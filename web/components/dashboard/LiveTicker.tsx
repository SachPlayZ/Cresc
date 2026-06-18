"use client";

/**
 * components/dashboard/LiveTicker.tsx — M8
 * Shows the current standing price for a piece with live updates via Supabase Realtime.
 * Subscribes to price_decisions on mount; flashes a pulse animation on each update.
 * No LLM calls — reads only from DB.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createBrowserClient } from "../../lib/db";
import { fromBaseUnits, toDisplay } from "../../lib/money";
import { USDC_ERC20_DECIMALS } from "../../lib/config";
import type { PriceDecision } from "../../lib/repo/types";

interface LiveTickerProps {
  pieceId: string;
  initialPrice: string; // base units string
  initialDecisions: PriceDecision[];
}

const TRIGGER_LABELS: Record<PriceDecision["trigger"], string> = {
  clock: "CLOCK",
  spike: "SPIKE",
  tip_surplus: "TIP SURPLUS",
};

const TRIGGER_COLORS: Record<PriceDecision["trigger"], string> = {
  clock: "var(--c-dim, #666)",
  spike: "var(--c-amber, #f59e0b)",
  tip_surplus: "var(--c-violet, #7c3aed)",
};

function priceToDisplay(baseUnits: string): string {
  try {
    return toDisplay(fromBaseUnits(BigInt(baseUnits), USDC_ERC20_DECIMALS));
  } catch {
    return "$?.???";
  }
}

export default function LiveTicker({ pieceId, initialPrice, initialDecisions }: LiveTickerProps) {
  const [currentPrice, setCurrentPrice] = useState(initialPrice);
  const [latestDecision, setLatestDecision] = useState<PriceDecision | null>(
    initialDecisions[0] ?? null
  );
  const [prevPrice, setPrevPrice] = useState<string | null>(
    initialDecisions[0]?.old_price ?? null
  );
  const [pulse, setPulse] = useState(0);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const handleNewDecision = useCallback((decision: PriceDecision) => {
    setPrevPrice(decision.old_price);
    setCurrentPrice(decision.new_price);
    setLatestDecision(decision);
    setPulse((p) => p + 1);
  }, []);

  useEffect(() => {
    const db = createBrowserClient();
    if (!db) return;
    const channel = db
      .channel(`live-ticker:${pieceId}`)
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

    channelRef.current = channel;
    return () => {
      channel.unsubscribe();
    };
  }, [pieceId, handleNewDecision]);

  const currentDisplay = priceToDisplay(currentPrice);
  const prevDisplay = prevPrice ? priceToDisplay(prevPrice) : null;

  let direction: "up" | "down" | "flat" = "flat";
  if (prevPrice) {
    try {
      const cur = BigInt(currentPrice);
      const prev = BigInt(prevPrice);
      if (cur > prev) direction = "up";
      else if (cur < prev) direction = "down";
    } catch {
      // keep flat
    }
  }

  const dirColor =
    direction === "up"
      ? "var(--c-green, #22c55e)"
      : direction === "down"
      ? "var(--c-red, #ef4444)"
      : "var(--c-muted, #999)";

  const arrow = direction === "up" ? "↑" : direction === "down" ? "↓" : "·";

  const confidence = latestDecision?.confidence ?? null;
  const trigger = latestDecision?.trigger ?? null;

  return (
    <div
      style={{
        background: "linear-gradient(170deg, var(--c-surface-hi, #18162a), var(--c-surface, #12101f))",
        border: "1px solid var(--c-border, #2a2740)",
        borderRadius: 16,
        padding: "24px 28px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Pulse ring on update */}
      {pulse > 0 && (
        <span
          key={`pulse-${pulse}`}
          style={{
            position: "absolute",
            top: 24,
            left: 28,
            width: 48,
            height: 48,
            borderRadius: "50%",
            border: `2px solid ${dirColor}`,
            pointerEvents: "none",
            animation: "cresc-ring 600ms ease-out forwards",
          }}
        />
      )}

      {/* Label */}
      <div
        style={{
          fontFamily: "var(--font-jetbrains), monospace",
          fontSize: 11,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--c-dim, #666)",
          marginBottom: 10,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--c-accent, #3b82f6)",
            display: "inline-block",
            boxShadow: "0 0 8px var(--c-accent, #3b82f6)",
          }}
        />
        standing price
        {trigger && (
          <span
            style={{
              marginLeft: 8,
              padding: "2px 8px",
              borderRadius: 999,
              border: "1px solid",
              borderColor: TRIGGER_COLORS[trigger],
              color: TRIGGER_COLORS[trigger],
              fontSize: 10,
              letterSpacing: "0.08em",
            }}
          >
            {TRIGGER_LABELS[trigger]}
          </span>
        )}
      </div>

      {/* Price display */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 12,
          marginBottom: 8,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontWeight: 600,
            fontSize: 52,
            letterSpacing: "-0.04em",
            lineHeight: 1,
            color: dirColor,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {currentDisplay}
        </div>
        <div
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: 18,
            fontWeight: 500,
            color: dirColor,
            marginBottom: 6,
          }}
        >
          {arrow}
        </div>
        {prevDisplay && (
          <div
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: 14,
              color: "var(--c-dim, #666)",
              marginBottom: 8,
              textDecoration: "line-through",
            }}
          >
            {prevDisplay}
          </div>
        )}
      </div>

      {/* Latest reasoning snippet */}
      {latestDecision && (
        <div
          style={{
            fontFamily: "var(--font-manrope), sans-serif",
            fontSize: 13,
            color: "var(--c-muted, #999)",
            lineHeight: 1.5,
            marginBottom: 14,
            maxWidth: 420,
          }}
        >
          {direction !== "flat" ? (direction === "up" ? "↗ " : "↘ ") : ""}
          {latestDecision.reasoning.slice(0, 120)}
          {latestDecision.reasoning.length > 120 ? "…" : ""}
        </div>
      )}

      {/* Confidence bar */}
      {confidence !== null && (
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: 11,
              color: "var(--c-dim, #666)",
              marginBottom: 4,
            }}
          >
            <span>confidence</span>
            <span>{Math.round(confidence * 100)}%</span>
          </div>
          <div
            style={{
              height: 4,
              background: "var(--c-border, #2a2740)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.round(confidence * 100)}%`,
                background:
                  confidence >= 0.7
                    ? "var(--c-green, #22c55e)"
                    : confidence >= 0.4
                    ? "var(--c-amber, #f59e0b)"
                    : "var(--c-red, #ef4444)",
                borderRadius: 2,
                transition: "width 0.4s ease",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
