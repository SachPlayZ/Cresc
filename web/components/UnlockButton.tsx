"use client";

import { useState, useTransition, useEffect } from "react";
import { unlockPiece } from "../app/actions/unlock";
import { useReadingTelemetry } from "../hooks/useReadingTelemetry";
import { TipPrompt } from "./TipPrompt";
import type { Notification } from "../lib/repo/types";

type State =
  | { status: "idle" }
  | { status: "paying" }
  | { status: "unlocked"; body: string; arcExplorerUrl: string | null; sessionId: string; payer: string }
  | { status: "error"; message: string };

interface UnlockButtonProps {
  pieceId: string;
  priceDisplay: string; // e.g. "$0.0082"
}

export function UnlockButton({ pieceId, priceDisplay }: UnlockButtonProps) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [isPending, startTransition] = useTransition();
  const [tipNotification, setTipNotification] = useState<Notification | null>(null);

  // Wire telemetry after unlock (sessionId drives the hook)
  const sessionId = state.status === "unlocked" ? state.sessionId : null;
  const readerId = state.status === "unlocked" ? state.payer : null;
  useReadingTelemetry(sessionId);

  // Poll for tip_prompt notifications once unlocked
  useEffect(() => {
    if (!readerId) return;
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/notifications?reader=${encodeURIComponent(readerId)}`);
        if (!res.ok) return;
        const { notifications } = await res.json() as { notifications: Notification[] };
        const tip = notifications.find((n) => n.kind === "tip_prompt");
        if (tip && active) setTipNotification(tip);
      } catch { /* ignore */ }
    };
    poll();
    const id = setInterval(poll, 10_000);
    return () => { active = false; clearInterval(id); };
  }, [readerId]);

  const handleUnlock = () => {
    setState({ status: "paying" });
    startTransition(async () => {
      const result = await unlockPiece(pieceId);
      if ("error" in result) {
        setState({ status: "error", message: result.error });
      } else {
        setState({
          status: "unlocked",
          body: result.body,
          arcExplorerUrl: result.arcExplorerUrl,
          sessionId: result.sessionId ?? "",
          payer: result.payer ?? "",
        });
      }
    });
  };

  if (state.status === "unlocked") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {tipNotification && (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          <TipPrompt notification={tipNotification as any} onDismiss={() => setTipNotification(null)} />
        )}
        {/* Settlement badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 16px",
            background: "rgba(0, 200, 120, 0.08)",
            border: "1px solid rgba(0, 200, 120, 0.25)",
            borderRadius: 10,
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: 12,
            color: "var(--c-green, #00c87a)",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--c-green, #00c87a)",
              boxShadow: "0 0 8px var(--c-green, #00c87a)",
              display: "inline-block",
            }}
          />
          <span>200 OK · {priceDisplay} paid · settled on Arc</span>
          {state.arcExplorerUrl && (
            <a
              href={state.arcExplorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                marginLeft: "auto",
                color: "var(--c-muted, #888)",
                textDecoration: "none",
                fontSize: 11,
              }}
            >
              View tx ↗
            </a>
          )}
        </div>

        {/* Piece body */}
        <div
          style={{
            fontFamily: "var(--font-manrope), sans-serif",
            fontSize: 16,
            lineHeight: 1.75,
            color: "var(--c-text, #eee)",
            whiteSpace: "pre-wrap",
            padding: "24px 0",
          }}
        >
          {state.body}
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          style={{
            padding: "12px 16px",
            background: "rgba(255, 60, 60, 0.07)",
            border: "1px solid rgba(255, 60, 60, 0.2)",
            borderRadius: 10,
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: 13,
            color: "var(--c-red, #ff5555)",
          }}
        >
          Payment failed: {state.message}
        </div>
        <button
          onClick={() => setState({ status: "idle" })}
          style={{
            alignSelf: "flex-start",
            background: "transparent",
            color: "var(--c-muted, #888)",
            border: "1px solid var(--c-border, #333)",
            padding: "8px 16px",
            borderRadius: 8,
            cursor: "pointer",
            fontFamily: "var(--font-manrope), sans-serif",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  // idle or paying
  const isPaying = state.status === "paying" || isPending;

  return (
    <button
      onClick={handleUnlock}
      disabled={isPaying}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        background: isPaying ? "var(--c-surface-2, #1e1e2e)" : "var(--c-accent, #7c3aed)",
        color: isPaying ? "var(--c-muted, #888)" : "var(--c-accent-ink, #fff)",
        border: isPaying ? "1px solid var(--c-border, #333)" : "none",
        padding: "13px 22px",
        borderRadius: 11,
        cursor: isPaying ? "not-allowed" : "pointer",
        fontFamily: "var(--font-manrope), sans-serif",
        fontSize: 15,
        fontWeight: 700,
        boxShadow: isPaying ? "none" : "0 0 24px rgba(124, 58, 237, 0.4)",
        transition: "all 0.2s ease",
        opacity: isPaying ? 0.8 : 1,
      }}
    >
      {isPaying && <Spinner />}
      {isPaying ? "Paying…" : `Unlock for ${priceDisplay}`}
    </button>
  );
}

function Spinner() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      style={{ animation: "spin 0.8s linear infinite" }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" />
      <path
        d="M8 2a6 6 0 0 1 6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
