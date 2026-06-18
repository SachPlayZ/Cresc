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

// ---- Types ----

type TipNotificationPayload = {
  sessionId: string;
  pieceId: string;
  tipDecisionId: string;
  suggestedTip: number;    // display dollars (e.g. 0.0005)
  viewPricePaid: number;   // display dollars (e.g. 0.001)
  readerMessage: string;   // human sentence from the ReaderAgent
};

interface TipPromptProps {
  notification: { id: string; payload: TipNotificationPayload } | null;
  onDismiss: () => void;
}

// ---- State machine ----

type PromptState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "settled"; txHash: string; arcExplorerUrl: string | null; surplusDetected: boolean }
  | { status: "error"; message: string };

// ---- Component ----

export function TipPrompt({ notification, onDismiss }: TipPromptProps) {
  const [state, setState] = useState<PromptState>({ status: "idle" });
  const [sliderValue, setSliderValue] = useState<number | null>(null);

  if (!notification) return null;

  const { payload } = notification;
  const {
    tipDecisionId,
    suggestedTip,
    viewPricePaid,
    readerMessage,
  } = payload;

  // Slider range: [suggestedTip * 0.5, viewPricePaid]
  // Pre-select suggestedTip (clamped to range)
  const sliderMin = Math.max(suggestedTip * 0.5, 0.000001);
  const sliderMax = viewPricePaid;
  const selectedTip = sliderValue ?? suggestedTip;

  const handleSlider = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSliderValue(Number(e.target.value));
    },
    []
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
      const message = err instanceof Error ? err.message : "Network error";
      setState({ status: "error", message });
    }
  }, [state.status, tipDecisionId, selectedTip]);

  // ---- Render ----

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Tip the creator"
      style={overlayStyle}
    >
      <div style={cardStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <span style={agentBadgeStyle}>ReaderAgent</span>
          <button
            onClick={onDismiss}
            aria-label="Dismiss"
            style={closeBtnStyle}
          >
            ✕
          </button>
        </div>

        {/* Agent message */}
        <p style={messageStyle}>{readerMessage}</p>

        {/* Slider + amount display */}
        {state.status !== "settled" && (
          <>
            <div style={amountRowStyle}>
              <span style={amountLabelStyle}>Tip amount</span>
              <span style={amountValueStyle}>{formatDollars(selectedTip)}</span>
            </div>
            <input
              type="range"
              min={sliderMin}
              max={sliderMax}
              step={(sliderMax - sliderMin) / 100}
              value={selectedTip}
              onChange={handleSlider}
              disabled={state.status === "submitting"}
              style={sliderStyle}
            />
            <div style={sliderLabelsStyle}>
              <span>{formatDollars(sliderMin)}</span>
              <span style={{ color: "var(--c-muted, #888)", fontSize: 11 }}>
                suggested {formatDollars(suggestedTip)}
              </span>
              <span>{formatDollars(sliderMax)}</span>
            </div>
          </>
        )}

        {/* States */}
        {state.status === "error" && (
          <div style={errorBannerStyle}>
            {state.message}
          </div>
        )}

        {state.status === "settled" && (
          <div style={settledBannerStyle}>
            <span style={greenDotStyle} />
            <span>
              {formatDollars(selectedTip)} settled on Arc
              {state.surplusDetected && (
                <span style={{ color: "var(--c-accent, #7c3aed)", marginLeft: 8 }}>
                  — price signal sent to PricingAgent
                </span>
              )}
            </span>
            {state.arcExplorerUrl && (
              <a
                href={state.arcExplorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={explorerLinkStyle}
              >
                View tx ↗
              </a>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div style={actionsStyle}>
          {state.status === "settled" ? (
            <button onClick={onDismiss} style={primaryBtnStyle(false)}>
              Done
            </button>
          ) : (
            <>
              <button
                onClick={handleAccept}
                disabled={state.status === "submitting"}
                style={primaryBtnStyle(state.status === "submitting")}
              >
                {state.status === "submitting" ? "Settling…" : `Tip ${formatDollars(selectedTip)}`}
              </button>
              <button
                onClick={onDismiss}
                disabled={state.status === "submitting"}
                style={secondaryBtnStyle}
              >
                No thanks
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Helpers ----

function formatDollars(n: number): string {
  // Show up to 6 significant decimal places for sub-cent amounts
  if (n < 0.01) return `$${n.toFixed(6).replace(/\.?0+$/, "")}`;
  return `$${n.toFixed(4).replace(/\.?0+$/, "")}`;
}

// ---- Styles (inline — matches existing component conventions in codebase) ----

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.55)",
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  zIndex: 9999,
  padding: "0 16px 32px",
};

const cardStyle: React.CSSProperties = {
  background: "var(--c-surface, #13131f)",
  border: "1px solid var(--c-border, #2a2a3a)",
  borderRadius: 16,
  padding: "24px 20px",
  width: "100%",
  maxWidth: 420,
  display: "flex",
  flexDirection: "column",
  gap: 16,
  boxShadow: "0 8px 48px rgba(0,0,0,0.6)",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const agentBadgeStyle: React.CSSProperties = {
  fontFamily: "var(--font-jetbrains), monospace",
  fontSize: 11,
  color: "var(--c-accent, #7c3aed)",
  background: "rgba(124, 58, 237, 0.12)",
  border: "1px solid rgba(124, 58, 237, 0.25)",
  borderRadius: 6,
  padding: "3px 8px",
  letterSpacing: "0.04em",
};

const closeBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--c-muted, #888)",
  cursor: "pointer",
  fontSize: 16,
  lineHeight: 1,
  padding: 4,
};

const messageStyle: React.CSSProperties = {
  fontFamily: "var(--font-manrope), sans-serif",
  fontSize: 14,
  color: "var(--c-text, #eee)",
  lineHeight: 1.6,
  margin: 0,
};

const amountRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const amountLabelStyle: React.CSSProperties = {
  fontFamily: "var(--font-manrope), sans-serif",
  fontSize: 13,
  color: "var(--c-muted, #888)",
};

const amountValueStyle: React.CSSProperties = {
  fontFamily: "var(--font-jetbrains), monospace",
  fontSize: 20,
  fontWeight: 700,
  color: "var(--c-text, #eee)",
};

const sliderStyle: React.CSSProperties = {
  width: "100%",
  accentColor: "var(--c-accent, #7c3aed)",
  cursor: "pointer",
};

const sliderLabelsStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontFamily: "var(--font-jetbrains), monospace",
  fontSize: 10,
  color: "var(--c-muted, #666)",
};

const errorBannerStyle: React.CSSProperties = {
  padding: "10px 14px",
  background: "rgba(255, 60, 60, 0.07)",
  border: "1px solid rgba(255, 60, 60, 0.2)",
  borderRadius: 8,
  fontFamily: "var(--font-jetbrains), monospace",
  fontSize: 12,
  color: "var(--c-red, #ff5555)",
};

const settledBannerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 14px",
  background: "rgba(0, 200, 120, 0.08)",
  border: "1px solid rgba(0, 200, 120, 0.25)",
  borderRadius: 8,
  fontFamily: "var(--font-jetbrains), monospace",
  fontSize: 12,
  color: "var(--c-green, #00c87a)",
  flexWrap: "wrap",
};

const greenDotStyle: React.CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: "50%",
  background: "var(--c-green, #00c87a)",
  boxShadow: "0 0 8px var(--c-green, #00c87a)",
  flexShrink: 0,
};

const explorerLinkStyle: React.CSSProperties = {
  marginLeft: "auto",
  color: "var(--c-muted, #888)",
  textDecoration: "none",
  fontSize: 11,
};

const actionsStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  marginTop: 4,
};

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "12px 20px",
    background: disabled ? "var(--c-surface-2, #1e1e2e)" : "var(--c-accent, #7c3aed)",
    color: disabled ? "var(--c-muted, #888)" : "var(--c-accent-ink, #fff)",
    border: disabled ? "1px solid var(--c-border, #333)" : "none",
    borderRadius: 10,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "var(--font-manrope), sans-serif",
    fontSize: 14,
    fontWeight: 700,
    boxShadow: disabled ? "none" : "0 0 20px rgba(124, 58, 237, 0.35)",
    transition: "all 0.2s ease",
    opacity: disabled ? 0.8 : 1,
  };
}

const secondaryBtnStyle: React.CSSProperties = {
  padding: "12px 16px",
  background: "transparent",
  color: "var(--c-muted, #888)",
  border: "1px solid var(--c-border, #333)",
  borderRadius: 10,
  cursor: "pointer",
  fontFamily: "var(--font-manrope), sans-serif",
  fontSize: 14,
  fontWeight: 600,
};
