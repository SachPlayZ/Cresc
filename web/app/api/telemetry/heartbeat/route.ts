/**
 * app/api/telemetry/heartbeat/route.ts — M2: heartbeat ingest endpoint.
 *
 * Called every 5s by useReadingTelemetry while a reader has an active session.
 * Records the heartbeat and updates aggregate dwell/completion on the session row.
 * No LLM calls, no Circle calls — pure telemetry storage (CLAUDE.md §7.3).
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/db";
import { insertHeartbeat, updateSessionDwell } from "@/lib/repo";

type HeartbeatBody = {
  sessionId: string;
  focused: boolean;
  scrollPct: number;
  activeDwellSeconds: number;
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId, focused, scrollPct, activeDwellSeconds } =
    body as HeartbeatBody;

  if (
    typeof sessionId !== "string" ||
    !sessionId ||
    typeof focused !== "boolean" ||
    typeof scrollPct !== "number" ||
    typeof activeDwellSeconds !== "number"
  ) {
    return NextResponse.json(
      { error: "Missing or invalid fields: sessionId, focused, scrollPct, activeDwellSeconds required" },
      { status: 400 }
    );
  }

  try {
    const db = createServerClient();

    // Insert the raw heartbeat row (ts is set by DB default)
    await insertHeartbeat(db, {
      session_id: sessionId,
      focused,
      scroll_pct: scrollPct,
    });

    // Update aggregate dwell and completion on the session row.
    // completionPct = scrollPct * 100, rounded to nearest integer.
    await updateSessionDwell(
      db,
      sessionId,
      activeDwellSeconds,
      Math.round(scrollPct * 100)
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[telemetry/heartbeat] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
