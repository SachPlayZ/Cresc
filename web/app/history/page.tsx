"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Button } from "@/components/ui/button";
import {
  Wallet,
  Copy,
  Plus,
  FileText,
  Video,
  ExternalLink,
  History,
  Sparkles,
  ArrowLeft,
  Sun,
  Moon,
  ArrowUpRight,
  BookOpen
} from "lucide-react";

interface UnlockItem {
  id: string;
  amount: string;
  created_at: string;
  tx_ref: string;
  arc_explorer_url: string;
  pieces: {
    id: string;
    title: string;
    kind: "article" | "video";
  };
}

interface TipItem {
  id: string;
  amount: string;
  created_at: string;
  tx_ref: string;
  arc_explorer_url: string;
  pieces: {
    id: string;
    title: string;
    kind: "article" | "video";
  };
}

interface HistoryData {
  address: string;
  spendable: string;
  deposited: string;
  spent: string;
  unlocks: UnlockItem[];
  tips: TipItem[];
}

export default function HistoryPage() {
  const router = useRouter();
  const [data, setData] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"unlocks" | "tips">("unlocks");

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

  // Fetch history data
  useEffect(() => {
    async function fetchHistory() {
      try {
        const res = await fetch("/api/reader/history");
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch (err) {
        console.error("Failed to load reader history", err);
      } finally {
        setLoading(false);
      }
    }
    fetchHistory();
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
    if (!data?.address) return;
    await navigator.clipboard.writeText(data.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const abbreviateAddress = (addr: string) => {
    if (!addr) return "";
    return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
  };

  const formatPrice = (priceBaseUnits: string) => {
    const parsed = parseFloat(priceBaseUnits);
    if (isNaN(parsed)) return "$0.0000";
    return `$${(parsed / 1000000).toFixed(4)}`;
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const USDC_ARC = "0x3600000000000000000000000000000000000000";
  const SUGGESTED_AMOUNT_BASE = 100_000; // $0.10 Suggested
  const metaMaskUri = data?.address
    ? `ethereum:${USDC_ARC}/transfer?address=${data.address}&uint256=${SUGGESTED_AMOUNT_BASE}`
    : "#";

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
            <img
              src="/cresc-logo-transparent.png"
              alt="Cresc Logo"
              style={{
                width: 20,
                height: 20,
                objectFit: "contain",
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
              display: "flex",
              alignItems: "center",
              gap: 6,
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
        </div>
      </nav>

      {/* Main Container */}
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 40px 100px", position: "relative", zIndex: 1 }}>
        {/* Back Link */}
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

        {/* Dashboard Title */}
        <div style={{ marginBottom: 36 }}>
          <h1
            style={{
              fontFamily: "var(--font-sora), sans-serif",
              fontWeight: 700,
              fontSize: 38,
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
              margin: 0,
            }}
          >
            Reader Hub & Wallet
          </h1>
          <p style={{ fontSize: 15, color: "var(--c-muted)", marginTop: 8 }}>
            Manage your autonomous reading wallet, top up funds, and browse your archive of paid unlocks.
          </p>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "100px 0" }}>
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
            <p style={{ color: "var(--c-muted)", fontSize: 14 }}>Syncing reading profile data…</p>
          </div>
        ) : !data ? (
          <div
            style={{
              textAlign: "center",
              padding: "64px 20px",
              border: "1px dashed var(--c-border)",
              borderRadius: 16,
              background: "rgba(255,255,255,0.01)",
            }}
          >
            <span style={{ fontSize: 32 }}>⚠️</span>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginTop: 12 }}>No session found</h3>
            <p style={{ color: "var(--c-muted)", fontSize: 14, marginTop: 6, maxWidth: 380, margin: "6px auto 20px" }}>
              To view history, you must unlock at least one piece of content first. This establishes your local session key.
            </p>
            <Button variant="outline" onClick={() => router.push("/browse")}>
              Go to Catalog
            </Button>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.1fr 0.9fr",
              gap: 36,
              alignItems: "start",
            }}
          >
            {/* Left Column: Transaction Lists */}
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {/* Tab Selector */}
              <div
                style={{
                  display: "flex",
                  borderBottom: "1px solid var(--c-border-soft)",
                  gap: 24,
                  paddingBottom: 2,
                }}
              >
                <button
                  onClick={() => setActiveTab("unlocks")}
                  style={{
                    paddingBottom: 12,
                    fontSize: 15,
                    fontWeight: 700,
                    cursor: "pointer",
                    background: "none",
                    border: "none",
                    borderBottom: `2px solid ${activeTab === "unlocks" ? "var(--c-violet)" : "transparent"}`,
                    color: activeTab === "unlocks" ? "var(--c-text)" : "var(--c-muted)",
                    transition: "all 0.2s ease",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <BookOpen size={16} /> Unlocked Content ({data.unlocks?.length || 0})
                </button>
                <button
                  onClick={() => setActiveTab("tips")}
                  style={{
                    paddingBottom: 12,
                    fontSize: 15,
                    fontWeight: 700,
                    cursor: "pointer",
                    background: "none",
                    border: "none",
                    borderBottom: `2px solid ${activeTab === "tips" ? "var(--c-violet)" : "transparent"}`,
                    color: activeTab === "tips" ? "var(--c-text)" : "var(--c-muted)",
                    transition: "all 0.2s ease",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Sparkles size={16} /> Sent Tips ({data.tips?.length || 0})
                </button>
              </div>

              {/* Unlocks Tab Panel */}
              {activeTab === "unlocks" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {data.unlocks.length === 0 ? (
                    <div
                      style={{
                        padding: "48px 24px",
                        textAlign: "center",
                        border: "1px dashed var(--c-border)",
                        borderRadius: 12,
                        color: "var(--c-muted)",
                      }}
                    >
                      <FileText size={28} style={{ margin: "0 auto 12px", opacity: 0.5 }} />
                      <p style={{ margin: 0, fontSize: 14 }}>You haven't unlocked any content yet.</p>
                    </div>
                  ) : (
                    data.unlocks.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          background: "var(--c-surface)",
                          border: "1px solid var(--c-border)",
                          borderRadius: 12,
                          padding: 20,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          boxShadow: "var(--c-shadow-sm)",
                          transition: "border-color 0.2s ease",
                        }}
                      >
                        <div style={{ display: "flex", gap: 14, alignItems: "start", flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 8,
                              background: "var(--c-surface-2)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: item.pieces?.kind === "video" ? "var(--c-accent)" : "var(--c-violet)",
                              flexShrink: 0,
                            }}
                          >
                            {item.pieces?.kind === "video" ? <Video size={16} /> : <FileText size={16} />}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <h4
                              style={{
                                margin: 0,
                                fontSize: 15,
                                fontWeight: 700,
                                color: "var(--c-text)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {item.pieces?.title || "Mock Article"}
                            </h4>
                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 12,
                                fontSize: 12,
                                color: "var(--c-dim)",
                                marginTop: 4,
                              }}
                            >
                              <span>Unlocked {formatDate(item.created_at)}</span>
                              {item.tx_ref && (
                                <a
                                  href={item.arc_explorer_url || "#"}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    color: "var(--c-violet)",
                                    textDecoration: "none",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 3,
                                  }}
                                >
                                  Tx ↗
                                </a>
                              )}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 16, marginLeft: 16 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--c-accent)", fontFamily: "var(--font-jetbrains), monospace" }}>
                            {formatPrice(item.amount)}
                          </span>
                          <Link href={`/piece/${item.pieces?.id}`}>
                            <Button size="sm" variant="outline" className="text-xs h-8">
                              View
                            </Button>
                          </Link>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Tips Tab Panel */}
              {activeTab === "tips" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {data.tips.length === 0 ? (
                    <div
                      style={{
                        padding: "48px 24px",
                        textAlign: "center",
                        border: "1px dashed var(--c-border)",
                        borderRadius: 12,
                        color: "var(--c-muted)",
                      }}
                    >
                      <Sparkles size={28} style={{ margin: "0 auto 12px", opacity: 0.5 }} />
                      <p style={{ margin: 0, fontSize: 14 }}>No tips sent yet. Help creators trigger upward price sweeps!</p>
                    </div>
                  ) : (
                    data.tips.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          background: "var(--c-surface)",
                          border: "1px solid var(--c-border)",
                          borderRadius: 12,
                          padding: 20,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          boxShadow: "var(--c-shadow-sm)",
                        }}
                      >
                        <div style={{ display: "flex", gap: 14, alignItems: "start", flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 8,
                              background: "rgba(198,248,78,0.1)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "var(--c-accent)",
                              flexShrink: 0,
                            }}
                          >
                            <Sparkles size={16} />
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <h4
                              style={{
                                margin: 0,
                                fontSize: 15,
                                fontWeight: 700,
                                color: "var(--c-text)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              Tip for: {item.pieces?.title || "Mock Piece"}
                            </h4>
                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 12,
                                fontSize: 12,
                                color: "var(--c-dim)",
                                marginTop: 4,
                              }}
                            >
                              <span>Sent {formatDate(item.created_at)}</span>
                              <a
                                href={item.arc_explorer_url || "#"}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  color: "var(--c-violet)",
                                  textDecoration: "none",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 3,
                                }}
                              >
                                Tx ↗
                              </a>
                            </div>
                          </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 16, marginLeft: 16 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--c-accent)", fontFamily: "var(--font-jetbrains), monospace" }}>
                            +{formatPrice(item.amount)}
                          </span>
                          <span
                            style={{
                              fontSize: 10,
                              textTransform: "uppercase",
                              background: "var(--c-bg-soft)",
                              border: "1px solid var(--c-border-soft)",
                              padding: "3px 7px",
                              borderRadius: 6,
                              color: "var(--c-muted)",
                            }}
                          >
                            Feedback Loop
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Right Column: Wallet Info & Top-Up */}
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {/* Wallet Info Card */}
              <div
                style={{
                  background: "var(--c-surface)",
                  border: "1px solid var(--c-border)",
                  borderRadius: 16,
                  padding: 24,
                  boxShadow: "var(--c-shadow)",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                {/* Accent border top */}
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 4,
                    background: "var(--c-violet)",
                  }}
                />

                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                  <Wallet size={20} style={{ color: "var(--c-violet)" }} />
                  <span style={{ fontWeight: 700, fontSize: 16 }}>Autonomous Reading Wallet</span>
                </div>

                {/* EOA address slot */}
                <div
                  style={{
                    background: "var(--c-bg-soft)",
                    border: "1px solid var(--c-border-soft)",
                    borderRadius: 10,
                    padding: "12px 16px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 24,
                  }}
                >
                  <code style={{ fontSize: 13, color: "var(--c-text)", fontFamily: "var(--font-mono)" }}>
                    {abbreviateAddress(data.address)}
                  </code>
                  <button
                    onClick={copyAddress}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                      display: "flex",
                      color: copied ? "var(--c-green)" : "var(--c-muted)",
                      transition: "color 0.2s ease",
                    }}
                  >
                    <Copy size={16} />
                  </button>
                </div>

                {/* Balances */}
                <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 28 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontSize: 14, color: "var(--c-muted)" }}>Spendable Balance</span>
                    <span
                      style={{
                        fontSize: 24,
                        fontWeight: 700,
                        color: "var(--c-accent)",
                        fontFamily: "var(--font-jetbrains), monospace",
                      }}
                    >
                      ${parseFloat(data.spendable).toFixed(4)} <span style={{ fontSize: 12, fontWeight: 500, color: "var(--c-muted)" }}>USDC</span>
                    </span>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--c-border-soft)", paddingTop: 12 }}>
                    <span style={{ fontSize: 13, color: "var(--c-dim)" }}>Total Deposited</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--c-text)", fontFamily: "var(--font-jetbrains)" }}>
                      ${parseFloat(data.deposited).toFixed(4)}
                    </span>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 13, color: "var(--c-dim)" }}>Total Spent</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--c-text)", fontFamily: "var(--font-jetbrains)" }}>
                      ${parseFloat(data.spent).toFixed(4)}
                    </span>
                  </div>
                </div>

                {/* Top Up Block */}
                <div
                  style={{
                    background: "rgba(155,134,255,0.06)",
                    border: "1px solid rgba(155,134,255,0.15)",
                    borderRadius: 12,
                    padding: 16,
                  }}
                >
                  <h4 style={{ margin: "0 0 6px 0", fontSize: 13, fontWeight: 700, color: "var(--c-violet)" }}>
                    Top Up Instructions
                  </h4>
                  <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--c-muted)", marginBottom: 12 }}>
                    Get free Arc Testnet USDC from the{" "}
                    <a
                      href="https://faucet.circle.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--c-accent)", fontWeight: 600, textDecoration: "underline" }}
                    >
                      Circle Faucet
                    </a>{" "}
                    and send it to your EOA address above.
                  </p>

                  <a href={metaMaskUri} style={{ textDecoration: "none" }}>
                    <Button
                      size="sm"
                      className="w-full text-xs font-bold gap-1.5 h-9"
                      style={{ boxShadow: "0 0 16px rgba(155,134,255,0.2)" }}
                    >
                      <Plus size={14} /> Send $0.10 via MetaMask
                    </Button>
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
