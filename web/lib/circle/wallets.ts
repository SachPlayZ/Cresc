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
import { pad, maxUint256, zeroAddress } from "viem";
import { randomBytes } from "node:crypto";
import type { CircleDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import type { UsdcAmount } from "../money";
import { CIRCLE_API_KEY, ENTITY_SECRET, GATEWAY_MINTER_ADDRESS, GATEWAY_WALLET_ADDRESS, USDC_ADDRESS, GATEWAY_FACILITATOR_URL } from "../config";

// tsx ESM resolution bug: load CJS bundle directly via createRequire.
const _req = createRequire(import.meta.url);
const { initiateDeveloperControlledWalletsClient } = _req(
  "@circle-fin/developer-controlled-wallets"
) as typeof import("@circle-fin/developer-controlled-wallets");

// Blockchain.ArcTestnet — inlined because ESM bundle doesn't export the enum.
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
  // Circle returns decimal string like "1.5" — use string arithmetic to avoid float precision loss
  const { fromDisplay } = await import('../money');
  const { value } = fromDisplay(raw, 6);
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
      // Circle requires EIP712Domain in types (viem omits it — implicit there).
      const domain = params.domain;
      const domainFields = [
        domain.name !== undefined && { name: "name", type: "string" },
        domain.version !== undefined && { name: "version", type: "string" },
        domain.chainId !== undefined && { name: "chainId", type: "uint256" },
        domain.verifyingContract !== undefined && { name: "verifyingContract", type: "address" },
        domain.salt !== undefined && { name: "salt", type: "bytes32" },
      ].filter(Boolean);

      // BigInt → number (safe) or decimal string — Circle API rejects raw BigInt.
      const serialize = (v: unknown): unknown =>
        typeof v === "bigint"
          ? v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString()
          : Array.isArray(v) ? v.map(serialize)
          : v && typeof v === "object"
            ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, serialize(val)]))
          : v;

      const eip712Data = serialize({
        types: { EIP712Domain: domainFields, ...params.types },
        domain: params.domain,
        primaryType: params.primaryType,
        message: params.message,
      });

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
 * Deposit USDC from a Circle-managed wallet into the Gateway contract.
 * Two-step: approve(GATEWAY_WALLET_ADDRESS, amount) then deposit(USDC_ADDRESS, amount).
 * Uses createContractExecutionTransaction — NOT a plain ERC-20 transfer.
 *
 * Plain transferUsdc to GATEWAY_WALLET_ADDRESS does NOT register a Gateway balance;
 * the Gateway requires calling its deposit() function explicitly.
 */
export async function depositToGatewayCircle(
  walletId: string,
  gatewayAddress: string,
  usdcAddress: string,
  amount: UsdcAmount,
): Promise<string> {
  const client = getClient();
  const amountStr = amount.value.toString(); // base units (uint256)

  // Step 1: approve Gateway to spend USDC
  const approveResp = await client.createContractExecutionTransaction({
    walletId,
    contractAddress: usdcAddress,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: [gatewayAddress, amountStr],
    idempotencyKey: crypto.randomUUID(),
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  const approveTxId = approveResp.data?.id;
  if (!approveTxId) throw new Error("[wallets] depositToGatewayCircle: no approve tx id");
  await pollTransaction(approveTxId);

  // Step 2: call deposit(token, value) on the Gateway contract
  const depositResp = await client.createContractExecutionTransaction({
    walletId,
    contractAddress: gatewayAddress,
    abiFunctionSignature: "deposit(address,uint256)",
    abiParameters: [usdcAddress, amountStr],
    idempotencyKey: crypto.randomUUID(),
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  const depositTxId = depositResp.data?.id;
  if (!depositTxId) throw new Error("[wallets] depositToGatewayCircle: no deposit tx id");
  return pollTransaction(depositTxId);
}

// BurnIntent EIP-712 constants — verified from SDK source (CREATOR_PAYOUT.md M-P0)
const ARC_DOMAIN = 26; // GATEWAY_DOMAINS.arcTestnet
const EIP712_BURN_DOMAIN = { name: "GatewayWallet", version: "1" }; // no chainId, no verifyingContract
const BURN_INTENT_TYPES = {
  TransferSpec: [
    { name: "version",              type: "uint32" },
    { name: "sourceDomain",         type: "uint32" },
    { name: "destinationDomain",    type: "uint32" },
    { name: "sourceContract",       type: "bytes32" },
    { name: "destinationContract",  type: "bytes32" },
    { name: "sourceToken",          type: "bytes32" },
    { name: "destinationToken",     type: "bytes32" },
    { name: "sourceDepositor",      type: "bytes32" },
    { name: "destinationRecipient", type: "bytes32" },
    { name: "sourceSigner",         type: "bytes32" },
    { name: "destinationCaller",    type: "bytes32" },
    { name: "value",                type: "uint256" },
    { name: "salt",                 type: "bytes32" },
    { name: "hookData",             type: "bytes" },
  ],
  BurnIntent: [
    { name: "maxBlockHeight", type: "uint256" },
    { name: "maxFee",         type: "uint256" },
    { name: "spec",           type: "TransferSpec" },
  ],
};

/**
 * Withdraw USDC from the platform Gateway balance to a recipient address.
 * Replaces GatewayClient.withdraw() using Circle MPC signing instead of raw EOA key.
 * Steps: sign BurnIntent → POST /transfer → gatewayMint contract call.
 *
 * Mock mode (no Circle keys): returns a deterministic fake tx hash.
 */
export async function withdrawFromGatewayCircle(
  sellerWalletId: string,
  sellerAddress: string,
  recipientAddress: string,
  amount: UsdcAmount,
): Promise<string> {
  if (!isCircleWalletMode) {
    // Mock mode — no real withdrawal, return fake hash for demo
    return "0x" + "ab".repeat(32);
  }

  const addressToBytes32 = (addr: string): `0x${string}` =>
    pad(addr.toLowerCase() as `0x${string}`, { size: 32, dir: "left" });

  const maxFee = 2_010_000n; // $2.01 ceiling — actual fee is 0 on same-chain Arc (SDK default)

  const burnIntent = {
    maxBlockHeight: maxUint256,
    maxFee,
    spec: {
      version: 1,
      sourceDomain: ARC_DOMAIN,
      destinationDomain: ARC_DOMAIN,
      sourceContract: addressToBytes32(GATEWAY_WALLET_ADDRESS),
      destinationContract: addressToBytes32(GATEWAY_MINTER_ADDRESS),
      sourceToken: addressToBytes32(USDC_ADDRESS),
      destinationToken: addressToBytes32(USDC_ADDRESS),
      sourceDepositor: addressToBytes32(sellerAddress),
      destinationRecipient: addressToBytes32(recipientAddress),
      sourceSigner: addressToBytes32(sellerAddress),
      destinationCaller: addressToBytes32(zeroAddress),
      value: amount.value,
      salt: `0x${randomBytes(32).toString("hex")}` as `0x${string}`,
      hookData: "0x" as `0x${string}`,
    },
  };

  // Sign BurnIntent with Circle MPC
  const signer = makeCircleSigner(sellerWalletId, sellerAddress as `0x${string}`);
  const signature = await signer.signTypedData({
    domain: EIP712_BURN_DOMAIN as Record<string, unknown>,
    types: BURN_INTENT_TYPES as Record<string, unknown>,
    primaryType: "BurnIntent",
    message: burnIntent as unknown as Record<string, unknown>,
  });

  // POST to Gateway API /transfer
  const response = await fetch(`${GATEWAY_FACILITATOR_URL}/transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      [{ burnIntent, signature }],
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
    ),
  });
  const result = await response.json() as { attestation?: string; signature?: string };
  if (!result.attestation || !result.signature) {
    throw new Error(`[wallets] Gateway /transfer error: ${JSON.stringify(result)}`);
  }

  // Call gatewayMint on GatewayMinter contract via Circle
  const client = getClient();
  const mintResp = await client.createContractExecutionTransaction({
    walletId: sellerWalletId,
    contractAddress: GATEWAY_MINTER_ADDRESS,
    abiFunctionSignature: "gatewayMint(bytes,bytes)",
    abiParameters: [result.attestation, result.signature],
    idempotencyKey: crypto.randomUUID(),
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  const mintTxId = mintResp.data?.id;
  if (!mintTxId) throw new Error("[wallets] gatewayMint: no tx id");
  return pollTransaction(mintTxId);
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
