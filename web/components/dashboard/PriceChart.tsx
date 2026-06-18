"use client";

/**
 * components/dashboard/PriceChart.tsx — M8
 * Recharts ComposedChart: price line over time + payment bars.
 * tip_surplus trigger points shown as colored reference lines.
 */

import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceDot,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { fromBaseUnits, toDisplay } from "../../lib/money";
import { USDC_ERC20_DECIMALS } from "../../lib/config";
import type { PriceDecision, Payment } from "../../lib/repo/types";

interface PriceChartProps {
  decisions: PriceDecision[];
  payments: Payment[];
}

function baseToDisplayNum(baseUnits: string): number {
  try {
    const amount = fromBaseUnits(BigInt(baseUnits), USDC_ERC20_DECIMALS);
    // return in cents-of-dollar for readable chart: $0.012 → 0.012
    return Number(amount.value) / 10 ** amount.decimals;
  } catch {
    return 0;
  }
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return ts.slice(11, 16);
  }
}

// Merge decisions + payment buckets by time (per-hour)
function buildChartData(
  decisions: PriceDecision[],
  payments: Payment[]
): Array<{
  time: string;
  fullTs: string;
  price: number;
  revenue: number;
  trigger: PriceDecision["trigger"] | null;
}> {
  if (decisions.length === 0) return [];

  // Sort decisions oldest→newest
  const sorted = [...decisions].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  // Build a payment map: bucket ts (minute) → total revenue
  const payMap = new Map<string, number>();
  for (const p of payments) {
    const bucket = p.created_at.slice(0, 16); // "YYYY-MM-DDTHH:MM"
    payMap.set(bucket, (payMap.get(bucket) ?? 0) + baseToDisplayNum(p.amount));
  }

  return sorted.map((d) => {
    const bucket = d.created_at.slice(0, 16);
    return {
      time: formatTime(d.created_at),
      fullTs: d.created_at,
      price: baseToDisplayNum(d.new_price),
      revenue: payMap.get(bucket) ?? 0,
      trigger: d.trigger,
    };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "var(--c-surface, #12101f)",
        border: "1px solid var(--c-border, #2a2740)",
        borderRadius: 10,
        padding: "10px 14px",
        fontFamily: "var(--font-jetbrains), monospace",
        fontSize: 12,
      }}
    >
      <div style={{ color: "var(--c-dim, #666)", marginBottom: 6 }}>{label}</div>
      {payload.map((entry: { name: string; value: number; color: string }) => (
        <div key={entry.name} style={{ color: entry.color, marginBottom: 2 }}>
          {entry.name}: {entry.name === "price" ? `$${entry.value.toFixed(4)}` : `$${entry.value.toFixed(6)}`}
        </div>
      ))}
    </div>
  );
}

export default function PriceChart({ decisions, payments }: PriceChartProps) {
  const data = buildChartData(decisions, payments);

  if (data.length === 0) {
    return (
      <div
        style={{
          padding: 40,
          textAlign: "center",
          color: "var(--c-dim, #666)",
          fontFamily: "var(--font-jetbrains), monospace",
          fontSize: 13,
        }}
      >
        No price history yet.
      </div>
    );
  }

  // Find tip_surplus points for reference dots
  const surplusPoints = data.filter((d) => d.trigger === "tip_surplus");

  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--c-border-soft, #1e1b32)"
            vertical={false}
          />
          <XAxis
            dataKey="time"
            tick={{ fill: "var(--c-dim, #666)", fontSize: 10, fontFamily: "var(--font-jetbrains), monospace" }}
            axisLine={{ stroke: "var(--c-border, #2a2740)" }}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="price"
            orientation="left"
            tick={{ fill: "var(--c-dim, #666)", fontSize: 10, fontFamily: "var(--font-jetbrains), monospace" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `$${v.toFixed(3)}`}
            domain={["auto", "auto"]}
          />
          <YAxis
            yAxisId="revenue"
            orientation="right"
            tick={{ fill: "var(--c-dim, #666)", fontSize: 10, fontFamily: "var(--font-jetbrains), monospace" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `$${v.toFixed(4)}`}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: 11,
              color: "var(--c-dim, #666)",
            }}
          />

          {/* Revenue bars */}
          <Bar
            yAxisId="revenue"
            dataKey="revenue"
            name="revenue"
            fill="var(--c-violet, #7c3aed)"
            opacity={0.35}
            radius={[2, 2, 0, 0]}
          />

          {/* Price line */}
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="price"
            name="price"
            stroke="var(--c-accent, #3b82f6)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: "var(--c-accent, #3b82f6)" }}
          />

          {/* tip_surplus trigger dots */}
          {surplusPoints.map((pt) => (
            <ReferenceDot
              key={pt.fullTs}
              yAxisId="price"
              x={pt.time}
              y={pt.price}
              r={5}
              fill="var(--c-violet, #7c3aed)"
              stroke="var(--c-bg, #0a0814)"
              strokeWidth={2}
              label={{
                value: "↑tip",
                position: "top",
                fill: "var(--c-violet, #7c3aed)",
                fontSize: 9,
                fontFamily: "var(--font-jetbrains), monospace",
              }}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
