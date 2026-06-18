/**
 * lib/telemetry/index.ts — M2: server-side session-end detection.
 *
 * Handles the heartbeat-timeout path for session-end (CLAUDE.md §7.6):
 * - pagehide fires the explicit /api/telemetry/end call
 * - BUT mobile/hard-kill can skip pagehide — heartbeat timeout is the fallback
 *
 * detectSessionEnd() is called periodically (every ~30s) via /api/telemetry/detect-end.
 * It finds sessions whose last heartbeat is older than SESSION_END_TIMEOUT_SECONDS,
 * ends them, and enqueues reader_eval jobs so the ReaderAgent can evaluate them.
 *
 * No LLM calls in this module (CLAUDE.md §7.3).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getOpenSessions,
  getLastHeartbeat,
  endSession,
  enqueueJob,
} from "../repo/index.js";
import { SESSION_END_TIMEOUT_SECONDS } from "../config.js";

/**
 * detectSessionEnd — sweep open sessions and end those whose heartbeat has timed out.
 *
 * getOpenSessions already filters to sessions where unlocked_at < now - timeout,
 * so we are only checking sessions that have been open long enough to potentially time out.
 * We then check the last heartbeat for each: if it is older than SESSION_END_TIMEOUT_SECONDS
 * (or absent), the reader has gone and we end the session.
 *
 * Safe to call concurrently — endSession has an `.is('ended_at', null)` guard so
 * double-ending is a no-op.
 *
 * @returns count of sessions ended in this sweep
 */
export async function detectSessionEnd(db: SupabaseClient): Promise<number> {
  // getOpenSessions filters to sessions older than timeoutSeconds with ended_at IS NULL.
  // We pass the same timeout so only "stale" sessions are candidates.
  const openSessions = await getOpenSessions(db, SESSION_END_TIMEOUT_SECONDS);

  const now = Date.now();
  const timeoutMs = SESSION_END_TIMEOUT_SECONDS * 1000;

  let endedCount = 0;

  await Promise.all(
    openSessions.map(async (session) => {
      try {
        const lastHb = await getLastHeartbeat(db, session.id);

        const isTimedOut =
          lastHb === null ||
          now - new Date(lastHb.ts).getTime() > timeoutMs;

        if (!isTimedOut) return;

        // End the session — idempotent
        await endSession(db, session.id);

        // Enqueue ReaderAgent evaluation (Cresc-Agents will pick this up)
        await enqueueJob(db, "reader_eval", { sessionId: session.id });

        endedCount++;
      } catch (err) {
        // Log per-session errors but continue sweeping other sessions
        console.error(
          `[telemetry/detectSessionEnd] failed for session ${session.id}:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    })
  );

  return endedCount;
}
