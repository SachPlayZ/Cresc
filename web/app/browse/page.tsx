"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { fromBaseUnits, toDisplay } from "../../lib/money";
import {
  Search,
  X,
  ChevronLeft,
  Video,
  FileText,
  Filter,
  ArrowRight,
  Sun,
  Moon
} from "lucide-react";

interface PieceItem {
  id: string;
  title: string;
  current_price: string;
  kind: "article" | "video";
  topic_tags: string[];
  created_at: string;
  creators: {
    display_name: string;
    wallet_address: string;
  };
}

function BrowseContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialCreator = searchParams.get("creator");

  const [pieces, setPieces] = useState<PieceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "article" | "video">("all");
  const [creatorFilter, setCreatorFilter] = useState<string | null>(initialCreator);

  // Sync theme with local storage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("cresc-theme") as "dark" | "light";
      if (saved === "dark" || saved === "light") {
        setTheme(saved);
        document.documentElement.setAttribute("data-theme", saved);
      }
    } catch {}
  }, []);

  // Fetch listed pieces
  useEffect(() => {
    async function fetchPieces() {
      try {
        const res = await fetch("/api/piece/list");
        if (res.ok) {
          const data = await res.json();
          setPieces(data);
        }
      } catch (err) {
        console.error("Failed to load catalog pieces", err);
      } finally {
        setLoading(false);
      }
    }
    fetchPieces();
  }, []);

  // Sync state if URL query param changes
  useEffect(() => {
    if (initialCreator) {
      setCreatorFilter(initialCreator);
    }
  }, [initialCreator]);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem("cresc-theme", next);
      document.documentElement.setAttribute("data-theme", next);
    } catch {}
  };

  const handleClearCreatorFilter = () => {
    setCreatorFilter(null);
    // Remove query param from URL
    const params = new URLSearchParams(window.location.search);
    params.delete("creator");
    router.replace(`/browse?${params.toString()}`);
  };

  const handleSelectCreator = (wallet: string) => {
    setCreatorFilter(wallet);
    const params = new URLSearchParams(window.location.search);
    params.set("creator", wallet);
    router.replace(`/browse?${params.toString()}`);
  };

  // Filtering logic
  const filteredPieces = pieces.filter((piece) => {
    // Type filter
    if (typeFilter !== "all" && piece.kind !== typeFilter) return false;

    // Creator wallet filter
    if (creatorFilter && piece.creators?.wallet_address.toLowerCase() !== creatorFilter.toLowerCase()) {
      return false;
    }

    // Search filter (title, tag, or creator name)
    if (search.trim()) {
      const term = search.toLowerCase();
      const titleMatches = piece.title.toLowerCase().includes(term);
      const tagMatches = piece.topic_tags?.some((t) => t.toLowerCase().includes(term));
      const creatorMatches = piece.creators?.display_name.toLowerCase().includes(term);
      return titleMatches || tagMatches || creatorMatches;
    }

    return true;
  });

  const abbreviateAddress = (addr: string) => {
    if (!addr) return "";
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const formatPrice = (priceBaseUnits: string) => {
    try {
      const amount = fromBaseUnits(BigInt(priceBaseUnits), 6);
      return toDisplay(amount);
    } catch {
      return `$${(parseFloat(priceBaseUnits) / 1000000).toFixed(4)}`;
    }
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
        </div>
      </nav>

      {/* Main Browse Section */}
      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "48px 40px 100px", position: "relative", zIndex: 1 }}>
        {/* Header Block */}
        <div style={{ marginBottom: 40 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--c-violet)",
              background: "var(--c-surface-2)",
              border: "1px solid var(--c-border)",
              padding: "6px 12px",
              borderRadius: 999,
              marginBottom: 16,
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "var(--c-accent)",
                boxShadow: "0 0 6px var(--c-accent)",
              }}
            />
            explore the catalogue
          </div>

          <h1
            style={{
              fontFamily: "var(--font-sora), sans-serif",
              fontWeight: 700,
              fontSize: 42,
              lineHeight: 1.15,
              letterSpacing: "-0.03em",
              margin: 0,
            }}
          >
            Listed Creations
          </h1>
          <p style={{ fontSize: 16, color: "var(--c-muted)", marginTop: 10, maxWidth: 640 }}>
            Browse content carrying live, AI-adjusted prices backed by the x402 payment protocol.
            Unlock instantly with gasless sub-cent transactions.
          </p>
        </div>

        {/* Toolbar (Search + Filters) */}
        <div
          style={{
            background: "var(--c-surface)",
            border: "1px solid var(--c-border)",
            borderRadius: 16,
            padding: 20,
            marginBottom: 32,
            boxShadow: "var(--c-shadow-sm)",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
            {/* Search Input */}
            <div style={{ position: "relative", flex: 1, minWidth: 260 }}>
              <Search
                size={18}
                style={{
                  position: "absolute",
                  left: 14,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--c-dim)",
                }}
              />
              <input
                type="text"
                placeholder="Search title, tag, or creator..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px 10px 42px",
                  borderRadius: 10,
                  background: "var(--c-bg-soft)",
                  border: "1px solid var(--c-border)",
                  color: "var(--c-text)",
                  fontSize: 14,
                  outline: "none",
                }}
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  style={{
                    position: "absolute",
                    right: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--c-dim)",
                  }}
                >
                  <X size={16} />
                </button>
              )}
            </div>

            {/* Type tabs filter */}
            <div
              style={{
                display: "flex",
                background: "var(--c-bg-soft)",
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
                      padding: "8px 16px",
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      background: active ? "var(--c-surface-hi)" : "transparent",
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

          {/* Active filter badges */}
          {(creatorFilter || search || typeFilter !== "all") && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                paddingTop: 12,
                borderTop: "1px solid var(--c-border-soft)",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: 12, color: "var(--c-dim)", display: "flex", alignItems: "center", gap: 4 }}>
                <Filter size={12} /> Active filters:
              </span>

              {creatorFilter && (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    background: "rgba(155,134,255,0.15)",
                    border: "1px solid rgba(155,134,255,0.3)",
                    padding: "4px 10px",
                    borderRadius: 6,
                    fontSize: 12,
                    color: "var(--c-violet)",
                  }}
                >
                  <span>Creator: {abbreviateAddress(creatorFilter)}</span>
                  <button
                    onClick={handleClearCreatorFilter}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", color: "var(--c-violet)" }}
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              {typeFilter !== "all" && (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    background: "rgba(198,248,78,0.15)",
                    border: "1px solid rgba(198,248,78,0.3)",
                    padding: "4px 10px",
                    borderRadius: 6,
                    fontSize: 12,
                    color: "var(--c-accent)",
                  }}
                >
                  <span>Type: {typeFilter}</span>
                  <button
                    onClick={() => setTypeFilter("all")}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", color: "var(--c-accent)" }}
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              {search && (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid var(--c-border)",
                    padding: "4px 10px",
                    borderRadius: 6,
                    fontSize: 12,
                    color: "var(--c-text)",
                  }}
                >
                  <span>Search: "{search}"</span>
                  <button
                    onClick={() => setSearch("")}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", color: "var(--c-text)" }}
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              <button
                onClick={() => {
                  setSearch("");
                  setTypeFilter("all");
                  handleClearCreatorFilter();
                }}
                style={{
                  fontSize: 12,
                  color: "var(--c-muted)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  textDecoration: "underline",
                  padding: 0,
                  marginLeft: "auto",
                }}
              >
                Clear all
              </button>
            </div>
          )}
        </div>

        {/* Content list */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "80px 0" }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                border: "3px solid var(--c-border)",
                borderTopColor: "var(--c-violet)",
                animation: "spin 0.8s linear infinite",
                margin: "0 auto 16px",
              }}
            />
            <p style={{ color: "var(--c-muted)", fontSize: 14 }}>Loading listed items…</p>
            <style jsx global>{`
              @keyframes spin {
                to { transform: rotate(360deg); }
              }
            `}</style>
          </div>
        ) : filteredPieces.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "64px 20px",
              border: "1px dashed var(--c-border)",
              borderRadius: 16,
              background: "rgba(255,255,255,0.01)",
            }}
          >
            <span style={{ fontSize: 32 }}>🔍</span>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginTop: 12 }}>No creations found</h3>
            <p style={{ color: "var(--c-muted)", fontSize: 14, marginTop: 6, maxWidth: 380, margin: "6px auto 20px" }}>
              We couldn't find any items matching your filters. Try checking a different category or clearing active filters.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearch("");
                setTypeFilter("all");
                handleClearCreatorFilter();
              }}
            >
              Reset Filters
            </Button>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: 24,
            }}
          >
            {filteredPieces.map((piece) => (
              <PieceCard
                key={piece.id}
                piece={piece}
                onSelectCreator={handleSelectCreator}
                formatPrice={formatPrice}
                abbreviateAddress={abbreviateAddress}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function PieceCard({
  piece,
  onSelectCreator,
  formatPrice,
  abbreviateAddress,
}: {
  piece: PieceItem;
  onSelectCreator: (wallet: string) => void;
  formatPrice: (p: string) => string;
  abbreviateAddress: (w: string) => string;
}) {
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
        height: 250,
        boxShadow: hovered ? "0 12px 30px rgba(0,0,0,0.3)" : "var(--c-shadow-sm)",
        transform: hovered ? "translateY(-4px)" : "translateY(0)",
        transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Decorative top stripe */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: piece.kind === "video" ? "var(--c-accent)" : "var(--c-violet)",
          opacity: hovered ? 1 : 0.6,
          transition: "opacity 0.25s ease",
        }}
      />

      {/* Top row: Medium and Tags */}
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
            {piece.kind === "video" ? <Video size={12} /> : <FileText size={12} />}
            {piece.kind === "video" ? "video" : "article"}
          </div>

          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--c-accent)",
              background: "var(--c-bg-soft)",
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid var(--c-border-soft)",
            }}
          >
            {formatPrice(piece.current_price)}
          </span>
        </div>

        {/* Title */}
        <h3
          style={{
            fontFamily: "var(--font-sora), sans-serif",
            fontSize: 18,
            fontWeight: 700,
            lineHeight: 1.3,
            color: "var(--c-text)",
            margin: "0 0 10px 0",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {piece.title}
        </h3>

        {/* Tags */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
          {piece.topic_tags?.slice(0, 3).map((tag) => (
            <span
              key={tag}
              style={{
                fontSize: 11,
                color: "var(--c-muted)",
                background: "var(--c-surface-2)",
                padding: "2px 8px",
                borderRadius: 4,
                border: "1px solid var(--c-border-soft)",
              }}
            >
              #{tag}
            </span>
          ))}
        </div>
      </div>

      {/* Bottom row: Creator and Action Button */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingTop: 12,
          borderTop: "1px solid var(--c-border-soft)",
        }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (piece.creators?.wallet_address) {
              onSelectCreator(piece.creators.wallet_address);
            }
          }}
          title={`Filter by ${piece.creators?.display_name || "creator"}`}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            textAlign: "left",
            display: "flex",
            flexDirection: "column",
            gap: 2,
            outline: "none",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--c-text)" }}>
            {piece.creators?.display_name || "Unknown Creator"}
          </span>
          <span style={{ fontSize: 11, color: "var(--c-dim)" }}>
            {piece.creators?.wallet_address ? abbreviateAddress(piece.creators.wallet_address) : ""}
          </span>
        </button>

        <Link
          href={`/piece/${piece.id}`}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: hovered ? "var(--c-violet)" : "var(--c-surface-2)",
            color: hovered ? "#fff" : "var(--c-text)",
            transition: "all 0.2s ease",
            textDecoration: "none",
          }}
        >
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
}

function BrowseFallback() {
  return (
    <div style={{ background: "#15101F", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
      <p>Loading browse catalogue…</p>
    </div>
  );
}

export default function BrowsePage() {
  return (
    <Suspense fallback={<BrowseFallback />}>
      <BrowseContent />
    </Suspense>
  );
}
