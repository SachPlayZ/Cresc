"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useCookies } from "react-cookie";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";

const CIRCLE_APP_ID = process.env.NEXT_PUBLIC_CIRCLE_APP_ID ?? "";
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_CIRCLE_GOOGLE_CLIENT_ID ?? "";

type Step = 1 | 2 | 3;
type WalletStep = 'idle' | 'device' | 'login' | 'init' | 'challenge' | 'fetching' | 'done';

type ConnectResult = {
  syncedCount: number;
  errors: string[];
  webhookUrl: string;
  webhookSecret: string;
  snippetHtml: string;
};

export default function GhostOnboardPage() {
  const sdkRef = useRef<W3SSdk | null>(null);
  const [cookies, setCookie] = useCookies([
    'circle_device_id', 'circle_device_token', 'circle_device_enc_key',
    'circle_user_token', 'circle_enc_key',
  ]);

  const [step, setStep] = useState<Step>(1);
  const [walletStep, setWalletStep] = useState<WalletStep>('idle');
  const [name, setName] = useState("");
  const [creatorId, setCreatorId] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [instanceUrl, setInstanceUrl] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [result, setResult] = useState<ConnectResult | null>(null);

  const deviceId = cookies.circle_device_id as string | undefined;
  const deviceToken = cookies.circle_device_token as string | undefined;
  const deviceEncKey = cookies.circle_device_enc_key as string | undefined;
  const userToken = cookies.circle_user_token as string | undefined;
  const encKey = cookies.circle_enc_key as string | undefined;

  // Init W3S SDK on step 2
  useEffect(() => {
    if (step !== 2) return;
    let cancelled = false;

    const initSdk = async () => {
      try {
        const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");

        const onLoginComplete = (err: unknown, res: unknown) => {
          if (cancelled) return;
          if (err) { setError("Google login failed: " + String(err)); return; }
          const { userToken: ut, encryptionKey: ek } = res as { userToken: string; encryptionKey: string };
          setCookie('circle_user_token', ut, { path: '/' });
          setCookie('circle_enc_key', ek, { path: '/' });
          setWalletStep('init');
        };

        const sdk = new W3SSdk(
          {
            appSettings: { appId: CIRCLE_APP_ID },
            loginConfigs: {
              deviceToken: deviceToken ?? '',
              deviceEncryptionKey: deviceEncKey ?? '',
              google: { clientId: GOOGLE_CLIENT_ID, redirectUri: window.location.origin },
            },
          },
          onLoginComplete
        );
        sdkRef.current = sdk;

        if (!deviceId) {
          const id = await sdk.getDeviceId();
          setCookie('circle_device_id', id, { path: '/' });
          setWalletStep('device');
        } else {
          setWalletStep(userToken ? 'init' : deviceToken ? 'login' : 'device');
        }
      } catch (e) {
        if (!cancelled) setError("W3S SDK init failed: " + String(e));
      }
    };

    void initSdk();
    return () => { cancelled = true; };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleGetDeviceToken() {
    if (!deviceId) return;
    setError(null);
    try {
      const res = await fetch('/api/ucw/device-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
      const data = await res.json() as { deviceToken?: string; deviceEncryptionKey?: string; error?: string };
      if (!res.ok || data.error) { setError(data.error ?? 'Device token failed'); return; }
      setCookie('circle_device_token', data.deviceToken!, { path: '/' });
      setCookie('circle_device_enc_key', data.deviceEncryptionKey!, { path: '/' });

      // Re-init SDK with new device token
      const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
      const onLoginComplete = (err: unknown, res2: unknown) => {
        if (err) { setError("Google login failed: " + String(err)); return; }
        const { userToken: ut, encryptionKey: ek } = res2 as { userToken: string; encryptionKey: string };
        setCookie('circle_user_token', ut, { path: '/' });
        setCookie('circle_enc_key', ek, { path: '/' });
        setWalletStep('init');
      };
      const sdk = new W3SSdk(
        {
          appSettings: { appId: CIRCLE_APP_ID },
          loginConfigs: {
            deviceToken: data.deviceToken!,
            deviceEncryptionKey: data.deviceEncryptionKey!,
            google: { clientId: GOOGLE_CLIENT_ID, redirectUri: window.location.origin },
          },
        },
        onLoginComplete
      );
      sdkRef.current = sdk;
      setWalletStep('login');
    } catch (e) { setError(String(e)); }
  }

  function handleLoginWithGoogle() {
    const sdk = sdkRef.current;
    if (!sdk) return;
    sdk.updateConfigs({
      appSettings: { appId: CIRCLE_APP_ID },
      loginConfigs: {
        deviceToken: deviceToken ?? '',
        deviceEncryptionKey: deviceEncKey ?? '',
        google: { clientId: GOOGLE_CLIENT_ID, redirectUri: window.location.origin },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sdk.performLogin('Google' as Parameters<W3SSdk['performLogin']>[0]);
  }

  async function handleInitWallet() {
    if (!userToken || !creatorId) return;
    setError(null);
    try {
      const res = await fetch('/api/ucw/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userToken, creator_id: creatorId }),
      });
      const data = await res.json() as {
        challengeId?: string;
        alreadyExists?: boolean;
        wallets?: { address: string }[];
        error?: string;
      };
      if (!res.ok || data.error) { setError(data.error ?? 'Init failed'); return; }

      if (data.alreadyExists && data.wallets?.[0]) {
        setWalletAddress(data.wallets[0].address);
        localStorage.setItem("cresc_ucw_wallet", data.wallets[0].address);
        setWalletStep('done');
        setStep(3);
        return;
      }

      // Execute challenge in browser
      const sdk = sdkRef.current;
      if (!sdk || !data.challengeId || !encKey) { setError('SDK or session missing'); return; }
      setWalletStep('challenge');
      sdk.setAuthentication({ userToken, encryptionKey: encKey });
      sdk.execute(data.challengeId, async (err) => {
        if (err) { setError('Wallet creation failed: ' + String(err)); setWalletStep('init'); return; }
        setWalletStep('fetching');
        await fetchWalletAddress();
      });
    } catch (e) { setError(String(e)); }
  }

  async function fetchWalletAddress() {
    if (!userToken || !creatorId) return;
    try {
      const url = `/api/ucw/wallet?userToken=${encodeURIComponent(userToken)}&creator_id=${encodeURIComponent(creatorId)}`;
      const res = await fetch(url);
      const data = await res.json() as { address?: string; error?: string };
      if (!res.ok || data.error) { setError(data.error ?? 'Wallet fetch failed'); setWalletStep('challenge'); return; }
      setWalletAddress(data.address!);
      localStorage.setItem("cresc_ucw_wallet", data.address!);
      setWalletStep('done');
      setStep(3);
    } catch (e) { setError(String(e)); }
  }

  async function goStep2(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Display name required."); return; }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/creator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: name.trim() }),
      });
      const data = await res.json() as { creator?: { id: string }; error?: string };
      if (!res.ok || !data.creator) { setError(data.error ?? "Failed to create account."); return; }
      setCreatorId(data.creator.id);
      localStorage.setItem("cresc_creator_id", data.creator.id);
      setStep(2);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!creatorId) return;
    if (!instanceUrl.trim() || !adminKey.trim()) { setError("Both fields required."); return; }
    setError(null);
    setLoading(true);
    try {
      const ghostRes = await fetch("/api/ghost/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceUrl: instanceUrl.trim(), adminKey: adminKey.trim(), creatorId }),
      });
      const ghostData = await ghostRes.json() as ConnectResult & { error?: string };
      if (!ghostRes.ok || ghostData.error) { setError(ghostData.error ?? "Ghost connection failed."); return; }
      setResult(ghostData);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }

  // ---- Success screen ----
  if (result) {
    return (
      <main className="min-h-screen bg-background text-foreground pb-20">
        <Nav />
        <div className="max-w-xl mx-auto px-6 pt-16">
          <div className="flex items-center gap-2 font-sans text-sm px-4 py-3 rounded-xl mb-8"
            style={{ background: "rgba(34,197,94,0.1)", color: "#16a34a", border: "1px solid rgba(34,197,94,0.2)" }}>
            ✓ Connected — {result.syncedCount} post{result.syncedCount !== 1 ? "s" : ""} synced and priced
            {result.errors.length > 0 && ` (${result.errors.length} error${result.errors.length !== 1 ? "s" : ""})`}
          </div>
          <h1 className="font-heading font-bold text-3xl mb-2" style={{ letterSpacing: "-0.03em" }}>
            Two steps left in Ghost Admin
          </h1>
          <p className="text-muted-foreground text-sm mb-8">
            Add the webhook so new posts sync automatically, then inject the paywall snippet.
          </p>
          <div className="rounded-xl p-5 border mb-4" style={{ background: "var(--c-surface)", border: "1px solid var(--c-border)" }}>
            <div className="flex items-center gap-2 mb-1">
              <StepBadge n={1} />
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
          <div className="rounded-xl p-5 border mb-8" style={{ background: "var(--c-surface)", border: "1px solid var(--c-border)" }}>
            <div className="flex items-center gap-2 mb-1">
              <StepBadge n={2} />
              <h3 className="font-heading font-semibold text-sm">Inject paywall snippet</h3>
            </div>
            <p className="font-sans text-xs text-muted-foreground mb-4 ml-7">
              Ghost Admin → Settings → Code Injection → Site Footer → paste this tag.
            </p>
            <div className="flex items-start gap-2 ml-7">
              <code className="font-mono text-xs flex-1 break-all"
                style={{ color: "var(--c-accent)", background: "var(--c-surface-hi)", padding: "0.5rem", borderRadius: "6px", display: "block" }}>
                {result.snippetHtml}
              </code>
              <button onClick={() => copy(result.snippetHtml, "snippet")}
                className="font-mono text-xs px-2 py-1 rounded border transition-colors shrink-0 mt-0.5"
                style={{ borderColor: "var(--c-border)", color: "var(--c-dim)" }}>
                {copied === "snippet" ? "✓" : "copy"}
              </button>
            </div>
          </div>
          <Link href="/dashboard"
            className="block font-sans font-semibold text-sm px-6 py-3 rounded-xl text-center transition-opacity"
            style={{ background: "var(--c-accent)", color: "#fff" }}>
            View dashboard →
          </Link>
        </div>
      </main>
    );
  }

  // ---- Main form ----
  return (
    <main className="min-h-screen bg-background text-foreground pb-20">
      <Nav />
      <div className="max-w-xl mx-auto px-6 pt-16">
        <div className="inline-flex items-center gap-1.5 font-mono text-xs tracking-widest uppercase px-3 py-1.5 rounded-full border mb-6"
          style={{ color: "var(--c-violet)", background: "var(--c-surface)", border: "1px solid var(--c-border)" }}>
          <span className="inline-block w-1 h-1 rounded-full" style={{ background: "var(--c-accent)" }} />
          Ghost Integration
        </div>
        <h1 className="font-heading font-bold text-3xl mb-2" style={{ letterSpacing: "-0.03em" }}>
          Connect your Ghost blog
        </h1>
        <p className="text-muted-foreground text-sm mb-8">
          Your posts stay in Ghost. Cresc adds AI-driven x402 pricing on top — one snippet, zero migration.
        </p>

        <div className="flex gap-2 mb-10">
          {([1, 2, 3] as Step[]).map((n) => (
            <div key={n} className="h-[3px] flex-1 rounded-full transition-colors duration-300"
              style={{ background: step >= n ? "var(--c-accent)" : "var(--c-border)" }} />
          ))}
        </div>

        {step === 1 && (
          <form onSubmit={goStep2} className="flex flex-col gap-5">
            <StepLabel n={1} label="Your name" />
            <div>
              <Label htmlFor="name" className="font-mono text-xs text-muted-foreground uppercase tracking-wider block mb-1.5">
                Display name
              </Label>
              <Input id="name" placeholder="e.g. Aria Chen" value={name}
                onChange={(e) => setName(e.target.value)} autoFocus className="h-10 text-sm font-sans" />
            </div>
            {error && <ErrorBox message={error} />}
            <Button type="submit" disabled={loading} className="h-11 font-bold text-sm mt-1">
              {loading ? "Creating account…" : "Next →"}
            </Button>
          </form>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-5">
            <button type="button" onClick={() => { setStep(1); setError(null); }}
              className="flex items-center gap-1 text-muted-foreground text-sm bg-transparent border-none font-sans hover:text-foreground transition-colors w-fit">
              ← Back
            </button>
            <StepLabel n={2} label="Create your wallet" />
            <p className="text-muted-foreground text-sm -mt-3">
              Your Circle wallet receives x402 nanopayments on Arc Testnet. Sign in with Google to create it — you control the keys.
            </p>

            {/* Sub-steps */}
            <div className="flex flex-col gap-3">
              {/* 2a: Get device token */}
              <WalletSubStep
                done={!!deviceToken}
                active={walletStep === 'device' || walletStep === 'idle'}
                label="Initialize browser session"
              >
                <Button size="sm" onClick={handleGetDeviceToken} disabled={!deviceId || !!deviceToken}
                  className="h-8 text-xs font-mono">
                  {deviceToken ? "✓ Done" : "Initialize →"}
                </Button>
              </WalletSubStep>

              {/* 2b: Google login */}
              <WalletSubStep
                done={!!userToken}
                active={walletStep === 'login' && !!deviceToken}
                label="Sign in with Google"
              >
                <Button size="sm" onClick={handleLoginWithGoogle} disabled={!deviceToken || !!userToken}
                  className="h-8 text-xs font-mono">
                  {userToken ? "✓ Signed in" : "Continue with Google →"}
                </Button>
              </WalletSubStep>

              {/* 2c: Create wallet challenge */}
              <WalletSubStep
                done={walletStep === 'done'}
                active={(walletStep === 'init' || walletStep === 'challenge' || walletStep === 'fetching') && !!userToken}
                label="Create Arc wallet"
              >
                <Button size="sm" onClick={handleInitWallet}
                  disabled={!userToken || walletStep === 'challenge' || walletStep === 'fetching' || walletStep === 'done'}
                  className="h-8 text-xs font-mono">
                  {walletStep === 'done' ? "✓ Wallet created" :
                   walletStep === 'challenge' ? "Approve in Circle UI…" :
                   walletStep === 'fetching' ? "Fetching wallet…" :
                   "Create wallet →"}
                </Button>
              </WalletSubStep>
            </div>

            {walletAddress && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--c-border)" }}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "#4ade80" }} />
                <span className="font-mono text-xs text-muted-foreground truncate">{walletAddress}</span>
              </div>
            )}

            {error && <ErrorBox message={error} />}
          </div>
        )}

        {step === 3 && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <button type="button" onClick={() => { setStep(2); setError(null); }}
              className="flex items-center gap-1 text-muted-foreground text-sm bg-transparent border-none font-sans hover:text-foreground transition-colors w-fit">
              ← Back
            </button>
            <StepLabel n={3} label="Ghost credentials" />

            <div>
              <label className="font-mono text-xs text-muted-foreground uppercase tracking-wider block mb-1.5">
                Ghost Instance URL
              </label>
              <Input placeholder="https://yourblog.ghost.io" value={instanceUrl}
                onChange={(e) => setInstanceUrl(e.target.value)} autoFocus className="h-10 text-sm font-mono" />
              <p className="font-sans text-xs text-muted-foreground mt-1.5">
                Works with Ghost.com hosted and self-hosted instances.
              </p>
            </div>

            <div>
              <label className="font-mono text-xs text-muted-foreground uppercase tracking-wider block mb-1.5">
                Ghost Admin API Key
              </label>
              <Input placeholder="id:secret" value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)} type="password" className="h-10 text-sm font-mono" />
              <p className="font-sans text-xs text-muted-foreground mt-1.5">
                Ghost Admin → Settings → Integrations → Add custom integration → Admin API Key.
              </p>
            </div>

            {error && <ErrorBox message={error} />}

            <Button type="submit" disabled={loading || !instanceUrl.trim() || !adminKey.trim()}
              className="h-11 font-bold text-sm mt-1">
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
    <nav className="flex items-center justify-between px-10 py-4.5 border-b"
      style={{ borderColor: "var(--c-border-soft)" }}>
      <Link href="/" className="font-heading font-bold text-lg tracking-tight text-foreground no-underline flex items-center gap-2"
        style={{ letterSpacing: "-0.03em" }}>
        <img src="/cresc-logo-transparent.png" alt="Cresc" style={{ width: 18, height: 18 }} />
        Cresc
      </Link>
      <Link href="/docs/ghost" className="font-mono text-xs text-muted-foreground no-underline">
        Setup docs
      </Link>
    </nav>
  );
}

function StepLabel({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <StepBadge n={n} />
      <span className="font-heading font-semibold text-sm" style={{ color: "var(--c-dim)" }}>{label}</span>
    </div>
  );
}

function StepBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full font-mono text-xs font-bold shrink-0"
      style={{ background: "var(--c-accent)", color: "#fff" }}>
      {n}
    </span>
  );
}

function WalletSubStep({ done, active, label, children }: {
  done: boolean; active: boolean; label: string; children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 rounded-xl"
      style={{
        background: done ? "rgba(34,197,94,0.06)" : active ? "rgba(255,255,255,0.04)" : "transparent",
        border: `1px solid ${done ? "rgba(34,197,94,0.2)" : "var(--c-border)"}`,
        opacity: !done && !active ? 0.4 : 1,
      }}>
      <span className="font-sans text-sm">{label}</span>
      {children}
    </div>
  );
}

function CopyRow({ label, value, id, copied, onCopy }: {
  label: string; value: string; id: string; copied: string | null; onCopy: (t: string, i: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-xs text-muted-foreground w-16">{label}</span>
      <code className="font-mono text-xs flex-1 truncate" style={{ color: "var(--c-accent)" }}>{value}</code>
      <button onClick={() => onCopy(value, id)}
        className="font-mono text-xs px-2 py-1 rounded border transition-colors shrink-0"
        style={{ borderColor: "var(--c-border)", color: "var(--c-dim)" }}>
        {copied === id ? "✓" : "copy"}
      </button>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="font-mono text-xs px-3 py-2 rounded-lg"
      style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
      {message}
    </div>
  );
}
