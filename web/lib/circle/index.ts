/**
 * lib/circle/index.ts — Circle/Arc adapter (M3).
 * Thin wrapper over @circle-fin/x402-batching + viem.
 * All Circle/Arc SDK types are sealed here; callers use UsdcAmount / TxRef / our types only.
 *
 * Mock mode: when neither ARC_RPC_URL nor Circle wallet mode available, every function returns
 * a deterministic stub so the spine runs without testnet config.
 *
 * keep-in-sync: Cresc-Agents/src/circle/index.ts mirrors this file.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";
import {
  GatewayClient,
  BatchEvmScheme,
  type SupportedChainName,
} from "@circle-fin/x402-batching/client";
import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
import type { UsdcAmount } from "../money";
import {
  ARC_CHAIN_ID,
  ARC_CAIP2,
  ARC_SDK_CHAIN,
  USDC_ADDRESS,
  GATEWAY_WALLET_ADDRESS,
  GATEWAY_FACILITATOR_URL,
  ARC_EXPLORER_BASE,
  ARC_RPC_URL,
  isCircleWalletMode,
} from "../config";

// --- Public types (no SDK leaks past this barrel) ---

export type TxRef = { hash: `0x${string}`; chain: string };

export type X402Requirements = {
  scheme: string;
  network: string;
  asset: string;
  /** Standing price in 6-decimal base units as a string (e.g. "10000" = $0.01). */
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
};

export type EIP3009Auth = {
  x402Version: number;
  payload: Record<string, unknown>;
};

export type PaymentResult = {
  success: boolean;
  payer?: string;
  txHash?: string;
  errorReason?: string;
};

// --- Internal helpers ---

// Mock only when neither RPC nor Circle wallet mode available.
const isMockCircle = !ARC_RPC_URL && !isCircleWalletMode;

// Arc Testnet chain definition for viem (rpcUrls default is overridden per-client via transport).
const arcTestnetChain = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL || "https://arc-testnet.drpc.org"] } },
});

const ERC20_ABI = [
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const CONTENT_VAULT_ABI = [
  {
    name: "priceAtomic",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "withdrawNonce",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "totalWithdrawnAtomic",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

const ERC20_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

function requireRpc(): string {
  if (!ARC_RPC_URL) throw new Error("[circle] ARC_RPC_URL not set");
  return ARC_RPC_URL;
}

function makePublicClient() {
  return createPublicClient({
    chain: arcTestnetChain,
    transport: http(requireRpc()),
  });
}

function makeGatewayClient(privKey: string) {
  return new GatewayClient({
    chain: ARC_SDK_CHAIN as SupportedChainName,
    privateKey: privKey as `0x${string}`,
    rpcUrl: requireRpc(),
  });
}

// Startup assertion — lazy singleton; runs once on first verifyAndSettle call.
// Vercel is stateless so we can't do this at module init with a real RPC call.
let _startupAssertionDone = false;
async function runStartupAssertionOnce(): Promise<void> {
  if (_startupAssertionDone || isMockCircle) return;
  _startupAssertionDone = true;
  const client = makePublicClient();
  const [chainId, decimals] = await Promise.all([
    client.getChainId(),
    client.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "decimals" }),
  ]);
  if (chainId !== ARC_CHAIN_ID) {
    throw new Error(`[circle] chain id mismatch: expected ${ARC_CHAIN_ID}, got ${chainId}`);
  }
  if (decimals !== 6) {
    throw new Error(`[circle] USDC decimals: expected 6, got ${decimals}`);
  }
  console.log("[circle] startup assertions passed: chainId=5042002, USDC decimals=6");
}

// Singleton facilitator — URL is a constant, safe to init at module level.
// Lazy so missing env doesn't throw at import time in mock mode.
let _facilitator: BatchFacilitatorClient | null = null;
function getFacilitator() {
  if (!_facilitator) {
    _facilitator = new BatchFacilitatorClient({ url: GATEWAY_FACILITATOR_URL });
  }
  return _facilitator;
}

// --- Mock stubs ---

const MOCK_TX: TxRef = {
  hash: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  chain: ARC_SDK_CHAIN,
};

const MOCK_BALANCE: UsdcAmount = { value: 10_000_000n, decimals: 6 }; // $10 mock

// --- Public API ---

/**
 * Read USDC ERC-20 balance for any address.
 * Reads `decimals()` from the contract — never hardcodes 1e6 (CLAUDE.md §4.2).
 */
export async function getUsdcBalance(address: string): Promise<UsdcAmount> {
  if (isMockCircle) return MOCK_BALANCE;
  const client = makePublicClient();
  const [decimals, balance] = await Promise.all([
    client.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "decimals",
    }),
    client.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    }),
  ]);
  return { value: balance, decimals };
}

/**
 * One-time deposit of USDC from a wallet into the Circle Gateway.
 * Requires native USDC gas on Arc. Returns the deposit tx hash.
 */
export async function depositToGateway(privKey: string, amount: UsdcAmount): Promise<TxRef> {
  if (isMockCircle) return MOCK_TX;
  const client = makeGatewayClient(privKey);
  const formatted = formatUnits(amount.value, amount.decimals);
  const result = await client.deposit(formatted);
  return { hash: result.depositTxHash, chain: ARC_SDK_CHAIN };
}

/**
 * Read all Gateway balance tiers (total / withdrawable / withdrawing) for any address.
 * Gateway bigints are 6-decimal USDC base units.
 */
export async function getGatewayBalance(address: string): Promise<{
  total: UsdcAmount;
  withdrawable: UsdcAmount;
  withdrawing: UsdcAmount;
}> {
  void address;
  if (isMockCircle) {
    return {
      total: MOCK_BALANCE,
      withdrawable: MOCK_BALANCE,
      withdrawing: { value: 0n, decimals: 6 },
    };
  }
  throw new Error('[circle] getGatewayBalance is deprecated in contract-native payment flow');
}

/**
 * Build the x402 payment requirements object for BatchFacilitatorClient.
 * Pure function — no network calls. Inject standing price (base-unit string) + seller address.
 */
export function buildPaymentRequirements(
  price: UsdcAmount,
  payToAddress: string
): X402Requirements {
  return {
    scheme: "exact",
    network: ARC_CAIP2,
    asset: USDC_ADDRESS,
    amount: price.value.toString(),
    // > 7 days: Gateway rejects validBefore < 7 days (CLAUDE.md §4.3)
    maxTimeoutSeconds: 345600,
    payTo: payToAddress,
    extra: {
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: GATEWAY_WALLET_ADDRESS,
    },
  };
}

/** Current withdrawal nonce for a ContentVault — required for building the EIP-712
 * withdrawal message the creator's UCW wallet signs (see /api/withdraw/sign-request). */
export async function readVaultWithdrawNonce(contentContract: string): Promise<bigint> {
  if (isMockCircle || !ARC_RPC_URL) return 0n;
  return makePublicClient().readContract({
    address: contentContract as `0x${string}`,
    abi: CONTENT_VAULT_ABI,
    functionName: "withdrawNonce",
  });
}

/** Cumulative atomic USDC ever withdrawn from a vault (direct + relayed). Snapshotting
 * this at sign-time and re-checking it at relay-time detects "a withdrawal happened in
 * between" even in cases the vault's own withdrawNonce wouldn't catch (ContentVault's
 * deployed bytecode doesn't bump withdrawNonce on a direct withdraw) — see /api/withdraw
 * /sign-request and /prepare. */
export async function readVaultTotalWithdrawn(contentContract: string): Promise<bigint> {
  if (isMockCircle || !ARC_RPC_URL) return 0n;
  return makePublicClient().readContract({
    address: contentContract as `0x${string}`,
    abi: CONTENT_VAULT_ABI,
    functionName: "totalWithdrawnAtomic",
  });
}

/** USDC (ERC-20, 6dp) balance of any Arc address. */
export async function readUsdcBalance(address: string): Promise<bigint> {
  if (isMockCircle || !ARC_RPC_URL) return 0n;
  return makePublicClient().readContract({
    address: USDC_ADDRESS as `0x${string}`,
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
  });
}

/** Current USDC balance held by a ContentVault — this *is* "all earnings" for that
 * piece of content, since x402 settlement pays directly into the vault. */
export async function readVaultBalance(contentContract: string): Promise<bigint> {
  return readUsdcBalance(contentContract);
}

/** Native ARC balance (18dp) of any address — gas only, never USDC (CLAUDE.md §4.2). */
export async function readNativeBalance(address: string): Promise<bigint> {
  if (isMockCircle || !ARC_RPC_URL) return 0n;
  return makePublicClient().getBalance({ address: address as `0x${string}` });
}

export async function readContentPriceAtomic(
  contentContract: string,
  fallbackAtomic: string
): Promise<string> {
  if (isMockCircle || !ARC_RPC_URL) return fallbackAtomic;
  try {
    const price = await makePublicClient().readContract({
      address: contentContract as `0x${string}`,
      abi: CONTENT_VAULT_ABI,
      functionName: "priceAtomic",
    });
    return price.toString();
  } catch {
    return fallbackAtomic;
  }
}

/**
 * Verify then settle a signed x402 payment via Circle Gateway BatchFacilitatorClient.
 * verify() validates the signature offchain; settle() triggers onchain settlement.
 */
export async function verifyAndSettle(
  signedAuth: EIP3009Auth,
  requirements: X402Requirements
): Promise<PaymentResult> {
  if (isMockCircle) {
    return { success: true, payer: "0xmock", txHash: MOCK_TX.hash };
  }
  await runStartupAssertionOnce();
  const facilitator = getFacilitator();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const verifyResult = await facilitator.verify(signedAuth as any, requirements as any);
  if (!verifyResult.isValid) {
    return { success: false, errorReason: verifyResult.invalidReason ?? "verification failed" };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settleResult = await facilitator.settle(signedAuth as any, requirements as any);
  return {
    success: settleResult.success,
    payer: settleResult.payer,
    txHash: settleResult.transaction,
    errorReason: settleResult.errorReason,
  };
}

/**
 * Sign an EIP-3009 payment authorization (buyer side).
 * Buyer side must use a raw-key EOA. Circle SCA/EIP-1271 signatures are not accepted by x402 Gateway ecrecover.
 * BatchEvmScheme handles building the EIP-712 typed data and calling signer.signTypedData.
 */
export async function signPaymentAuthorization(
  privKey: string,
  requirements: X402Requirements
): Promise<EIP3009Auth> {
  if (isMockCircle) {
    return {
      x402Version: 2,
      payload: {
        signature: "0xmocksig",
        authorization: {
          from: "0xmockbuyer",
          to: GATEWAY_WALLET_ADDRESS,
          value: requirements.amount,
          validAfter: "0",
          validBefore: String(Math.floor(Date.now() / 1000) + 604900),
          nonce: "0xmocknonce",
        },
      },
    };
  }

  if (!privKey) throw new Error("[circle] raw buyer private key required for x402 EIP-3009 signing");
  const account = privateKeyToAccount(privKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: arcTestnetChain,
    transport: http(requireRpc()),
  });
  const signer = {
    address: account.address,
    signTypedData: (params: Parameters<typeof walletClient.signTypedData>[0]) =>
      walletClient.signTypedData(params),
  };

  const scheme = new BatchEvmScheme(signer);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = await scheme.createPaymentPayload(2, requirements as any);
  return payload as unknown as EIP3009Auth;
}

/**
 * Withdraw USDC from Gateway to a wallet.
 * Same-chain: instant. Cross-chain: requires gas on destination.
 */
// withdrawFromGateway — EC2-only operation (requires BUYER_PRIVATE_KEY + entity secret).
// Vercel never calls this directly. Routed through /agent/withdraw on EC2.
export async function withdrawFromGateway(
  _privKey: string,
  _to: string,
  _chain: string,
  _amount: UsdcAmount
): Promise<TxRef> {
  void _privKey;
  void _to;
  void _chain;
  void _amount;
  throw new Error('[circle] withdrawFromGateway must be called on EC2 via /agent/withdraw endpoint');
}

/**
 * Arc Testnet explorer URL for a transaction.
 */
export function explorerUrl(txRef: TxRef): string {
  return `${ARC_EXPLORER_BASE}/tx/${txRef.hash}`;
}
