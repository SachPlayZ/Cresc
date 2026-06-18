"use client";

/**
 * components/TipPrompt.tsx — M7a: tip prompt UI shown after session end.
 *
 * Receives the notification payload pushed by the ReaderAgent (M6).
 * Lets the reader adjust the tip amount on a slider, then calls POST /api/tip/accept.
 * On success: shows Arc explorer link confirming the on-chain settlement.
 *
 * Invariant (CLAUDE.md §7.7): tip is bounded in [10%, 100%] of view price paid.
 * Slider min = suggestedTip * 0.5 (generous floor), max = viewPricePaid.
 */

import { useState, useCallback } from "react";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";
import { Badge } from "./ui/badge";

type TipNotificationPayload = {
  sessionId: string;
  pieceId: string;
  tipDecisionId: string;
  suggestedTip: number;
  viewPricePaid: number;
  readerMessage: string;
};

interface TipPromptProps {
  notification: { id: string; payload: TipNotificationPayload } | null;
  onDismiss: () => void;
}

type PromptState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "settled"; txHash: string; arcExplorerUrl: string | null; surplusDetected: boolean }
  | { status: "error"; message: string };

function formatDollars(n: number): string {
  if (n < 0.01) return `$${n.toFixed(6).replace(/\.?0+$/, "")}`;
  return `$${n.toFixed(4).replace(/\.?0+$/, "")}`;
}

export function TipPrompt({ notification, onDismiss }: TipPromptProps) {
  const [state, setState] = useState<PromptState>({ status: "idle" });
  const [sliderValue, setSliderValue] = useState<number | null>(null);

  if (!notification) return null;

  const { payload } = notification;
  const { tipDecisionId, suggestedTip, viewPricePaid, readerMessage } = payload;

  const sliderMin = Math.max(suggestedTip * 0.5, 0.000001);
  const sliderMax = viewPricePaid;
  const selectedTip = sliderValue ?? suggestedTip;

  // Convert to 0–100 scale for shadcn Slider
  const sliderRange = sliderMax - sliderMin;
  const sliderPct = sliderRange > 0 ? ((selectedTip - sliderMin) / sliderRange) * 100 : 50;

  const handleSliderChange = useCallback(
    (vals: number | readonly number[]) => {
      const arr = Array.isArray(vals) ? vals : [vals];
      const pct = (arr as number[])[0] ?? 50;
      const val = sliderMin + (pct / 100) * (sliderMax - sliderMin);
      setSliderValue(val);
    },
    [sliderMin, sliderMax]
  );

  const handleAccept = useCallback(async () => {
    if (state.status === "submitting") return;
    setState({ status: "submitting" });

    try {
      const res = await fetch("/api/tip/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipDecisionId, finalTip: selectedTip }),
      });
      const data = await res.json() as {
        ok?: boolean;
        txHash?: string;
        arcExplorerUrl?: string | null;
        surplusDetected?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setState({ status: "error", message: data.error ?? "Tip settlement failed" });
        return;
      }
      setState({
        status: "settled",
        txHash: data.txHash ?? "0x0",
        arcExplorerUrl: data.arcExplorerUrl ?? null,
        surplusDetected: data.surplusDetected ?? false,
      });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "Network error" });
    }
  }, [state.status, tipDecisionId, selectedTip]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Tip the creator"
      className="fixed inset-0 flex items-end justify-center z-[9999] px-4 pb-8"
      style={{ background: "rgba(0,0,0,0.55)" }}
    >
      <div
        className="w-full max-w-md flex flex-col gap-4 rounded-2xl p-6 border"
        style={{
          background: "var(--c-surface)",
          border: "1px solid var(--c-border)",
          boxShadow: "0 8px 48px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <Badge
            variant="outline"
            className="font-mono text-xs tracking-wide"
            style={{ color: "var(--c-accent)", borderColor: "rgba(198,248,78,0.3)" }}
          >
            ReaderAgent
          </Badge>
          <button
            onClick={onDismiss}
            aria-label="Dismiss"
            className="text-muted-foreground bg-transparent border-none cursor-pointer text-base leading-none p-1 hover:text-foreground transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Agent message */}
        <p className="font-sans text-sm text-foreground leading-relaxed m-0">{readerMessage}</p>

        {/* Slider + amount */}
        {state.status !== "settled" && (
          <>
            <div className="flex items-center justify-between">
              <span className="font-sans text-sm text-muted-foreground">Tip amount</span>
              <span
                className="font-mono text-xl font-bold text-foreground"
              >
                {formatDollars(selectedTip)}
              </span>
            </div>
            <Slider
              value={[sliderPct]}
              onValueChange={handleSliderChange}
              min={0}
              max={100}
              step={1}
              disabled={state.status === "submitting"}
              className="w-full"
            />
            <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
              <span>{formatDollars(sliderMin)}</span>
              <span className="text-muted-foreground text-[11px]">
                suggested {formatDollars(suggestedTip)}
              </span>
              <span>{formatDollars(sliderMax)}</span>
            </div>
          </>
        )}

        {/* Error state */}
        {state.status === "error" && (
          <div
            className="px-3.5 py-2.5 rounded-lg font-mono text-xs"
            style={{
              background: "rgba(224,138,138,0.08)",
              border: "1px solid rgba(224,138,138,0.22)",
              color: "var(--c-red)",
            }}
          >
            {state.message}
          </div>
        )}

        {/* Settled state */}
        {state.status === "settled" && (
          <div
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg font-mono text-xs flex-wrap"
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
            <span>
              {formatDollars(selectedTip)} settled on Arc
              {state.surplusDetected && (
                <span className="ml-2" style={{ color: "var(--c-accent)" }}>
                  — price signal sent to PricingAgent
                </span>
              )}
            </span>
            {state.arcExplorerUrl && (
              <a
                href={state.arcExplorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-[11px] no-underline"
                style={{ color: "var(--c-muted)" }}
              >
                View tx ↗
              </a>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2.5 mt-1">
          {state.status === "settled" ? (
            <Button onClick={onDismiss} className="flex-1">
              Done
            </Button>
          ) : (
            <>
              <Button
                onClick={handleAccept}
                disabled={state.status === "submitting"}
                className="flex-1"
              >
                {state.status === "submitting" ? "Settling…" : `Tip ${formatDollars(selectedTip)}`}
              </Button>
              <Button
                variant="outline"
                onClick={onDismiss}
                disabled={state.status === "submitting"}
                className="flex-1"
              >
                No thanks
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
