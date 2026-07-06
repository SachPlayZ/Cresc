/**
 * Deposits USDC from the raw-key x402 buyer EOA into Circle Gateway.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/deposit-gateway.mts --amount 5
 *
 * BUYER_PRIVATE_KEY is required because x402 Gateway payments require
 * ecrecover-compatible EOA signatures. Circle SCA/MPC buyer signatures do not work.
 */

import { GatewayClient } from "@circle-fin/x402-batching/client";

const ARC_SDK_CHAIN = "arcTestnet";
const ARC_RPC_URL = process.env.ARC_RPC_URL;
const BUYER_PRIVATE_KEY = process.env.BUYER_PRIVATE_KEY;

if (!ARC_RPC_URL || !BUYER_PRIVATE_KEY) {
  console.error("Need ARC_RPC_URL and BUYER_PRIVATE_KEY in env.");
  process.exit(1);
}

const amountArg = (() => {
  const idx = process.argv.indexOf("--amount");
  if (idx !== -1) return process.argv[idx + 1];
  const eq = process.argv.find((a) => a.startsWith("--amount="));
  if (eq) return eq.split("=")[1];
  return "2";
})();

const amountUsdc = Number(amountArg);
if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
  console.error(`Invalid --amount: ${amountArg}`);
  process.exit(1);
}

const client = new GatewayClient({
  chain: ARC_SDK_CHAIN,
  privateKey: BUYER_PRIVATE_KEY as `0x${string}`,
  rpcUrl: ARC_RPC_URL,
});

const result = await client.deposit(String(amountUsdc));
console.log(`Deposited ${amountUsdc} USDC into Gateway.`);
console.log(`tx: ${result.depositTxHash}`);
