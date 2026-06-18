"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Button } from "@/components/ui/button";
import { fromBaseUnits, toDisplay } from "../lib/money";
import {
  FileText,
  Video,
  ArrowRight,
  Sun,
  Moon,
  ArrowLeft,
  Copy,
  Globe,
  Award,
  BookOpen
} from "lucide-react";
import type { Creator, Piece } from "../lib/repo/types";

interface CreatorProfileClientProps {
  creator: Creator & { bio?: string; content_types?: string[]; platforms?: string[] };
  pieces: Piece[];
}

export default function CreatorProfileClient({ creator, pieces }: CreatorProfileClientProps) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [copied, setCopied] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"all" | "article" | "video">("all");

  // Sync theme
  useEffect(() => {
    try {
      const saved = localStorage.getItem("cresc-theme") as "dark" | "light";
      if (saved === "dark" || saved === "light") {
        setTheme(saved);
        document.documentElement.setAttribute("data-theme", saved);
      }
    } catch {}
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem("cresc-theme", next);
      document.documentElement.setAttribute("data-theme", next);
    } catch {}
  };

  const copyAddress = async () => {
    if (!creator.wallet_address) return;
    await navigator.clipboard.writeText(creator.wallet_address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const abbreviateAddress = (addr: string) => {
    if (!addr) return "";
    return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
  };

  const formatPrice = (priceBaseUnits: string) => {
    try {
      const amount = fromBaseUnits(BigInt(priceBaseUnits), 6);
      return toDisplay(amount);
    } catch {
      return `$${(parseFloat(priceBaseUnits) / 1000000).toFixed(4)}`;
    }
  };

  const filteredPieces = pieces.filter((piece) => {
    if (typeFilter !== "all" && piece.kind !== typeFilter) return false;
    return true;
  });

  const getPlatformIcon = (platform: string) => {
    const p = platform.toLowerCase();
    if (p.includes("substack") || p.includes("medium")) return <FileText size={14} />;
    if (p.includes("youtube") || p.includes("twitch") || p.includes("tiktok")) return <Video size={14} />;
    return <Globe size={14} />;
  };

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
      {/* Background glow radial gradients */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "radial-gradient(ellipse 60% 50% at 18% 30%, var(--c-glow), transparent 60%), radial-gradient(ellipse 40% 40% at 92% 70%, var(--c-glow), transparent 60%)",
          pointerEvents: "none",
        }}
      />

      {/* Nav */}
      <nav
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 40px",
          background: "color-mix(in srgb, var(--c-bg) 78%, transparent)",
          backdropFilter: "saturate(140%) blur(14px)",
          borderBottom: "1px solid var(--c-border-soft)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <Link
            href="/"
            style={{
              fontFamily: "var(--font-sora), sans-serif",
              fontWeight: 700,
              fontSize: 19,
              letterSpacing: "-0.03em",
              display: "flex",
              alignItems: "center",
              gap: 9,
              textDecoration: "none",
              color: "var(--c-text)",
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
          </Link>
          <Link
            href="/browse"
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--c-muted)",
              textDecoration: "none",
            }}
            className="cresc-nav-link"
          >
            Browse Catalog
          </Link>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
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
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
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
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {theme === "light" ? (
                <Sun size={11} color="var(--c-accent-ink)" />
              ) : (
                <Moon size={11} color="var(--c-accent-ink)" />
              )}
            </span>
          </button>
          <ConnectButton />
          <Link href="/history">
            <Button size="sm" variant="outline" className="rounded-full text-xs font-semibold px-4">
              My History
            </Button>
          </Link>
        </div>
      </nav>

      {/* Profile Main Body */}
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "48px 40px 100px", position: "relative", zIndex: 1 }}>
        <Link
          href="/browse"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            color: "var(--c-muted)",
            textDecoration: "none",
            marginBottom: 28,
            transition: "color 0.2s ease",
          }}
          className="cresc-nav-link"
        >
          <ArrowLeft size={16} /> Back to Catalog
        </Link>

        {/* Creator Hero Banner Card */}
        <div
          style={{
            background: "var(--c-surface)",
            border: "1px solid var(--c-border)",
            borderRadius: 20,
            padding: "36px 36px 32px",
            marginBottom: 44,
            boxShadow: "var(--c-shadow)",
            display: "flex",
            flexDirection: "column",
            gap: 24,
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Top banner visual accent strip */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 4,
              background: "linear-gradient(90deg, var(--c-violet), var(--c-accent))",
            }}
          />

          <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "start" }}>
            {/* Address-derived Avatar */}
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: 16,
                background: "linear-gradient(135deg, var(--c-violet) 0%, var(--c-accent) 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "var(--c-shadow-sm)",
                flexShrink: 0,
              }}
            >
              <Award size={36} color="var(--c-accent-ink)" />
            </div>

            {/* Info details */}
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 12 }}>
                <h1
                  style={{
                    margin: 0,
                    fontFamily: "var(--font-sora), sans-serif",
                    fontSize: 28,
                    fontWeight: 700,
                  }}
                >
                  {creator.display_name}
                </h1>

                {creator.wallet_address && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <code
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        color: "var(--c-muted)",
                        background: "var(--c-bg-soft)",
                        padding: "3px 8px",
                        borderRadius: 6,
                        border: "1px solid var(--c-border-soft)",
                      }}
                    >
                      {abbreviateAddress(creator.wallet_address)}
                    </code>
                    <button
                      onClick={copyAddress}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: 0,
                        display: "flex",
                        color: copied ? "var(--c-green)" : "var(--c-dim)",
                      }}
                      title="Copy Address"
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                )}
              </div>

              {/* Bio */}
              <p style={{ margin: "12px 0 0 0", color: "var(--c-muted)", fontSize: 15, lineHeight: 1.6 }}>
                {creator.bio || "Premium content creator utilizing dynamic AI pricing on the Cresc network."}
              </p>
            </div>
          </div>

          {/* Social Badges and Specialties row */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 16,
              alignItems: "center",
              paddingTop: 20,
              borderTop: "1px solid var(--c-border-soft)",
            }}
          >
            {/* Specialty Pills */}
            {creator.content_types && creator.content_types.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {creator.content_types.map((type) => (
                  <span
                    key={type}
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      color: "var(--c-violet)",
                      background: "rgba(155,134,255,0.08)",
                      border: "1px solid rgba(155,134,255,0.15)",
                      padding: "2px 8px",
                      borderRadius: 6,
                    }}
                  >
                    {type}
                  </span>
                ))}
              </div>
            )}

            {/* Social Platform Badges */}
            {creator.platforms && creator.platforms.length > 0 && (
              <div style={{ display: "flex", gap: 8, marginLeft: creator.content_types ? "auto" : 0 }}>
                {creator.platforms.map((plat) => (
                  <a
                    key={plat}
                    href={plat.includes("://") ? plat : `https://${plat}.com`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      color: "var(--c-muted)",
                      background: "var(--c-surface-2)",
                      border: "1px solid var(--c-border-soft)",
                      padding: "4px 10px",
                      borderRadius: 8,
                      textDecoration: "none",
                      transition: "all 0.2s ease",
                    }}
                    className="cresc-btn-secondary"
                  >
                    {getPlatformIcon(plat)}
                    <span style={{ textTransform: "capitalize" }}>{plat.split(".")[0]}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Section header + Filter tabs */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 16,
            marginBottom: 28,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontFamily: "var(--font-sora), sans-serif",
              fontSize: 22,
              fontWeight: 700,
            }}
          >
            Creations ({pieces.length})
          </h2>

          <div
            style={{
              display: "flex",
              background: "var(--c-surface)",
              border: "1px solid var(--c-border)",
              borderRadius: 10,
              padding: 3,
            }}
          >
            {(["all", "article", "video"] as const).map((type) => {
              const active = typeFilter === type;
              return (
                <button
                  key={type}
                  onClick={() => setTypeFilter(type)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    background: active ? "var(--c-surface-2)" : "transparent",
                    border: "none",
                    color: active ? "var(--c-text)" : "var(--c-muted)",
                    textTransform: "capitalize",
                    transition: "all 0.2s ease",
                  }}
                >
                  {type === "all" ? "All content" : `${type}s`}
                </button>
              );
            })}
          </div>
        </div>

        {/* Grid of Pieces */}
        {filteredPieces.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "54px 20px",
              border: "1px dashed var(--c-border)",
              borderRadius: 16,
              background: "rgba(255,255,255,0.01)",
            }}
          >
            <span style={{ fontSize: 24 }}>📁</span>
            <p style={{ color: "var(--c-muted)", fontSize: 14, margin: "10px 0 0 0" }}>
              No active creations listed in this category.
            </p>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: 24,
            }}
          >
            {filteredPieces.map((piece) => (
              <PieceItemCard key={piece.id} piece={piece} formatPrice={formatPrice} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function PieceItemCard({ piece, formatPrice }: { piece: Piece; formatPrice: (p: string) => string }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? "var(--c-surface-hi)" : "var(--c-surface)",
        border: `1px solid ${hovered ? "var(--c-violet)" : "var(--c-border)"}`,
        borderRadius: 16,
        padding: 24,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        height: 200,
        boxShadow: hovered ? "0 10px 24px rgba(0,0,0,0.25)" : "var(--c-shadow-sm)",
        transform: hovered ? "translateY(-4px)" : "translateY(0)",
        transition: "all 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: piece.kind === "video" ? "var(--c-accent)" : "var(--c-violet)",
          opacity: hovered ? 1 : 0.6,
        }}
      />

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: piece.kind === "video" ? "var(--c-accent)" : "var(--c-violet)",
            }}
          >
            {piece.kind === "video" ? <Video size={12} /> : <BookOpen size={12} />}
            {piece.kind}
          </div>
          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--c-accent)",
              background: "var(--c-bg-soft)",
              padding: "3px 7px",
              borderRadius: 6,
              border: "1px solid var(--c-border-soft)",
            }}
          >
            {formatPrice(piece.current_price)}
          </span>
        </div>

        <h3
          style={{
            fontFamily: "var(--font-sora), sans-serif",
            fontSize: 17,
            fontWeight: 700,
            lineHeight: 1.3,
            color: "var(--c-text)",
            margin: 0,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {piece.title}
        </h3>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingTop: 12,
          borderTop: "1px solid var(--c-border-soft)",
        }}
      >
        <span style={{ fontSize: 11, color: "var(--c-dim)" }}>
          {piece.kind === "article" ? `${piece.length_chars || 0} characters` : "unlocked stream"}
        </span>

        <Link
          href={`/piece/${piece.id}`}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: hovered ? "var(--c-violet)" : "var(--c-surface-2)",
            color: hovered ? "#fff" : "var(--c-text)",
            transition: "all 0.2s ease",
            textDecoration: "none",
          }}
        >
          <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}
