/**
 * app/api/telemetry/detect-end/route.ts — M2: heartbeat-timeout session sweep endpoint.
 *
 * GET handler intended to be called every ~30s (by a cron, Next.js revalidation,
 * or the dashboard's polling). Runs detectSessionEnd() to catch sessions where the
 * reader's browser never fired a pagehide event (mobile app-kill, hard close, crash).
 *
 * This is the SECOND path for session-end (CLAUDE.md §7.6):
 *   Path 1: explicit pagehide → POST /api/telemetry/end
 *   Path 2: heartbeat timeout → GET /api/telemetry/detect-end (this route)
 *
 * No LLM calls.
 */

import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/db";
import { detectSessionEnd } from "@/lib/telemetry";

export async function GET(): Promise<NextResponse> {
  try {
    const db = createServerClient();
    const ended = await detectSessionEnd(db);
    return NextResponse.json({ ok: true, ended });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[telemetry/detect-end] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
