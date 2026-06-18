/**
 * scripts/test-gateway.mts — end-to-end Gateway settlement test.
 *
 * Uses Circle developer-controlled wallet (CIRCLE_BUYER_WALLET_ID) to sign
 * an EIP-3009 payment auth and settle it against the Circle Gateway API.
 * No Next.js server needed.
 *
 * Run: npx tsx --env-file=.env.local scripts/test-gateway.mts
 */

import { createRequire } from "node:module";
import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
import { BatchEvmScheme } from "@circle-fin/x402-batching/client";

const _req = createRequire(import.meta.url);
const { initiateDeveloperControlledWalletsClient } = _req(
  "@circle-fin/developer-controlled-wallets"
) as typeof import("@circle-fin/developer-controlled-wallets");

// --- Config (from env) ---
const CIRCLE_API_KEY      = process.env.CIRCLE_API_KEY!;
const ENTITY_SECRET       = process.env.ENTITY_SECRET!;
const CIRCLE_BUYER_WALLET_ID      = process.env.CIRCLE_BUYER_WALLET_ID!;
const CIRCLE_BUYER_WALLET_ADDRESS = process.env.CIRCLE_BUYER_WALLET_ADDRESS!;
const SELLER_ADDRESS      = process.env.SELLER_ADDRESS!;
const GATEWAY_FACILITATOR = "https://gateway-api-testnet.circle.com";
const USDC_ADDRESS        = "0x3600000000000000000000000000000000000000";
const GATEWAY_WALLET      = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const ARC_CAIP2           = "eip155:5042002";

for (const [k, v] of Object.entries({ CIRCLE_API_KEY, ENTITY_SECRET, CIRCLE_BUYER_WALLET_ID, CIRCLE_BUYER_WALLET_ADDRESS, SELLER_ADDRESS })) {
  if (!v) { console.error(`Missing env var: ${k}`); process.exit(1); }
}

// --- Circle wallet client ---
const circleClient = initiateDeveloperControlledWalletsClient({ apiKey: CIRCLE_API_KEY, entitySecret: ENTITY_SECRET });

// BatchEvmScheme-compatible signer backed by Circle MPC
const signer = {
  address: CIRCLE_BUYER_WALLET_ADDRESS as `0x${string}`,
  signTypedData: async (params: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<`0x${string}`> => {
    // BigInt → number if safe, else decimal string
    const serialize = (v: unknown): unknown =>
      typeof v === "bigint"
        ? v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString()
        : Array.isArray(v) ? v.map(serialize)
        : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k2, v2]) => [k2, serialize(v2)]))
        : v;

    // Circle requires EIP712Domain in types (viem omits it — it's implicit there).
    const domain = params.domain as Record<string, unknown>;
    const domainFields = [
      domain.name !== undefined && { name: "name", type: "string" },
      domain.version !== undefined && { name: "version", type: "string" },
      domain.chainId !== undefined && { name: "chainId", type: "uint256" },
      domain.verifyingContract !== undefined && { name: "verifyingContract", type: "address" },
      domain.salt !== undefined && { name: "salt", type: "bytes32" },
    ].filter(Boolean);

    const typesWithDomain = {
      EIP712Domain: domainFields,
      ...params.types,
    };

    const eip712 = serialize({ types: typesWithDomain, domain: params.domain, primaryType: params.primaryType, message: params.message });

    const resp = await circleClient.signTypedData({
      walletId: CIRCLE_BUYER_WALLET_ID,
      data: JSON.stringify(eip712),
    });
    const sig = resp.data?.signature;
    if (!sig) throw new Error("No signature returned from Circle");
    console.log("  ✓ Circle MPC signed EIP-3009 auth");
    return sig as `0x${string}`;
  },
};

// --- Test ---
const TEST_AMOUNT = "1000"; // $0.001 USDC (6 dec)

const requirements = {
  scheme: "exact",
  network: ARC_CAIP2,
  asset: USDC_ADDRESS,
  amount: TEST_AMOUNT,
  maxTimeoutSeconds: 604900,
  payTo: SELLER_ADDRESS,
  extra: {
    name: "GatewayWalletBatched",
    version: "1",
    verifyingContract: GATEWAY_WALLET,
  },
};

console.log("\n=== Cresc Gateway Test ===");
console.log(`  Payer:  ${CIRCLE_BUYER_WALLET_ADDRESS}`);
console.log(`  Payee:  ${SELLER_ADDRESS}`);
console.log(`  Amount: $${(parseInt(TEST_AMOUNT) / 1_000_000).toFixed(6)} USDC`);
console.log(`  Gateway: ${GATEWAY_FACILITATOR}\n`);

try {
  // Step 1: Sign EIP-3009 auth with Circle MPC
  console.log("1. Signing payment authorization (Circle MPC)…");
  const scheme = new BatchEvmScheme(signer);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = await scheme.createPaymentPayload(2, requirements as any);
  console.log("  ✓ Payment payload created");

  // Step 2: Settle via Gateway.
  // settle() expects the full payment payload that includes resource + accepted
  // (normally injected from the 402 PAYMENT-REQUIRED header in the real flow).
  const fullPayload = {
    ...(payload as object),
    resource: { url: "https://cresc.test/api/piece/test", description: "Cresc article unlock", mimeType: "application/json" },
    accepted: requirements,                          // chosen payment option
  };

  console.log("2. Settling with Circle Gateway…");
  const facilitator = new BatchFacilitatorClient({ url: GATEWAY_FACILITATOR });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await facilitator.settle(fullPayload as any, requirements as any);

  console.log("  [debug] settle result:", JSON.stringify(result, null, 2));
  if (result.success) {
    console.log("  ✓ Settlement SUCCESS");
    console.log(`  payer:  ${result.payer ?? "(not returned yet — batched)"}`);
    console.log(`  txHash: ${result.transaction ?? "(batched — settles on-chain later)"}`);
    console.log("\n✅ Gateway is working. x402 unlock path is live.\n");
  } else {
    console.error("  ✗ Settlement FAILED");
    console.error(`  reason: ${result.errorReason}`);
    process.exit(1);
  }
} catch (err) {
  console.error("\n✗ Test threw:", err instanceof Error ? err.message : err);
  process.exit(1);
}
