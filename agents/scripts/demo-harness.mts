/**
 * scripts/demo-harness.mts — M9 demo traffic harness.
 *
 * Simulates N reader sessions against a running local server to:
 *   1. Generate real payment settlements (x402 unlock flow)
 *   2. Seed engagement signals (dwell, completion, scroll)
 *   3. Trigger tip surplus to demo the emergent loop (§6.5)
 *
 * Run: npx tsx scripts/demo-harness.mts [--piece <id>] [--readers <n>] [--tip-surplus]
 * Requires: local server running at localhost:3000, BUYER_PRIVATE_KEY in .env.local
 */

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const BASE_URL = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
const BUYER_ADDRESS = process.env.BUYER_ADDRESS ?? "0xDEMOBUYER";

// Parse CLI args
const args = process.argv.slice(2);
const pieceArg = args.find((_, i) => args[i - 1] === "--piece");
const readersArg = args.find((_, i) => args[i - 1] === "--readers");
const tipSurplus = args.includes("--tip-surplus");

const NUM_READERS = parseInt(readersArg ?? "5");

// Simulated reader profiles
type ReaderProfile = {
  address: string;
  dwellSeconds: number;
  completionPct: number;
  scrollDepth: number;
  focused: boolean;
};

const READER_PROFILES: ReaderProfile[] = [
  { address: `${BUYER_ADDRESS}_1`, dwellSeconds: 320, completionPct: 94, scrollDepth: 0.95, focused: true },   // deep reader
  { address: `${BUYER_ADDRESS}_2`, dwellSeconds: 180, completionPct: 72, scrollDepth: 0.74, focused: true },   // engaged
  { address: `${BUYER_ADDRESS}_3`, dwellSeconds: 45, completionPct: 22, scrollDepth: 0.25, focused: false },   // bouncer
  { address: `${BUYER_ADDRESS}_4`, dwellSeconds: 240, completionPct: 88, scrollDepth: 0.90, focused: true },   // strong
  { address: `${BUYER_ADDRESS}_5`, dwellSeconds: 90, completionPct: 45, scrollDepth: 0.48, focused: true },    // partial
  { address: `${BUYER_ADDRESS}_6`, dwellSeconds: 380, completionPct: 98, scrollDepth: 1.0, focused: true },    // power reader
  { address: `${BUYER_ADDRESS}_7`, dwellSeconds: 30, completionPct: 15, scrollDepth: 0.18, focused: false },   // immediate bounce
];

async function fetchPieces(): Promise<{ id: string; title: string; current_price: string }[]> {
  const res = await fetch(`${BASE_URL}/api/piece/list`).catch(() => null);
  if (!res?.ok) return [];
  return res.json();
}

async function simulateUnlock(pieceId: string, reader: ReaderProfile): Promise<{ sessionId: string; payer: string } | null> {
  try {
    // Call the unlock server action via a dedicated demo endpoint
    // In real mode this uses BUYER_PRIVATE_KEY; in mock mode returns fake session
    const res = await fetch(`${BASE_URL}/api/piece/${pieceId}?reader=${reader.address}`, {
      headers: { "X-Demo-Mode": "true" },
    });

    if (res.status === 402) {
      // Simulate the mock payment flow by requesting with a mock header
      const paymentRequired = res.headers.get("Payment-Required") ?? res.headers.get("PAYMENT-REQUIRED");
      if (!paymentRequired) {
        console.warn(`    No Payment-Required header for piece ${pieceId}`);
        return null;
      }
      // Retry with mock payment signature (server mock mode accepts this)
      const mockPayload = Buffer.from(JSON.stringify({
        x402Version: 2,
        payload: { signature: "0xmocksig", authorization: { from: reader.address, validBefore: String(Math.floor(Date.now() / 1000) + 604900) } },
        resource: `${BASE_URL}/api/piece/${pieceId}`,
        accepted: JSON.parse(Buffer.from(paymentRequired, "base64").toString()).accepts[0],
      })).toString("base64");

      const paid = await fetch(`${BASE_URL}/api/piece/${pieceId}?reader=${reader.address}`, {
        headers: { "Payment-Signature": mockPayload },
      });

      if (!paid.ok) {
        console.warn(`    Payment failed (${paid.status}) for reader ${reader.address}`);
        return null;
      }
      const data = await paid.json() as { sessionId?: string; payer?: string };
      return { sessionId: data.sessionId ?? "", payer: data.payer ?? reader.address };
    }

    if (res.ok) {
      const data = await res.json() as { sessionId?: string; payer?: string };
      return { sessionId: data.sessionId ?? "", payer: data.payer ?? reader.address };
    }

    return null;
  } catch (err) {
    console.warn(`    Unlock error:`, err);
    return null;
  }
}

async function simulateSession(
  pieceId: string,
  sessionId: string,
  reader: ReaderProfile,
  tipSurplusMode: boolean
): Promise<void> {
  // Send heartbeats simulating the reader's engagement
  const heartbeatCount = Math.ceil(reader.dwellSeconds / 5);

  for (let i = 0; i < Math.min(heartbeatCount, 10); i++) {
    const scrollPct = Math.min(reader.scrollDepth, (i / heartbeatCount) * reader.scrollDepth + 0.05);
    await fetch(`${BASE_URL}/api/telemetry/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        focused: reader.focused,
        scrollPct,
        activeDwellSeconds: Math.round((i / heartbeatCount) * reader.dwellSeconds),
      }),
    }).catch(() => {});
    await sleep(50); // fast in demo mode
  }

  // Send session end
  await fetch(`${BASE_URL}/api/telemetry/end`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      activeDwellSeconds: reader.dwellSeconds,
      completionPct: reader.completionPct,
      scrollPattern: { depth: reader.scrollDepth, focused: reader.focused },
    }),
  }).catch(() => {});

  // For tip surplus demo: wait for a tip notification and accept with surplus
  if (tipSurplusMode && reader.completionPct > 70) {
    await sleep(2000); // let ReaderAgent process
    console.log(`    Checking for tip notification for reader ${reader.address}...`);
    const notifRes = await fetch(`${BASE_URL}/api/notifications?reader=${encodeURIComponent(reader.address)}`).catch(() => null);
    if (notifRes?.ok) {
      const { notifications } = await notifRes.json() as { notifications: Array<{ id: string; payload: { tipDecisionId?: string; suggestedTip?: number; viewPricePaid?: number } }> };
      const tipNotif = notifications.find((n) => n.payload?.tipDecisionId);
      if (tipNotif?.payload?.tipDecisionId) {
        const suggestedTip = tipNotif.payload.suggestedTip ?? 0;
        const surplusAmount = suggestedTip * 1.5; // tip 50% ABOVE suggestion → surplus signal
        console.log(`    Accepting tip with surplus: suggested=$${suggestedTip.toFixed(6)}, paying=$${surplusAmount.toFixed(6)}`);
        await fetch(`${BASE_URL}/api/tip/accept`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tipDecisionId: tipNotif.payload.tipDecisionId, finalTip: surplusAmount }),
        }).catch(() => {});
      }
    }
  }
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  console.log(`Demo harness — ${BASE_URL}`);
  console.log(`Readers: ${NUM_READERS}, Tip-surplus mode: ${tipSurplus}\n`);

  // Resolve piece IDs
  let pieceIds: string[] = [];
  if (pieceArg) {
    pieceIds = [pieceArg];
  } else {
    const pieces = await fetchPieces();
    if (pieces.length === 0) {
      console.log("No pieces found via /api/piece/list. Provide --piece <id> or ensure seed ran.");
      console.log("Usage: npx tsx scripts/demo-harness.mts --piece <pieceId> [--readers 5] [--tip-surplus]");
      process.exit(0);
    }
    pieceIds = pieces.slice(0, 3).map((p) => p.id);
    console.log(`Found ${pieces.length} pieces. Using first 3:\n${pieces.slice(0, 3).map((p) => `  ${p.id} — ${p.title} ($${(parseInt(p.current_price) / 1_000_000).toFixed(4)})`).join("\n")}\n`);
  }

  const profiles = READER_PROFILES.slice(0, NUM_READERS);

  for (const pieceId of pieceIds) {
    console.log(`\n=== Piece ${pieceId} ===`);
    for (const reader of profiles) {
      console.log(`  Reader ${reader.address} (dwell=${reader.dwellSeconds}s, completion=${reader.completionPct}%, focused=${reader.focused})`);
      const session = await simulateUnlock(pieceId, reader);
      if (!session?.sessionId) {
        console.log(`    ✗ Unlock failed`);
        continue;
      }
      console.log(`    ✓ Unlocked — session ${session.sessionId}`);
      await simulateSession(pieceId, session.sessionId, reader, tipSurplus);
      console.log(`    ✓ Session complete`);
      await sleep(200);
    }
  }

  console.log("\n--- Demo harness complete ---");
  console.log("Signals written to DB. PricingAgent will sweep on next clock tick.");
  if (tipSurplus) console.log("Tip surplus signals sent → check price_decisions for tip_surplus trigger.");
  console.log(`\nDashboard: ${BASE_URL}/dashboard`);
  console.log(`Arc Explorer: https://testnet.arcscan.app`);
}

main().catch((err) => {
  console.error("Harness failed:", err);
  process.exit(1);
});
