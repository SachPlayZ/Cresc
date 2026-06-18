"use client";

/**
 * components/dashboard/ReasoningChain.tsx — M8
 * Expandable list of price decisions for a piece, newest first.
 * Low-confidence decisions (< 0.5) show a warning and Dispute button.
 * Dispute opens a dialog: note input → POST /api/dispute.
 */

import { useEffect, useState, useCallback } from "react";
import { createBrowserClient } from "../../lib/db";
import { fromBaseUnits, toDisplay } from "../../lib/money";
import { USDC_ERC20_DECIMALS } from "../../lib/config";
import type { PriceDecision } from "../../lib/repo/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";

interface ReasoningChainProps {
  pieceId: string;
  creatorId: string;
  initialDecisions: PriceDecision[];
}

function displayPrice(baseUnits: string): string {
  try {
    return toDisplay(fromBaseUnits(BigInt(baseUnits), USDC_ERC20_DECIMALS));
  } catch {
    return "?";
  }
}

function formatTs(ts: string): string {
  try {
    return new Date(ts).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return ts;
  }
}

const TRIGGER_LABELS: Record<PriceDecision["trigger"], string> = {
  clock: "clock",
  spike: "spike",
  tip_surplus: "tip surplus",
};

const TRIGGER_VARIANT: Record<PriceDecision["trigger"], "default" | "secondary" | "outline"> = {
  clock: "outline",
  spike: "secondary",
  tip_surplus: "default",
};

export default function ReasoningChain({ pieceId, creatorId, initialDecisions }: ReasoningChainProps) {
  const [decisions, setDecisions] = useState<PriceDecision[]>(initialDecisions);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [disputeTarget, setDisputeTarget] = useState<PriceDecision | null>(null);
  const [disputeNote, setDisputeNote] = useState("");
  const [disputing, setDisputing] = useState(false);
  const [disputeError, setDisputeError] = useState<string | null>(null);
  const [disputedIds, setDisputedIds] = useState<Set<string>>(new Set());

  const handleNewDecision = useCallback((d: PriceDecision) => {
    setDecisions((prev) => [d, ...prev].slice(0, 50));
  }, []);

  useEffect(() => {
    const db = createBrowserClient();
    const channel = db
      .channel(`reasoning-chain:${pieceId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "price_decisions",
          filter: `piece_id=eq.${pieceId}`,
        },
        (payload) => handleNewDecision(payload.new as PriceDecision)
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [pieceId, handleNewDecision]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submitDispute = async () => {
    if (!disputeTarget || !disputeNote.trim()) return;
    setDisputing(true);
    setDisputeError(null);
    try {
      const res = await fetch("/api/dispute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceDecisionId: disputeTarget.id,
          creatorId,
          note: disputeNote.trim(),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? "Dispute failed");
      }
      setDisputedIds((prev) => new Set([...prev, disputeTarget.id]));
      setDisputeTarget(null);
      setDisputeNote("");
    } catch (err) {
      setDisputeError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setDisputing(false);
    }
  };

  if (decisions.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          color: "var(--c-dim, #666)",
          fontFamily: "var(--font-jetbrains), monospace",
          fontSize: 13,
          textAlign: "center",
        }}
      >
        No price decisions yet. The agent will sweep on the next clock tick.
      </div>
    );
  }

  return (
    <div>
      {/* Dispute dialog */}
      <Dialog open={disputeTarget !== null} onOpenChange={(open) => { if (!open) { setDisputeTarget(null); setDisputeNote(""); setDisputeError(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dispute Price Decision</DialogTitle>
          </DialogHeader>
          {disputeTarget && (
            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontSize: 12,
                  color: "var(--c-muted, #999)",
                  marginBottom: 8,
                }}
              >
                {displayPrice(disputeTarget.old_price)} → {displayPrice(disputeTarget.new_price)}
                <span style={{ marginLeft: 8, opacity: 0.6 }}>
                  {formatTs(disputeTarget.created_at)}
                </span>
              </div>
              <div
                style={{
                  fontFamily: "var(--font-manrope), sans-serif",
                  fontSize: 13,
                  color: "var(--c-muted, #999)",
                  marginBottom: 12,
                  padding: "8px 12px",
                  background: "var(--c-surface, #12101f)",
                  borderRadius: 8,
                  border: "1px solid var(--c-border, #2a2740)",
                }}
              >
                {disputeTarget.reasoning}
              </div>
            </div>
          )}
          <textarea
            placeholder="Explain why this decision seems wrong or incoherent…"
            value={disputeNote}
            onChange={(e) => setDisputeNote(e.target.value)}
            rows={4}
            style={{
              width: "100%",
              background: "var(--c-surface, #12101f)",
              border: "1px solid var(--c-border, #2a2740)",
              borderRadius: 8,
              padding: "10px 12px",
              color: "var(--c-text, #e8e6f0)",
              fontFamily: "var(--font-manrope), sans-serif",
              fontSize: 13,
              resize: "vertical",
              outline: "none",
            }}
          />
          {disputeError && (
            <div style={{ color: "var(--c-red, #ef4444)", fontSize: 13, marginTop: 4 }}>
              {disputeError}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setDisputeTarget(null); setDisputeNote(""); setDisputeError(null); }}
            >
              Cancel
            </Button>
            <Button
              onClick={submitDispute}
              disabled={disputing || !disputeNote.trim()}
            >
              {disputing ? "Submitting…" : "Submit Dispute"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Decision list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {decisions.map((d) => {
          const isExpanded = expanded.has(d.id);
          const isLowConf = d.confidence < 0.5;
          const isDisputed = disputedIds.has(d.id);
          let dir: "up" | "down" | "flat" = "flat";
          try {
            const nv = BigInt(d.new_price);
            const ov = BigInt(d.old_price);
            if (nv > ov) dir = "up";
            else if (nv < ov) dir = "down";
          } catch { /* keep flat */ }

          const dirColor =
            dir === "up"
              ? "var(--c-green, #22c55e)"
              : dir === "down"
              ? "var(--c-red, #ef4444)"
              : "var(--c-muted, #999)";

          return (
            <div
              key={d.id}
              style={{
                background: isLowConf
                  ? "linear-gradient(170deg, rgba(239,68,68,0.05), var(--c-surface, #12101f))"
                  : "linear-gradient(170deg, var(--c-surface-hi, #18162a), var(--c-surface, #12101f))",
                border: `1px solid ${isLowConf ? "rgba(239,68,68,0.25)" : "var(--c-border, #2a2740)"}`,
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              {/* Header row */}
              <button
                onClick={() => toggleExpand(d.id)}
                style={{
                  width: "100%",
                  padding: "14px 16px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  textAlign: "left",
                }}
              >
                {/* Timestamp */}
                <span
                  style={{
                    fontFamily: "var(--font-jetbrains), monospace",
                    fontSize: 11,
                    color: "var(--c-dim, #666)",
                    flexShrink: 0,
                    minWidth: 140,
                  }}
                >
                  {formatTs(d.created_at)}
                </span>

                {/* Price change */}
                <span
                  style={{
                    fontFamily: "var(--font-jetbrains), monospace",
                    fontSize: 13,
                    fontWeight: 600,
                    color: dirColor,
                    flexShrink: 0,
                  }}
                >
                  {displayPrice(d.old_price)} → {displayPrice(d.new_price)}
                </span>

                {/* Trigger badge */}
                <Badge variant={TRIGGER_VARIANT[d.trigger]}>
                  {TRIGGER_LABELS[d.trigger]}
                </Badge>

                {/* Confidence */}
                <span
                  style={{
                    fontFamily: "var(--font-jetbrains), monospace",
                    fontSize: 11,
                    color: d.confidence < 0.5 ? "var(--c-red, #ef4444)" : "var(--c-dim, #666)",
                    marginLeft: "auto",
                    flexShrink: 0,
                  }}
                >
                  {isLowConf && "⚠ "}
                  {Math.round(d.confidence * 100)}% conf
                </span>

                {/* Expand chevron */}
                <span
                  style={{
                    color: "var(--c-dim, #666)",
                    fontSize: 12,
                    flexShrink: 0,
                    transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.2s",
                  }}
                >
                  ▼
                </span>
              </button>

              {/* Expanded body */}
              {isExpanded && (
                <div
                  style={{
                    padding: "0 16px 16px",
                    borderTop: "1px solid var(--c-border-soft, #1e1b32)",
                    paddingTop: 14,
                  }}
                >
                  {/* Reasoning paragraph */}
                  <p
                    style={{
                      fontFamily: "var(--font-manrope), sans-serif",
                      fontSize: 14,
                      color: "var(--c-muted, #999)",
                      lineHeight: 1.6,
                      margin: "0 0 12px",
                    }}
                  >
                    {d.reasoning}
                  </p>

                  {/* Signals cited */}
                  {d.signals_cited.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                      {d.signals_cited.map((sig) => (
                        <span
                          key={sig}
                          style={{
                            fontFamily: "var(--font-jetbrains), monospace",
                            fontSize: 11,
                            color: "var(--c-muted, #999)",
                            background: "var(--c-bg, #0a0814)",
                            border: "1px solid var(--c-border, #2a2740)",
                            padding: "3px 8px",
                            borderRadius: 6,
                          }}
                        >
                          {sig}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Low-confidence warning + dispute */}
                  {isLowConf && !isDisputed && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "8px 12px",
                        background: "rgba(239,68,68,0.08)",
                        borderRadius: 8,
                        border: "1px solid rgba(239,68,68,0.2)",
                      }}
                    >
                      <span style={{ fontSize: 13, color: "var(--c-red, #ef4444)" }}>
                        ⚠ Low confidence — the agent was uncertain about this decision.
                      </span>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); setDisputeTarget(d); }}
                        style={{ flexShrink: 0 }}
                      >
                        Dispute
                      </Button>
                    </div>
                  )}
                  {isDisputed && (
                    <div
                      style={{
                        padding: "8px 12px",
                        background: "rgba(34,197,94,0.08)",
                        borderRadius: 8,
                        border: "1px solid rgba(34,197,94,0.2)",
                        fontSize: 13,
                        color: "var(--c-green, #22c55e)",
                      }}
                    >
                      Dispute submitted.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
