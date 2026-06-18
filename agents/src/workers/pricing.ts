// src/workers/pricing.ts — PricingAgent sweep worker (M5).
// Handles jobs of kind: 'pricing_sweep'.
// Consumes signal bundles from Supabase, reasons via LLM, clamps to envelope, persists decisions.

import type { SupabaseClient } from '@supabase/supabase-js';
import { complete } from '../llm/index.js';
import {
  fromDisplay,
  fromBaseUnits,
  toDisplay,
  toBaseUnitsString,
} from '../money.js';
import {
  SWEEP_INTERVAL_MINUTES,
  USDC_ERC20_DECIMALS,
  PRICE_CEILING,
  PRICE_FLOOR_MIN,
} from '../config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PricingSweepPayload = {
  pieceId: string;
  trigger: 'clock' | 'spike' | 'tip_surplus';
};

type Objective = 'MAX_REVENUE' | 'MAX_REACH';

type WindowStats = {
  views: number;
  uniqueReaders: number;
  avgDwellSeconds: number;
  medianDwellSeconds: number;
  completionPct: number;
  bounceRate: number;
  tipCount: number;
  tipRevenue: number; // display dollars
};

type SignalBundle = {
  pieceId: string;
  objective: Objective;
  currentPrice: number;   // display dollars
  reserve: number;        // display dollars
  ceiling: number;        // display dollars
  ageHours: number;
  windows: {
    '1h': WindowStats;
    '24h': WindowStats;
    '7d': WindowStats;
  };
  recentTipSurplus: number; // display dollars
};

type AgentDecision = {
  kind: 'price';
  oldPrice: number;
  newPrice: number;
  reserve: number;
  objective: Objective;
  signalsCited: string[];
  reasoning: string;
  confidence: number; // 0..1
};

type ReserveDecision = {
  reserve: number;
  reasoning: string;
};

// ---------------------------------------------------------------------------
// Signal bundle builder
// ---------------------------------------------------------------------------

/**
 * Parse a base-unit string from the DB (stored as string to avoid JS BigInt overflow) into a
 * display-dollar number. Falls back to 0 if null/undefined.
 */
function baseUnitsToDisplay(raw: string | null | undefined): number {
  if (!raw) return 0;
  try {
    const amount = fromBaseUnits(BigInt(raw), USDC_ERC20_DECIMALS);
    return parseFloat(toDisplay(amount).replace('$', ''));
  } catch {
    return 0;
  }
}

/** Compute stats for one time window across sessions for a given piece. */
async function computeWindowStats(
  db: SupabaseClient,
  pieceId: string,
  windowHours: number
): Promise<WindowStats> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  // Fetch sessions in window
  const { data: sessions, error } = await db
    .from('sessions')
    .select('reader_id, dwell_seconds, completion_pct')
    .eq('piece_id', pieceId)
    .gte('created_at', since);

  if (error || !sessions || sessions.length === 0) {
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

  const views = sessions.length;
  const uniqueReaders = new Set(sessions.map((s: { reader_id: string }) => s.reader_id)).size;

  const dwells = sessions.map((s: { dwell_seconds: number }) => s.dwell_seconds ?? 0);
  const avgDwellSeconds = dwells.reduce((a: number, b: number) => a + b, 0) / views;

  const sorted = [...dwells].sort((a: number, b: number) => a - b);
  const medianDwellSeconds =
    views % 2 === 0
      ? (sorted[views / 2 - 1] + sorted[views / 2]) / 2
      : sorted[Math.floor(views / 2)];

  const completions = sessions.map((s: { completion_pct: number }) => s.completion_pct ?? 0);
  const completionPct = completions.reduce((a: number, b: number) => a + b, 0) / views;

  const bounces = sessions.filter((s: { completion_pct: number }) => (s.completion_pct ?? 0) < 20).length;
  const bounceRate = bounces / views;

  // Tips linked to sessions in this window — join via piece_id + paid_at window
  const { data: tips } = await db
    .from('tip_decisions')
    .select('tip_amount')
    .eq('piece_id', pieceId)
    .eq('accepted', true)
    .gte('created_at', since);

  const tipCount = tips?.length ?? 0;
  const tipRevenue = (tips ?? []).reduce(
    (sum: number, t: { tip_amount: string | null }) => sum + baseUnitsToDisplay(t.tip_amount),
    0
  );

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

async function getSignalBundle(db: SupabaseClient, pieceId: string): Promise<SignalBundle> {
  // Fetch piece metadata
  const { data: piece, error: pieceErr } = await db
    .from('pieces')
    .select('id, objective, current_price, reserve, ceiling, created_at')
    .eq('id', pieceId)
    .single();

  if (pieceErr || !piece) {
    throw new Error(`[pricing] piece not found: ${pieceId} — ${pieceErr?.message ?? 'no data'}`);
  }

  const currentPrice = baseUnitsToDisplay(piece.current_price);
  const reserve = baseUnitsToDisplay(piece.reserve);
  const ceiling = baseUnitsToDisplay(piece.ceiling);
  const ageHours =
    (Date.now() - new Date(piece.created_at as string).getTime()) / (1000 * 60 * 60);

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: surplusRows } = await db
    .from('tip_decisions')
    .select('tip_surplus')
    .eq('piece_id', pieceId)
    .eq('accepted', true)
    .gte('created_at', since24h);

  const recentTipSurplus = (surplusRows ?? []).reduce(
    (sum: number, r: { tip_surplus: string | null }) => sum + baseUnitsToDisplay(r.tip_surplus),
    0
  );

  const [w1h, w24h, w7d] = await Promise.all([
    computeWindowStats(db, pieceId, 1),
    computeWindowStats(db, pieceId, 24),
    computeWindowStats(db, pieceId, 7 * 24),
  ]);

  return {
    pieceId,
    objective: (piece.objective as Objective) ?? 'MAX_REVENUE',
    currentPrice,
    reserve,
    ceiling,
    ageHours,
    windows: {
      '1h': w1h,
      '24h': w24h,
      '7d': w7d,
    },
    recentTipSurplus,
  };
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildPricingPrompt(bundle: SignalBundle): string {
  const { objective, currentPrice, reserve, ceiling, ageHours, windows, recentTipSurplus } = bundle;
  const maxStep = currentPrice * 0.5;

  const w = (label: string, s: WindowStats) =>
    `  ${label}:
    views=${s.views}, uniqueReaders=${s.uniqueReaders}
    avgDwell=${s.avgDwellSeconds.toFixed(1)}s, medianDwell=${s.medianDwellSeconds.toFixed(1)}s
    completionPct=${(s.completionPct * 100).toFixed(1)}%, bounceRate=${(s.bounceRate * 100).toFixed(1)}%
    tips=${s.tipCount}, tipRevenue=$${s.tipRevenue.toFixed(6)}`;

  return `You are a PricingAgent for a content platform. Your task is to set the optimal standing price for an article based on reader engagement signals.

## Article context
- Objective: ${objective} (${objective === 'MAX_REVENUE' ? 'maximise total revenue per piece' : 'maximise reader reach / widest audience'})
- Current price: $${currentPrice.toFixed(6)}
- Price envelope: reserve=$${reserve.toFixed(6)}, ceiling=$${ceiling.toFixed(6)}
- Max step this sweep: ±$${maxStep.toFixed(6)} from current (i.e. new price must be in [$${(currentPrice - maxStep).toFixed(6)}, $${(currentPrice + maxStep).toFixed(6)}])
- Piece age: ${ageHours.toFixed(1)} hours
- Recent tip surplus (tipped above suggestion, last 24h): $${recentTipSurplus.toFixed(6)}

## Engagement signals by time window
${w('1h (last hour)', windows['1h'])}

${w('24h (last 24 hours)', windows['24h'])}

${w('7d (last 7 days)', windows['7d'])}

## Your reasoning must distinguish these three real-world patterns:

1. **Pre-emptive cut**: If dwell_median is falling between 7d→24h→1h while views haven't dropped yet, predict engagement decay before it shows in traffic. Cut price early to attract readers before the drop compounds.

2. **Hold through a quiet patch**: If recent views are low but historical (7d) dwell and completion are strong, and bounce rate is thin — this is a content-quality piece in a lull, not a dying piece. Hold or nudge price up slightly to signal value.

3. **Boredom vs topic-death**:
   - Falling dwell + steady or rising views → readers are skimming or bailing; piece is too long or losing relevance → cut or hold at floor.
   - Falling views + steady dwell (those who arrive still read fully) → topic exhausted or audience saturated → gentle downward nudge to find new readers.

Apply whichever pattern fits the data. Your reasoning must cite which pattern applies and why.

## Additional signals
- If recentTipSurplus > 0, readers are valuing the piece MORE than you suggested. Treat this as an under-pricing signal — consider raising the price.
- High bounceRate (>40%) suggests current price is too high for perceived value.
- completionPct > 80% + low bounceRate + healthy dwell = quality signal, supports holding or raising.

## Output
Return ONLY valid JSON (no markdown fences, no explanation outside the JSON) matching this exact shape:
{
  "kind": "price",
  "oldPrice": <current price as number>,
  "newPrice": <your proposed price as number, within envelope and max_step>,
  "reserve": <your recommended reserve floor as number — you may adjust it slowly>,
  "objective": "${objective}",
  "signalsCited": [<list of 3-6 short signal strings, e.g. "dwell_median_1h:120s", "bounce_24h:38%">],
  "reasoning": "<one concise paragraph explaining which pattern you identified and why you chose this price>",
  "confidence": <0.0 to 1.0 — lower if data is thin or pattern is ambiguous>
}

IMPORTANT constraints on your output:
- newPrice MUST be in [${reserve.toFixed(6)}, ${ceiling.toFixed(6)}]
- newPrice MUST NOT move more than $${maxStep.toFixed(6)} from current price $${currentPrice.toFixed(6)}
- reserve MUST be in [${PRICE_FLOOR_MIN}, ${(ceiling / 2).toFixed(6)}]
- All prices are in USD (e.g. 0.01 = $0.01 = 1 cent)`;
}

function buildReservePrompt(bundle: SignalBundle): string {
  const { currentPrice, reserve, ceiling, ageHours, windows } = bundle;
  return `You are a PricingAgent reviewing the price floor (reserve) for an article.

## Context
- Current reserve (floor): $${reserve.toFixed(6)}
- Current price: $${currentPrice.toFixed(6)}
- Ceiling: $${ceiling.toFixed(6)}
- Piece age: ${ageHours.toFixed(1)} hours

## Signals (7-day window)
- views=${windows['7d'].views}, medianDwell=${windows['7d'].medianDwellSeconds.toFixed(1)}s
- completionPct=${(windows['7d'].completionPct * 100).toFixed(1)}%, bounceRate=${(windows['7d'].bounceRate * 100).toFixed(1)}%
- tipRevenue=$${windows['7d'].tipRevenue.toFixed(6)}

What is the right price floor for this piece? Consider: setting it too low wastes revenue on highly-engaged readers; too high kills reach for a piece that's underperforming.

Return ONLY valid JSON:
{
  "reserve": <number, must be in [${PRICE_FLOOR_MIN}, ${(ceiling / 2).toFixed(6)}]>,
  "reasoning": "<one sentence explaining why>"
}`;
}

// ---------------------------------------------------------------------------
// LLM calls + validation
// ---------------------------------------------------------------------------

const PRICING_SYSTEM_PROMPT =
  'You are a PricingAgent for a nanopayment content platform. You reason over engagement data and ' +
  'return pricing decisions as valid JSON. You never fabricate data — you work only from the signals given. ' +
  'Your decisions are the product; poor reasoning will directly harm creators.';

async function runPricingAgent(bundle: SignalBundle): Promise<AgentDecision> {
  const prompt = buildPricingPrompt(bundle);
  const raw = await complete(prompt, {
    json: true,
    systemPrompt: PRICING_SYSTEM_PROMPT,
    maxTokens: 1024,
  });

  let decision: AgentDecision;
  try {
    decision = JSON.parse(raw) as AgentDecision;
  } catch (e) {
    throw new Error(`[pricing] LLM returned non-JSON: ${raw.slice(0, 200)}`);
  }

  // Validate required fields
  if (decision.kind !== 'price') {
    throw new Error(`[pricing] unexpected decision kind: ${decision.kind}`);
  }
  if (typeof decision.newPrice !== 'number' || isNaN(decision.newPrice)) {
    throw new Error(`[pricing] invalid newPrice in LLM response`);
  }
  if (typeof decision.confidence !== 'number') {
    decision.confidence = 0.5; // safe default
  }
  if (!Array.isArray(decision.signalsCited)) {
    decision.signalsCited = [];
  }
  if (!decision.reasoning) {
    decision.reasoning = 'No reasoning provided.';
  }

  return decision;
}

async function runReserveAgent(bundle: SignalBundle): Promise<ReserveDecision> {
  const prompt = buildReservePrompt(bundle);
  const raw = await complete(prompt, {
    json: true,
    systemPrompt: PRICING_SYSTEM_PROMPT,
    maxTokens: 256,
  });
  try {
    return JSON.parse(raw) as ReserveDecision;
  } catch {
    return { reserve: bundle.reserve, reasoning: 'Parse error — keeping current reserve.' };
  }
}

// ---------------------------------------------------------------------------
// Envelope clamp (§7.1, §7.2)
// ---------------------------------------------------------------------------

/**
 * Clamp the agent's proposed price to the hard envelope and max_step constraint.
 * Returns the clamped price in display dollars.
 */
function clampToEnvelope(
  proposed: number,
  currentPrice: number,
  reserve: number,
  ceiling: number
): number {
  // Step 1: clamp to envelope [reserve, ceiling]
  const envelopeClamped = Math.min(Math.max(proposed, reserve), ceiling);

  // Step 2: clamp to max_step = 50% of current price
  const maxStep = currentPrice * 0.5;
  const stepClamped = Math.min(
    Math.max(envelopeClamped, currentPrice - maxStep),
    currentPrice + maxStep
  );

  // Step 3: global hard bounds from config
  const finalPrice = Math.min(Math.max(stepClamped, PRICE_FLOOR_MIN), PRICE_CEILING);

  return finalPrice;
}

// ---------------------------------------------------------------------------
// Core sweep handler
// ---------------------------------------------------------------------------

async function handlePricingSweep(
  db: SupabaseClient,
  pieceId: string,
  trigger: PricingSweepPayload['trigger']
): Promise<void> {
  console.log(`[pricing] sweep start — piece=${pieceId} trigger=${trigger}`);

  // 1. Gather signals
  const bundle = await getSignalBundle(db, pieceId);

  const { currentPrice, reserve, ceiling, objective, ageHours } = bundle;

  // 2. Run PricingAgent
  const decision = await runPricingAgent(bundle);

  // 3. Clamp to envelope
  const finalPrice = clampToEnvelope(decision.newPrice, currentPrice, reserve, ceiling);

  const finalPriceUsd = fromDisplay(finalPrice, USDC_ERC20_DECIMALS);
  const oldPriceUsd = fromDisplay(decision.oldPrice ?? currentPrice, USDC_ERC20_DECIMALS);
  const reserveUsd = fromDisplay(decision.reserve ?? reserve, USDC_ERC20_DECIMALS);

  // Log if clamping changed the price
  if (Math.abs(finalPrice - decision.newPrice) > 0.000001) {
    console.log(
      `[pricing] envelope clamp: agent proposed $${decision.newPrice.toFixed(6)} → clamped to $${finalPrice.toFixed(6)}`
    );
  }

  // 4. Persist price decision (reasoning chain — §7.10)
  const { error: insertErr } = await db.from('price_decisions').insert({
    piece_id: pieceId,
    old_price: toBaseUnitsString(oldPriceUsd),
    new_price: toBaseUnitsString(finalPriceUsd),
    reserve: toBaseUnitsString(reserveUsd),
    objective: decision.objective ?? objective,
    signals_cited: decision.signalsCited,
    reasoning: decision.reasoning,
    confidence: decision.confidence,
    trigger,
  });

  if (insertErr) {
    console.error(`[pricing] failed to insert price_decision:`, insertErr.message);
    throw new Error(`[pricing] DB insert failed: ${insertErr.message}`);
  }

  // 5. Update piece's standing price
  const { error: updateErr } = await db
    .from('pieces')
    .update({ current_price: toBaseUnitsString(finalPriceUsd) })
    .eq('id', pieceId);

  if (updateErr) {
    console.error(`[pricing] failed to update piece current_price:`, updateErr.message);
    throw new Error(`[pricing] DB update failed: ${updateErr.message}`);
  }

  console.log(
    `[pricing] sweep done — piece=${pieceId} $${currentPrice.toFixed(6)}→$${finalPrice.toFixed(6)} ` +
      `confidence=${decision.confidence.toFixed(2)} trigger=${trigger}`
  );

  // 6. Reserve re-evaluation (only on clock trigger, piece >24h old, every ~5th sweep)
  if (trigger === 'clock' && ageHours > 24 && Math.random() < 0.2) {
    await maybeUpdateReserve(db, pieceId, bundle, ceiling);
  }
}

async function maybeUpdateReserve(
  db: SupabaseClient,
  pieceId: string,
  bundle: SignalBundle,
  ceiling: number
): Promise<void> {
  try {
    const reserveDecision = await runReserveAgent(bundle);

    // Clamp reserve to [PRICE_FLOOR_MIN, ceiling/2]
    const reserveMin = PRICE_FLOOR_MIN;
    const reserveMax = ceiling / 2;
    const clampedReserve = Math.min(
      Math.max(reserveDecision.reserve, reserveMin),
      reserveMax
    );

    // Only update if changed by more than 20%
    const changePct =
      Math.abs(clampedReserve - bundle.reserve) / (bundle.reserve || 0.001);
    if (changePct > 0.2) {
      const reserveUsd = fromDisplay(clampedReserve, USDC_ERC20_DECIMALS);
      await db
        .from('pieces')
        .update({ reserve: toBaseUnitsString(reserveUsd) })
        .eq('id', pieceId);
      console.log(
        `[pricing] reserve updated — piece=${pieceId} ` +
          `$${bundle.reserve.toFixed(6)}→$${clampedReserve.toFixed(6)}: ${reserveDecision.reasoning}`
      );
    }
  } catch (err) {
    // Non-fatal — reserve update is opportunistic
    console.warn(`[pricing] reserve update skipped for piece=${pieceId}:`, err);
  }
}

// ---------------------------------------------------------------------------
// Clock: sweep all listed pieces on an interval
// ---------------------------------------------------------------------------

async function sweepAllListedPieces(db: SupabaseClient): Promise<void> {
  console.log('[pricing] clock sweep — fetching listed pieces...');

  const { data: pieces, error } = await db
    .from('pieces')
    .select('id')
    .eq('status', 'listed');

  if (error) {
    console.error('[pricing] failed to fetch listed pieces:', error.message);
    return;
  }

  if (!pieces || pieces.length === 0) {
    console.log('[pricing] no listed pieces to sweep');
    return;
  }

  console.log(`[pricing] sweeping ${pieces.length} listed piece(s)...`);

  // Process sequentially to avoid hammering LLM / DB in parallel
  for (const piece of pieces) {
    try {
      await handlePricingSweep(db, piece.id as string, 'clock');
    } catch (err) {
      console.error(`[pricing] sweep failed for piece=${piece.id}:`, err);
      // continue with next piece
    }
  }

  console.log(`[pricing] clock sweep complete — ${pieces.length} piece(s) processed`);
}

export function startPricingClock(db: SupabaseClient): void {
  const intervalMs = SWEEP_INTERVAL_MINUTES * 60 * 1000;
  console.log(`[pricing] clock starting — sweep every ${SWEEP_INTERVAL_MINUTES}min`);

  // Sweep immediately on startup
  sweepAllListedPieces(db).catch((err) =>
    console.error('[pricing] initial sweep error:', err)
  );

  // Then on interval
  setInterval(() => {
    sweepAllListedPieces(db).catch((err) =>
      console.error('[pricing] interval sweep error:', err)
    );
  }, intervalMs);
}

// ---------------------------------------------------------------------------
// Worker factory (queue consumer integration)
// ---------------------------------------------------------------------------

export function makePricingWorker(db: SupabaseClient) {
  return async function pricingWorker(rawPayload: unknown): Promise<void> {
    const payload = rawPayload as PricingSweepPayload;

    if (!payload?.pieceId) {
      throw new Error('[pricing] invalid payload: missing pieceId');
    }

    const trigger = payload.trigger ?? 'clock';
    await handlePricingSweep(db, payload.pieceId, trigger);
  };
}
