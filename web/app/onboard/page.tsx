"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
  const [step, setStep] = useState<Step>("form");
  const [page, setPage] = useState<1 | 2>(1);

  // Page 1 fields
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [selectedContentTypes, setSelectedContentTypes] = useState<string[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [customPlatform, setCustomPlatform] = useState("");

  // Page 2 fields
  const [wallet, setWallet] = useState("");
  const [error, setError] = useState("");
  const [creatorId, setCreatorId] = useState("");

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
    if (!wallet.trim()) { setError("Wallet address required."); return; }
    setError("");
    setStep("submitting");

    const allPlatforms = [...selectedPlatforms, ...(customPlatform.trim() ? [customPlatform.trim()] : [])];

    const res = await fetch("/api/creator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        display_name: name.trim(),
        wallet_address: wallet.trim().toLowerCase(),
        // Extra profile metadata stored in display_name for now; extend schema for full profile
        // These are passed for potential future use
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
    localStorage.setItem("cresc_wallet", wallet.trim().toLowerCase());
    setStep("done");
  }

  if (step === "done") {
    return (
      <main style={s.main}>
        <div style={s.card}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>✓</div>
          <h1 style={s.heading}>Welcome, {name}</h1>
          <p style={s.sub}>
            Your creator account is live. Publish your first piece — the AI pricing agent will
            handle the economics while you focus on the work.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 28, flexWrap: "wrap" }}>
            <button style={s.btnPrimary} onClick={() => router.push("/create")}>
              Publish first piece →
            </button>
            <button style={s.btnSecondary} onClick={() => router.push(`/dashboard?creator=${creatorId}`)}>
              Go to dashboard
            </button>
          </div>
          <p style={{ ...s.sub, marginTop: 20, fontSize: 11, opacity: 0.4 }}>Creator ID: {creatorId}</p>
        </div>
      </main>
    );
  }

  return (
    <main style={s.main}>
      <div style={s.card}>
        {/* Progress indicator */}
        <div style={{ display: "flex", gap: 8, marginBottom: 32 }}>
          {[1, 2].map((n) => (
            <div key={n} style={{ height: 3, flex: 1, borderRadius: 2, background: page >= n ? "var(--c-accent, #7c3aed)" : "var(--c-border, #2e2e44)", transition: "background 0.3s" }} />
          ))}
        </div>

        {page === 1 ? (
          <>
            <h1 style={s.heading}>Tell us about yourself</h1>
            <p style={s.sub}>Help readers and the system understand what you create.</p>

            <form onSubmit={handlePage1} style={{ display: "flex", flexDirection: "column", gap: 22, marginTop: 28 }}>
              <label style={s.label}>
                Display name
                <input
                  style={s.input}
                  type="text"
                  placeholder="e.g. Aria Chen"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </label>

              <label style={s.label}>
                Bio
                <span style={{ fontSize: 11, opacity: 0.5, fontWeight: 400, marginLeft: 6 }}>optional</span>
                <textarea
                  style={{ ...s.input, minHeight: 80, resize: "vertical", lineHeight: 1.6 }}
                  placeholder="One or two sentences about your work…"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                />
              </label>

              <div>
                <span style={{ ...s.label, marginBottom: 12, display: "block" }}>
                  What do you create?
                  <span style={{ fontSize: 11, opacity: 0.5, fontWeight: 400, marginLeft: 6 }}>select all that apply</span>
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {CONTENT_TYPES.map((ct) => (
                    <button
                      key={ct.id}
                      type="button"
                      onClick={() => toggleContentType(ct.id)}
                      style={{
                        padding: "8px 14px",
                        borderRadius: 20,
                        border: `1px solid ${selectedContentTypes.includes(ct.id) ? "var(--c-accent, #7c3aed)" : "var(--c-border, #2e2e44)"}`,
                        background: selectedContentTypes.includes(ct.id) ? "rgba(124,58,237,0.15)" : "transparent",
                        color: selectedContentTypes.includes(ct.id) ? "var(--c-text, #eee)" : "var(--c-muted, #888)",
                        fontFamily: "var(--font-manrope), sans-serif",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        transition: "all 0.15s",
                      }}
                    >
                      <span>{ct.icon}</span>
                      {ct.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span style={{ ...s.label, marginBottom: 12, display: "block" }}>
                  Where do you publish?
                  <span style={{ fontSize: 11, opacity: 0.5, fontWeight: 400, marginLeft: 6 }}>optional</span>
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {PLATFORMS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => togglePlatform(p.id)}
                      style={{
                        padding: "7px 13px",
                        borderRadius: 20,
                        border: `1px solid ${selectedPlatforms.includes(p.id) ? "var(--c-accent, #7c3aed)" : "var(--c-border, #2e2e44)"}`,
                        background: selectedPlatforms.includes(p.id) ? "rgba(124,58,237,0.12)" : "transparent",
                        color: selectedPlatforms.includes(p.id) ? "var(--c-text, #eee)" : "var(--c-muted, #888)",
                        fontFamily: "var(--font-manrope), sans-serif",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <input
                  style={{ ...s.input, marginTop: 10, fontSize: 13 }}
                  type="text"
                  placeholder="Other platform or personal site URL…"
                  value={customPlatform}
                  onChange={(e) => setCustomPlatform(e.target.value)}
                />
              </div>

              {error && <div style={s.err}>{error}</div>}

              <button type="submit" style={{ ...s.btnPrimary, marginTop: 4 }}>
                Next →
              </button>
            </form>
          </>
        ) : (
          <>
            <button
              onClick={() => { setPage(1); setError(""); }}
              style={{ background: "none", border: "none", color: "var(--c-muted,#888)", fontFamily: "var(--font-manrope),sans-serif", fontSize: 13, cursor: "pointer", padding: "0 0 20px", display: "flex", alignItems: "center", gap: 4 }}
            >
              ← Back
            </button>
            <h1 style={s.heading}>Connect your wallet</h1>
            <p style={s.sub}>
              This EOA wallet receives nanopayments on Arc Testnet — fractions of a cent per read,
              settled instantly by Circle Gateway.
            </p>

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 28 }}>
              <label style={s.label}>
                Wallet address
                <input
                  style={s.input}
                  type="text"
                  placeholder="0x…"
                  value={wallet}
                  onChange={(e) => setWallet(e.target.value)}
                  spellCheck={false}
                  autoFocus
                />
                <span style={{ fontSize: 11, opacity: 0.4, marginTop: 4 }}>
                  Need one? Run{" "}
                  <code style={{ background: "rgba(255,255,255,0.06)", padding: "2px 5px", borderRadius: 4 }}>
                    npx tsx scripts/generate-wallets.mts
                  </code>{" "}
                  in the Cresc directory.
                </span>
              </label>

              <div style={{ padding: "14px 16px", background: "rgba(124,58,237,0.07)", border: "1px solid rgba(124,58,237,0.2)", borderRadius: 10 }}>
                <p style={{ ...s.sub, marginTop: 0, fontSize: 12 }}>
                  <strong style={{ color: "var(--c-text,#eee)" }}>Testnet only.</strong>{" "}
                  This wallet receives Arc Testnet USDC. Get free test USDC at{" "}
                  <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" style={{ color: "var(--c-accent,#7c3aed)" }}>
                    faucet.circle.com
                  </a>.
                  No real funds are ever at risk.
                </p>
              </div>

              {error && <div style={s.err}>{error}</div>}

              <button
                type="submit"
                style={{ ...s.btnPrimary, marginTop: 4 }}
                disabled={step === "submitting"}
              >
                {step === "submitting" ? "Creating account…" : "Create account →"}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

const s = {
  main: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", background: "var(--c-bg, #0d0d14)" } as React.CSSProperties,
  card: { background: "var(--c-surface, #13131f)", border: "1px solid var(--c-border, #23233a)", borderRadius: 18, padding: "40px 44px", maxWidth: 540, width: "100%" } as React.CSSProperties,
  heading: { fontFamily: "var(--font-sora), sans-serif", fontSize: 24, fontWeight: 700, color: "var(--c-text, #eee)", margin: 0 } as React.CSSProperties,
  sub: { fontFamily: "var(--font-manrope), sans-serif", fontSize: 14, color: "var(--c-muted, #888)", marginTop: 10, lineHeight: 1.6 } as React.CSSProperties,
  label: { fontFamily: "var(--font-manrope), sans-serif", fontSize: 13, fontWeight: 600, color: "var(--c-text, #eee)", display: "flex", flexDirection: "column" as const, gap: 6 } as React.CSSProperties,
  input: { background: "var(--c-surface-2, #1c1c2e)", border: "1px solid var(--c-border, #2e2e44)", borderRadius: 10, padding: "11px 14px", color: "var(--c-text, #eee)", fontFamily: "var(--font-manrope), sans-serif", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box" as const } as React.CSSProperties,
  btnPrimary: { background: "var(--c-accent, #7c3aed)", color: "#fff", border: "none", borderRadius: 10, padding: "13px 22px", fontFamily: "var(--font-manrope), sans-serif", fontWeight: 700, fontSize: 15, cursor: "pointer", boxShadow: "0 0 24px rgba(124,58,237,0.35)" } as React.CSSProperties,
  btnSecondary: { background: "transparent", color: "var(--c-muted, #888)", border: "1px solid var(--c-border, #333)", borderRadius: 10, padding: "13px 22px", fontFamily: "var(--font-manrope), sans-serif", fontWeight: 600, fontSize: 15, cursor: "pointer" } as React.CSSProperties,
  err: { color: "#ff5555", fontSize: 13, padding: "10px 14px", background: "rgba(255,60,60,0.07)", borderRadius: 8, border: "1px solid rgba(255,60,60,0.2)" } as React.CSSProperties,
} as const;
