/**
 * lib/circle/circle.test.ts — M3 unit tests (mock mode, no real network).
 * Run: npx tsx --test lib/circle/circle.test.ts
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

// Force mock mode by ensuring env vars are absent before importing the module.
// (ARC_RPC_URL and SELLER_PRIVATE_KEY are empty in test env by default.)
import {
  buildPaymentRequirements,
  explorerUrl,
  getUsdcBalance,
  depositToGateway,
  getGatewayBalance,
  verifyAndSettle,
  signPaymentAuthorization,
  withdrawFromGateway,
  type TxRef,
  type X402Requirements,
} from "./index.js";
import { fromDisplay } from "../money.js";

const MOCK_PRICE = fromDisplay("0.01", 6); // $0.01 = 10000n base units
const MOCK_SELLER = "0xSellerAddress0000000000000000000000000001";
const MOCK_BUYER = "0xBuyerAddress00000000000000000000000000002";
const MOCK_PRIV =
  "0x0000000000000000000000000000000000000000000000000000000000000001";

test("buildPaymentRequirements — shape + amount encoding", () => {
  const req = buildPaymentRequirements(MOCK_PRICE, MOCK_SELLER);
  assert.equal(req.scheme, "exact");
  assert.equal(req.network, "eip155:5042002");
  assert.equal(req.asset, "0x3600000000000000000000000000000000000000");
  assert.equal(req.amount, "10000"); // 10000 base units = $0.01
  assert.equal(req.payTo, MOCK_SELLER);
  assert.ok(req.maxTimeoutSeconds > 604800, "maxTimeoutSeconds must be > 7 days");
  assert.equal((req.extra as Record<string, string>)?.name, "GatewayWalletBatched");
  assert.equal(
    (req.extra as Record<string, string>)?.verifyingContract,
    "0x0077777d7EBA4688BDeF3E311b846F25870A19B9"
  );
});

test("explorerUrl — returns Arc testnet URL", () => {
  const txRef: TxRef = {
    hash: "0xabc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc1",
    chain: "arcTestnet",
  };
  const url = explorerUrl(txRef);
  assert.ok(url.startsWith("https://testnet.arcscan.app/tx/0xabc123"));
});

test("getUsdcBalance — mock mode returns UsdcAmount", async () => {
  const bal = await getUsdcBalance(MOCK_BUYER);
  assert.ok(typeof bal.value === "bigint");
  assert.ok(bal.decimals > 0);
});

test("depositToGateway — mock mode returns TxRef", async () => {
  const ref = await depositToGateway(MOCK_PRIV, MOCK_PRICE);
  assert.ok(ref.hash.startsWith("0x"));
  assert.ok(ref.chain.length > 0);
});

test("getGatewayBalance — mock mode returns tiered balances", async () => {
  const bal = await getGatewayBalance(MOCK_SELLER);
  assert.ok(typeof bal.total.value === "bigint");
  assert.ok(typeof bal.withdrawable.value === "bigint");
  assert.ok(typeof bal.withdrawing.value === "bigint");
  // In mock mode withdrawing is 0
  assert.equal(bal.withdrawing.value, 0n);
});

test("verifyAndSettle — mock mode returns success", async () => {
  const req = buildPaymentRequirements(MOCK_PRICE, MOCK_SELLER);
  const mockAuth = {
    x402Version: 2,
    payload: { signature: "0xmock", authorization: {} },
  };
  const result = await verifyAndSettle(mockAuth, req);
  assert.equal(result.success, true);
  assert.ok(result.txHash);
});

test("signPaymentAuthorization — mock mode returns EIP3009Auth shape", async () => {
  const req = buildPaymentRequirements(MOCK_PRICE, MOCK_SELLER);
  const auth = await signPaymentAuthorization(MOCK_PRIV, req);
  assert.equal(auth.x402Version, 2);
  assert.ok(auth.payload);
  // payload must contain signature + authorization fields
  const p = auth.payload as Record<string, unknown>;
  assert.ok(p.signature);
  assert.ok(p.authorization);
});

test("withdrawFromGateway — mock mode returns TxRef with target chain", async () => {
  const ref = await withdrawFromGateway(MOCK_PRIV, MOCK_BUYER, "baseSepolia", MOCK_PRICE);
  assert.equal(ref.chain, "baseSepolia");
  assert.ok(ref.hash.startsWith("0x"));
});

test("buildPaymentRequirements — zero price encodes correctly", () => {
  const zeroPrice = fromDisplay("0.001", 6); // $0.001 = 1000n base units (floor)
  const req = buildPaymentRequirements(zeroPrice, MOCK_SELLER);
  assert.equal(req.amount, "1000");
});
