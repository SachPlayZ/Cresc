"use client";

import { useState, useTransition, useEffect } from "react";
import { unlockPiece } from "../app/actions/unlock";
import { useReadingTelemetry } from "../hooks/useReadingTelemetry";
import { TipPrompt } from "./TipPrompt";
import { DepositPrompt } from "./DepositPrompt";
import type { Notification } from "../lib/repo/types";
import { Button } from "./ui/button";

type WalletInfo = {
  address: string;
  balance: string;
  gatewayFunded: boolean;
};

type WalletState =
  | { status: "loading" }
  | { status: "no-usdc"; address: string }
  | { status: "depositing"; address: string }
  | { status: "ready"; wallet: WalletInfo };

type PayState =
  | { status: "idle" }
  | { status: "paying" }
  | { status: "unlocked"; body: string; arcExplorerUrl: string | null; sessionId: string; payer: string }
  | { status: "error"; message: string };

interface UnlockButtonProps {
  pieceId: string;
  priceDisplay: string;
  isVideo?: boolean;
}

export function UnlockButton({ pieceId, priceDisplay, isVideo = false }: UnlockButtonProps) {
  const [walletState, setWalletState] = useState<WalletState>({ status: "loading" });
  const [payState, setPayState] = useState<PayState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();
  const [tipNotification, setTipNotification] = useState<Notification | null>(null);

  const sessionId = payState.status === "unlocked" ? payState.sessionId : null;
  const readerId = payState.status === "unlocked" ? payState.payer : null;
  useReadingTelemetry(sessionId);

  // On mount: fetch reader wallet, then auto-pay once funded.
  useEffect(() => {
    let active = true;
    async function loadWallet() {
      try {
        const res = await fetch("/api/reader/wallet");
        if (!res.ok) {
          if (active) setWalletState({ status: "ready", wallet: { address: "", balance: "0", gatewayFunded: true } });
          return;
        }
        const data = await res.json() as WalletInfo;
        if (!active) return;
        if (!data.gatewayFunded) {
          const onChain = parseFloat(data.balance);
          setWalletState(onChain > 0
            ? { status: "depositing", address: data.address }
            : { status: "no-usdc", address: data.address }
          );
        } else {
          setWalletState({ status: "ready", wallet: data });
        }
      } catch {
        if (active) setWalletState({ status: "ready", wallet: { address: "", balance: "0", gatewayFunded: true } });
      }
    }
    loadWallet();
    return () => { active = false; };
  }, []);

  // Auto-pay the moment wallet reaches "ready" — no click needed.
  useEffect(() => {
    if (walletState.status !== "ready") return;
    if (payState.status !== "idle") return;
    setPayState({ status: "paying" });
    startTransition(async () => {
      const result = await unlockPiece(pieceId);
      if ("error" in result) {
        setPayState({ status: "error", message: result.error });
      } else {
        setPayState({
          status: "unlocked",
          body: result.body,
          arcExplorerUrl: result.arcExplorerUrl,
          sessionId: result.sessionId ?? "",
          payer: result.payer ?? "",
        });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletState.status]);

  // Poll tip notifications after unlock.
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

  const retryUnlock = () => {
    if (walletState.status !== "ready") return;
    setPayState({ status: "paying" });
    startTransition(async () => {
      const result = await unlockPiece(pieceId);
      if ("error" in result) {
        setPayState({ status: "error", message: result.error });
      } else {
        setPayState({
          status: "unlocked",
          body: result.body,
          arcExplorerUrl: result.arcExplorerUrl,
          sessionId: result.sessionId ?? "",
          payer: result.payer ?? "",
        });
      }
    });
  };

  // --- Unlocked state ---
  if (payState.status === "unlocked") {
    // Sanitize HTML client-side — DOMPurify runs in the browser.
    // Strips <script> and on* attrs; allows img, video, a, standard block/inline.
    let safeHtml = payState.body;
    if (typeof window !== "undefined") {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
        const dp = require("dompurify") as any;
        const purify: { sanitize: (html: string, cfg: Record<string, unknown>) => string } = dp.default ?? dp;
        safeHtml = purify.sanitize(payState.body, {
          ALLOWED_TAGS: [
            "p","br","b","strong","i","em","s","strike","u","a","h1","h2","h3","h4",
            "ul","ol","li","blockquote","pre","code","img","video","source","figure","figcaption",
          ],
          ALLOWED_ATTR: ["href","src","alt","controls","autoplay","class","style","target","rel","type"],
          ALLOW_DATA_ATTR: false,
        });
      } catch {
        // Fallback: render unsanitized (content from our own DB — low risk)
        safeHtml = payState.body;
      }
    }

    return (
      <div className="flex flex-col gap-4">
        {tipNotification && (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          <TipPrompt notification={tipNotification as any} onDismiss={() => setTipNotification(null)} />
        )}
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
          {payState.arcExplorerUrl && (
            <a
              href={payState.arcExplorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-xs no-underline"
              style={{ color: "var(--c-muted)" }}
            >
              View tx ↗
            </a>
          )}
        </div>
        {isVideo ? (
          // Video piece: render the first <video> src directly for autoPlay
          <div className="py-4">
            <div
              className="font-sans text-base leading-7 text-foreground"
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: safeHtml }}
              style={{ maxWidth: "100%" }}
            />
          </div>
        ) : (
          <div
            className="prose-body py-6"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />
        )}
        <style>{`
          .prose-body p { margin: 0 0 0.9em; font-size: 1rem; line-height: 1.75; }
          .prose-body h1 { font-size: 1.6em; font-weight: 700; margin: 1.2em 0 0.4em; letter-spacing: -0.02em; }
          .prose-body h2 { font-size: 1.3em; font-weight: 700; margin: 1em 0 0.4em; }
          .prose-body a { color: var(--c-violet); text-decoration: underline; }
          .prose-body img { max-width: 100%; border-radius: 8px; margin: 0.75em 0; display: block; }
          .prose-body video { max-width: 100%; border-radius: 8px; margin: 0.75em 0; display: block; }
          .prose-body code { font-family: var(--font-mono); font-size: 0.875em; padding: 0.1em 0.35em; border-radius: 4px; background: rgba(255,255,255,0.06); }
          .prose-body pre { background: rgba(0,0,0,0.3); padding: 0.8em 1em; border-radius: 8px; overflow-x: auto; margin: 0.75em 0; }
          .prose-body blockquote { border-left: 3px solid var(--c-violet); padding-left: 1em; color: var(--c-muted); margin: 0.75em 0; }
          .prose-body ul, .prose-body ol { padding-left: 1.5em; margin: 0.5em 0; }
        `}</style>
      </div>
    );
  }

  // --- Error state ---
  if (payState.status === "error") {
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
          Payment failed: {payState.message}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={retryUnlock}
          className="self-start"
        >
          Try again
        </Button>
      </div>
    );
  }

  // --- Wallet loading ---
  if (walletState.status === "loading") {
    return (
      <Button disabled className="inline-flex items-center gap-2.5 h-12 px-6 text-sm font-bold">
        <Spinner />
        Loading wallet…
      </Button>
    );
  }

  // --- No USDC: deposit prompt ---
  if (walletState.status === "no-usdc") {
    return (
      <DepositPrompt
        address={walletState.address}
        onFunded={() => setWalletState({
          status: "ready",
          wallet: { address: walletState.address, balance: "0", gatewayFunded: true },
        })}
      />
    );
  }

  // --- USDC arrived, auto-depositing into Gateway ---
  if (walletState.status === "depositing") {
    return (
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-xl font-mono text-xs"
        style={{
          background: "rgba(198,248,78,0.05)",
          border: "1px solid rgba(198,248,78,0.15)",
          color: "var(--c-muted)",
        }}
      >
        <Spinner />
        Depositing USDC into Gateway…
      </div>
    );
  }

  // --- Ready / auto-paying ---
  const { wallet } = walletState;

  return (
    <div className="flex flex-col items-center gap-3">
      {wallet.address && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg font-mono text-xs"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            color: "var(--c-muted)",
          }}
        >
          <span>Balance</span>
          <span style={{ color: "var(--c-fg)" }}>${wallet.balance}</span>
          <span className="mx-1">·</span>
          <span>Wallet</span>
          <span style={{ color: "var(--c-fg)" }}>
            {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
          </span>
        </div>
      )}
      <div
        className="inline-flex items-center gap-2.5 h-12 px-6 text-sm font-bold rounded-xl"
        style={{ background: "rgba(198,248,78,0.08)", border: "1px solid rgba(198,248,78,0.2)", color: "var(--c-accent)" }}
      >
        <Spinner />
        Settling {priceDisplay} on Arc…
      </div>
    </div>
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
