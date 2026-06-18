"use client";

import { useState, useTransition, useEffect } from "react";
import { unlockPiece } from "../app/actions/unlock";
import { useReadingTelemetry } from "../hooks/useReadingTelemetry";
import { TipPrompt } from "./TipPrompt";
import type { Notification } from "../lib/repo/types";
import { Button } from "./ui/button";

type State =
  | { status: "idle" }
  | { status: "paying" }
  | { status: "unlocked"; body: string; arcExplorerUrl: string | null; sessionId: string; payer: string }
  | { status: "error"; message: string };

interface UnlockButtonProps {
  pieceId: string;
  priceDisplay: string;
}

export function UnlockButton({ pieceId, priceDisplay }: UnlockButtonProps) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [isPending, startTransition] = useTransition();
  const [tipNotification, setTipNotification] = useState<Notification | null>(null);

  const sessionId = state.status === "unlocked" ? state.sessionId : null;
  const readerId = state.status === "unlocked" ? state.payer : null;
  useReadingTelemetry(sessionId);

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
      <div className="flex flex-col gap-4">
        {tipNotification && (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          <TipPrompt notification={tipNotification as any} onDismiss={() => setTipNotification(null)} />
        )}
        {/* Settlement badge */}
        <div
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-mono text-xs"
          style={{
            background: "rgba(134,214,168,0.08)",
            border: "1px solid rgba(134,214,168,0.25)",
            color: "var(--c-green)",
          }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: "var(--c-green)", boxShadow: "0 0 8px var(--c-green)" }}
          />
          <span>200 OK · {priceDisplay} paid · settled on Arc</span>
          {state.arcExplorerUrl && (
            <a
              href={state.arcExplorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-xs no-underline"
              style={{ color: "var(--c-muted)" }}
            >
              View tx ↗
            </a>
          )}
        </div>

        {/* Piece body */}
        <div
          className="font-sans text-base leading-7 text-foreground whitespace-pre-wrap py-6"
        >
          {state.body}
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-3">
        <div
          className="px-4 py-3 rounded-xl font-mono text-sm"
          style={{
            background: "rgba(224,138,138,0.07)",
            border: "1px solid rgba(224,138,138,0.2)",
            color: "var(--c-red)",
          }}
        >
          Payment failed: {state.message}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setState({ status: "idle" })}
          className="self-start"
        >
          Try again
        </Button>
      </div>
    );
  }

  const isPaying = state.status === "paying" || isPending;

  return (
    <Button
      onClick={handleUnlock}
      disabled={isPaying}
      className="inline-flex items-center gap-2.5 h-12 px-6 text-sm font-bold"
      style={isPaying ? {} : { boxShadow: "0 0 24px rgba(198,248,78,0.35)" }}
    >
      {isPaying && <Spinner />}
      {isPaying ? "Paying…" : `Unlock for ${priceDisplay}`}
    </Button>
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
      <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
