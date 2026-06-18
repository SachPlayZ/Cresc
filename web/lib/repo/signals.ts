// lib/repo/signals.ts — getSignalBundle: recency-weighted stats for PricingAgent (M5 input).
// Uses raw Supabase RPC for efficient multi-window aggregation.
import { SupabaseClient } from '@supabase/supabase-js';
import { USDC_ERC20_DECIMALS } from '../config';
import { fromBaseUnits, toDisplay } from '../money';
import type { SignalBundle, WindowStats } from './types';

// Interval strings for the three recency windows
const WINDOWS = { '1h': '1 hour', '24h': '24 hours', '7d': '7 days' } as const;
type WindowKey = keyof typeof WINDOWS;

async function fetchWindowStats(
  db: SupabaseClient,
  pieceId: string,
  intervalSql: string
): Promise<WindowStats> {
  // Sessions opened in this window
  const { data: sessions, error: sErr } = await db
    .from('sessions')
    .select('id, reader_id, active_dwell_seconds, completion_pct, view_price_paid')
    .eq('piece_id', pieceId)
    .gte('unlocked_at', `now() - interval '${intervalSql}'`);
  if (sErr) throw sErr;

  const rows = sessions ?? [];
  const views = rows.length;

  if (views === 0) {
    return {
      views: 0,
      uniqueReaders: 0,
      avgDwellSeconds: 0,
      medianDwellSeconds: 0,
      completionPct: 0,
      bounceRate: 0,
      tipCount: 0,
      tipRevenue: 0,
    };
  }

  const uniqueReaders = new Set(rows.map((r) => r.reader_id)).size;

  const dwells = rows.map((r) => r.active_dwell_seconds as number);
  const avgDwellSeconds = dwells.reduce((a, b) => a + b, 0) / dwells.length;

  const sorted = [...dwells].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianDwellSeconds =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  const completionPct =
    rows.reduce((a, r) => a + (r.completion_pct as number), 0) / rows.length;

  // Bounce = completion < 20%
  const bounceRate = rows.filter((r) => (r.completion_pct as number) < 20).length / rows.length;

  // Tips settled for sessions in this window
  const sessionIds = rows.map((r) => r.id as string);
  const { data: tips, error: tErr } = await db
    .from('payments')
    .select('amount')
    .eq('kind', 'tip')
    .eq('status', 'settled')
    .in('session_id', sessionIds);
  if (tErr) throw tErr;

  const tipRows = tips ?? [];
  const tipCount = tipRows.length;
  const tipRevenue = tipRows.reduce((sum, t) => {
    const amt = fromBaseUnits(BigInt(t.amount as string), USDC_ERC20_DECIMALS);
    return sum + parseFloat(toDisplay(amt).replace('$', ''));
  }, 0);

  return {
    views,
    uniqueReaders,
    avgDwellSeconds,
    medianDwellSeconds,
    completionPct,
    bounceRate,
    tipCount,
    tipRevenue,
  };
}

export async function getSignalBundle(
  db: SupabaseClient,
  pieceId: string
): Promise<SignalBundle> {
  // Fetch piece metadata + all three windows in parallel
  const [pieceResult, w1h, w24h, w7d, surplusResult] = await Promise.all([
    db.from('pieces').select('objective, current_price, reserve, ceiling, created_at').eq('id', pieceId).single(),
    fetchWindowStats(db, pieceId, WINDOWS['1h']),
    fetchWindowStats(db, pieceId, WINDOWS['24h']),
    fetchWindowStats(db, pieceId, WINDOWS['7d']),
    // Recent tip surplus from accepted tips in past 24h
    db
      .from('tip_decisions')
      .select('tip_surplus')
      .eq('piece_id', pieceId)
      .eq('accepted', true)
      .not('tip_surplus', 'is', null)
      .gte('created_at', `now() - interval '24 hours'`),
  ]);

  if (pieceResult.error) throw pieceResult.error;
  const piece = pieceResult.data;

  const toDisplayNum = (baseUnits: string) =>
    parseFloat(
      toDisplay(fromBaseUnits(BigInt(baseUnits), USDC_ERC20_DECIMALS)).replace('$', '')
    );

  const ageHours =
    (Date.now() - new Date(piece.created_at as string).getTime()) / 1000 / 3600;

  const surplusRows = surplusResult.data ?? [];
  const recentTipSurplus = surplusRows.reduce((sum, r) => {
    if (!r.tip_surplus) return sum;
    return sum + toDisplayNum(r.tip_surplus as string);
  }, 0);

  return {
    pieceId,
    objective: piece.objective as SignalBundle['objective'],
    currentPrice: toDisplayNum(piece.current_price as string),
    reserve: toDisplayNum(piece.reserve as string),
    ceiling: toDisplayNum(piece.ceiling as string),
    ageHours,
    windows: { '1h': w1h, '24h': w24h, '7d': w7d },
    recentTipSurplus,
  };
}
