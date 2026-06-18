/**
 * lib/circle/index.ts — Circle/Arc adapter (M3).
 * Thin wrapper over @circle-fin/x402-batching + viem.
 * All Circle/Arc SDK types are sealed here; callers use UsdcAmount / TxRef / our types only.
 *
 * Mock mode: when ARC_RPC_URL or SELLER_PRIVATE_KEY is absent, every function returns
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
  SELLER_PRIVATE_KEY,
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

const isMockCircle = !ARC_RPC_URL || !SELLER_PRIVATE_KEY;

// Arc Testnet chain definition for viem (rpcUrls default is overridden per-client via transport).
const arcTestnetChain = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
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
  if (isMockCircle) {
    return {
      total: MOCK_BALANCE,
      withdrawable: MOCK_BALANCE,
      withdrawing: { value: 0n, decimals: 6 },
    };
  }
  const client = makeGatewayClient(SELLER_PRIVATE_KEY);
  const balances = await client.getBalances(address as `0x${string}`);
  const { total, withdrawable, withdrawing } = balances.gateway;
  const dec = 6; // Gateway balance bigints are 6-dec USDC (§4.2)
  return {
    total: { value: total, decimals: dec },
    withdrawable: { value: withdrawable, decimals: dec },
    withdrawing: { value: withdrawing, decimals: dec },
  };
}

/**
 * Build the x402 payment requirements object for BatchFacilitatorClient.
 * Pure function — no network calls. Inject standing price (base-unit string) + seller address.
 */
export function buildPaymentRequirements(
  price: UsdcAmount,
  sellerAddress: string
): X402Requirements {
  return {
    scheme: "exact",
    network: ARC_CAIP2,
    asset: USDC_ADDRESS,
    amount: price.value.toString(),
    // > 7 days: Gateway rejects validBefore < 7 days (CLAUDE.md §4.3)
    maxTimeoutSeconds: 604900,
    payTo: sellerAddress,
    extra: {
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: GATEWAY_WALLET_ADDRESS,
    },
  };
}

/**
 * Settle a signed x402 payment via Circle Gateway BatchFacilitatorClient.
 * Docs mandate settle() directly — do NOT call verify() then settle().
 */
export async function verifyAndSettle(
  signedAuth: EIP3009Auth,
  requirements: X402Requirements
): Promise<PaymentResult> {
  if (isMockCircle) {
    return { success: true, payer: "0xmock", txHash: MOCK_TX.hash };
  }
  const result = await getFacilitator().settle(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    signedAuth as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requirements as any
  );
  return {
    success: result.success,
    payer: result.payer,
    txHash: result.transaction,
    errorReason: result.errorReason,
  };
}

/**
 * Sign an EIP-3009 payment authorization (buyer side).
 * Uses BatchEvmScheme which signs against GatewayWallet (not USDC contract) per x402 batch spec.
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
  const account = privateKeyToAccount(privKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: arcTestnetChain,
    transport: http(requireRpc()),
  });
  // BatchEvmSigner-compatible wrapper (structural typing — no import of internal type needed)
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
export async function withdrawFromGateway(
  privKey: string,
  to: string,
  chain: string,
  amount: UsdcAmount
): Promise<TxRef> {
  if (isMockCircle) return { ...MOCK_TX, chain };
  const client = makeGatewayClient(privKey);
  const formatted = formatUnits(amount.value, amount.decimals);
  const result = await client.withdraw(formatted, {
    chain: chain as SupportedChainName,
    recipient: to as `0x${string}`,
  });
  return { hash: result.mintTxHash, chain };
}

/**
 * Arc Testnet explorer URL for a transaction.
 */
export function explorerUrl(txRef: TxRef): string {
  return `${ARC_EXPLORER_BASE}/tx/${txRef.hash}`;
}
