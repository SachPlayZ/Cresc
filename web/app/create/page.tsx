"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useSignMessage } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichEditor, countWordsInHtml } from "@/components/RichEditor";

type Step = "form" | "submitting" | "done";

export default function CreatePage() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [step, setStep] = useState<Step>("form");
  const [creatorId, setCreatorId] = useState("");
  const [title, setTitle] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [objective, setObjective] = useState<"MAX_REVENUE" | "MAX_REACH">("MAX_REACH");
  const [error, setError] = useState("");
  const [pieceId, setPieceId] = useState("");

  useEffect(() => {
    const id = localStorage.getItem("cresc_creator_id");
    if (!id) router.replace("/onboard");
    else setCreatorId(id);
  }, [router]);

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError("Title required."); return; }

    const plainText = bodyHtml.replace(/<[^>]+>/g, " ").trim();
    if (plainText.length < 100) { setError("Body must be at least 100 characters."); return; }
    setError("");
    setStep("submitting");

    const kind: "article" | "video" = bodyHtml.includes("<video") ? "video" : "article";

    // M-C7: sign a timestamped challenge to prove wallet ownership before publishing.
    // If wallet not connected (dev/mock), proceed without signature — API allows it.
    let signature: string | undefined;
    let timestamp: string | undefined;
    if (isConnected) {
      try {
        timestamp = Date.now().toString();
        signature = await signMessageAsync({ message: `cresc:create:${timestamp}` });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes("user rejected") || msg.toLowerCase().includes("denied")) {
          setError("Signature rejected. Please approve the MetaMask prompt to publish.");
        } else {
          setError("Wallet signing failed. Try again.");
        }
        setStep("form");
        return;
      }
    }

    const res = await fetch("/api/piece/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creator_id: creatorId, title: title.trim(), body: bodyHtml, kind, objective, signature, timestamp }),
    });
    const data = await res.json() as { piece?: { id: string }; error?: string };

    if (!res.ok || !data.piece) {
      setError(data.error ?? "Publish failed.");
      setStep("form");
      return;
    }

    setPieceId(data.piece.id);
    setStep("done");
  }

  if (!creatorId) return null;

  if (step === "done") {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div className="bg-card border border-border rounded-2xl p-10 w-full max-w-lg">
          <div className="text-4xl mb-3 font-mono text-primary">✓</div>
          <h1 className="font-heading text-2xl font-bold text-foreground mb-0">Piece published</h1>
          <p className="text-muted-foreground text-sm mt-2.5 leading-relaxed">
            Starting price: <strong className="text-foreground">$0.005</strong>. The PricingAgent will
            begin adjusting it once readers start engaging. Each decision will appear in your dashboard
            with full reasoning.
          </p>
          <div className="flex gap-3 mt-6 flex-wrap">
            <Button onClick={() => router.push(`/piece/${pieceId}`)}>
              Preview reader view
            </Button>
            <Button
              variant="outline"
              onClick={() => { setStep("form"); setTitle(""); setBodyHtml(""); setPieceId(""); }}
            >
              Publish another
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push(`/dashboard?creator=${creatorId}`)}
            >
              Dashboard
            </Button>
          </div>
          <p className="text-muted-foreground mt-5 text-xs opacity-50">Piece ID: {pieceId}</p>
        </div>
      </main>
    );
  }

  const wordCount = countWordsInHtml(bodyHtml);
  const readMin = Math.max(1, Math.round(wordCount / 200));

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="bg-card border border-border rounded-2xl p-10 w-full max-w-3xl">
        {/* Header */}
        <div className="mb-1">
          <span
            className="font-mono text-xs tracking-widest uppercase"
            style={{ color: "var(--c-violet)" }}
          >
            New piece
          </span>
        </div>
        <h1 className="font-heading text-2xl font-bold text-foreground mt-1">Publish a piece</h1>
        <p className="text-muted-foreground text-sm mt-2.5 leading-relaxed">
          Write or paste your content. The AI pricing agent sets the opening rate at $0.005 and
          adjusts autonomously from there based on reader engagement.
        </p>

        {/* M-C7: wallet connect gate */}
        {!isConnected && (
          <div
            className="flex flex-col gap-3 mt-6 p-4 rounded-xl border"
            style={{
              background: "rgba(155,134,255,0.05)",
              border: "1px solid rgba(155,134,255,0.2)",
            }}
          >
            <p className="text-sm text-muted-foreground">
              Connect your wallet to verify ownership before publishing. MetaMask will ask you to
              sign a short message — no gas, no transaction.
            </p>
            <ConnectButton />
          </div>
        )}

        <form onSubmit={handlePublish} className="flex flex-col gap-5 mt-7">
          {/* Title */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="title" className="text-foreground">Title</Label>
            <Input
              id="title"
              type="text"
              placeholder="What's this piece called?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={step === "submitting"}
              autoFocus
              className="h-10 text-sm"
            />
          </div>

          {/* Rich text body */}
          <div className="flex flex-col gap-2">
            <Label className="text-foreground">Body</Label>
            <RichEditor
              placeholder="Write your piece here… (min 100 characters)"
              onChange={setBodyHtml}
              disabled={step === "submitting"}
            />
            {wordCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {wordCount} words · ~{readMin} min read
                {bodyHtml.includes("<video") && (
                  <span className="ml-2 font-mono" style={{ color: "var(--c-violet)" }}>· video</span>
                )}
              </span>
            )}
          </div>

          {/* Objective */}
          <div className="flex flex-col gap-3">
            <Label className="text-foreground">Objective</Label>
            <div className="flex gap-3">
              {(["MAX_REACH", "MAX_REVENUE"] as const).map((obj) => {
                const active = objective === obj;
                return (
                  <button
                    key={obj}
                    type="button"
                    onClick={() => setObjective(obj)}
                    className="flex-1 flex flex-col gap-1 text-left px-4 py-3.5 rounded-xl border transition-all duration-150 cursor-pointer"
                    style={{
                      border: `1px solid ${active ? "var(--c-violet)" : "var(--c-border)"}`,
                      background: active ? "rgba(155,134,255,0.1)" : "transparent",
                      color: active ? "var(--c-text)" : "var(--c-muted)",
                    }}
                  >
                    <span className="font-bold text-sm">
                      {obj === "MAX_REACH" ? "Max reach" : "Max revenue"}
                    </span>
                    <span className="text-xs opacity-60">
                      {obj === "MAX_REACH"
                        ? "Agent prices for widest audience"
                        : "Agent prices for highest total earnings"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div
              className="text-sm px-3.5 py-2.5 rounded-lg border"
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
            disabled={step === "submitting"}
            className="mt-1 h-11 text-sm font-bold"
            style={{ boxShadow: "0 0 24px rgba(198,248,78,0.25)" }}
          >
            {step === "submitting" ? "Publishing…" : isConnected ? "Sign & Publish →" : "Publish →"}
          </Button>
        </form>
      </div>
    </main>
  );
}
