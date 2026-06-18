/**
 * src/circle/index.ts — Circle/Arc adapter for agents service (M3).
 * keep-in-sync: Cresc/lib/circle/index.ts
 *
 * Agents only use seller-side operations (getUsdcBalance, getGatewayBalance,
 * buildPaymentRequirements, verifyAndSettle, withdrawFromGateway, explorerUrl).
 * signPaymentAuthorization + depositToGateway included for completeness / scripts.
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
import type { UsdcAmount } from "../money.js";
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
} from "../config.js";

export type TxRef = { hash: `0x${string}`; chain: string };

export type X402Requirements = {
  scheme: string;
  network: string;
  asset: string;
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

const isMockCircle = !ARC_RPC_URL || !SELLER_PRIVATE_KEY;

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

let _facilitator: BatchFacilitatorClient | null = null;
function getFacilitator() {
  if (!_facilitator) {
    _facilitator = new BatchFacilitatorClient({ url: GATEWAY_FACILITATOR_URL });
  }
  return _facilitator;
}

const MOCK_TX: TxRef = {
  hash: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  chain: ARC_SDK_CHAIN,
};
const MOCK_BALANCE: UsdcAmount = { value: 10_000_000n, decimals: 6 };

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

export async function depositToGateway(privKey: string, amount: UsdcAmount): Promise<TxRef> {
  if (isMockCircle) return MOCK_TX;
  const client = makeGatewayClient(privKey);
  const formatted = formatUnits(amount.value, amount.decimals);
  const result = await client.deposit(formatted);
  return { hash: result.depositTxHash, chain: ARC_SDK_CHAIN };
}

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
  const dec = 6;
  return {
    total: { value: total, decimals: dec },
    withdrawable: { value: withdrawable, decimals: dec },
    withdrawing: { value: withdrawing, decimals: dec },
  };
}

export function buildPaymentRequirements(
  price: UsdcAmount,
  sellerAddress: string
): X402Requirements {
  return {
    scheme: "exact",
    network: ARC_CAIP2,
    asset: USDC_ADDRESS,
    amount: price.value.toString(),
    maxTimeoutSeconds: 604900,
    payTo: sellerAddress,
    extra: {
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: GATEWAY_WALLET_ADDRESS,
    },
  };
}

export async function verifyAndSettle(
  signedAuth: EIP3009Auth,
  requirements: X402Requirements
): Promise<PaymentResult> {
  if (isMockCircle) {
    return { success: true, payer: "0xmock", txHash: MOCK_TX.hash };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await getFacilitator().settle(signedAuth as any, requirements as any);
  return {
    success: result.success,
    payer: result.payer,
    txHash: result.transaction,
    errorReason: result.errorReason,
  };
}

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

export function explorerUrl(txRef: TxRef): string {
  return `${ARC_EXPLORER_BASE}/tx/${txRef.hash}`;
}
