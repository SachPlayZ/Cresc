/**
 * lib/circle/wallets.ts — Circle developer-controlled wallets adapter.
 * Wraps @circle-fin/developer-controlled-wallets for Cresc use cases:
 *   - Create/manage EOA wallets on ARC-TESTNET
 *   - Sign EIP-712 typed data (= EIP-3009) via Circle MPC — replaces raw private key path
 *   - USDC balance reads + transfers via Circle API
 *
 * Integration point: makeCircleSigner() returns a BatchEvmScheme-compatible signer.
 * When CIRCLE_API_KEY + CIRCLE_BUYER_WALLET_ID are set, lib/circle/index.ts uses this
 * signer instead of viem's privateKeyToAccount.
 *
 * Mock mode: when CIRCLE_API_KEY is absent, all functions return deterministic stubs.
 * keep-in-sync: agents/src/circle/wallets.ts
 */

import { createRequire } from "node:module";
import type { CircleDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import type { UsdcAmount } from "../money.js";
import { CIRCLE_API_KEY, ENTITY_SECRET } from "../config.js";

const _req = createRequire(import.meta.url);
const { initiateDeveloperControlledWalletsClient } = _req(
  "@circle-fin/developer-controlled-wallets"
) as typeof import("@circle-fin/developer-controlled-wallets");

const ARC_TESTNET = "ARC-TESTNET" as const;

// ---- Client singleton ----

let _client: CircleDeveloperControlledWalletsClient | null = null;

function getClient(): CircleDeveloperControlledWalletsClient {
  if (!_client) {
    if (!CIRCLE_API_KEY || !ENTITY_SECRET) {
      throw new Error("[wallets] CIRCLE_API_KEY and ENTITY_SECRET required");
    }
    _client = initiateDeveloperControlledWalletsClient({
      apiKey: CIRCLE_API_KEY,
      entitySecret: ENTITY_SECRET,
    });
  }
  return _client;
}

export const isCircleWalletMode = !!CIRCLE_API_KEY && !!ENTITY_SECRET;

// ---- Wallet creation ----

/** Create a new Cresc wallet set (one-time, called by setup script). */
export async function createWalletSet(name: string): Promise<string> {
  const resp = await getClient().createWalletSet({ name });
  const id = resp.data?.walletSet?.id;
  if (!id) throw new Error("[wallets] createWalletSet: no id in response");
  return id;
}

/**
 * Create an EOA wallet on ARC-TESTNET inside a wallet set.
 * Returns { walletId, address }.
 */
export async function createWallet(
  walletSetId: string,
  description: string
): Promise<{ walletId: string; address: string }> {
  const resp = await getClient().createWallets({
    accountType: "EOA",
    blockchains: [ARC_TESTNET],
    count: 1,
    walletSetId,
    metadata: [{ name: description, refId: description }],
  });
  const wallet = resp.data?.wallets?.[0];
  if (!wallet?.id || !wallet.address) {
    throw new Error("[wallets] createWallet: no wallet in response");
  }
  return { walletId: wallet.id, address: wallet.address };
}

// ---- Balance ----

/**
 * Get USDC balance of a Circle-managed wallet (6-decimal base units).
 * Uses Circle's token balance API — NOT viem ERC-20 call.
 */
export async function getCircleWalletBalance(walletId: string): Promise<UsdcAmount> {
  if (!isCircleWalletMode) return { value: 10_000_000n, decimals: 6 }; // mock: $10
  const resp = await getClient().getWalletTokenBalance({ id: walletId });
  const balances = resp.data?.tokenBalances ?? [];
  // Find USDC on Arc Testnet
  const usdcBalance = balances.find(
    (b) =>
      b.token?.blockchain === ARC_TESTNET &&
      b.token?.isNative === false &&
      (b.token?.symbol === "USDC" || b.token?.name?.includes("USD Coin"))
  );
  const raw = usdcBalance?.amount ?? "0";
  // Circle returns decimal string like "1.5" — convert to 6-dec base units
  const value = BigInt(Math.round(parseFloat(raw) * 1_000_000));
  return { value, decimals: 6 };
}

// ---- EIP-712 signing (the key integration: EIP-3009 = EIP-712 typed data) ----

/**
 * BatchEvmScheme-compatible signer backed by Circle's MPC signTypedData.
 * Plug this into new BatchEvmScheme(signer) to sign EIP-3009 payment authorizations
 * without ever holding a raw private key.
 */
export function makeCircleSigner(walletId: string, walletAddress: `0x${string}`) {
  return {
    address: walletAddress,
    signTypedData: async (params: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }): Promise<`0x${string}`> => {
      const eip712Data = {
        types: params.types,
        domain: params.domain,
        primaryType: params.primaryType,
        message: params.message,
      };
      const resp = await getClient().signTypedData({
        walletId,
        data: JSON.stringify(eip712Data),
      });
      const sig = resp.data?.signature;
      if (!sig) throw new Error("[wallets] signTypedData: no signature returned");
      return sig as `0x${string}`;
    },
  };
}

// ---- USDC transfers ----

/**
 * Transfer USDC from a Circle-managed wallet to any address on ARC-TESTNET.
 * Polls until transaction reaches a terminal state. Returns the on-chain tx hash.
 * Arc Testnet is sub-second, so this is fast in practice.
 */
export async function transferUsdc(
  fromWalletId: string,
  toAddress: string,
  amount: UsdcAmount,
  tokenAddress: string
): Promise<string> {
  const displayAmount = (Number(amount.value) / 1_000_000).toFixed(6);
  const resp = await getClient().createTransaction({
    walletId: fromWalletId,
    tokenAddress,
    destinationAddress: toAddress,
    amount: [displayAmount],
    idempotencyKey: crypto.randomUUID(),
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  const txId = resp.data?.id;
  if (!txId) throw new Error("[wallets] transferUsdc: no transaction id");
  return pollTransaction(txId);
}

/**
 * Poll a Circle transaction until it reaches a terminal state.
 * Returns the on-chain txHash on COMPLETE; throws on FAILED/DENIED/CANCELLED.
 */
export async function pollTransaction(
  txId: string,
  timeoutMs = 30_000
): Promise<string> {
  const TERMINAL = new Set(["COMPLETE", "FAILED", "DENIED", "CANCELLED"]);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resp = await getClient().getTransaction({ id: txId });
    const tx = resp.data?.transaction;
    const state = tx?.state;
    if (state && TERMINAL.has(state)) {
      if (state === "COMPLETE") return tx?.txHash ?? txId;
      throw new Error(`[wallets] transaction ${txId} ended in state: ${state}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`[wallets] transaction ${txId} timed out after ${timeoutMs}ms`);
}
