/**
 * lib/reader-wallets/index.ts — per-reader custodial EOA module.
 *
 * Identity: cresc_reader_id cookie (httpOnly, 1yr). No login, no MetaMask for identity.
 * MetaMask is only for the one-time USDC deposit step.
 *
 * Two wallet backends:
 *   - Raw EOA (default): generatePrivateKey() + AES-256-GCM encrypt → reader_wallets.key_enc
 *   - Circle dev-controlled (when CIRCLE_API_KEY + ENTITY_SECRET set): MPC wallet, no raw key in DB
 *
 * Mock mode: !ARC_RPC_URL || !SUPABASE_URL → deterministic stubs, no DB/chain calls.
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createWalletClient, defineChain, http } from "viem";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createServerClient } from "../db";
import {
  ARC_CHAIN_ID,
  ARC_RPC_URL,
  GATEWAY_WALLET_ADDRESS,
  READER_KEY_SECRET,
  CIRCLE_WALLET_SET_ID,
  SUPABASE_URL,
} from "../config";
import {
  getUsdcBalance,
  depositToGateway,
  getGatewayBalance,
} from "../circle/index";
import type { X402Requirements, EIP3009Auth } from "../circle/index";
import { isCircleWalletMode, createWallet, makeCircleSigner, depositToGatewayCircle } from "../circle/wallets";
import { USDC_ADDRESS } from "../config";
import { BatchEvmScheme } from "@circle-fin/x402-batching/client";
import type { ReaderWallet } from "../repo/types";

export const isMockReaderWallet = !ARC_RPC_URL || !SUPABASE_URL;

// AES-256-GCM constants
const ALG = "aes-256-gcm" as const;
const IV_LEN = 12;

const arcTestnetChain = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: [ARC_RPC_URL || "https://arc-testnet.drpc.org"] } },
});

// --- Crypto helpers ---

function encryptKey(privKey: string): string {
  if (!READER_KEY_SECRET) throw new Error("[reader-wallets] READER_KEY_SECRET not set");
  const keyBuf = Buffer.from(READER_KEY_SECRET, "hex");
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, keyBuf, iv);
  const encrypted = Buffer.concat([cipher.update(privKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptKey(enc: string): `0x${string}` {
  if (!READER_KEY_SECRET) throw new Error("[reader-wallets] READER_KEY_SECRET not set");
  const keyBuf = Buffer.from(READER_KEY_SECRET, "hex");
  const [ivHex, tagHex, ctHex] = enc.split(":");
  const decipher = createDecipheriv(
    ALG,
    keyBuf,
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctHex, "hex")),
    decipher.final(),
  ]).toString("utf8") as `0x${string}`;
}

// --- Internal wallet creators ---

async function createRawEOA(readerId: string): Promise<ReaderWallet> {
  const privKey = generatePrivateKey();
  const account = privateKeyToAccount(privKey);
  const db = createServerClient();
  const { data, error } = await db
    .from("reader_wallets")
    .insert({
      reader_id: readerId,
      eoa_address: account.address,
      key_enc: encryptKey(privKey),
    })
    .select()
    .single();
  if (error) throw new Error(`[reader-wallets] createRawEOA: ${error.message}`);
  return data as ReaderWallet;
}

async function createCircleReaderWallet(readerId: string): Promise<ReaderWallet> {
  const { walletId, address } = await createWallet(CIRCLE_WALLET_SET_ID, `reader:${readerId}`);
  const db = createServerClient();
  const { data, error } = await db
    .from("reader_wallets")
    .insert({
      reader_id: readerId,
      eoa_address: address,
      circle_wallet_id: walletId,
    })
    .select()
    .single();
  if (error) throw new Error(`[reader-wallets] createCircleReaderWallet: ${error.message}`);
  return data as ReaderWallet;
}

// --- Mock stub ---

const MOCK_READER_WALLET: ReaderWallet = {
  id: "mock-wallet-id",
  reader_id: "mock-reader",
  eoa_address: "0xMockReaderEOA0000000000000000000000000000",
  key_enc: null,
  circle_wallet_id: null,
  usdc_deposited: "100000",
  usdc_spent: "0",
  gateway_funded: true,
  created_at: new Date().toISOString(),
  last_seen_at: new Date().toISOString(),
};

// --- Public API ---

/** Get or create the custodial EOA for this reader_id. */
export async function getOrCreateReaderWallet(readerId: string): Promise<ReaderWallet> {
  if (isMockReaderWallet) return { ...MOCK_READER_WALLET, reader_id: readerId };

  const db = createServerClient();
  const { data: existing } = await db
    .from("reader_wallets")
    .select()
    .eq("reader_id", readerId)
    .maybeSingle();

  if (existing) {
    await db
      .from("reader_wallets")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("reader_id", readerId);
    return existing as ReaderWallet;
  }

  if (isCircleWalletMode && CIRCLE_WALLET_SET_ID) {
    return createCircleReaderWallet(readerId);
  }
  if (!READER_KEY_SECRET) {
    throw new Error("[reader-wallets] READER_KEY_SECRET not set — add it to .env.local (generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\")");
  }
  return createRawEOA(readerId);
}

/**
 * Fetch on-chain + gateway balances for the reader's EOA.
 * If on-chain USDC arrived and gateway_funded=false, auto-deposits into Gateway.
 */
export async function getReaderBalance(readerId: string): Promise<{
  onChain: bigint;
  gatewayAvailable: bigint;
  gatewayFunded: boolean;
}> {
  if (isMockReaderWallet) {
    return { onChain: 0n, gatewayAvailable: 100000n, gatewayFunded: true };
  }

  const wallet = await getOrCreateReaderWallet(readerId);
  const [onChainUsdc, gatewayBal] = await Promise.all([
    getUsdcBalance(wallet.eoa_address),
    getGatewayBalance(wallet.eoa_address),
  ]);

  const onChain = onChainUsdc.value;
  let gatewayAvailable = gatewayBal.withdrawable.value;

  // Auto-deposit: whenever on-chain USDC arrives, move it into Gateway.
  // Runs on first deposit AND subsequent top-ups — after each successful deposit
  // the on-chain balance drops to 0, so repeated calls are cheap no-ops.
  if (onChain > 0n) {
    let depositSucceeded = false;
    try {
      if (wallet.key_enc) {
        const privKey = decryptKey(wallet.key_enc);
        await depositToGateway(privKey, onChainUsdc);
      } else if (wallet.circle_wallet_id) {
        await depositToGatewayCircle(wallet.circle_wallet_id, GATEWAY_WALLET_ADDRESS, USDC_ADDRESS, onChainUsdc);
      }
      depositSucceeded = true;
    } catch (err) {
      console.error("[reader-wallets] auto-deposit failed:", err);
    }

    if (depositSucceeded) {
      const db = createServerClient();
      await db
        .from("reader_wallets")
        .update({
          gateway_funded: true,
          usdc_deposited: (BigInt(wallet.usdc_deposited || "0") + onChain).toString(),
        })
        .eq("reader_id", readerId);
      // Re-read Gateway balance so the returned value reflects the deposit we just made.
      try {
        const refreshed = await getGatewayBalance(wallet.eoa_address);
        gatewayAvailable = refreshed.withdrawable.value;
      } catch {
        // keep pre-deposit value — settlement may still work if Gateway confirms fast
      }
    }
  }

  return {
    onChain,
    gatewayAvailable,
    // Only report funded when Gateway actually has a positive balance.
    gatewayFunded: gatewayAvailable > 0n,
  };
}

/**
 * Sign an EIP-3009 payment authorization using the reader's EOA (server-side).
 * Raw EOA path: decrypt key → viem WalletClient + BatchEvmScheme.
 * Circle path: makeCircleSigner → BatchEvmScheme.
 */
export async function signReaderPayment(
  readerId: string,
  requirements: X402Requirements
): Promise<EIP3009Auth> {
  if (isMockReaderWallet) {
    return {
      x402Version: 2,
      payload: {
        signature: "0xmocksig",
        authorization: {
          from: "0xmockreader",
          to: GATEWAY_WALLET_ADDRESS,
          value: requirements.amount,
          validAfter: "0",
          validBefore: String(Math.floor(Date.now() / 1000) + 604900),
          nonce: "0xmocknonce",
        },
      },
    };
  }

  const wallet = await getOrCreateReaderWallet(readerId);

  let signer: {
    address: `0x${string}`;
    signTypedData: (...args: unknown[]) => Promise<`0x${string}`>;
  };

  if (wallet.circle_wallet_id) {
    signer = makeCircleSigner(
      wallet.circle_wallet_id,
      wallet.eoa_address as `0x${string}`
    ) as typeof signer;
  } else {
    if (!wallet.key_enc) throw new Error("[reader-wallets] no signing key for wallet");
    const privKey = decryptKey(wallet.key_enc);
    const account = privateKeyToAccount(privKey);
    const wc = createWalletClient({
      account,
      chain: arcTestnetChain,
      transport: http(ARC_RPC_URL),
    });
    signer = {
      address: account.address,
      signTypedData: (params: Parameters<typeof wc.signTypedData>[0]) =>
        wc.signTypedData(params),
    } as typeof signer;
  }

  const scheme = new BatchEvmScheme(signer);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = await scheme.createPaymentPayload(2, requirements as any);
  return payload as unknown as EIP3009Auth;
}

/** Increment usdc_spent after a confirmed unlock settlement. */
export async function recordSpend(readerId: string, amountBaseUnits: bigint): Promise<void> {
  if (isMockReaderWallet) return;
  const db = createServerClient();
  const { data: w } = await db
    .from("reader_wallets")
    .select("usdc_spent")
    .eq("reader_id", readerId)
    .maybeSingle();
  if (!w) return;
  const newSpent = (BigInt(w.usdc_spent || "0") + amountBaseUnits).toString();
  await db.from("reader_wallets").update({ usdc_spent: newSpent }).eq("reader_id", readerId);
}

/** Remaining spendable: usdc_deposited - usdc_spent (DB view, no chain call). */
export async function getSpendableBalance(readerId: string): Promise<bigint> {
  if (isMockReaderWallet) return 100000n;
  const db = createServerClient();
  const { data: w } = await db
    .from("reader_wallets")
    .select("usdc_deposited,usdc_spent")
    .eq("reader_id", readerId)
    .maybeSingle();
  if (!w) return 0n;
  const deposited = BigInt(w.usdc_deposited || "0");
  const spent = BigInt(w.usdc_spent || "0");
  return deposited > spent ? deposited - spent : 0n;
}
