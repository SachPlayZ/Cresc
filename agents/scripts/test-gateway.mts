/**
 * Raw-key x402 smoke test against a running Cresc web app.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/test-gateway.mts --slug <slug> --site <creator_id>
 *
 * This can spend real testnet USDC from BUYER_PRIVATE_KEY.
 */

import { GatewayClient } from "@circle-fin/x402-batching/client";
import crypto from "node:crypto";

const APP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_BASE_URL;
const ARC_RPC_URL = process.env.ARC_RPC_URL;
const BUYER_PRIVATE_KEY = process.env.BUYER_PRIVATE_KEY;

function arg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1) return process.argv[idx + 1] ?? null;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.split("=")[1] : null;
}

const slug = arg("slug");
const site = arg("site");

for (const [key, value] of Object.entries({ APP_BASE_URL, ARC_RPC_URL, BUYER_PRIVATE_KEY, slug, site })) {
  if (!value) {
    console.error(`Missing ${key}.`);
    process.exit(1);
  }
}

const readerId = `smoke-${crypto.randomUUID()}`;
const requestId = crypto.randomUUID();
const url = `${APP_BASE_URL}/api/x402/${encodeURIComponent(slug!)}?site=${encodeURIComponent(site!)}&r=${encodeURIComponent(readerId)}&rid=${encodeURIComponent(requestId)}`;

const client = new GatewayClient({
  chain: "arcTestnet",
  privateKey: BUYER_PRIVATE_KEY as `0x${string}`,
  rpcUrl: ARC_RPC_URL!,
});

console.log(`Paying x402 URL: ${url}`);
const result = await client.pay(url, { method: "GET" });
console.log(`status: ${result.status}`);
console.log(`tx: ${result.transaction ?? "(none)"}`);
console.log(`data: ${JSON.stringify(result.data)}`);

if (result.status !== 200 && result.status !== 201) {
  process.exit(1);
}
