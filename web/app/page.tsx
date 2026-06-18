"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

type Theme = "dark" | "light";
type DemoType = "article" | "photo" | "video" | "art";
type DemoStage = "idle" | "locked" | "paying" | "settling" | "unlocked";

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

const TYPES: Record<
  DemoType,
  { label: string; medium: string; title: string; meta: string; price: number }
> = {
  article: {
    label: "Article",
    medium: "ARTICLE",
    title: "The Last Honest Metric",
    meta: "1,200 words · Dana Okafor",
    price: 0.0082,
  },
  photo: {
    label: "Photo",
    medium: "PHOTO",
    title: "Static, 04:12",
    meta: "4000×6000 · Imo Eshet",
    price: 0.014,
  },
  video: {
    label: "Video",
    medium: "VIDEO",
    title: "Field Notes, Ep. 9",
    meta: "8 min · Studio Vesper",
    price: 0.021,
  },
  art: {
    label: "Art",
    medium: "ARTWORK",
    title: "Untitled (Lime)",
    meta: "Edition 1/1 · K. Owusu",
    price: 0.0305,
  },
};

const SEED_HISTORY = [
  0.011, 0.0118, 0.0112, 0.012, 0.0124, 0.0119, 0.0128, 0.013, 0.0126,
  0.0133, 0.0129, 0.0136, 0.0141, 0.0138, 0.0134, 0.0142, 0.0146, 0.0143,
  0.0139, 0.0144, 0.0148, 0.0145, 0.0141, 0.014,
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

function ContentPreview({ type }: { type: DemoType }) {
  const t = TYPES[type];
  const stripes: React.CSSProperties = {
    backgroundColor: "var(--c-surface-2)",
    backgroundImage:
      "repeating-linear-gradient(135deg, var(--c-border-soft) 0, var(--c-border-soft) 1px, transparent 1px, transparent 13px)",
  };

  let body: React.ReactNode;
  if (type === "article") {
    const line = (w: string, o: number) => (
      <div
        style={{
          height: 9,
          borderRadius: 4,
          background: "var(--c-border)",
          width: w,
          opacity: o,
        }}
      />
    );
    body = (
      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: "34px 34px 70px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          justifyContent: "center",
        }}
      >
        <div
          style={{
            height: 15,
            width: "62%",
            borderRadius: 5,
            background: "var(--c-violet)",
            opacity: 0.6,
            marginBottom: 10,
          }}
        />
        {line("100%", 0.5)}
        {line("96%", 0.5)}
        {line("88%", 0.5)}
        {line("100%", 0.5)}
        {line("70%", 0.5)}
        <div style={{ height: 1 }} />
        {line("100%", 0.35)}
        {line("92%", 0.35)}
        {line("80%", 0.35)}
      </div>
    );
  } else if (type === "video") {
    body = (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 66,
            height: 66,
            borderRadius: "50%",
            background: "var(--c-accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
          }}
        >
          <div
            style={{
              width: 0,
              height: 0,
              borderTop: "13px solid transparent",
              borderBottom: "13px solid transparent",
              borderLeft: "21px solid var(--c-accent-ink)",
              marginLeft: 5,
            }}
          />
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 60,
            right: 22,
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: 11,
            color: "#fff",
            background: "rgba(0,0,0,0.5)",
            padding: "3px 7px",
            borderRadius: 5,
          }}
        >
          08:00
        </div>
      </div>
    );
  } else {
    body = (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 54,
            height: 54,
            borderRadius: type === "art" ? "50%" : 10,
            border: "2px solid var(--c-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: type === "art" ? "rotate(45deg)" : "none",
          }}
        >
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: type === "art" ? 3 : "50%",
              background: "var(--c-accent)",
              opacity: 0.8,
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "absolute", inset: 0, ...stripes }}>
      {body}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: 16,
          background: "linear-gradient(0deg, rgba(0,0,0,0.55), transparent)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: 10,
            letterSpacing: "0.1em",
            color: "rgba(255,255,255,0.7)",
            marginBottom: 3,
          }}
        >
          {t.medium}
        </div>
        <div
          style={{
            fontFamily: "var(--font-sora), sans-serif",
            fontWeight: 600,
            fontSize: 16,
            color: "#fff",
          }}
        >
          {t.title}
        </div>
        <div
          style={{
            fontFamily: "var(--font-manrope), sans-serif",
            fontSize: 12,
            color: "rgba(255,255,255,0.7)",
            marginTop: 2,
          }}
        >
          {t.meta}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [loaded, setLoaded] = useState(false);
  const [demoType, setDemoType] = useState<DemoType>("photo");
  const [demoStage, setDemoStage] = useState<DemoStage>("idle");
  const [price, setPrice] = useState(0.014);
  const [displayed, setDisplayed] = useState(0.014);
  const [dir, setDir] = useState(0);
  const [history, setHistory] = useState<number[]>(SEED_HISTORY);
  const [pulse, setPulse] = useState(0);
  const [reason, setReason] = useState(
    "Saves up 12 this hour — adjusted up from $0.012"
  );
  const [ticker, setTicker] = useState<TickerItem[]>(
    TICKER_BASE.map((b) => ({ ...b, prev: b.p }))
  );
  const [log, setLog] = useState<LogEntry[]>(INIT_LOG);

  const navRef = useRef<HTMLElement>(null);
  const rafRef = useRef<number | null>(null);
  const demoTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const priceRef = useRef(price);
  const displayedRef = useRef(displayed);
  priceRef.current = price;
  displayedRef.current = displayed;

  useEffect(() => {
    try {
      const saved = localStorage.getItem("cresc-theme") as Theme;
      if (saved === "dark" || saved === "light") setTheme(saved);
    } catch {}
    const t = setTimeout(() => setLoaded(true), 1850);
    return () => clearTimeout(t);
  }, []);

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
            Math.min(0.035, item.p + (Math.random() - 0.47) * vol * 1.6)
          );
          return { ...item, prev: item.p, p: np };
        })
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

  const setType = (k: DemoType) => {
    demoTimersRef.current.forEach(clearTimeout);
    demoTimersRef.current = [];
    setDemoType(k);
    setDemoStage("idle");
  };

  const onUnlock = () => {
    demoTimersRef.current.forEach(clearTimeout);
    demoTimersRef.current = [];
    setDemoStage("locked");
    demoTimersRef.current.push(
      setTimeout(() => setDemoStage("paying"), 560)
    );
    demoTimersRef.current.push(
      setTimeout(() => setDemoStage("settling"), 1560)
    );
    demoTimersRef.current.push(
      setTimeout(() => setDemoStage("unlocked"), 2120)
    );
  };

  const t = TYPES[demoType];
  const open = demoStage === "settling" || demoStage === "unlocked";
  const showIdle = demoStage === "idle";
  const showLock =
    demoStage === "locked" ||
    demoStage === "paying" ||
    demoStage === "settling";
  const showAgent = demoStage === "paying" || demoStage === "settling";
  const showUnlocked = demoStage === "unlocked";
  const priceStr = `$${displayed.toFixed(4)}`;
  const priceColor = colorFor(dir);
  const demoPriceStr = `$${t.price.toFixed(4)}`;

  const tickerItems = ticker.map((x) => {
    const d = x.p > x.prev ? 1 : x.p < x.prev ? -1 : 0;
    const arrow = d > 0 ? "↑" : d < 0 ? "↓" : "·";
    return { ...x, color: colorFor(d), label: `${arrow} $${x.p.toFixed(4)}` };
  });
  const tickerLoop = [...tickerItems, ...tickerItems];

  const sp = spark(history, 480, 200, 18);
  const ms = spark(
    [
      0.008, 0.0075, 0.0085, 0.009, 0.0088, 0.0095, 0.0102, 0.0098, 0.0108,
      0.0114,
    ],
    200,
    60,
    8
  );
  const rv = spark([40, 55, 52, 70, 85, 80, 110, 140, 135, 170, 200, 260], 200, 60, 8);

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
              transformOrigin: "bottom right",
              animation:
                "ld-shackle 1.7s cubic-bezier(.5,1.5,.4,1) forwards",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: "50%",
              bottom: 0,
              width: 108,
              height: 80,
              marginLeft: -54,
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
          <span
            style={{
              width: 11,
              height: 11,
              background: "var(--c-accent)",
              borderRadius: 3,
              display: "inline-block",
              transform: "rotate(45deg)",
              boxShadow: "0 0 12px var(--c-accent)",
            }}
          />
          Cresc
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 32,
            fontSize: 14,
            fontWeight: 600,
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
            href="#docs"
            className="cresc-nav-link"
            style={{ color: "var(--c-muted)", textDecoration: "none" }}
          >
            Docs
          </a>
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
          <Button variant="outline" size="sm" className="cresc-btn-ghost text-sm font-semibold">
            Connect Wallet
          </Button>
          <Button
            size="sm"
            className="cresc-btn-accent rounded-full text-sm font-bold px-5"
            style={{ boxShadow: "0 0 0 1px var(--c-border-soft)" }}
          >
            Start Reading
          </Button>
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
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 9,
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: 12,
                letterSpacing: "0.13em",
                textTransform: "uppercase",
                color: "var(--c-violet)",
                background: "var(--c-surface)",
                border: "1px solid var(--c-border)",
                padding: "7px 13px",
                borderRadius: 999,
                marginBottom: 30,
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
              x402-native payments · Powered by Arc
            </div>
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
              <Button
                className="cresc-btn-accent h-12 px-6 text-sm font-bold rounded-xl"
                style={{ boxShadow: "0 0 28px var(--c-accent)" }}
              >
                Explore Content
              </Button>
              <Button
                variant="outline"
                className="cresc-btn-outline h-12 px-6 text-sm font-semibold rounded-xl"
              >
                Publish a Piece
              </Button>
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
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 14,
                padding: "0 4px",
              }}
            >
              <div style={{ display: "flex", gap: 7 }}>
                {(Object.keys(TYPES) as DemoType[]).map((k) => {
                  const active = k === demoType;
                  return (
                    <button
                      key={k}
                      onClick={() => setType(k)}
                      className="px-3 py-1.5 rounded-lg text-sm font-semibold cursor-pointer transition-all font-sans"
                      style={{
                        border: `1px solid ${active ? "var(--c-violet)" : "var(--c-border)"}`,
                        background: active ? "var(--c-violet)" : "transparent",
                        color: active ? "#fff" : "var(--c-muted)",
                      }}
                    >
                      {TYPES[k].label}
                    </button>
                  );
                })}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--c-accent)",
                  background: "var(--c-bg)",
                  border: "1px solid var(--c-border)",
                  padding: "6px 11px",
                  borderRadius: 8,
                }}
              >
                {demoPriceStr}
              </div>
            </div>

            <div
              style={{
                position: "relative",
                height: 360,
                borderRadius: 15,
                overflow: "hidden",
                border: "1px solid var(--c-border-soft)",
              }}
            >
              {/* Content (blurred until unlocked) */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  filter: open ? "blur(0px)" : "blur(10px)",
                  transform: open ? "scale(1)" : "scale(1.04)",
                  transition: "filter 0.55s ease, transform 0.55s ease",
                }}
              >
                <ContentPreview type={demoType} />
              </div>

              {/* Idle CTA */}
              {showIdle && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 16,
                    background: "rgba(10,8,20,0.30)",
                    backdropFilter: "blur(1px)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontFamily: "var(--font-jetbrains), monospace",
                      fontSize: 11,
                      letterSpacing: "0.1em",
                      color: "#fff",
                      background: "rgba(0,0,0,0.4)",
                      padding: "6px 12px",
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.18)",
                    }}
                  >
                    <span
                      style={{
                        width: 13,
                        height: 14,
                        borderRadius: 3,
                        background: "var(--c-accent)",
                        display: "inline-block",
                      }}
                    />
                    402 · LOCKED
                  </div>
                  <Button
                    className="cresc-btn-accent h-11 px-5 text-sm font-bold rounded-xl"
                    onClick={onUnlock}
                    style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}
                  >
                    Unlock with an agent →
                  </Button>
                </div>
              )}

              {/* Lock / paying overlay */}
              {showLock && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 18,
                    background: "rgba(10,8,20,0.46)",
                  }}
                >
                  <div
                    style={{ position: "relative", width: 88, height: 100 }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        left: "50%",
                        top: 0,
                        width: 44,
                        height: 42,
                        border: "7px solid var(--c-accent)",
                        borderBottom: "none",
                        borderRadius: "22px 22px 0 0",
                        transform: open
                          ? "translateX(-62%) translateY(-15px) rotate(-12deg)"
                          : "translateX(-50%)",
                        transformOrigin: "bottom right",
                        transition:
                          "transform 0.5s cubic-bezier(.5,1.6,.4,1)",
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        left: "50%",
                        bottom: 0,
                        width: 88,
                        height: 66,
                        marginLeft: -44,
                        background: "var(--c-accent)",
                        borderRadius: 13,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-jetbrains), monospace",
                          fontWeight: 600,
                          fontSize: 18,
                          color: "var(--c-accent-ink)",
                          letterSpacing: "-0.02em",
                        }}
                      >
                        x402
                      </span>
                    </div>
                    {open && (
                      <span
                        key={`ring-${demoType}-${demoStage}`}
                        style={{
                          position: "absolute",
                          left: "50%",
                          top: "60%",
                          width: 60,
                          height: 60,
                          marginLeft: -30,
                          marginTop: -30,
                          borderRadius: "50%",
                          border: "2px solid var(--c-accent)",
                          animation: "cresc-ring 600ms ease-out forwards",
                          pointerEvents: "none",
                        }}
                      />
                    )}
                    {demoStage === "paying" && (
                      <span
                        key={`coin-${demoType}`}
                        style={{
                          position: "absolute",
                          left: "50%",
                          bottom: -30,
                          marginLeft: -7,
                          width: 14,
                          height: 14,
                          borderRadius: "50%",
                          background: "var(--c-violet)",
                          boxShadow: "0 0 14px var(--c-violet)",
                          animation: "cresc-coin 1s ease-in forwards",
                          pointerEvents: "none",
                        }}
                      />
                    )}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-jetbrains), monospace",
                      fontSize: 12,
                      letterSpacing: "0.1em",
                      color: open
                        ? "var(--c-green)"
                        : demoStage === "paying"
                        ? "var(--c-amber)"
                        : "var(--c-red)",
                    }}
                  >
                    {open
                      ? "200 · OK"
                      : demoStage === "paying"
                      ? "402 · awaiting payment"
                      : "402 · Payment Required"}
                  </div>
                  {showAgent && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 9,
                        background: "rgba(0,0,0,0.4)",
                        border: "1px solid rgba(255,255,255,0.16)",
                        padding: "7px 13px",
                        borderRadius: 999,
                        fontFamily: "var(--font-manrope), sans-serif",
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#fff",
                      }}
                    >
                      <span
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          background: "var(--c-violet)",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontFamily: "var(--font-jetbrains), monospace",
                          fontSize: 9,
                          color: "#fff",
                        }}
                      >
                        AI
                      </span>
                      {demoStage === "settling"
                        ? `Agent · paid $${t.price.toFixed(4)}`
                        : `Agent · paying $${t.price.toFixed(4)}…`}
                    </div>
                  )}
                </div>
              )}

              {/* Unlocked bar */}
              {showUnlocked && (
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "14px 16px",
                    background:
                      "linear-gradient(0deg, rgba(0,0,0,0.55), transparent)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      fontFamily: "var(--font-jetbrains), monospace",
                      fontSize: 12,
                      color: "#fff",
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: "var(--c-green)",
                        display: "inline-block",
                        boxShadow: "0 0 8px var(--c-green)",
                      }}
                    />
                    Unlocked · {demoPriceStr} paid · settled 0.4s on Arc
                  </div>
                  <button
                    onClick={onUnlock}
                    className="font-sans text-xs font-semibold cursor-pointer px-3 py-1.5 rounded-lg"
                    style={{
                      background: "rgba(255,255,255,0.14)",
                      color: "#fff",
                      border: "1px solid rgba(255,255,255,0.22)",
                    }}
                  >
                    Replay
                  </button>
                </div>
              )}
            </div>

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
            background:
              "linear-gradient(90deg,var(--c-bg-soft),transparent)",
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
            background:
              "linear-gradient(270deg,var(--c-bg-soft),transparent)",
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
            {/* Piece card */}
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
              <svg viewBox="0 0 200 60" style={{ width: "100%", height: "auto" }}>
                <polyline
                  points={ms.line}
                  fill="none"
                  stroke="var(--c-green)"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                <circle cx={ms.last[0]} cy={ms.last[1]} r="3" fill="var(--c-green)" />
              </svg>
            </div>
            {/* Revenue card */}
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
              <svg viewBox="0 0 200 60" style={{ width: "100%", height: "auto" }}>
                <defs>
                  <linearGradient id="cr" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor="var(--c-violet)"
                      stopOpacity="0.24"
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--c-violet)"
                      stopOpacity="0"
                    />
                  </linearGradient>
                </defs>
                <polygon points={rv.area} fill="url(#cr)" />
                <polyline
                  points={rv.line}
                  fill="none"
                  stroke="var(--c-violet)"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>
              <div
                style={{
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontSize: 18,
                  fontWeight: 600,
                  marginTop: 10,
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
            <Slider defaultValue={[42]} min={0} max={100} step={1} className="mb-6" />
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
          {[
            { val: "$0.000001", label: "minimum payment size", accent: false },
            { val: "<1s", label: "settlement time on Arc", accent: false },
            {
              val: "100%",
              label: "AI-reasoned pricing decisions",
              accent: true,
            },
          ].map(({ val, label, accent }) => (
            <div key={label}>
              <div
                style={{
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontWeight: 600,
                  fontSize: 46,
                  letterSpacing: "-0.04em",
                  marginBottom: 8,
                  fontVariantNumeric: "tabular-nums",
                  color: accent ? "var(--c-violet)" : undefined,
                }}
              >
                {val}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-manrope), sans-serif",
                  fontSize: 15,
                  color: "var(--c-muted)",
                }}
              >
                {label}
              </div>
            </div>
          ))}
        </div>
      </section>

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
          <Button
            className="cresc-btn-accent h-14 px-9 text-base font-bold rounded-xl"
            style={{ boxShadow: "0 0 34px var(--c-accent)" }}
          >
            Open the Platform
          </Button>
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
              <span
                style={{
                  width: 11,
                  height: 11,
                  background: "var(--c-accent)",
                  borderRadius: 3,
                  display: "inline-block",
                  transform: "rotate(45deg)",
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
              href="#docs"
              className="cresc-nav-link"
              style={{ color: "var(--c-muted)", textDecoration: "none" }}
            >
              Docs
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
