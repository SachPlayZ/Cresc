/**
 * Staging smoke check for contract-native Cresc.
 *
 * Safe default: verifies DB + HTTP/x402 402 shape without spending.
 * Add --pay to execute the paid x402 unlock flow with BUYER_PRIVATE_KEY.
 */

import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { GatewayClient } from "@circle-fin/x402-batching/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const APP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_BASE_URL;
const EC2_AGENT_BASE_URL = process.env.EC2_AGENT_BASE_URL;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ARC_RPC_URL = process.env.ARC_RPC_URL;
const BUYER_PRIVATE_KEY = process.env.BUYER_PRIVATE_KEY;
const shouldPay = process.argv.includes("--pay");

function required(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const appBase = required("NEXT_PUBLIC_APP_URL or APP_BASE_URL", APP_BASE_URL).replace(/\/$/, "");
  const agentBase = required("EC2_AGENT_BASE_URL", EC2_AGENT_BASE_URL).replace(/\/$/, "");
  const db = createClient(
    required("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL),
    required("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY)
  );

  console.log("1. Checking agent health...");
  const health = await fetch(`${agentBase}/healthz`);
  if (!health.ok) throw new Error(`/healthz failed: ${health.status} ${await health.text()}`);
  console.log(`   ok: ${await health.text()}`);

  console.log("2. Finding active article with content contract...");
  const { data: article, error } = await db
    .from("articles")
    .select("slug, creator_id, content_contract, current_price_atomic")
    .eq("active", true)
    .not("content_contract", "is", null)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!article?.content_contract) throw new Error("No active article with content_contract found. Re-sync Ghost first.");

  console.log(`   ${article.creator_id}/${article.slug} -> ${article.content_contract}`);

  console.log("3. Checking Ghost post status route...");
  const statusUrl = `${appBase}/api/ghost/post-status?site=${encodeURIComponent(article.creator_id as string)}&slug=${encodeURIComponent(article.slug as string)}`;
  const status = await fetch(statusUrl);
  if (!status.ok) throw new Error(`post-status failed: ${status.status}`);
  const statusJson = await status.json() as { paywalled?: boolean; contentContract?: string };
  if (!statusJson.paywalled || statusJson.contentContract !== article.content_contract) {
    throw new Error(`post-status mismatch: ${JSON.stringify(statusJson)}`);
  }

  console.log("4. Checking x402 402 requirements...");
  const readerId = `smoke-${crypto.randomUUID()}`;
  const requestId = crypto.randomUUID();
  const x402Url = `${appBase}/api/x402/${encodeURIComponent(article.slug as string)}?site=${encodeURIComponent(article.creator_id as string)}&r=${encodeURIComponent(readerId)}&rid=${encodeURIComponent(requestId)}`;
  const requiredRes = await fetch(x402Url);
  if (requiredRes.status !== 402) throw new Error(`expected 402, got ${requiredRes.status}`);
  const header = requiredRes.headers.get("PAYMENT-REQUIRED");
  if (!header) throw new Error("missing PAYMENT-REQUIRED header");
  const paymentRequired = JSON.parse(Buffer.from(header, "base64").toString()) as {
    accepts?: Array<{ payTo?: string; amount?: string }>;
  };
  const accepted = paymentRequired.accepts?.[0];
  if (accepted?.payTo !== article.content_contract) {
    throw new Error(`x402 payTo mismatch: ${JSON.stringify(accepted)}`);
  }
  console.log(`   payTo ok, amount=${accepted.amount}`);

  if (!shouldPay) {
    console.log("Done. Re-run with --pay to execute a real paid unlock.");
    return;
  }

  console.log("5. Executing paid unlock...");
  const client = new GatewayClient({
    chain: "arcTestnet",
    privateKey: required("BUYER_PRIVATE_KEY", BUYER_PRIVATE_KEY) as `0x${string}`,
    rpcUrl: required("ARC_RPC_URL", ARC_RPC_URL),
  });
  const paid = await client.pay(x402Url, { method: "GET" });
  if (paid.status !== 200 && paid.status !== 201) {
    throw new Error(`paid unlock failed: ${paid.status} ${JSON.stringify(paid.data)}`);
  }
  console.log(`   paid tx=${paid.transaction ?? "(batched)"}`);
}

main().catch((err) => {
  console.error("Smoke failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
