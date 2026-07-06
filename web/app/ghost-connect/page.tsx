"use client";

// app/ghost-connect/page.tsx — Creator UI for connecting a Ghost instance to Cresc.
// Step 1: Enter Ghost URL + Admin API key → POST /api/ghost/connect
// Step 2: Copy webhook config + snippet into Ghost Admin

import { useState } from "react";
import Link from "next/link";

type ConnectResult = {
  ok: boolean;
  syncedCount: number;
  errors: string[];
  webhookUrl: string;
  webhookSecret: string;
  snippetHtml: string;
  setup: string[];
};

export default function GhostConnectPage() {
  const [creatorId, setCreatorId] = useState("");
  const [instanceUrl, setInstanceUrl] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConnectResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ghost/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceUrl, adminKey, creatorId }),
      });
      const data = await res.json() as ConnectResult & { error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? "Connection failed");
      } else {
        setResult(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground pb-20">
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
        <span className="font-mono text-xs text-muted-foreground">Connect Ghost</span>
      </nav>

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
        <p className="text-muted-foreground text-sm mb-10">
          Your posts stay in Ghost. Cresc adds AI-driven x402 pricing on top — one snippet, zero migration.
        </p>

        {!result ? (
          <div className="flex flex-col gap-4">
            <div>
              <label className="font-mono text-xs text-muted-foreground uppercase tracking-wider block mb-1.5">
                Your Cresc Creator ID
              </label>
              <input
                className="w-full font-mono text-sm px-3 py-2.5 rounded-lg border bg-background focus:outline-none focus:ring-1"
                style={{ borderColor: "var(--c-border)", "--tw-ring-color": "var(--c-accent)" } as React.CSSProperties}
                placeholder="Paste your creator UUID from /onboard"
                value={creatorId}
                onChange={(e) => setCreatorId(e.target.value)}
              />
            </div>

            <div>
              <label className="font-mono text-xs text-muted-foreground uppercase tracking-wider block mb-1.5">
                Ghost Instance URL
              </label>
              <input
                className="w-full font-mono text-sm px-3 py-2.5 rounded-lg border bg-background focus:outline-none focus:ring-1"
                style={{ borderColor: "var(--c-border)" } as React.CSSProperties}
                placeholder="https://yourblog.ghost.io"
                value={instanceUrl}
                onChange={(e) => setInstanceUrl(e.target.value)}
              />
              <p className="font-sans text-xs text-muted-foreground mt-1">
                Works with Ghost.com hosted and self-hosted instances.
              </p>
            </div>

            <div>
              <label className="font-mono text-xs text-muted-foreground uppercase tracking-wider block mb-1.5">
                Ghost Admin API Key
              </label>
              <input
                className="w-full font-mono text-sm px-3 py-2.5 rounded-lg border bg-background focus:outline-none focus:ring-1"
                style={{ borderColor: "var(--c-border)" } as React.CSSProperties}
                placeholder="id:secret (from Ghost Admin → Integrations)"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                type="password"
              />
              <p className="font-sans text-xs text-muted-foreground mt-1">
                Ghost Admin → Settings → Integrations → Add custom integration → copy Admin API Key.
              </p>
            </div>

            {error && (
              <div
                className="font-mono text-xs px-3 py-2 rounded-lg"
                style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}
              >
                {error}
              </div>
            )}

            <button
              onClick={handleConnect}
              disabled={loading || !creatorId || !instanceUrl || !adminKey}
              className="font-sans font-semibold text-sm px-6 py-3 rounded-xl transition-opacity disabled:opacity-40"
              style={{ background: "var(--c-accent)", color: "#fff" }}
            >
              {loading ? "Connecting & syncing posts…" : "Connect Ghost →"}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div
              className="flex items-center gap-2 font-sans text-sm px-4 py-3 rounded-xl"
              style={{ background: "rgba(34,197,94,0.1)", color: "#16a34a", border: "1px solid rgba(34,197,94,0.2)" }}
            >
              ✓ Connected — {result.syncedCount} post{result.syncedCount !== 1 ? "s" : ""} synced and priced
              {result.errors.length > 0 && ` (${result.errors.length} error${result.errors.length > 1 ? "s" : ""})`}
            </div>

            {/* Step 1: Webhook */}
            <div
              className="rounded-xl p-5 border"
              style={{ background: "var(--c-surface)", border: "1px solid var(--c-border)" }}
            >
              <h3 className="font-heading font-semibold text-sm mb-3">Step 1 — Add Ghost webhook</h3>
              <p className="font-sans text-xs text-muted-foreground mb-3">
                Ghost Admin → Settings → Webhooks → Add webhook. Set all post events to this URL.
              </p>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground w-16">URL</span>
                  <code className="font-mono text-xs flex-1 truncate" style={{ color: "var(--c-accent)" }}>
                    {result.webhookUrl}
                  </code>
                  <button
                    onClick={() => copy(result.webhookUrl, "url")}
                    className="font-mono text-xs px-2 py-1 rounded border transition-colors"
                    style={{ borderColor: "var(--c-border)", color: "var(--c-dim)" }}
                  >
                    {copied === "url" ? "✓" : "copy"}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground w-16">Secret</span>
                  <code className="font-mono text-xs flex-1 truncate" style={{ color: "var(--c-accent)" }}>
                    {result.webhookSecret}
                  </code>
                  <button
                    onClick={() => copy(result.webhookSecret, "secret")}
                    className="font-mono text-xs px-2 py-1 rounded border transition-colors"
                    style={{ borderColor: "var(--c-border)", color: "var(--c-dim)" }}
                  >
                    {copied === "secret" ? "✓" : "copy"}
                  </button>
                </div>
              </div>
            </div>

            {/* Step 2: Snippet */}
            <div
              className="rounded-xl p-5 border"
              style={{ background: "var(--c-surface)", border: "1px solid var(--c-border)" }}
            >
              <h3 className="font-heading font-semibold text-sm mb-3">Step 2 — Inject paywall snippet</h3>
              <p className="font-sans text-xs text-muted-foreground mb-3">
                Ghost Admin → Settings → Code Injection → Site Header → paste this tag.
              </p>
              <div className="flex items-start gap-2">
                <code
                  className="font-mono text-xs flex-1 break-all"
                  style={{ color: "var(--c-accent)", background: "var(--c-surface-hi)", padding: "0.5rem", borderRadius: "6px", display: "block" }}
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
              className="font-sans font-semibold text-sm px-6 py-3 rounded-xl text-center transition-opacity"
              style={{ background: "var(--c-accent)", color: "#fff" }}
            >
              View synced posts in dashboard →
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
