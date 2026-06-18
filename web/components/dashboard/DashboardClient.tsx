"use client";

/**
 * components/dashboard/DashboardClient.tsx — M8
 * Main dashboard shell: pieces list, selected piece detail panel,
 * Gateway balance, withdraw dialog, live realtime updates.
 * No LLM calls — reads DB only.
 */

import { useEffect, useState, useCallback } from "react";
import type { Piece, PriceDecision, Payment, Creator } from "../../lib/repo/types";
import { fromBaseUnits, toDisplay } from "../../lib/money";
import { USDC_ERC20_DECIMALS } from "../../lib/config";
import { createBrowserClient } from "../../lib/db";
import LiveTicker from "./LiveTicker";
import ReasoningChain from "./ReasoningChain";
import PriceChart from "./PriceChart";
import ListDelistControl from "./ListDelistControl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

interface GatewayBalanceState {
  total: string;
  withdrawable: string;
  withdrawing: string;
  loading: boolean;
  error: string | null;
}

interface DashboardClientProps {
  creator: Creator;
  initialPieces: Piece[];
  initialDecisionsByPiece: Record<string, PriceDecision[]>;
  initialPaymentsByPiece: Record<string, Payment[]>;
}

function displayPrice(baseUnits: string): string {
  try {
    return toDisplay(fromBaseUnits(BigInt(baseUnits), USDC_ERC20_DECIMALS));
  } catch {
    return "$?.???";
  }
}

function sumSettled(payments: Payment[]): string {
  try {
    let total = 0n;
    for (const p of payments) {
      if (p.status === "settled") total += BigInt(p.amount);
    }
    return toDisplay(fromBaseUnits(total, USDC_ERC20_DECIMALS));
  } catch {
    return "$0";
  }
}

function uniquePayers(payments: Payment[]): number {
  return new Set(payments.map((p) => p.reader_id)).size;
}

export default function DashboardClient({
  creator,
  initialPieces,
  initialDecisionsByPiece,
  initialPaymentsByPiece,
}: DashboardClientProps) {
  const [pieces, setPieces] = useState<Piece[]>(initialPieces);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialPieces[0]?.id ?? null
  );
  const [decisionsByPiece, setDecisionsByPiece] = useState<
    Record<string, PriceDecision[]>
  >(initialDecisionsByPiece);
  const [paymentsByPiece, setPaymentsByPiece] = useState<
    Record<string, Payment[]>
  >(initialPaymentsByPiece);

  // Gateway balance
  const [balance, setBalance] = useState<GatewayBalanceState>({
    total: "—",
    withdrawable: "—",
    withdrawing: "—",
    loading: true,
    error: null,
  });

  // Withdraw dialog
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawTo, setWithdrawTo] = useState(creator.wallet_address);
  const [withdrawChain, setWithdrawChain] = useState("arcTestnet");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawResult, setWithdrawResult] = useState<{ txHash: string; explorerUrl: string } | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  // Fetch gateway balance
  const fetchBalance = useCallback(async () => {
    setBalance((b) => ({ ...b, loading: true, error: null }));
    try {
      const res = await fetch(`/api/balance?address=${creator.wallet_address}`);
      if (!res.ok) throw new Error("Failed to fetch balance");
      const data = await res.json() as { total: string; withdrawable: string; withdrawing: string };
      setBalance({ ...data, loading: false, error: null });
    } catch (err) {
      setBalance((b) => ({
        ...b,
        loading: false,
        error: err instanceof Error ? err.message : "Error",
      }));
    }
  }, [creator.wallet_address]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  // Realtime: subscribe to payments for selected piece
  useEffect(() => {
    if (!selectedId) return;
    const db = createBrowserClient();
    const channel = db
      .channel(`dashboard-payments:${selectedId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "payments",
          filter: `piece_id=eq.${selectedId}`,
        },
        (payload) => {
          const p = payload.new as Payment;
          if (p.status === "settled") {
            setPaymentsByPiece((prev) => ({
              ...prev,
              [selectedId]: [p, ...(prev[selectedId] ?? [])],
            }));
          }
        }
      )
      .subscribe();

    return () => { channel.unsubscribe(); };
  }, [selectedId]);

  // Handlers
  const handleStatusChange = useCallback(
    (id: string, status: Piece["status"]) => {
      setPieces((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status } : p))
      );
    },
    []
  );

  const handleObjectiveChange = useCallback(
    (id: string, objective: Piece["objective"]) => {
      setPieces((prev) =>
        prev.map((p) => (p.id === id ? { ...p, objective } : p))
      );
    },
    []
  );

  const submitWithdraw = async () => {
    setWithdrawing(true);
    setWithdrawError(null);
    setWithdrawResult(null);
    try {
      const res = await fetch("/api/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: withdrawTo,
          chain: withdrawChain,
          amount: withdrawAmount,
        }),
      });
      const data = await res.json() as { txHash?: string; explorerUrl?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Withdraw failed");
      setWithdrawResult({ txHash: data.txHash!, explorerUrl: data.explorerUrl! });
      fetchBalance();
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setWithdrawing(false);
    }
  };

  // Aggregate stats
  const allPayments = Object.values(paymentsByPiece).flat();
  const allDecisions = Object.values(decisionsByPiece).flat();
  const totalRevenue = sumSettled(allPayments.filter((p) => p.kind === "unlock"));
  const uniqueReaders = uniquePayers(allPayments.filter((p) => p.kind === "unlock"));
  const listedCount = pieces.filter((p) => p.status === "listed").length;
  const totalDecisions = allDecisions.length;

  const selectedPiece = pieces.find((p) => p.id === selectedId) ?? null;
  const selectedDecisions = selectedId ? (decisionsByPiece[selectedId] ?? []) : [];
  const selectedPayments = selectedId ? (paymentsByPiece[selectedId] ?? []) : [];

  return (
    <div
      data-theme="dark"
      style={{
        background: "var(--c-bg, #0a0814)",
        color: "var(--c-text, #e8e6f0)",
        minHeight: "100vh",
        fontFamily: "var(--font-manrope), sans-serif",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          borderBottom: "1px solid var(--c-border, #2a2740)",
          padding: "16px 32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "var(--c-surface, #12101f)",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        {/* Logo + creator */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <a
            href="/"
            style={{
              fontFamily: "var(--font-sora), sans-serif",
              fontWeight: 700,
              fontSize: 17,
              letterSpacing: "-0.03em",
              textDecoration: "none",
              color: "var(--c-text, #e8e6f0)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                background: "var(--c-accent, #3b82f6)",
                borderRadius: 2,
                display: "inline-block",
                transform: "rotate(45deg)",
                boxShadow: "0 0 10px var(--c-accent, #3b82f6)",
              }}
            />
            Cresc
          </a>
          <span style={{ color: "var(--c-border, #2a2740)", fontSize: 18 }}>·</span>
          <div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "var(--c-text, #e8e6f0)",
              }}
            >
              {creator.display_name}
            </div>
            <div
              style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: 11,
                color: "var(--c-dim, #666)",
                marginTop: 1,
              }}
            >
              {creator.wallet_address.slice(0, 8)}…{creator.wallet_address.slice(-6)}
            </div>
          </div>
        </div>

        {/* Gateway balance + withdraw */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: 11,
                color: "var(--c-dim, #666)",
                marginBottom: 2,
              }}
            >
              gateway balance
            </div>
            <div
              style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontWeight: 600,
                fontSize: 18,
                color: balance.loading ? "var(--c-dim, #666)" : "var(--c-text, #e8e6f0)",
              }}
            >
              {balance.loading ? "…" : balance.error ? "—" : balance.withdrawable}
              <span style={{ fontSize: 11, color: "var(--c-dim, #666)", marginLeft: 4 }}>
                withdrawable
              </span>
            </div>
          </div>
          <Button
            onClick={() => { setWithdrawOpen(true); setWithdrawResult(null); setWithdrawError(null); }}
            variant="outline"
            size="sm"
          >
            Withdraw
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      <div
        style={{
          borderBottom: "1px solid var(--c-border-soft, #1e1b32)",
          background: "var(--c-bg-soft, #0d0b1a)",
          padding: "16px 32px",
          display: "flex",
          gap: 48,
        }}
      >
        {[
          { label: "Listed Pieces", value: String(listedCount) },
          { label: "Total Revenue", value: totalRevenue },
          { label: "Price Decisions", value: String(totalDecisions) },
          { label: "Unique Paid Readers", value: String(uniqueReaders) },
        ].map(({ label, value }) => (
          <div key={label}>
            <div
              style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: 10,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--c-dim, #666)",
                marginBottom: 4,
              }}
            >
              {label}
            </div>
            <div
              style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontWeight: 600,
                fontSize: 22,
                color: "var(--c-text, #e8e6f0)",
                letterSpacing: "-0.03em",
              }}
            >
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Main layout: sidebar + detail panel */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "300px 1fr",
          height: "calc(100vh - 116px)",
          overflow: "hidden",
        }}
      >
        {/* Pieces sidebar */}
        <div
          style={{
            borderRight: "1px solid var(--c-border, #2a2740)",
            overflowY: "auto",
            padding: "16px 0",
          }}
        >
          <div
            style={{
              padding: "0 16px 12px",
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: 11,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--c-dim, #666)",
            }}
          >
            Your Pieces
          </div>

          {pieces.length === 0 && (
            <div
              style={{
                padding: 16,
                color: "var(--c-dim, #666)",
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: 12,
              }}
            >
              No pieces yet.
            </div>
          )}

          {pieces.map((piece) => {
            const isSelected = piece.id === selectedId;
            const priceDec = decisionsByPiece[piece.id] ?? [];
            const prevPrice = priceDec[1]?.new_price ?? priceDec[0]?.old_price ?? null;
            let dir: "up" | "down" | "flat" = "flat";
            if (prevPrice) {
              try {
                const cur = BigInt(piece.current_price);
                const prev = BigInt(prevPrice);
                if (cur > prev) dir = "up";
                else if (cur < prev) dir = "down";
              } catch { /* keep flat */ }
            }
            const arrow = dir === "up" ? "↑" : dir === "down" ? "↓" : "·";
            const dirColor =
              dir === "up"
                ? "var(--c-green, #22c55e)"
                : dir === "down"
                ? "var(--c-red, #ef4444)"
                : "var(--c-muted, #999)";

            return (
              <button
                key={piece.id}
                onClick={() => setSelectedId(piece.id)}
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  background: isSelected
                    ? "linear-gradient(90deg, var(--c-surface-hi, #18162a), transparent)"
                    : "transparent",
                  border: "none",
                  borderLeft: isSelected
                    ? "2px solid var(--c-accent, #3b82f6)"
                    : "2px solid transparent",
                  cursor: "pointer",
                  textAlign: "left",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-manrope), sans-serif",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--c-text, #e8e6f0)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {piece.title}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      fontFamily: "var(--font-jetbrains), monospace",
                      fontSize: 13,
                      fontWeight: 600,
                      color: dirColor,
                    }}
                  >
                    {arrow} {displayPrice(piece.current_price)}
                  </span>
                  <Badge
                    variant={piece.status === "listed" ? "default" : "outline"}
                    style={{ fontSize: 10 }}
                  >
                    {piece.status}
                  </Badge>
                  <Badge variant="secondary" style={{ fontSize: 10 }}>
                    {piece.objective === "MAX_REVENUE" ? "revenue" : "reach"}
                  </Badge>
                </div>
              </button>
            );
          })}
        </div>

        {/* Detail panel */}
        <div style={{ overflowY: "auto", padding: "24px 32px" }}>
          {!selectedPiece ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "60%",
                color: "var(--c-dim, #666)",
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: 13,
              }}
            >
              Select a piece to inspect.
            </div>
          ) : (
            <div style={{ maxWidth: 860 }}>
              {/* Piece header */}
              <div style={{ marginBottom: 24 }}>
                <h2
                  style={{
                    fontFamily: "var(--font-sora), sans-serif",
                    fontWeight: 600,
                    fontSize: 24,
                    letterSpacing: "-0.025em",
                    margin: "0 0 8px",
                  }}
                >
                  {selectedPiece.title}
                </h2>
                <div style={{ marginBottom: 16 }}>
                  <ListDelistControl
                    piece={selectedPiece}
                    onStatusChange={handleStatusChange}
                    onObjectiveChange={handleObjectiveChange}
                  />
                </div>
              </div>

              {/* Live ticker */}
              <div style={{ marginBottom: 20 }}>
                <LiveTicker
                  pieceId={selectedPiece.id}
                  initialPrice={selectedPiece.current_price}
                  initialDecisions={selectedDecisions}
                />
              </div>

              {/* Tabs: chart | reasoning | payments */}
              <Tabs defaultValue="reasoning">
                <TabsList style={{ marginBottom: 16 }}>
                  <TabsTrigger value="chart">Price Chart</TabsTrigger>
                  <TabsTrigger value="reasoning">Reasoning Chain</TabsTrigger>
                  <TabsTrigger value="payments">Payments</TabsTrigger>
                </TabsList>

                <TabsContent value="chart">
                  <div
                    style={{
                      background: "linear-gradient(170deg, var(--c-surface-hi, #18162a), var(--c-surface, #12101f))",
                      border: "1px solid var(--c-border, #2a2740)",
                      borderRadius: 14,
                      padding: 20,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "var(--font-jetbrains), monospace",
                        fontSize: 11,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        color: "var(--c-dim, #666)",
                        marginBottom: 16,
                      }}
                    >
                      price history + revenue
                    </div>
                    <PriceChart
                      decisions={selectedDecisions}
                      payments={selectedPayments}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="reasoning">
                  <ReasoningChain
                    pieceId={selectedPiece.id}
                    creatorId={creator.id}
                    initialDecisions={selectedDecisions}
                  />
                </TabsContent>

                <TabsContent value="payments">
                  <div
                    style={{
                      background: "linear-gradient(170deg, var(--c-surface-hi, #18162a), var(--c-surface, #12101f))",
                      border: "1px solid var(--c-border, #2a2740)",
                      borderRadius: 14,
                      overflow: "hidden",
                    }}
                  >
                    {selectedPayments.length === 0 ? (
                      <div
                        style={{
                          padding: 32,
                          textAlign: "center",
                          color: "var(--c-dim, #666)",
                          fontFamily: "var(--font-jetbrains), monospace",
                          fontSize: 13,
                        }}
                      >
                        No settled payments yet.
                      </div>
                    ) : (
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr
                            style={{
                              borderBottom: "1px solid var(--c-border, #2a2740)",
                            }}
                          >
                            {["Time", "Kind", "Amount", "Explorer"].map((h) => (
                              <th
                                key={h}
                                style={{
                                  padding: "12px 16px",
                                  textAlign: "left",
                                  fontFamily: "var(--font-jetbrains), monospace",
                                  fontSize: 11,
                                  letterSpacing: "0.08em",
                                  textTransform: "uppercase",
                                  color: "var(--c-dim, #666)",
                                  fontWeight: 400,
                                }}
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {selectedPayments.map((p) => (
                            <tr
                              key={p.id}
                              style={{
                                borderBottom: "1px solid var(--c-border-soft, #1e1b32)",
                              }}
                            >
                              <td
                                style={{
                                  padding: "10px 16px",
                                  fontFamily: "var(--font-jetbrains), monospace",
                                  fontSize: 12,
                                  color: "var(--c-dim, #666)",
                                }}
                              >
                                {new Date(p.created_at).toLocaleString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  hour12: false,
                                })}
                              </td>
                              <td style={{ padding: "10px 16px" }}>
                                <Badge variant={p.kind === "tip" ? "default" : "secondary"}>
                                  {p.kind}
                                </Badge>
                              </td>
                              <td
                                style={{
                                  padding: "10px 16px",
                                  fontFamily: "var(--font-jetbrains), monospace",
                                  fontSize: 13,
                                  fontWeight: 600,
                                  color: "var(--c-green, #22c55e)",
                                }}
                              >
                                {displayPrice(p.amount)}
                              </td>
                              <td style={{ padding: "10px 16px" }}>
                                {p.arc_explorer_url ? (
                                  <a
                                    href={p.arc_explorer_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                      fontFamily: "var(--font-jetbrains), monospace",
                                      fontSize: 11,
                                      color: "var(--c-violet, #7c3aed)",
                                      textDecoration: "none",
                                    }}
                                  >
                                    {p.tx_ref?.slice(0, 12)}…
                                  </a>
                                ) : (
                                  <span style={{ color: "var(--c-dim, #666)", fontSize: 11 }}>
                                    —
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>
      </div>

      {/* Withdraw dialog */}
      <Dialog open={withdrawOpen} onOpenChange={(open) => { if (!open) { setWithdrawOpen(false); setWithdrawResult(null); setWithdrawError(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw from Gateway</DialogTitle>
          </DialogHeader>

          {withdrawResult ? (
            <div style={{ padding: "8px 0" }}>
              <div
                style={{
                  color: "var(--c-green, #22c55e)",
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontSize: 14,
                  marginBottom: 12,
                }}
              >
                Withdraw submitted!
              </div>
              <a
                href={withdrawResult.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontSize: 12,
                  color: "var(--c-violet, #7c3aed)",
                  wordBreak: "break-all",
                }}
              >
                View on Arc Explorer →
              </a>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
                  Amount (USDC)
                </Label>
                <Input
                  type="number"
                  step="0.000001"
                  min="0.000001"
                  placeholder="0.00"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  className="font-mono text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
                  Recipient address
                </Label>
                <Input
                  type="text"
                  value={withdrawTo}
                  onChange={(e) => setWithdrawTo(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
                  Chain
                </Label>
                <Select value={withdrawChain} onValueChange={(v) => { if (v) setWithdrawChain(v); }}>
                  <SelectTrigger className="font-mono text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="arcTestnet">Arc Testnet</SelectItem>
                    <SelectItem value="baseSepolia">Base Sepolia</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {withdrawError && (
                <p className="text-sm" style={{ color: "var(--c-red)" }}>
                  {withdrawError}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            {withdrawResult ? (
              <Button onClick={() => { setWithdrawOpen(false); setWithdrawResult(null); }}>
                Done
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setWithdrawOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={submitWithdraw}
                  disabled={withdrawing || !withdrawAmount || !withdrawTo}
                >
                  {withdrawing ? "Withdrawing…" : "Withdraw"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
