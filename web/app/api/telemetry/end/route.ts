/**
 * app/api/telemetry/end/route.ts — M2: explicit session-end ingest endpoint.
 *
 * Called via navigator.sendBeacon on pagehide, or via fetch on component unmount.
 * Marks the session as ended, updates final dwell/completion, and enqueues a
 * reader_eval job for the ReaderAgent (Cresc-Agents service) to process (CLAUDE.md §6.3).
 * No LLM calls — the job enqueue is the handoff point.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/db";
import { endSession, updateSessionDwell, enqueueJob } from "@/lib/repo";

type EndBody = {
  sessionId: string;
  activeDwellSeconds: number;
  completionPct: number;
  scrollPattern?: unknown;
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId, activeDwellSeconds, completionPct, scrollPattern } =
    body as EndBody;

  if (
    typeof sessionId !== "string" ||
    !sessionId ||
    typeof activeDwellSeconds !== "number" ||
    typeof completionPct !== "number"
  ) {
    return NextResponse.json(
      { error: "Missing or invalid fields: sessionId, activeDwellSeconds, completionPct required" },
      { status: 400 }
    );
  }

  try {
    const db = createServerClient();

    // Update final dwell + completion (with optional scroll pattern snapshot)
    await updateSessionDwell(
      db,
      sessionId,
      activeDwellSeconds,
      completionPct,
      scrollPattern
    );

    // Mark session as ended — idempotent via `.is('ended_at', null)` guard in repo
    await endSession(db, sessionId);

    // Enqueue reader_eval job → Cresc-Agents will run ReaderAgent asynchronously
    await enqueueJob(db, "reader_eval", { sessionId });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[telemetry/end] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
