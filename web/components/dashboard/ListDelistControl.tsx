"use client";

/**
 * components/dashboard/ListDelistControl.tsx — M8
 * Toggle switch for piece status (listed/delisted) and objective (MAX_REVENUE/MAX_REACH).
 * Calls PATCH /api/piece/[id]/settings on change.
 */

import { useState } from "react";
import type { Piece } from "../../lib/repo/types";
import { Button } from "../ui/button";

interface ListDelistControlProps {
  piece: Piece;
  onStatusChange: (id: string, status: Piece["status"]) => void;
  onObjectiveChange?: (id: string, objective: Piece["objective"]) => void;
}

export default function ListDelistControl({
  piece,
  onStatusChange,
  onObjectiveChange,
}: ListDelistControlProps) {
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isListed = piece.status === "listed";

  const handleStatusToggle = async () => {
    const newStatus: Piece["status"] = isListed ? "delisted" : "listed";
    setUpdating(true);
    setError(null);
    try {
      const res = await fetch(`/api/piece/${piece.id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? "Update failed");
      }
      onStatusChange(piece.id, newStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setUpdating(false);
    }
  };

  const handleObjectiveToggle = async () => {
    const newObjective: Piece["objective"] =
      piece.objective === "MAX_REVENUE" ? "MAX_REACH" : "MAX_REVENUE";
    setUpdating(true);
    setError(null);
    try {
      const res = await fetch(`/api/piece/${piece.id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objective: newObjective }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? "Update failed");
      }
      onObjectiveChange?.(piece.id, newObjective);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      {/* Status toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          onClick={handleStatusToggle}
          disabled={updating}
          title={isListed ? "Click to delist" : "Click to list"}
          style={{
            width: 44,
            height: 24,
            borderRadius: 999,
            background: isListed ? "var(--c-green, #22c55e)" : "var(--c-border, #2a2740)",
            border: "none",
            position: "relative",
            cursor: updating ? "wait" : "pointer",
            transition: "background 0.2s",
            flexShrink: 0,
            opacity: updating ? 0.6 : 1,
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 2,
              left: isListed ? 22 : 2,
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "#fff",
              transition: "left 0.2s cubic-bezier(.4,1.5,.5,1)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
            }}
          />
        </button>
        <span
          style={{
            fontFamily: "var(--font-manrope), sans-serif",
            fontSize: 13,
            fontWeight: 600,
            color: isListed ? "var(--c-green, #22c55e)" : "var(--c-muted, #999)",
          }}
        >
          {isListed ? "Listed" : "Delisted"}
        </span>
      </div>

      {/* Objective toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Button
          variant={piece.objective === "MAX_REVENUE" ? "default" : "outline"}
          size="sm"
          onClick={piece.objective !== "MAX_REVENUE" ? handleObjectiveToggle : undefined}
          disabled={updating || piece.objective === "MAX_REVENUE"}
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: 11,
          }}
        >
          MAX_REVENUE
        </Button>
        <Button
          variant={piece.objective === "MAX_REACH" ? "default" : "outline"}
          size="sm"
          onClick={piece.objective !== "MAX_REACH" ? handleObjectiveToggle : undefined}
          disabled={updating || piece.objective === "MAX_REACH"}
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: 11,
          }}
        >
          MAX_REACH
        </Button>
      </div>

      {error && (
        <span
          style={{
            fontFamily: "var(--font-manrope), sans-serif",
            fontSize: 12,
            color: "var(--c-red, #ef4444)",
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
