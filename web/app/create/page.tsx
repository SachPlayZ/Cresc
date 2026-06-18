"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type Step = "form" | "submitting" | "done";

const WORD_ESTIMATE = (text: string) => Math.round(text.trim().split(/\s+/).filter(Boolean).length);

export default function CreatePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("form");
  const [creatorId, setCreatorId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
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
    if (body.trim().length < 100) { setError("Body must be at least 100 characters."); return; }
    setError("");
    setStep("submitting");

    const res = await fetch("/api/piece/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creator_id: creatorId, title: title.trim(), body: body.trim(), objective }),
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
      <main style={styles.main}>
        <div style={styles.card}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
          <h1 style={styles.heading}>Piece published</h1>
          <p style={styles.sub}>
            Starting price: <strong>$0.005</strong>. The PricingAgent will begin adjusting it once
            readers start engaging. Each decision will appear in your dashboard with full reasoning.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 24, flexWrap: "wrap" }}>
            <button style={styles.btnPrimary} onClick={() => router.push(`/piece/${pieceId}`)}>
              Preview reader view
            </button>
            <button style={styles.btnSecondary} onClick={() => { setStep("form"); setTitle(""); setBody(""); setPieceId(""); }}>
              Publish another
            </button>
            <button style={styles.btnSecondary} onClick={() => router.push(`/dashboard?creator=${creatorId}`)}>
              Dashboard
            </button>
          </div>
          <p style={{ ...styles.sub, marginTop: 20, fontSize: 11, opacity: 0.5 }}>Piece ID: {pieceId}</p>
        </div>
      </main>
    );
  }

  const wordCount = WORD_ESTIMATE(body);
  const readMin = Math.max(1, Math.round(wordCount / 200));

  return (
    <main style={styles.main}>
      <div style={{ ...styles.card, maxWidth: 640 }}>
        <h1 style={styles.heading}>Publish a piece</h1>
        <p style={styles.sub}>
          Write or paste your content. The AI pricing agent sets the opening rate at $0.005 and adjusts
          autonomously from there based on reader engagement.
        </p>

        <form onSubmit={handlePublish} style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 28 }}>
          <label style={styles.label}>
            Title
            <input
              style={styles.input}
              type="text"
              placeholder="What's this piece called?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={step === "submitting"}
              autoFocus
            />
          </label>

          <label style={styles.label}>
            Body
            <textarea
              style={{ ...styles.input, minHeight: 260, resize: "vertical", lineHeight: 1.65, fontFamily: "var(--font-manrope), sans-serif" }}
              placeholder="Write your piece here… (min 100 characters)"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={step === "submitting"}
            />
            {body.length > 0 && (
              <span style={{ fontSize: 11, opacity: 0.45, marginTop: 4 }}>
                {wordCount} words · ~{readMin} min read · {body.length} chars
              </span>
            )}
          </label>

          <div>
            <span style={{ ...styles.label, marginBottom: 10 }}>Objective</span>
            <div style={{ display: "flex", gap: 10 }}>
              {(["MAX_REACH", "MAX_REVENUE"] as const).map((obj) => (
                <button
                  key={obj}
                  type="button"
                  onClick={() => setObjective(obj)}
                  style={{
                    ...styles.objBtn,
                    ...(objective === obj ? styles.objBtnActive : {}),
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{obj === "MAX_REACH" ? "Max reach" : "Max revenue"}</span>
                  <span style={{ fontSize: 11, opacity: 0.6, marginTop: 3 }}>
                    {obj === "MAX_REACH" ? "Agent prices for widest audience" : "Agent prices for highest total earnings"}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div style={{ color: "#ff5555", fontSize: 13, padding: "10px 14px", background: "rgba(255,60,60,0.07)", borderRadius: 8, border: "1px solid rgba(255,60,60,0.2)" }}>
              {error}
            </div>
          )}

          <button type="submit" style={{ ...styles.btnPrimary, marginTop: 4 }} disabled={step === "submitting"}>
            {step === "submitting" ? "Publishing…" : "Publish →"}
          </button>
        </form>
      </div>
    </main>
  );
}

const styles = {
  main: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", background: "var(--c-bg, #0d0d14)" } as React.CSSProperties,
  card: { background: "var(--c-surface, #13131f)", border: "1px solid var(--c-border, #23233a)", borderRadius: 18, padding: "40px 44px", width: "100%" } as React.CSSProperties,
  heading: { fontFamily: "var(--font-sora), sans-serif", fontSize: 26, fontWeight: 700, color: "var(--c-text, #eee)", margin: 0 } as React.CSSProperties,
  sub: { fontFamily: "var(--font-manrope), sans-serif", fontSize: 14, color: "var(--c-muted, #888)", marginTop: 10, lineHeight: 1.6 } as React.CSSProperties,
  label: { display: "flex", flexDirection: "column" as const, gap: 6, fontFamily: "var(--font-manrope), sans-serif", fontSize: 13, fontWeight: 600, color: "var(--c-text, #eee)" } as React.CSSProperties,
  input: { background: "var(--c-surface-2, #1c1c2e)", border: "1px solid var(--c-border, #2e2e44)", borderRadius: 10, padding: "11px 14px", color: "var(--c-text, #eee)", fontFamily: "var(--font-manrope), sans-serif", fontSize: 14, outline: "none" } as React.CSSProperties,
  objBtn: { flex: 1, display: "flex", flexDirection: "column" as const, gap: 2, textAlign: "left" as const, padding: "14px 16px", borderRadius: 10, border: "1px solid var(--c-border, #2e2e44)", background: "transparent", color: "var(--c-muted, #888)", cursor: "pointer" } as React.CSSProperties,
  objBtnActive: { border: "1px solid var(--c-accent, #7c3aed)", background: "rgba(124,58,237,0.1)", color: "var(--c-text, #eee)" } as React.CSSProperties,
  btnPrimary: { background: "var(--c-accent, #7c3aed)", color: "#fff", border: "none", borderRadius: 10, padding: "13px 22px", fontFamily: "var(--font-manrope), sans-serif", fontWeight: 700, fontSize: 15, cursor: "pointer", boxShadow: "0 0 24px rgba(124,58,237,0.35)" } as React.CSSProperties,
  btnSecondary: { background: "transparent", color: "var(--c-muted, #888)", border: "1px solid var(--c-border, #333)", borderRadius: 10, padding: "13px 22px", fontFamily: "var(--font-manrope), sans-serif", fontWeight: 600, fontSize: 15, cursor: "pointer" } as React.CSSProperties,
} as const;
