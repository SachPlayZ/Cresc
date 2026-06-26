"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import Link from "next/link";

type Theme = "dark" | "light";
interface TickerItem {
  title: string;
  medium: string;
  p: number;
  prev: number;
}
interface LogEntry {
  id: number;
  time: string;
  text: string;
}

const SEED_HISTORY = [
  0.011, 0.0118, 0.0112, 0.012, 0.0124, 0.0119, 0.0128, 0.013, 0.0126, 0.0133,
  0.0129, 0.0136, 0.0141, 0.0138, 0.0134, 0.0142, 0.0146, 0.0143, 0.0139,
  0.0144, 0.0148, 0.0145, 0.0141, 0.014,
];

const REASONS = [
  "Dwell climbing this hour — adjusted up from prior sweep",
  "Saves outpacing views — eased the price upward",
  "Fresh inbound momentum — nudged up a notch",
  "Tip landed above suggested — underpriced, corrected up",
  "Engagement cooling slightly — eased the price down",
];

const LOG_LINES = [
  "saves rising — nudged up 0.0006",
  "bounce climbing — holding, watching",
  "inbound from /weekly — momentum up",
  "tip above suggested — +0.0008",
  "engagement cooling — eased down 0.0004",
  "recency strong, depth thin — flat",
];

const INIT_LOG: LogEntry[] = [
  { id: 1, time: "09:41:02", text: "recency strong, depth thin — held flat" },
  { id: 2, time: "09:43:18", text: "fresh inbound from /weekly — momentum up" },
  { id: 3, time: "09:46:50", text: "saves rising 2.3× — nudged up 0.0006" },
];

const TICKER_BASE = [
  { title: "The Quiet Collapse of Attention", medium: "ARTICLE", p: 0.0091 },
  { title: "Static, 04:12", medium: "PHOTO", p: 0.014 },
  { title: "Field Notes, Ep. 9", medium: "VIDEO", p: 0.021 },
  { title: "Untitled (Lime)", medium: "ART", p: 0.0305 },
  { title: "Notes on a Slower Internet", medium: "ARTICLE", p: 0.0123 },
];

function spark(arr: number[], w: number, h: number, padY: number) {
  const min = Math.min(...arr),
    max = Math.max(...arr),
    span = max - min || 1;
  const pts = arr.map((v, i) => {
    const x = (i / (arr.length - 1)) * w;
    const y = h - padY - ((v - min) / span) * (h - 2 * padY);
    return [x, y] as [number, number];
  });
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return { line, area: `0,${h} ${line} ${w},${h}`, last: pts[pts.length - 1] };
}

function colorFor(dir: number) {
  return dir > 0
    ? "var(--c-green)"
    : dir < 0
      ? "var(--c-red)"
      : "var(--c-amber)";
}

const PadlockSVG = ({ open }: { open: boolean }) => {
  return (
    <svg
      width="48"
      height="54"
      viewBox="0 0 48 54"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M14 20V14C14 8.47715 18.4772 4 24 4C29.5228 4 34 8.47715 34 14V20"
        stroke="var(--c-accent)"
        strokeWidth="6"
        strokeLinecap="round"
        style={{
          transform: open ? "translateY(-6px) rotate(-15deg)" : "none",
          transformOrigin: "34px 20px",
          transition: "transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      />
      <rect x="6" y="18" width="36" height="30" rx="8" fill="var(--c-accent)" />
      <circle cx="24" cy="30" r="4" fill="var(--c-accent-ink)" />
      <path
        d="M24 34V40"
        stroke="var(--c-accent-ink)"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
};

const CardView = ({
  stage,
  onClick,
}: {
  stage: string;
  onClick: () => void;
}) => {
  const isPressed = stage === "clicking";
  return (
    <div
      onClick={onClick}
      style={{
        width: "100%",
        height: "100%",
        background: "var(--c-surface)",
        border: "1px solid var(--c-border)",
        borderRadius: 16,
        padding: 22,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        cursor: "pointer",
        position: "relative",
        boxShadow: "var(--c-shadow-sm)",
        transform: isPressed ? "scale(0.97)" : "scale(1)",
        transition: "transform 0.15s ease-out, border-color 0.3s ease",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(135deg, rgba(155, 134, 255, 0.05) 0%, transparent 100%)",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          zIndex: 2,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: 10,
            color: "var(--c-violet)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            background: "rgba(155, 134, 255, 0.1)",
            padding: "4px 8px",
            borderRadius: 6,
          }}
        >
          Technology
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--c-accent)",
            }}
          >
            $0.0082
          </span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--c-accent)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
        </div>
      </div>

      <div style={{ margin: "14px 0", zIndex: 2 }}>
        <h3
          style={{
            fontFamily: "var(--font-sora), sans-serif",
            fontWeight: 600,
            fontSize: 19,
            lineHeight: 1.3,
            color: "var(--c-text)",
            margin: "0 0 8px 0",
          }}
        >
          The Quiet Collapse of Attention
        </h3>
        <p
          style={{
            fontFamily: "var(--font-manrope), sans-serif",
            fontSize: 13,
            lineHeight: 1.5,
            color: "var(--c-muted)",
            margin: 0,
          }}
        >
          How the modern web became a battlefield for your focus, and how
          micro-pricing changes the incentives for quality content creators...
        </p>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          zIndex: 2,
          marginTop: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "var(--c-surface-2)",
              border: "1px solid var(--c-border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-sora), sans-serif",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--c-violet)",
            }}
          >
            EV
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span
              style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text)" }}
            >
              Elena Vance
            </span>
            <span style={{ fontSize: 10, color: "var(--c-dim)" }}>
              5 min read
            </span>
          </div>
        </div>

        <button
          className="cresc-btn-accent"
          style={{
            background: "var(--c-accent)",
            color: "var(--c-accent-ink)",
            fontFamily: "var(--font-manrope), sans-serif",
            fontSize: 12,
            fontWeight: 700,
            padding: "8px 14px",
            borderRadius: 8,
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            boxShadow: "0 4px 12px rgba(198, 248, 78, 0.2)",
          }}
        >
          Read Full
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="5" y1="12" x2="19" y2="12"></line>
            <polyline points="12 5 19 12 12 19"></polyline>
          </svg>
        </button>
      </div>

      {stage === "clicking" && (
        <span
          style={{
            position: "absolute",
            top: "76%",
            left: "81%",
            width: 50,
            height: 50,
            marginLeft: -25,
            marginTop: -25,
            borderRadius: "50%",
            border: "2px solid var(--c-accent)",
            animation: "cresc-ring 500ms ease-out forwards",
            pointerEvents: "none",
            zIndex: 10,
          }}
        />
      )}
    </div>
  );
};

const ArticleDetailView = ({ stage }: { stage: string }) => {
  const isBlurred = stage === "opening" || stage === "paying";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "var(--c-surface)",
        border: "1px solid var(--c-border)",
        borderRadius: 16,
        padding: 22,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        boxShadow: "var(--c-shadow-sm)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          filter: isBlurred ? "blur(10px)" : "blur(0px)",
          transform: isBlurred ? "scale(0.99)" : "scale(1)",
          transition:
            "filter 0.7s cubic-bezier(0.25, 0.8, 0.25, 1), transform 0.7s cubic-bezier(0.25, 0.8, 0.25, 1)",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          opacity: 0.95,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: 10,
              color: "var(--c-dim)",
            }}
          >
            ARTICLE · 5 MIN READ
          </span>
          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: 11,
              color: "var(--c-muted)",
            }}
          >
            Elena Vance
          </span>
        </div>

        <h2
          style={{
            fontFamily: "var(--font-sora), sans-serif",
            fontWeight: 700,
            fontSize: 20,
            lineHeight: 1.25,
            color: "var(--c-text)",
            margin: "0 0 12px 0",
          }}
        >
          The Quiet Collapse of Attention
        </h2>

        <div
          style={{
            fontFamily: "var(--font-manrope), sans-serif",
            fontSize: 13,
            lineHeight: 1.6,
            color: "var(--c-muted)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            overflow: "hidden",
          }}
        >
          <p style={{ margin: 0 }}>
            We did not evolve to process thousands of fragments of information
            per hour. The modern attention economy treats human focus as an
            infinite resource to be mined, packaged, and sold to the highest
            bidder.
          </p>
          <p style={{ margin: 0 }}>
            By placing a micro-price on attention, we flip the script. Platforms
            must pay for your time, and creators are compensated directly by
            automated agents. The web becomes quiet again, structured around
            quality rather than clicks.
          </p>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(21, 16, 31, 0.45)",
          backdropFilter: "blur(2px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          opacity: isBlurred ? 1 : 0,
          transform: isBlurred ? "scale(1)" : "scale(1.05)",
          pointerEvents: isBlurred ? "auto" : "none",
          transition: "opacity 0.5s ease 0.4s, transform 0.5s ease 0.4s",
          zIndex: 5,
        }}
      >
        <div style={{ position: "relative" }}>
          <PadlockSVG open={stage === "unlocked"} />

          {stage === "unlocked" && (
            <span
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: 120,
                height: 120,
                marginLeft: -60,
                marginTop: -60,
                borderRadius: "50%",
                border: "2px solid var(--c-green)",
                animation:
                  "green-success-pulse 0.8s cubic-bezier(0.1, 0.8, 0.3, 1) forwards",
                pointerEvents: "none",
              }}
            />
          )}

          {stage === "paying" && (
            <div
              style={{
                position: "absolute",
                left: "50%",
                bottom: -35,
                marginLeft: -8,
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: "var(--c-accent)",
                boxShadow: "0 0 12px var(--c-accent)",
                animation:
                  "coin-fly 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) infinite",
              }}
            />
          )}
        </div>

        <div
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: 12,
            letterSpacing: "0.08em",
            color: stage === "paying" ? "var(--c-amber)" : "var(--c-red)",
            transition: "color 0.3s ease",
            textAlign: "center",
          }}
        >
          {stage === "paying"
            ? "402 · awaiting payment"
            : "402 · Payment Required"}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "var(--c-surface-hi)",
            border: "1px solid var(--c-border)",
            padding: "6px 12px",
            borderRadius: 999,
            fontFamily: "var(--font-manrope), sans-serif",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--c-text)",
            opacity: stage === "paying" ? 1 : 0,
            transform:
              stage === "paying" ? "translateY(0)" : "translateY(10px)",
            transition: "opacity 0.4s ease, transform 0.4s ease",
          }}
        >
          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: "var(--c-violet)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: 8,
              fontWeight: 700,
              color: "#fff",
              animation: "agent-pulse 1.5s infinite",
            }}
          >
            AI
          </span>
          Agent paying $0.0082...
        </div>
      </div>
    </div>
  );
};

function HeroDemoLoop() {
  const [stage, setStage] = useState<
    "browse" | "cursor-moving" | "clicking" | "opening" | "paying" | "unlocked"
  >("browse");

  useEffect(() => {
    let active = true;
    const runLoop = async () => {
      while (active) {
        setStage("browse");
        await new Promise((resolve) => setTimeout(resolve, 2500));
        if (!active) break;

        setStage("cursor-moving");
        await new Promise((resolve) => setTimeout(resolve, 1400));
        if (!active) break;

        setStage("clicking");
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (!active) break;

        setStage("opening");
        await new Promise((resolve) => setTimeout(resolve, 1200));
        if (!active) break;

        setStage("paying");
        await new Promise((resolve) => setTimeout(resolve, 2200));
        if (!active) break;

        setStage("unlocked");
        await new Promise((resolve) => setTimeout(resolve, 4500));
        if (!active) break;
      }
    };
    runLoop();
    return () => {
      active = false;
    };
  }, []);

  let cursorStyle = {
    top: "85%",
    left: "85%",
    opacity: 0,
    scale: 1,
    cursor: "default" as "default" | "pointer",
  };

  if (stage === "cursor-moving") {
    cursorStyle = {
      top: "79%",
      left: "81%",
      opacity: 1,
      scale: 1,
      cursor: "pointer",
    };
  } else if (stage === "clicking") {
    cursorStyle = {
      top: "79%",
      left: "81%",
      opacity: 1,
      scale: 0.82,
      cursor: "pointer",
    };
  }

  const showDetail =
    stage === "opening" || stage === "paying" || stage === "unlocked";

  return (
    <div
      style={{
        position: "relative",
        height: 380,
        width: "100%",
        borderRadius: 20,
        overflow: "hidden",
      }}
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes coin-fly {
          0% {
            transform: translateY(60px) scale(0.6);
            opacity: 0;
          }
          15% {
            opacity: 1;
          }
          80% {
            transform: translateY(-70px) scale(1);
            opacity: 1;
          }
          100% {
            transform: translateY(-100px) scale(0.2);
            opacity: 0;
          }
        }
        @keyframes agent-pulse {
          0%, 100% { opacity: 0.9; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }
        @keyframes green-success-pulse {
          0% { transform: scale(0.5); opacity: 0.8; }
          100% { transform: scale(2.2); opacity: 0; }
        }
      `,
        }}
      />

      <div
        style={{
          position: "absolute",
          top: cursorStyle.top,
          left: cursorStyle.left,
          opacity: cursorStyle.opacity,
          transform: `scale(${cursorStyle.scale})`,
          transition:
            "top 1.2s cubic-bezier(0.22, 1, 0.36, 1), left 1.2s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease, transform 0.15s ease",
          pointerEvents: "none",
          zIndex: 100,
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ filter: "drop-shadow(0px 2px 4px rgba(0,0,0,0.35))" }}
        >
          {cursorStyle.cursor === "pointer" ? (
            <path
              d="M12 2v8M12 2a2 2 0 012 2v6M9 6V4a2 2 0 014 0v6M15 8a2 2 0 012 2v2a6 6 0 01-6 6H9a5 5 0 01-5-5V9.5a2 2 0 014 0V10M17 11.5V11a2 2 0 012 2v2a8 8 0 01-8 8H9a7 7 0 01-7-7"
              stroke="#FFF"
              strokeWidth="2.5"
              fill="rgba(21, 16, 31, 0.7)"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <path
              d="M5.5 3.2V20.8L10.3 16L13.8 22.8L16.2 21.6L12.7 14.8H19.5L5.5 3.2Z"
              fill="#FFF"
              stroke="#000"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          )}
        </svg>
      </div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: showDetail ? 0 : 1,
          transform: showDetail ? "scale(0.95)" : "scale(1)",
          transition: "opacity 0.4s ease, transform 0.4s ease",
          pointerEvents: showDetail ? "none" : "auto",
        }}
      >
        <CardView stage={stage} onClick={() => {}} />
      </div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: showDetail ? 1 : 0,
          transform: showDetail ? "scale(1)" : "scale(1.05)",
          transition: "opacity 0.4s ease, transform 0.4s ease",
          pointerEvents: showDetail ? "auto" : "none",
        }}
      >
        <ArticleDetailView stage={stage} />

        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            background:
              "linear-gradient(0deg, rgba(21,16,31,0.95), rgba(21,16,31,0.75))",
            borderTop: "1px solid var(--c-border)",
            opacity: stage === "unlocked" ? 1 : 0,
            transform:
              stage === "unlocked" ? "translateY(0)" : "translateY(15px)",
            transition: "opacity 0.5s ease 0.3s, transform 0.5s ease 0.3s",
            pointerEvents: "none",
            zIndex: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: 12,
              color: "var(--c-green)",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--c-green)",
                display: "inline-block",
                boxShadow: "0 0 10px var(--c-green)",
              }}
            />
            Unlocked · $0.0082 paid via Arc
          </div>
          <div
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: 11,
              color: "var(--c-muted)",
              background: "rgba(255,255,255,0.06)",
              padding: "3px 8px",
              borderRadius: 4,
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            200 OK
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Animated stat counter ─────────────────────────────────────────────────

interface StatItem {
  prefix: string;
  num: number | null; // null = non-numeric (like "<1s")
  suffix: string;
  display: string; // fallback / static display when num is null
  label: string;
  accent: boolean;
  decimals: number;
}

const STATS: StatItem[] = [
  {
    prefix: "$0.",
    num: 0.000001,
    suffix: "",
    display: "$0.000001",
    label: "minimum payment size",
    accent: false,
    decimals: 6,
  },
  {
    prefix: "<",
    num: 1,
    suffix: "s",
    display: "<1s",
    label: "settlement time on Arc",
    accent: false,
    decimals: 0,
  },
  {
    prefix: "",
    num: 100,
    suffix: "%",
    display: "100%",
    label: "AI-reasoned pricing decisions",
    accent: true,
    decimals: 0,
  },
];

function AnimatedStat({ stat }: { stat: StatItem }) {
  const [started, setStarted] = useState(false);
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const rafRef2 = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started) {
          setStarted(true);
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started || stat.num === null) return;
    const target = stat.num;
    const duration = 1600;
    const t0 = performance.now();
    const easeOut = (x: number) => 1 - Math.pow(1 - x, 4);
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      setValue(target * easeOut(t));
      if (t < 1) rafRef2.current = requestAnimationFrame(step);
      else setValue(target);
    };
    rafRef2.current = requestAnimationFrame(step);
    return () => {
      if (rafRef2.current) cancelAnimationFrame(rafRef2.current);
    };
  }, [started, stat.num]);

  // Format the animated number
  const formatted = () => {
    if (stat.num === null) return stat.display;
    // Special case: $0.000001 — animate like 0.000000 → 0.000001
    if (stat.decimals === 6) {
      return `$0.${Math.round(value * 1e6)
        .toString()
        .padStart(6, "0")}`;
    }
    if (stat.decimals === 0) {
      return `${stat.prefix}${Math.round(value)}${stat.suffix}`;
    }
    return `${stat.prefix}${value.toFixed(stat.decimals)}${stat.suffix}`;
  };

  return (
    <div ref={ref}>
      <div
        style={{
          fontFamily: "var(--font-jetbrains), monospace",
          fontWeight: 600,
          fontSize: 46,
          letterSpacing: "-0.04em",
          marginBottom: 8,
          fontVariantNumeric: "tabular-nums",
          color: stat.accent ? "var(--c-violet)" : undefined,
          transition: "color 0.3s ease",
        }}
      >
        {formatted()}
      </div>
      <div
        style={{
          fontFamily: "var(--font-manrope), sans-serif",
          fontSize: 15,
          color: "var(--c-muted)",
        }}
      >
        {stat.label}
      </div>
    </div>
  );
}

function StatsSection() {
  return (
    <section
      data-reveal
      style={{
        borderTop: "1px solid var(--c-border-soft)",
        borderBottom: "1px solid var(--c-border-soft)",
        background: "var(--c-bg-soft)",
        padding: "64px 40px",
      }}
    >
      <div
        style={{
          maxWidth: 1000,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "repeat(3,1fr)",
          gap: 40,
          textAlign: "center",
        }}
      >
        {STATS.map((stat) => (
          <AnimatedStat key={stat.label} stat={stat} />
        ))}
      </div>
    </section>
  );
}

export default function Home() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "dark";
    try {
      const saved = localStorage.getItem("cresc-theme");
      return saved === "dark" || saved === "light" ? saved : "dark";
    } catch {
      return "dark";
    }
  });
  const [loaded, setLoaded] = useState(false);
  const [creatorId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem("cresc_creator_id");
    } catch {
      return null;
    }
  });
  const [ucwWallet] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem("cresc_ucw_wallet");
    } catch {
      return null;
    }
  });

  const [price, setPrice] = useState(0.014);
  const [displayed, setDisplayed] = useState(0.014);
  const [dir, setDir] = useState(0);
  const [history, setHistory] = useState<number[]>(SEED_HISTORY);
  const [pulse, setPulse] = useState(0);
  const [reason, setReason] = useState(
    "Saves up 12 this hour — adjusted up from $0.012",
  );
  const [ticker, setTicker] = useState<TickerItem[]>(
    TICKER_BASE.map((b) => ({ ...b, prev: b.p })),
  );
  const [log, setLog] = useState<LogEntry[]>(INIT_LOG);

  const navRef = useRef<HTMLElement>(null);
  const rafRef = useRef<number | null>(null);

  const priceRef = useRef(price);
  const displayedRef = useRef(displayed);

  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 1850);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    priceRef.current = price;
    displayedRef.current = displayed;
  }, [displayed, price]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const handler = () => {
      if (window.scrollY > 24) {
        nav.style.background =
          "color-mix(in srgb, var(--c-bg) 78%, transparent)";
        nav.style.backdropFilter = "saturate(140%) blur(14px)";
        (nav.style as unknown as Record<string, string>).webkitBackdropFilter =
          "saturate(140%) blur(14px)";
        nav.style.borderBottomColor = "var(--c-border-soft)";
      } else {
        nav.style.background = "transparent";
        nav.style.backdropFilter = "none";
        (nav.style as unknown as Record<string, string>).webkitBackdropFilter =
          "none";
        nav.style.borderBottomColor = "transparent";
      }
    };
    window.addEventListener("scroll", handler, { passive: true });
    handler();
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const tween = useCallback((from: number, to: number) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const t0 = performance.now(),
      dur = 600;
    const ease = (x: number) => 1 - Math.pow(1 - x, 3);
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      setDisplayed(from + (to - from) * ease(t));
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => {
    const vol = 0.0012;
    const tick = () => {
      const cur = priceRef.current;
      const from = displayedRef.current;
      let next = cur + (Math.random() - 0.46) * vol * 2;
      next = Math.max(0.006, Math.min(0.028, next));
      setPrice(next);
      setDir(next > cur ? 1 : next < cur ? -1 : 0);
      setHistory((h) => [...h, next].slice(-24));
      setTicker((tk) =>
        tk.map((item) => {
          const np = Math.max(
            0.006,
            Math.min(0.035, item.p + (Math.random() - 0.47) * vol * 1.6),
          );
          return { ...item, prev: item.p, p: np };
        }),
      );
      setReason(REASONS[Math.floor(Math.random() * REASONS.length)]);
      setPulse((p) => p + 1);
      tween(from, next);
    };
    const addLog = () => {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      const text = LOG_LINES[Math.floor(Math.random() * LOG_LINES.length)];
      setLog((l) => [...l, { id: Date.now(), time, text }].slice(-7));
    };
    const iv = setInterval(tick, 2700);
    const logIv = setInterval(addLog, 4590);
    return () => {
      clearInterval(iv);
      clearInterval(logIv);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [tween]);

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem("cresc-theme", next);
    } catch {}
  };

  const priceStr = `$${displayed.toFixed(4)}`;
  const priceColor = colorFor(dir);

  const tickerItems = ticker.map((x) => {
    const d = x.p > x.prev ? 1 : x.p < x.prev ? -1 : 0;
    const arrow = d > 0 ? "↑" : d < 0 ? "↓" : "·";
    return { ...x, color: colorFor(d), label: `${arrow} $${x.p.toFixed(4)}` };
  });
  const tickerLoop = [...tickerItems, ...tickerItems];

  const sp = spark(history, 480, 200, 18);

  return (
    <div
      data-theme={theme}
      style={{
        background: "var(--c-bg)",
        color: "var(--c-text)",
        fontFamily: "var(--font-manrope), sans-serif",
        minHeight: "100vh",
        overflowX: "hidden",
        position: "relative",
        transition: "background 0.4s ease, color 0.4s ease",
      }}
    >
      {/* ============ LOADER ============ */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 26,
          background: "var(--c-bg)",
          opacity: loaded ? 0 : 1,
          pointerEvents: loaded ? "none" : "auto",
          transition: "opacity 0.55s ease",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "radial-gradient(circle at 50% 44%, var(--c-glow), transparent 55%)",
          }}
        />
        <div
          style={{ position: "relative", width: 108, height: 120, zIndex: 1 }}
        >
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: 0,
              width: 54,
              height: 50,
              border: "8px solid var(--c-accent)",
              borderBottom: "none",
              borderRadius: "27px 27px 0 0",
              transform: "translateX(-50%)",
              transformOrigin: "bottom right",
              animation: "ld-shackle 1.7s cubic-bezier(.5,1.5,.4,1) forwards",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: "50%",
              bottom: 0,
              width: 108,
              height: 80,
              background: "var(--c-accent)",
              borderRadius: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 14px 36px rgba(0,0,0,0.4)",
              animation: "ld-pop 1.7s ease forwards",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontWeight: 600,
                fontSize: 24,
                color: "var(--c-accent-ink)",
                letterSpacing: "-0.02em",
              }}
            >
              x402
            </span>
          </div>
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: 30,
              width: 13,
              height: 13,
              borderRadius: "50%",
              background: "var(--c-violet)",
              boxShadow: "0 0 14px var(--c-violet)",
              transform: "translateX(-50%)",
              animation: "ld-coin 1.7s ease-in forwards",
            }}
          />
        </div>
        <div
          style={{
            zIndex: 1,
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: 12,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--c-green)",
            animation: "ld-status 1.7s ease forwards",
          }}
        >
          200 · payment settled
        </div>
        <div
          style={{
            zIndex: 1,
            fontFamily: "var(--font-sora), sans-serif",
            fontWeight: 600,
            fontSize: 14,
            letterSpacing: "-0.01em",
            color: "var(--c-muted)",
          }}
        >
          Cresc
        </div>
      </div>

      {/* ============ NAV ============ */}
      <nav
        ref={navRef}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 40px",
          transition: "background 0.3s ease, border-color 0.3s ease",
          borderBottom: "1px solid transparent",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-sora), sans-serif",
            fontWeight: 700,
            fontSize: 19,
            letterSpacing: "-0.03em",
            display: "flex",
            alignItems: "center",
            gap: 9,
          }}
        >
          <img
            src="/cresc-logo-transparent.png"
            alt="Cresc Logo"
            style={{
              width: 20,
              height: 20,
              objectFit: "contain",
            }}
          />
          Cresc
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          <button
            onClick={toggleTheme}
            title="Toggle theme"
            style={{
              width: 48,
              height: 27,
              borderRadius: 999,
              background: "var(--c-surface-2)",
              border: "1px solid var(--c-border)",
              position: "relative",
              cursor: "pointer",
              padding: 0,
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 2,
                left: theme === "light" ? 24 : 2,
                width: 21,
                height: 21,
                borderRadius: "50%",
                background: "var(--c-accent)",
                transition: "left 0.32s cubic-bezier(.4,1.5,.5,1)",
                boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
              }}
            />
          </button>
          {ucwWallet && (
            <span
              style={{
                height: 38,
                display: "inline-flex",
                alignItems: "center",
                border: "1px solid var(--c-border)",
                borderRadius: 999,
                padding: "0 14px",
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: 12,
                color: "var(--c-muted)",
                background: "var(--c-surface-2)",
              }}
            >
              UCW {ucwWallet.slice(0, 6)}…{ucwWallet.slice(-4)}
            </span>
          )}

          {creatorId ? (
            <>
              <Link
                href={`/dashboard?creator=${creatorId}`}
                style={{ textDecoration: "none", display: "inline-flex" }}
              >
                <Button
                  className="cresc-btn-accent rounded-full text-sm font-bold px-5 flex items-center justify-center"
                  style={{
                    height: 38,
                    background: "var(--c-accent)",
                    color: "var(--c-accent-ink)",
                    boxShadow: "0 0 12px rgba(198, 248, 78, 0.15)",
                  }}
                >
                  Dashboard
                </Button>
              </Link>
              <Link
                href="/docs/ghost"
                style={{ display: "inline-flex" }}
              >
                <Button
                  className="cresc-btn-outline rounded-full text-sm font-semibold px-5 flex items-center justify-center"
                  style={{
                    height: 38,
                    color: "var(--c-text)",
                    border: "1px solid var(--c-border)",
                    background: "transparent",
                  }}
                >
                  Creator Docs
                </Button>
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/ghost-onboard"
                style={{ textDecoration: "none", display: "inline-flex" }}
              >
                <Button
                  className="cresc-btn-accent rounded-full text-sm font-bold px-5 flex items-center justify-center"
                  style={{
                    height: 38,
                    background: "var(--c-accent)",
                    color: "var(--c-accent-ink)",
                    boxShadow: "0 0 12px rgba(198, 248, 78, 0.15)",
                  }}
                >
                  Join as Creator
                </Button>
              </Link>
              <Link href="/docs/ghost" style={{ display: "inline-flex" }}>
                <Button
                  className="cresc-btn-outline rounded-full text-sm font-semibold px-5 flex items-center justify-center"
                  style={{
                    height: 38,
                    color: "var(--c-text)",
                    border: "1px solid var(--c-border)",
                    background: "transparent",
                  }}
                >
                  Creator Docs
                </Button>
              </Link>
            </>
          )}
        </div>
      </nav>

      {/* ============ HERO ============ */}
      <section
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          padding: "120px 40px 70px",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "radial-gradient(ellipse 60% 50% at 18% 30%, var(--c-glow), transparent 60%), radial-gradient(ellipse 40% 40% at 92% 70%, var(--c-glow), transparent 60%)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            maxWidth: 1180,
            margin: "0 auto",
            width: "100%",
            display: "grid",
            gridTemplateColumns: "1.05fr 0.95fr",
            gap: 64,
            alignItems: "center",
            position: "relative",
            zIndex: 1,
          }}
        >
          {/* Left copy */}
          <div>
            <h1
              style={{
                fontFamily: "var(--font-sora), sans-serif",
                fontWeight: 700,
                fontSize: 64,
                lineHeight: 1.05,
                letterSpacing: "-0.035em",
                margin: 0,
              }}
            >
              The price of good work, set the moment it&apos;s seen.
            </h1>
            <p
              style={{
                fontFamily: "var(--font-manrope), sans-serif",
                fontSize: 18,
                lineHeight: 1.7,
                color: "var(--c-muted)",
                maxWidth: 480,
                margin: "26px 0 0",
              }}
            >
              Articles, photos, video, art — anything you publish carries a live
              price, set autonomously by AI and paid in a fraction of a cent.
              Agents settle on-chain via the x402 handshake before the first
              scroll ends.
            </p>
            <div style={{ display: "flex", gap: 13, marginTop: 36 }}>
              <Link
                href="/ghost-onboard"
                style={{ display: "inline-flex", textDecoration: "none" }}
              >
                <Button
                  className="cresc-btn-accent h-12 px-6 text-sm font-bold rounded-xl"
                  style={{ boxShadow: "0 0 28px var(--c-accent)" }}
                >
                  Join as Creator
                </Button>
              </Link>
              <Link
                href="/docs/ghost"
                style={{ display: "inline-flex", textDecoration: "none" }}
              >
                <Button
                  variant="outline"
                  className="cresc-btn-outline h-12 px-6 text-sm font-semibold rounded-xl"
                >
                  Creator Docs
                </Button>
              </Link>
            </div>
            <div
              style={{
                display: "flex",
                gap: 22,
                marginTop: 34,
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: 12,
                color: "var(--c-dim)",
              }}
            >
              <span>ARTICLES</span>
              <span>·</span>
              <span>PHOTOS</span>
              <span>·</span>
              <span>VIDEO</span>
              <span>·</span>
              <span>ART</span>
            </div>
          </div>

          {/* Right: x402 unlock demo */}
          <div
            style={{
              background:
                "linear-gradient(170deg, var(--c-surface-hi), var(--c-surface))",
              border: "1px solid var(--c-border)",
              borderRadius: 22,
              padding: 18,
              boxShadow: "var(--c-shadow)",
            }}
          >
            <HeroDemoLoop />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 13,
                padding: "0 4px",
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: 11,
                color: "var(--c-dim)",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--c-violet)",
                  display: "inline-block",
                }}
              />
              HTTP 402 Payment Required → agent pays standing price → 200 OK
            </div>
          </div>
        </div>
      </section>

      {/* ============ TICKER ============ */}
      <section
        style={{
          position: "relative",
          borderTop: "1px solid var(--c-border-soft)",
          borderBottom: "1px solid var(--c-border-soft)",
          background: "var(--c-bg-soft)",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 140,
            background: "linear-gradient(90deg,var(--c-bg-soft),transparent)",
            zIndex: 2,
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: 140,
            background: "linear-gradient(270deg,var(--c-bg-soft),transparent)",
            zIndex: 2,
            pointerEvents: "none",
          }}
        />
        <div style={{ overflow: "hidden", padding: "15px 0" }}>
          <div
            className="cresc-ticker"
            style={{
              display: "flex",
              width: "max-content",
              animation: "cresc-marquee 42s linear infinite",
            }}
          >
            {tickerLoop.map((item, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "0 28px",
                  whiteSpace: "nowrap",
                  borderRight: "1px solid var(--c-border-soft)",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-jetbrains), monospace",
                    fontSize: 10,
                    letterSpacing: "0.08em",
                    color: "var(--c-dim)",
                  }}
                >
                  {item.medium}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-manrope), sans-serif",
                    fontSize: 14,
                    fontWeight: 500,
                    color: "var(--c-muted)",
                  }}
                >
                  {item.title}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-jetbrains), monospace",
                    fontSize: 13,
                    fontWeight: 500,
                    color: item.color,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ HOW IT WORKS ============ */}
      <section
        id="how"
        data-reveal
        style={{
          maxWidth: 1180,
          margin: "0 auto",
          padding: "120px 40px 90px",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: 12,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--c-violet)",
            marginBottom: 14,
          }}
        >
          How it works
        </div>
        <h2
          style={{
            fontFamily: "var(--font-sora), sans-serif",
            fontWeight: 600,
            fontSize: 34,
            letterSpacing: "-0.03em",
            margin: "0 0 64px",
            maxWidth: 600,
          }}
        >
          Pricing that reasons. Payment that just happens.
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3,1fr)",
            gap: 24,
          }}
        >
          {[
            {
              n: "01",
              title: "The AI reads the room",
              body: "Every view, every watch, every moment of dwell feeds a signal bundle. The Pricing Agent weighs recency and momentum, then sets the next price — no formula, no decay curve.",
            },
            {
              n: "02",
              title: "The x402 handshake",
              body: (
                <>
                  The content returns{" "}
                  <span
                    style={{
                      fontFamily: "var(--font-jetbrains), monospace",
                      color: "var(--c-text)",
                    }}
                  >
                    402 Payment Required
                  </span>
                  . Your agent pays the standing price — a fraction of a cent,
                  signed offchain, settled in under a second via Circle Gateway.
                  Then{" "}
                  <span
                    style={{
                      fontFamily: "var(--font-jetbrains), monospace",
                      color: "var(--c-green)",
                    }}
                  >
                    200 OK
                  </span>
                  .
                </>
              ),
            },
            {
              n: "03",
              title: "The price earns its keep",
              body: "Tips above the suggested amount tell the agent it underpriced the piece. It adjusts. Every decision is logged, reasoned, and readable by the creator.",
            },
          ].map(({ n, title, body }) => (
            <div
              key={n}
              style={{
                background:
                  "linear-gradient(170deg,var(--c-surface-hi),var(--c-surface))",
                border: "1px solid var(--c-border)",
                borderRadius: 18,
                padding: 30,
                boxShadow: "var(--c-shadow-sm)",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontSize: 42,
                  fontWeight: 500,
                  color: "var(--c-violet)",
                  letterSpacing: "-0.04em",
                  marginBottom: 18,
                }}
              >
                {n}
              </div>
              <h3
                style={{
                  fontFamily: "var(--font-sora), sans-serif",
                  fontWeight: 600,
                  fontSize: 19,
                  letterSpacing: "-0.02em",
                  margin: "0 0 12px",
                }}
              >
                {title}
              </h3>
              <p
                style={{
                  fontFamily: "var(--font-manrope), sans-serif",
                  fontSize: 15,
                  lineHeight: 1.7,
                  color: "var(--c-muted)",
                  margin: 0,
                }}
              >
                {body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ============ LIVE PRICE DEMO ============ */}
      <section
        data-reveal
        style={{ maxWidth: 1180, margin: "0 auto", padding: "50px 40px" }}
      >
        <div
          style={{
            background:
              "linear-gradient(160deg,var(--c-surface-hi),var(--c-surface))",
            border: "1px solid var(--c-border)",
            borderRadius: 20,
            padding: 44,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 48,
            alignItems: "center",
            boxShadow: "var(--c-shadow)",
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: 11,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--c-dim)",
                marginBottom: 16,
              }}
            >
              PHOTO · live · sweeps every few seconds
            </div>
            <h3
              style={{
                fontFamily: "var(--font-sora), sans-serif",
                fontWeight: 600,
                fontSize: 26,
                letterSpacing: "-0.025em",
                margin: "0 0 6px",
              }}
            >
              Static, 04:12
            </h3>
            <div
              style={{
                fontFamily: "var(--font-manrope), sans-serif",
                fontSize: 14,
                color: "var(--c-muted)",
                marginBottom: 24,
              }}
            >
              4000×6000 · by Imo Eshet
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: 14,
                position: "relative",
                width: "max-content",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontWeight: 600,
                  fontSize: 64,
                  letterSpacing: "-0.04em",
                  lineHeight: 1,
                  color: priceColor,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {priceStr}
              </div>
              <span
                key={pulse}
                style={{
                  position: "absolute",
                  left: -10,
                  top: "50%",
                  width: 36,
                  height: 36,
                  marginTop: -18,
                  borderRadius: "50%",
                  border: `2px solid ${priceColor}`,
                  animation: "cresc-ring 600ms ease-out forwards",
                  pointerEvents: "none",
                }}
              />
            </div>
            <div
              style={{
                fontFamily: "var(--font-manrope), sans-serif",
                fontSize: 14,
                color: "var(--c-muted)",
                marginTop: 14,
                maxWidth: 340,
                lineHeight: 1.55,
              }}
            >
              {reason}
            </div>
            <div
              style={{
                display: "flex",
                gap: 9,
                marginTop: 26,
                flexWrap: "wrap",
              }}
            >
              {[
                { k: "views_1h", v: "↑3.1×", accent: true },
                { k: "dwell_median", v: "38s", accent: false },
                { k: "saves", v: "↑ 12", accent: false },
              ].map(({ k, v, accent }) => (
                <div
                  key={k}
                  style={{
                    fontFamily: "var(--font-jetbrains), monospace",
                    fontSize: 12,
                    color: "var(--c-muted)",
                    background: "var(--c-bg)",
                    border: "1px solid var(--c-border)",
                    padding: "7px 12px",
                    borderRadius: 8,
                  }}
                >
                  {k}{" "}
                  <span style={accent ? { color: "var(--c-green)" } : {}}>
                    {v}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: 11,
                color: "var(--c-dim)",
                marginBottom: 10,
              }}
            >
              <span>last 24 sweeps</span>
              <span>$/view</span>
            </div>
            <svg
              viewBox="0 0 480 200"
              style={{ width: "100%", height: "auto", overflow: "visible" }}
            >
              <defs>
                <linearGradient id="cf" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={priceColor} stopOpacity="0.20" />
                  <stop offset="100%" stopColor={priceColor} stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0.25, 0.5, 0.75].map((g, i) => (
                <line
                  key={i}
                  x1={0}
                  y1={200 * g}
                  x2={480}
                  y2={200 * g}
                  stroke="var(--c-border-soft)"
                  strokeWidth={1}
                />
              ))}
              <polygon points={sp.area} fill="url(#cf)" />
              <polyline
                points={sp.line}
                fill="none"
                stroke={priceColor}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <circle
                cx={sp.last[0]}
                cy={sp.last[1]}
                r="4.5"
                fill={priceColor}
                style={{ filter: `drop-shadow(0 0 7px ${priceColor})` }}
              />
              <text
                x={0}
                y={196}
                fill="var(--c-dim)"
                fontSize="10"
                fontFamily="var(--font-jetbrains), monospace"
              >
                −24h
              </text>
              <text
                x={480}
                y={196}
                fill="var(--c-dim)"
                fontSize="10"
                fontFamily="var(--font-jetbrains), monospace"
                textAnchor="end"
              >
                now
              </text>
            </svg>
          </div>
        </div>
      </section>

      {/* ============ CREATOR DASHBOARD ============ */}
      <section
        id="creators"
        data-reveal
        style={{ maxWidth: 1180, margin: "0 auto", padding: "90px 40px" }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "0.85fr 1.15fr",
            gap: 60,
            alignItems: "center",
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: 12,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--c-violet)",
                marginBottom: 14,
              }}
            >
              For creators
            </div>
            <h2
              style={{
                fontFamily: "var(--font-sora), sans-serif",
                fontWeight: 600,
                fontSize: 34,
                letterSpacing: "-0.03em",
                margin: "0 0 22px",
                lineHeight: 1.12,
              }}
            >
              Watch the agent think, line by line.
            </h2>
            <p
              style={{
                fontFamily: "var(--font-manrope), sans-serif",
                fontSize: 17,
                lineHeight: 1.7,
                color: "var(--c-muted)",
                margin: "0 0 16px",
              }}
            >
              Every price move comes with a reason you can read. The dashboard
              streams the full reasoning chain — why it raised, why it held,
              what signal tipped the call — across all your pieces, whatever the
              medium.
            </p>
            <p
              style={{
                fontFamily: "var(--font-manrope), sans-serif",
                fontSize: 15,
                lineHeight: 1.7,
                color: "var(--c-dim)",
                margin: 0,
              }}
            >
              Disagree with a decision? Dispute it. The agent reweighs and logs
              the correction against your piece.
            </p>
          </div>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
          >
            {/* Piece card — BAR CHART */}
            <div
              style={{
                background:
                  "linear-gradient(170deg,var(--c-surface-hi),var(--c-surface))",
                border: "1px solid var(--c-border)",
                borderRadius: 15,
                padding: 20,
                boxShadow: "var(--c-shadow-sm)",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-manrope), sans-serif",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--c-muted)",
                  marginBottom: 2,
                }}
              >
                Field Guide to Disappearing
              </div>
              <div
                style={{
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontSize: 10,
                  color: "var(--c-dim)",
                  marginBottom: 8,
                }}
              >
                VIDEO
              </div>
              <div
                style={{
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontSize: 21,
                  fontWeight: 600,
                  color: "var(--c-green)",
                  marginBottom: 12,
                }}
              >
                $0.0114
              </div>
              {/* Bar chart */}
              {(() => {
                const bars = [
                  0.008, 0.0075, 0.0085, 0.009, 0.0088, 0.0095, 0.0102, 0.0098,
                  0.0108, 0.0114,
                ];
                const maxV = Math.max(...bars);
                const W = 200,
                  H = 60,
                  gap = 3;
                const bw = (W - gap * (bars.length - 1)) / bars.length;
                return (
                  <svg
                    viewBox={`0 0 ${W} ${H}`}
                    style={{ width: "100%", height: "auto", display: "block" }}
                  >
                    <defs>
                      <linearGradient id="bar-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="0%"
                          stopColor="var(--c-green)"
                          stopOpacity="0.95"
                        />
                        <stop
                          offset="100%"
                          stopColor="var(--c-green)"
                          stopOpacity="0.25"
                        />
                      </linearGradient>
                      <linearGradient
                        id="bar-grad-active"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="var(--c-green)"
                          stopOpacity="1"
                        />
                        <stop
                          offset="100%"
                          stopColor="var(--c-green)"
                          stopOpacity="0.5"
                        />
                      </linearGradient>
                    </defs>
                    {bars.map((v, i) => {
                      const bh = (v / maxV) * (H - 6);
                      const x = i * (bw + gap);
                      const isLast = i === bars.length - 1;
                      return (
                        <rect
                          key={i}
                          x={x}
                          y={H - bh}
                          width={bw}
                          height={bh}
                          rx={2}
                          fill={
                            isLast ? "url(#bar-grad-active)" : "url(#bar-grad)"
                          }
                          opacity={isLast ? 1 : 0.55 + (i / bars.length) * 0.3}
                        />
                      );
                    })}
                  </svg>
                );
              })()}
            </div>
            {/* Revenue card — SMOOTH AREA CHART */}
            <div
              style={{
                background:
                  "linear-gradient(170deg,var(--c-surface-hi),var(--c-surface))",
                border: "1px solid var(--c-border)",
                borderRadius: 15,
                padding: 20,
                boxShadow: "var(--c-shadow-sm)",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-manrope), sans-serif",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--c-muted)",
                  marginBottom: 12,
                }}
              >
                30-day revenue
              </div>
              {(() => {
                const pts = [
                  40, 55, 52, 70, 85, 80, 110, 140, 135, 170, 200, 260,
                ];
                const W = 200,
                  H = 72,
                  pad = 10;
                const maxV = Math.max(...pts);
                const minV = Math.min(...pts);
                const span = maxV - minV || 1;
                const coords = pts.map((v, i) => {
                  const x = pad + (i / (pts.length - 1)) * (W - pad * 2);
                  const y = pad + (1 - (v - minV) / span) * (H - pad * 2);
                  return [x, y] as [number, number];
                });
                // Build smooth cubic bezier path
                const pathD = coords.reduce((acc, [x, y], i) => {
                  if (i === 0) return `M ${x},${y}`;
                  const [px, py] = coords[i - 1];
                  const cpx = (px + x) / 2;
                  return `${acc} C ${cpx},${py} ${cpx},${y} ${x},${y}`;
                }, "");
                const areaD = `${pathD} L ${coords[coords.length - 1][0]},${H} L ${coords[0][0]},${H} Z`;
                const [lx, ly] = coords[coords.length - 1];
                return (
                  <svg
                    viewBox={`0 0 ${W} ${H}`}
                    style={{
                      width: "100%",
                      height: "auto",
                      display: "block",
                      overflow: "visible",
                    }}
                  >
                    <defs>
                      <linearGradient id="rv2" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="0%"
                          stopColor="var(--c-violet)"
                          stopOpacity="0.35"
                        />
                        <stop
                          offset="100%"
                          stopColor="var(--c-violet)"
                          stopOpacity="0"
                        />
                      </linearGradient>
                      <filter id="glow-dot">
                        <feGaussianBlur stdDeviation="2.5" result="blur" />
                        <feMerge>
                          <feMergeNode in="blur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>
                    {/* subtle grid lines */}
                    {[0.25, 0.5, 0.75].map((f, i) => (
                      <line
                        key={i}
                        x1={pad}
                        y1={pad + f * (H - pad * 2)}
                        x2={W - pad}
                        y2={pad + f * (H - pad * 2)}
                        stroke="var(--c-border-soft)"
                        strokeWidth="0.6"
                        strokeDasharray="3 3"
                      />
                    ))}
                    <path d={areaD} fill="url(#rv2)" />
                    <path
                      d={pathD}
                      fill="none"
                      stroke="var(--c-violet)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {/* glowing endpoint dot */}
                    <circle
                      cx={lx}
                      cy={ly}
                      r="5"
                      fill="var(--c-violet)"
                      opacity="0.25"
                      filter="url(#glow-dot)"
                    />
                    <circle cx={lx} cy={ly} r="3" fill="var(--c-violet)" />
                    <circle cx={lx} cy={ly} r="1.5" fill="#fff" />
                  </svg>
                );
              })()}
              <div
                style={{
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontSize: 18,
                  fontWeight: 600,
                  marginTop: 8,
                }}
              >
                $284.10
              </div>
            </div>
            {/* Reasoning log — full width */}
            <div
              style={{
                gridColumn: "1 / span 2",
                background:
                  "linear-gradient(170deg,var(--c-surface-hi),var(--c-surface))",
                border: "1px solid var(--c-border)",
                borderRadius: 15,
                padding: 20,
                minHeight: 200,
                boxShadow: "var(--c-shadow-sm)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontSize: 11,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--c-dim)",
                  marginBottom: 14,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--c-accent)",
                    display: "inline-block",
                    boxShadow: "0 0 8px var(--c-accent)",
                  }}
                />
                reasoning_log
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {log.map((l) => (
                  <div
                    key={l.id}
                    style={{
                      display: "flex",
                      gap: 14,
                      padding: "7px 0",
                      borderBottom: "1px solid var(--c-border-soft)",
                      fontFamily: "var(--font-jetbrains), monospace",
                      fontSize: 13,
                      animation: "cresc-termin 0.4s ease-out both",
                    }}
                  >
                    <span style={{ color: "var(--c-dim)", flexShrink: 0 }}>
                      {l.time}
                    </span>
                    <span style={{ color: "var(--c-muted)" }}>{l.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ TIP MECHANIC ============ */}
      <section
        data-reveal
        style={{
          padding: "100px 40px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "radial-gradient(circle at 50% 55%, var(--c-glow), transparent 55%)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            maxWidth: 620,
            margin: "0 auto",
            textAlign: "center",
            position: "relative",
            zIndex: 1,
          }}
        >
          <h2
            style={{
              fontFamily: "var(--font-sora), sans-serif",
              fontWeight: 600,
              fontSize: 34,
              letterSpacing: "-0.03em",
              margin: "0 0 18px",
            }}
          >
            The reader decides what it was worth.
          </h2>
          <p
            style={{
              fontFamily: "var(--font-manrope), sans-serif",
              fontSize: 17,
              lineHeight: 1.7,
              color: "var(--c-muted)",
              margin: "0 0 46px",
            }}
          >
            After a read, watch, or scroll, the AI judges whether to ask — and
            how much. Never a checkout. More like a suggestion from someone who
            was paying attention.
          </p>
        </div>
        <div
          style={{
            maxWidth: 420,
            margin: "0 auto",
            position: "relative",
            zIndex: 1,
          }}
        >
          <div
            style={{
              background:
                "linear-gradient(170deg,var(--c-surface-2),var(--c-surface))",
              border: "1px solid var(--c-border)",
              borderRadius: 18,
              padding: 28,
              boxShadow: "var(--c-shadow)",
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: 11,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--c-violet)",
                marginBottom: 18,
              }}
            >
              Cresc · suggestion
            </div>
            <div
              style={{
                fontFamily: "var(--font-sora), sans-serif",
                fontWeight: 600,
                fontSize: 17,
                marginBottom: 6,
              }}
            >
              The AI thinks your watch was worth a tip.
            </div>
            <div
              style={{
                fontFamily: "var(--font-manrope), sans-serif",
                fontSize: 14,
                color: "var(--c-muted)",
                marginBottom: 24,
              }}
            >
              You stayed 4m 12s — well past the median.
            </div>
            <div
              style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontWeight: 600,
                fontSize: 46,
                letterSpacing: "-0.03em",
                textAlign: "center",
                marginBottom: 18,
              }}
            >
              $0.006
            </div>
            <Slider
              defaultValue={[42]}
              min={0}
              max={100}
              step={1}
              className="mb-6"
            />
            <div style={{ display: "flex", gap: 10 }}>
              <Button className="cresc-btn-accent flex-1 h-11 text-sm font-bold rounded-xl">
                Accept
              </Button>
              <Button
                variant="outline"
                className="cresc-btn-secondary flex-1 h-11 text-sm font-semibold rounded-xl"
              >
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ============ STATS ============ */}
      <StatsSection />

      {/* ============ CTA ============ */}
      <section
        data-reveal
        style={{
          padding: "130px 40px",
          textAlign: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "radial-gradient(ellipse 50% 60% at 50% 50%, var(--c-glow), transparent 60%)",
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "relative", zIndex: 1 }}>
          <h2
            style={{
              fontFamily: "var(--font-sora), sans-serif",
              fontWeight: 700,
              fontSize: 48,
              letterSpacing: "-0.035em",
              margin: "0 0 18px",
            }}
          >
            Publish anything. Get paid per view.
          </h2>
          <p
            style={{
              fontFamily: "var(--font-manrope), sans-serif",
              fontSize: 18,
              lineHeight: 1.7,
              color: "var(--c-muted)",
              margin: "0 auto 40px",
              maxWidth: 500,
            }}
          >
            No subscription. No paywalls. Just prices that make sense — for
            words, pictures, video, and everything between.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 40 }}>
            <Link
              href="/ghost-onboard"
              style={{ display: "inline-flex", textDecoration: "none" }}
            >
              <Button
                className="cresc-btn-accent h-14 px-9 text-base font-bold rounded-xl"
                style={{ boxShadow: "0 0 34px var(--c-accent)" }}
              >
                Join as Creator
              </Button>
            </Link>
            <Link
              href="/docs/ghost"
              style={{ display: "inline-flex", textDecoration: "none" }}
            >
              <Button
                variant="outline"
                className="cresc-btn-outline h-14 px-9 text-base font-semibold rounded-xl"
                style={{
                  color: "var(--c-text)",
                  border: "1px solid var(--c-border)",
                  background: "transparent",
                }}
              >
                Creator Docs
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer
        id="docs"
        style={{
          borderTop: "1px solid var(--c-border-soft)",
          padding: "56px 40px 30px",
        }}
      >
        <div
          style={{
            maxWidth: 1180,
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "1.4fr 1fr 1fr",
            gap: 40,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "var(--font-sora), sans-serif",
                fontWeight: 700,
                fontSize: 19,
                letterSpacing: "-0.03em",
                display: "flex",
                alignItems: "center",
                gap: 9,
                marginBottom: 12,
              }}
            >
              <img
                src="/cresc-logo-transparent.png"
                alt="Cresc Logo"
                style={{
                  width: 20,
                  height: 20,
                  objectFit: "contain",
                }}
              />
              Cresc
            </div>
            <p
              style={{
                fontFamily: "var(--font-manrope), sans-serif",
                fontSize: 15,
                lineHeight: 1.6,
                color: "var(--c-muted)",
                margin: 0,
                maxWidth: 300,
              }}
            >
              Any content, priced in real time by AI and paid per view through
              the x402 handshake.
            </p>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              fontSize: 14,
            }}
          >
            <a
              href="#how"
              className="cresc-nav-link"
              style={{ color: "var(--c-muted)", textDecoration: "none" }}
            >
              How it works
            </a>
            <a
              href="#creators"
              className="cresc-nav-link"
              style={{ color: "var(--c-muted)", textDecoration: "none" }}
            >
              For Creators
            </a>
            <a
              href="/docs/ghost"
              className="cresc-nav-link"
              style={{ color: "var(--c-muted)", textDecoration: "none" }}
            >
              Ghost setup docs
            </a>
          </div>
          <div
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: 13,
              color: "var(--c-muted)",
              lineHeight: 1.9,
            }}
          >
            Built on Arc
            <br />
            Powered by Circle Gateway
          </div>
        </div>
        <div
          style={{
            maxWidth: 1180,
            margin: "48px auto 0",
            paddingTop: 22,
            borderTop: "1px solid var(--c-border-soft)",
            display: "flex",
            justifyContent: "space-between",
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: 12,
            color: "var(--c-dim)",
          }}
        >
          <span>© 2026 Cresc Labs</span>
          <span>Testnet — real payments, zero gas.</span>
        </div>
      </footer>
    </div>
  );
}
