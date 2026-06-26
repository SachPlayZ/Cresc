"use client";

import { useState } from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ARC_TESTNET_CHAIN_ID = 5042002;

type Step = 1 | 2 | 3;

type ConnectResult = {
  syncedCount: number;
  errors: string[];
  webhookUrl: string;
  webhookSecret: string;
  snippetHtml: string;
};

export default function GhostOnboardPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const onWrongChain = isConnected && chainId !== ARC_TESTNET_CHAIN_ID;

  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [instanceUrl, setInstanceUrl] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [result, setResult] = useState<ConnectResult | null>(null);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  function goStep2(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Display name required."); return; }
    setError(null);
    setStep(2);
  }

  function goStep3(e: React.FormEvent) {
    e.preventDefault();
    if (!isConnected || !address) { setError("Connect your wallet first."); return; }
    if (onWrongChain) { setError("Switch to Arc Testnet first."); return; }
    setError(null);
    setStep(3);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!address) return;
    if (!instanceUrl.trim() || !adminKey.trim()) { setError("Both fields required."); return; }
    setError(null);
    setLoading(true);

    try {
      // 1. Create (or retrieve) creator account
      const creatorRes = await fetch("/api/creator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: name.trim(), wallet_address: address.toLowerCase() }),
      });
      const creatorData = await creatorRes.json() as { creator?: { id: string }; error?: string };
      if (!creatorRes.ok || !creatorData.creator) {
        setError(creatorData.error ?? "Failed to create account.");
        return;
      }
      const creatorId = creatorData.creator.id;
      localStorage.setItem("cresc_creator_id", creatorId);
      localStorage.setItem("cresc_wallet", address.toLowerCase());

      // 2. Connect Ghost
      const ghostRes = await fetch("/api/ghost/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceUrl: instanceUrl.trim(), adminKey: adminKey.trim(), creatorId }),
      });
      const ghostData = await ghostRes.json() as ConnectResult & { error?: string };
      if (!ghostRes.ok || ghostData.error) {
        setError(ghostData.error ?? "Ghost connection failed.");
        return;
      }

      setResult(ghostData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <main className="min-h-screen bg-background text-foreground pb-20">
        <Nav />
        <div className="max-w-xl mx-auto px-6 pt-16">
          <div
            className="flex items-center gap-2 font-sans text-sm px-4 py-3 rounded-xl mb-8"
            style={{ background: "rgba(34,197,94,0.1)", color: "#16a34a", border: "1px solid rgba(34,197,94,0.2)" }}
          >
            ✓ Connected — {result.syncedCount} post{result.syncedCount !== 1 ? "s" : ""} synced and priced
            {result.errors.length > 0 && ` (${result.errors.length} error${result.errors.length !== 1 ? "s" : ""})`}
          </div>

          <h1 className="font-heading font-bold text-3xl mb-2" style={{ letterSpacing: "-0.03em" }}>
            Two steps left in Ghost Admin
          </h1>
          <p className="text-muted-foreground text-sm mb-8">
            Add the webhook so new posts sync automatically, then inject the paywall snippet.
          </p>

          {/* Webhook card */}
          <div className="rounded-xl p-5 border mb-4" style={{ background: "var(--c-surface)", border: "1px solid var(--c-border)" }}>
            <div className="flex items-center gap-2 mb-1">
              <span
                className="inline-flex items-center justify-center w-5 h-5 rounded-full font-mono text-xs font-bold shrink-0"
                style={{ background: "var(--c-accent)", color: "#fff" }}
              >1</span>
              <h3 className="font-heading font-semibold text-sm">Add Ghost webhook</h3>
            </div>
            <p className="font-sans text-xs text-muted-foreground mb-4 ml-7">
              Ghost Admin → Settings → Webhooks → Add webhook. Select Post published, Post updated, Post deleted.
            </p>
            <div className="flex flex-col gap-2 ml-7">
              <CopyRow label="URL" value={result.webhookUrl} id="url" copied={copied} onCopy={copy} />
              <CopyRow label="Secret" value={result.webhookSecret} id="secret" copied={copied} onCopy={copy} />
            </div>
          </div>

          {/* Snippet card */}
          <div className="rounded-xl p-5 border mb-8" style={{ background: "var(--c-surface)", border: "1px solid var(--c-border)" }}>
            <div className="flex items-center gap-2 mb-1">
              <span
                className="inline-flex items-center justify-center w-5 h-5 rounded-full font-mono text-xs font-bold shrink-0"
                style={{ background: "var(--c-accent)", color: "#fff" }}
              >2</span>
              <h3 className="font-heading font-semibold text-sm">Inject paywall snippet</h3>
            </div>
            <p className="font-sans text-xs text-muted-foreground mb-4 ml-7">
              Ghost Admin → Settings → Code Injection → Site Footer → paste this tag.
            </p>
            <div className="flex items-start gap-2 ml-7">
              <code
                className="font-mono text-xs flex-1 break-all"
                style={{
                  color: "var(--c-accent)",
                  background: "var(--c-surface-hi)",
                  padding: "0.5rem",
                  borderRadius: "6px",
                  display: "block",
                }}
              >
                {result.snippetHtml}
              </code>
              <button
                onClick={() => copy(result.snippetHtml, "snippet")}
                className="font-mono text-xs px-2 py-1 rounded border transition-colors shrink-0 mt-0.5"
                style={{ borderColor: "var(--c-border)", color: "var(--c-dim)" }}
              >
                {copied === "snippet" ? "✓" : "copy"}
              </button>
            </div>
          </div>

          <Link
            href="/dashboard"
            className="block font-sans font-semibold text-sm px-6 py-3 rounded-xl text-center transition-opacity"
            style={{ background: "var(--c-accent)", color: "#fff" }}
          >
            View dashboard →
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground pb-20">
      <Nav />
      <div className="max-w-xl mx-auto px-6 pt-16">
        <div
          className="inline-flex items-center gap-1.5 font-mono text-xs tracking-widest uppercase px-3 py-1.5 rounded-full border mb-6"
          style={{ color: "var(--c-violet)", background: "var(--c-surface)", border: "1px solid var(--c-border)" }}
        >
          <span className="inline-block w-1 h-1 rounded-full" style={{ background: "var(--c-accent)" }} />
          Ghost Integration
        </div>

        <h1 className="font-heading font-bold text-3xl mb-2" style={{ letterSpacing: "-0.03em" }}>
          Connect your Ghost blog
        </h1>
        <p className="text-muted-foreground text-sm mb-8">
          Your posts stay in Ghost. Cresc adds AI-driven x402 pricing on top — one snippet, zero migration.
        </p>

        {/* Step progress */}
        <div className="flex gap-2 mb-10">
          {([1, 2, 3] as Step[]).map((n) => (
            <div
              key={n}
              className="h-[3px] flex-1 rounded-full transition-colors duration-300"
              style={{ background: step >= n ? "var(--c-accent)" : "var(--c-border)" }}
            />
          ))}
        </div>

        {step === 1 && (
          <form onSubmit={goStep2} className="flex flex-col gap-5">
            <StepLabel n={1} label="Your name" />
            <div>
              <Label htmlFor="name" className="font-mono text-xs text-muted-foreground uppercase tracking-wider block mb-1.5">
                Display name
              </Label>
              <Input
                id="name"
                placeholder="e.g. Aria Chen"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                className="h-10 text-sm font-sans"
              />
            </div>
            {error && <ErrorBox message={error} />}
            <Button type="submit" className="h-11 font-bold text-sm mt-1">
              Next →
            </Button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={goStep3} className="flex flex-col gap-5">
            <button
              type="button"
              onClick={() => { setStep(1); setError(null); }}
              className="flex items-center gap-1 text-muted-foreground text-sm bg-transparent border-none font-sans hover:text-foreground transition-colors w-fit"
            >
              ← Back
            </button>
            <StepLabel n={2} label="Connect wallet" />
            <p className="text-muted-foreground text-sm -mt-3">
              Your MetaMask EOA receives nanopayments on Arc Testnet — fractions of a cent per read, settled by Circle Gateway.
            </p>

            <div>
              <Label className="font-mono text-xs text-muted-foreground uppercase tracking-wider block mb-2">
                Wallet
              </Label>
              <ConnectButton />
            </div>

            {isConnected && address && (
              <div
                className="flex items-center gap-2 px-4 py-3 rounded-xl"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--c-border)" }}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: onWrongChain ? "var(--c-red)" : "#4ade80" }}
                />
                <span className="font-mono text-xs text-muted-foreground truncate">{address}</span>
              </div>
            )}

            {onWrongChain && (
              <div
                className="text-sm px-3.5 py-2.5 rounded-lg"
                style={{ color: "#f59e0b", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.22)" }}
              >
                Switch to <strong>Arc Testnet</strong> (chain ID 5042002) in MetaMask to continue.
              </div>
            )}

            <div
              className="px-4 py-3.5 rounded-xl"
              style={{ background: "rgba(155,134,255,0.07)", border: "1px solid rgba(155,134,255,0.2)" }}
            >
              <p className="text-muted-foreground text-xs leading-relaxed m-0">
                <strong className="text-foreground">Need testnet USDC?</strong>{" "}
                Get free USDC at{" "}
                <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" style={{ color: "var(--c-accent)" }}>
                  faucet.circle.com
                </a>{" "}
                (select Arc Testnet). Readers pay you via gasless x402 nanopayments — no real funds at risk.
              </p>
            </div>

            {error && <ErrorBox message={error} />}

            <Button
              type="submit"
              disabled={!isConnected || onWrongChain}
              className="h-11 font-bold text-sm mt-1"
            >
              {!isConnected ? "Connect wallet to continue" : onWrongChain ? "Switch to Arc Testnet" : "Next →"}
            </Button>
          </form>
        )}

        {step === 3 && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <button
              type="button"
              onClick={() => { setStep(2); setError(null); }}
              className="flex items-center gap-1 text-muted-foreground text-sm bg-transparent border-none font-sans hover:text-foreground transition-colors w-fit"
            >
              ← Back
            </button>
            <StepLabel n={3} label="Ghost credentials" />

            <div>
              <label className="font-mono text-xs text-muted-foreground uppercase tracking-wider block mb-1.5">
                Ghost Instance URL
              </label>
              <Input
                placeholder="https://yourblog.ghost.io"
                value={instanceUrl}
                onChange={(e) => setInstanceUrl(e.target.value)}
                autoFocus
                className="h-10 text-sm font-mono"
              />
              <p className="font-sans text-xs text-muted-foreground mt-1.5">
                Works with Ghost.com hosted and self-hosted instances.
              </p>
            </div>

            <div>
              <label className="font-mono text-xs text-muted-foreground uppercase tracking-wider block mb-1.5">
                Ghost Admin API Key
              </label>
              <Input
                placeholder="id:secret"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                type="password"
                className="h-10 text-sm font-mono"
              />
              <p className="font-sans text-xs text-muted-foreground mt-1.5">
                Ghost Admin → Settings → Integrations → Add custom integration → Admin API Key.
              </p>
            </div>

            {error && <ErrorBox message={error} />}

            <Button
              type="submit"
              disabled={loading || !instanceUrl.trim() || !adminKey.trim()}
              className="h-11 font-bold text-sm mt-1"
            >
              {loading ? "Connecting & syncing posts…" : "Connect Ghost →"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}

function Nav() {
  return (
    <nav
      className="flex items-center justify-between px-10 py-4.5 border-b"
      style={{ borderColor: "var(--c-border-soft)" }}
    >
      <Link
        href="/"
        className="font-heading font-bold text-lg tracking-tight text-foreground no-underline flex items-center gap-2"
        style={{ letterSpacing: "-0.03em" }}
      >
        <img src="/cresc-logo-transparent.png" alt="Cresc" style={{ width: 18, height: 18 }} />
        Cresc
      </Link>
      <span className="font-mono text-xs text-muted-foreground">Ghost Onboarding</span>
    </nav>
  );
}

function StepLabel({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-flex items-center justify-center w-5 h-5 rounded-full font-mono text-xs font-bold shrink-0"
        style={{ background: "var(--c-accent)", color: "#fff" }}
      >
        {n}
      </span>
      <span className="font-heading font-semibold text-sm" style={{ color: "var(--c-dim)" }}>
        {label}
      </span>
    </div>
  );
}

function CopyRow({ label, value, id, copied, onCopy }: {
  label: string;
  value: string;
  id: string;
  copied: string | null;
  onCopy: (text: string, id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-xs text-muted-foreground w-16">{label}</span>
      <code className="font-mono text-xs flex-1 truncate" style={{ color: "var(--c-accent)" }}>
        {value}
      </code>
      <button
        onClick={() => onCopy(value, id)}
        className="font-mono text-xs px-2 py-1 rounded border transition-colors shrink-0"
        style={{ borderColor: "var(--c-border)", color: "var(--c-dim)" }}
      >
        {copied === id ? "✓" : "copy"}
      </button>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div
      className="font-mono text-xs px-3 py-2 rounded-lg"
      style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}
    >
      {message}
    </div>
  );
}
