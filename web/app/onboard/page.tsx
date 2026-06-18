"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const ARC_TESTNET_CHAIN_ID = 5042002;

type Step = "form" | "submitting" | "done";

const CONTENT_TYPES = [
  { id: "writing", label: "Writing", icon: "✍️" },
  { id: "photography", label: "Photography", icon: "📷" },
  { id: "art", label: "Art & Illustration", icon: "🎨" },
  { id: "music", label: "Music", icon: "🎵" },
  { id: "video", label: "Video", icon: "🎬" },
  { id: "code", label: "Dev / Tech", icon: "⌨️" },
  { id: "research", label: "Research", icon: "🔬" },
  { id: "other", label: "Other", icon: "✦" },
];

const PLATFORMS = [
  { id: "instagram", label: "Instagram" },
  { id: "youtube", label: "YouTube" },
  { id: "deviantart", label: "DeviantArt" },
  { id: "substack", label: "Substack" },
  { id: "twitter", label: "X / Twitter" },
  { id: "medium", label: "Medium" },
  { id: "tiktok", label: "TikTok" },
  { id: "patreon", label: "Patreon" },
  { id: "github", label: "GitHub" },
  { id: "behance", label: "Behance" },
  { id: "soundcloud", label: "SoundCloud" },
  { id: "twitch", label: "Twitch" },
];

export default function OnboardPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  const [step, setStep] = useState<Step>("form");
  const [page, setPage] = useState<1 | 2>(1);

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [selectedContentTypes, setSelectedContentTypes] = useState<string[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [customPlatform, setCustomPlatform] = useState("");

  const [error, setError] = useState("");
  const [creatorId, setCreatorId] = useState("");

  const onWrongChain = isConnected && chainId !== ARC_TESTNET_CHAIN_ID;
  const canSubmit = isConnected && !onWrongChain && !!address;

  function toggleContentType(id: string) {
    setSelectedContentTypes((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function togglePlatform(id: string) {
    setSelectedPlatforms((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function handlePage1(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Display name required."); return; }
    setError("");
    setPage(2);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !address) { setError("Connect MetaMask on Arc Testnet first."); return; }
    setError("");
    setStep("submitting");

    const allPlatforms = [
      ...selectedPlatforms,
      ...(customPlatform.trim() ? [customPlatform.trim()] : []),
    ];

    const res = await fetch("/api/creator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        display_name: name.trim(),
        wallet_address: address.toLowerCase(),
        _meta: { bio: bio.trim(), content_types: selectedContentTypes, platforms: allPlatforms },
      }),
    });
    const data = await res.json() as { creator?: { id: string }; error?: string };

    if (!res.ok || !data.creator) {
      setError(data.error ?? "Something went wrong.");
      setStep("form");
      return;
    }

    setCreatorId(data.creator.id);
    localStorage.setItem("cresc_creator_id", data.creator.id);
    localStorage.setItem("cresc_wallet", address.toLowerCase());
    setStep("done");
  }

  if (step === "done") {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div className="bg-card border border-border rounded-2xl p-10 w-full max-w-lg">
          <div className="text-4xl mb-3 text-primary">✓</div>
          <h1 className="font-heading text-2xl font-bold text-foreground">Welcome, {name}</h1>
          <p className="text-muted-foreground text-sm mt-2.5 leading-relaxed">
            Your creator account is live. Publish your first piece — the AI pricing agent will handle
            the economics while you focus on the work.
          </p>
          <div className="flex gap-3 mt-7 flex-wrap">
            <Button onClick={() => router.push("/create")}>Publish first piece →</Button>
            <Button
              variant="outline"
              onClick={() => router.push(`/dashboard?creator=${creatorId}`)}
            >
              Go to dashboard
            </Button>
          </div>
          <p className="text-muted-foreground mt-5 text-xs opacity-40">Creator ID: {creatorId}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="bg-card border border-border rounded-2xl p-10 w-full max-w-lg">
        {/* Step progress bar */}
        <div className="flex gap-2 mb-8">
          {[1, 2].map((n) => (
            <div
              key={n}
              className="h-[3px] flex-1 rounded-full transition-colors duration-300"
              style={{ background: page >= n ? "var(--c-accent)" : "var(--c-border)" }}
            />
          ))}
        </div>

        {page === 1 ? (
          <>
            <h1 className="font-heading text-2xl font-bold text-foreground">Tell us about yourself</h1>
            <p className="text-muted-foreground text-sm mt-2.5 leading-relaxed">
              Help readers and the system understand what you create.
            </p>

            <form onSubmit={handlePage1} className="flex flex-col gap-5 mt-7">
              <div className="flex flex-col gap-2">
                <Label htmlFor="name" className="text-foreground">Display name</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="e.g. Aria Chen"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  className="h-10 text-sm"
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5">
                  <Label className="text-foreground">Bio</Label>
                  <span className="text-xs text-muted-foreground font-normal">optional</span>
                </div>
                <Textarea
                  placeholder="One or two sentences about your work…"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="min-h-20 resize-none font-sans text-sm leading-relaxed"
                />
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-1.5">
                  <Label className="text-foreground">What do you create?</Label>
                  <span className="text-xs text-muted-foreground font-normal">select all that apply</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {CONTENT_TYPES.map((ct) => {
                    const active = selectedContentTypes.includes(ct.id);
                    return (
                      <button
                        key={ct.id}
                        type="button"
                        onClick={() => toggleContentType(ct.id)}
                        className="flex items-center gap-1.5 px-3.5 py-2 rounded-full border text-sm font-semibold transition-all duration-150 cursor-pointer font-sans"
                        style={{
                          border: `1px solid ${active ? "var(--c-violet)" : "var(--c-border)"}`,
                          background: active ? "rgba(155,134,255,0.15)" : "transparent",
                          color: active ? "var(--c-text)" : "var(--c-muted)",
                        }}
                      >
                        <span>{ct.icon}</span>
                        {ct.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-1.5">
                  <Label className="text-foreground">Where do you publish?</Label>
                  <span className="text-xs text-muted-foreground font-normal">optional</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {PLATFORMS.map((p) => {
                    const active = selectedPlatforms.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => togglePlatform(p.id)}
                        className="px-3 py-1.5 rounded-full border text-xs font-semibold transition-all duration-150 cursor-pointer font-sans"
                        style={{
                          border: `1px solid ${active ? "var(--c-violet)" : "var(--c-border)"}`,
                          background: active ? "rgba(155,134,255,0.12)" : "transparent",
                          color: active ? "var(--c-text)" : "var(--c-muted)",
                        }}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                <Input
                  type="text"
                  placeholder="Other platform or personal site URL…"
                  value={customPlatform}
                  onChange={(e) => setCustomPlatform(e.target.value)}
                  className="text-sm h-9"
                />
              </div>

              {error && (
                <div
                  className="text-sm px-3.5 py-2.5 rounded-lg"
                  style={{
                    color: "var(--c-red)",
                    background: "rgba(224,138,138,0.08)",
                    border: "1px solid rgba(224,138,138,0.22)",
                  }}
                >
                  {error}
                </div>
              )}

              <Button type="submit" className="mt-1 h-11 font-bold text-sm">
                Next →
              </Button>
            </form>
          </>
        ) : (
          <>
            <button
              onClick={() => { setPage(1); setError(""); }}
              className="flex items-center gap-1 text-muted-foreground text-sm cursor-pointer bg-transparent border-none font-sans mb-5 hover:text-foreground transition-colors"
            >
              ← Back
            </button>
            <h1 className="font-heading text-2xl font-bold text-foreground">Connect your wallet</h1>
            <p className="text-muted-foreground text-sm mt-2.5 leading-relaxed">
              Your MetaMask EOA receives nanopayments on Arc Testnet — fractions of a cent per read,
              settled instantly by Circle Gateway.
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-5 mt-7">
              {/* RainbowKit connect button */}
              <div className="flex flex-col gap-3">
                <Label className="text-foreground">Wallet</Label>
                <ConnectButton />
              </div>

              {/* Connected address display */}
              {isConnected && address && (
                <div
                  className="flex items-center gap-2 px-4 py-3 rounded-xl"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--c-border)" }}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: onWrongChain ? "var(--c-red)" : "#4ade80" }}
                  />
                  <span className="font-mono text-xs text-muted-foreground truncate">{address}</span>
                </div>
              )}

              {/* Wrong chain warning */}
              {onWrongChain && (
                <div
                  className="text-sm px-3.5 py-2.5 rounded-lg"
                  style={{
                    color: "#f59e0b",
                    background: "rgba(245,158,11,0.08)",
                    border: "1px solid rgba(245,158,11,0.22)",
                  }}
                >
                  Switch to <strong>Arc Testnet</strong> (chain ID 5042002) in MetaMask to continue.
                  RainbowKit will prompt you automatically — click "Switch network" above.
                </div>
              )}

              {/* Faucet + deposit note */}
              <div
                className="px-4 py-3.5 rounded-xl"
                style={{
                  background: "rgba(155,134,255,0.07)",
                  border: "1px solid rgba(155,134,255,0.2)",
                }}
              >
                <p className="text-muted-foreground text-xs leading-relaxed m-0">
                  <strong className="text-foreground">Need testnet USDC?</strong>{" "}
                  Get free USDC at{" "}
                  <a
                    href="https://faucet.circle.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--c-accent)" }}
                  >
                    faucet.circle.com
                  </a>{" "}
                  (select Arc Testnet). Then deposit into Circle Gateway once — readers pay you via
                  gasless x402 nanopayments after that. No real funds at risk.
                </p>
              </div>

              {error && (
                <div
                  className="text-sm px-3.5 py-2.5 rounded-lg"
                  style={{
                    color: "var(--c-red)",
                    background: "rgba(224,138,138,0.08)",
                    border: "1px solid rgba(224,138,138,0.22)",
                  }}
                >
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={!canSubmit || step === "submitting"}
                className="mt-1 h-11 font-bold text-sm"
              >
                {step === "submitting"
                  ? "Creating account…"
                  : !isConnected
                  ? "Connect wallet to continue"
                  : onWrongChain
                  ? "Switch to Arc Testnet"
                  : "Create account →"}
              </Button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
