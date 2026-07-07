"use client";

import { useState } from "react";
import { toast } from "sonner";

interface MonetizationToggleProps {
  slug: string;
  initialEnabled: boolean;
}

export function MonetizationToggle({ slug, initialEnabled }: MonetizationToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, setPending] = useState(false);

  async function toggle() {
    const next = !enabled;
    setPending(true);
    setEnabled(next); // optimistic
    try {
      const res = await fetch("/api/articles/monetization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, enabled: next }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to update");
      toast.success(next ? "Monetization enabled" : "Monetization disabled — content is now free", {
        description: slug,
      });
    } catch (e) {
      setEnabled(!next); // revert
      toast.error("Couldn't update monetization", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={enabled}
      title={enabled ? "Monetization on — click to make this article free" : "Monetization off — click to gate this article again"}
      className="inline-flex items-center gap-2 shrink-0"
      style={{ opacity: pending ? 0.6 : 1, cursor: pending ? "wait" : "pointer", background: "transparent", border: "none", padding: 0 }}
    >
      <span
        style={{
          position: "relative",
          width: 34,
          height: 19,
          borderRadius: 999,
          background: enabled ? "var(--c-accent)" : "var(--c-border)",
          transition: "background 0.15s",
          display: "inline-block",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: enabled ? 17 : 2,
            width: 15,
            height: 15,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 0.15s",
            boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
          }}
        />
      </span>
      <span className="font-mono text-xs text-muted-foreground">
        {enabled ? "Paid" : "Free"}
      </span>
    </button>
  );
}
