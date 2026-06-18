/**
 * hooks/useReadingTelemetry.ts — M2: client-side reading telemetry hook.
 *
 * Tracks active focused dwell, scroll depth, and session-end.
 * CRITICAL rules (CLAUDE.md §7.5–7.6):
 *  - Dwell increments ONLY while document.visibilityState === 'visible' AND document.hasFocus()
 *  - Backgrounded tabs NEVER accrue dwell
 *  - Session-end fires on pagehide (more reliable than beforeunload on mobile)
 *  - navigator.sendBeacon is used for end signal so it survives page unload
 */

"use client";

import { useEffect, useRef } from "react";

// 5s heartbeat interval (CLAUDE.md §5, lib/config.ts HEARTBEAT_INTERVAL_SECONDS)
const HEARTBEAT_INTERVAL_MS = 5_000;

function getScrollPct(): number {
  const scrollable = document.body.scrollHeight - window.innerHeight;
  if (scrollable <= 0) return 1;
  return Math.min(1, Math.max(0, window.scrollY / scrollable));
}

function isActiveFocused(): boolean {
  return (
    document.visibilityState === "visible" &&
    document.hasFocus()
  );
}

/**
 * useReadingTelemetry — attach to the reading page after unlock.
 * @param sessionId — null until the reader has paid and received a session id.
 */
export function useReadingTelemetry(sessionId: string | null): void {
  // activeDwellSeconds: incremented only when tab is visible + focused
  const activeDwellRef = useRef<number>(0);
  // Track whether we were active at the last tick
  const lastTickActiveRef = useRef<boolean>(false);
  // Store the interval so we can clear it on unmount
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guard against double-ending the session
  const endedRef = useRef<boolean>(false);

  useEffect(() => {
    // Do nothing until we have a session
    if (!sessionId) return;

    // Reset state for this session
    activeDwellRef.current = 0;
    endedRef.current = false;
    lastTickActiveRef.current = isActiveFocused();

    // --- Heartbeat sender ---
    async function sendHeartbeat(): Promise<void> {
      const focused = isActiveFocused();
      const scrollPct = getScrollPct();

      // Increment dwell only if active+focused during this interval
      if (focused) {
        activeDwellRef.current += HEARTBEAT_INTERVAL_MS / 1000;
      }

      try {
        await fetch("/api/telemetry/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            focused,
            scrollPct,
            activeDwellSeconds: activeDwellRef.current,
          }),
        });
      } catch {
        // Fire-and-forget: network errors are non-fatal for telemetry
      }
    }

    // --- Session-end sender (beacon for reliability on unload) ---
    function sendEnd(): void {
      if (endedRef.current) return;
      endedRef.current = true;

      const payload = JSON.stringify({
        sessionId,
        activeDwellSeconds: activeDwellRef.current,
        completionPct: Math.round(getScrollPct() * 100),
      });

      // navigator.sendBeacon is the only reliable way to send data on page unload;
      // it survives navigation, tab close, and mobile app-kill (CLAUDE.md §7.6).
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        const blob = new Blob([payload], { type: "application/json" });
        navigator.sendBeacon("/api/telemetry/end", blob);
      } else {
        // Fallback: best-effort fetch (may be cancelled on unload)
        fetch("/api/telemetry/end", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => undefined);
      }
    }

    // --- Page Visibility handler ---
    // When tab is hidden, the current tick becomes inactive — dwell stops accruing.
    // When tab is visible again, dwell resumes on the next heartbeat tick.
    function handleVisibilityChange(): void {
      // No dwell to adjust here — the heartbeat tick checks isActiveFocused() live.
      // Visibility events are tracked passively.
    }

    // --- Focus / blur handlers ---
    // These change isActiveFocused() result; no extra action needed beyond letting
    // the heartbeat tick re-evaluate.
    function handleFocusChange(): void {
      // Intentionally empty — the heartbeat tick calls isActiveFocused() each interval.
    }

    // --- pagehide: fires on all mobile browsers and on tab close (CLAUDE.md §7.6) ---
    function handlePageHide(): void {
      // Clear the heartbeat interval so it doesn't fire after unload
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      sendEnd();
    }

    // Start heartbeat interval
    intervalRef.current = setInterval(() => {
      void sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    // Attach event listeners
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocusChange);
    window.addEventListener("blur", handleFocusChange);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      // Cleanup: clear interval and send final signals
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocusChange);
      window.removeEventListener("blur", handleFocusChange);
      window.removeEventListener("pagehide", handlePageHide);

      // Send a final heartbeat + end signal when the component unmounts
      // (e.g., SPA navigation away from the article)
      void sendHeartbeat();
      sendEnd();
    };
  }, [sessionId]);
}
