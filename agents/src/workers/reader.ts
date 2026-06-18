// src/workers/reader.ts — ReaderAgent session eval worker. M6.
// Handles jobs of kind: 'reader_eval'
// Runs fully off the read path — async, after session-end.
// Two genuine judgments: (1) prompt-or-skip, (2) how much tip.
// No fixed time threshold (§7.8). Tip clamped to [10%, 100%] of view price (§7.7).

import type { SupabaseClient } from '@supabase/supabase-js';
import { complete } from '../llm/index.js';
import {
  fromDisplay,
  fromBaseUnits,
  toDisplay,
  toBaseUnitsString,
  clamp,
  type UsdcAmount,
} from '../money.js';
import { USDC_ERC20_DECIMALS } from '../config.js';

export type ReaderEvalPayload = {
  sessionId: string;
};

// Shape returned by the LLM (§6.6 extended with readerMessage)
type AgentDecision = {
  kind: 'tip' | 'tip_skip';
  suggestedTip: number | null;     // display dollars, null when tip_skip
  viewPricePaid: number;
  signalsCited: string[];
  reasoning: string;               // creator-readable rationale
  readerMessage: string | null;    // human sentence shown to reader, null when tip_skip
  confidence: number;              // 0..1
};

// DB row shapes — typed narrowly to avoid `any` leaking out
type SessionRow = {
  id: string;
  piece_id: string;
  reader_id: string;
  view_price_paid: string;         // base-unit string (6 decimals)
  active_dwell_seconds: number;
  completion_pct: number;
  revisit_count: number;
};

type HeartbeatRow = {
  focused: boolean;
  scroll_pct: number;
  ts: string;
};

type PieceRow = {
  id: string;
  title: string;
  length_chars: number;
};

type DerivedMetrics = {
  focusRatio: number;
  scrollDepth: number;
  normalizedDwell: number;
  viewPricePaid: number;
};

/** Derive metrics from session + heartbeats. Pure computation — no LLM. */
function deriveMetrics(
  session: SessionRow,
  heartbeats: HeartbeatRow[],
  piece: PieceRow,
): DerivedMetrics {
  const total = heartbeats.length;
  const focusedCount = heartbeats.filter((h) => h.focused).length;
  const focusRatio = total > 0 ? focusedCount / total : 0;

  const scrollDepth =
    heartbeats.length > 0
      ? Math.max(...heartbeats.map((h) => h.scroll_pct ?? 0))
      : 0;

  // Normalize dwell against piece reading speed (~200 chars/min → chars/s = 200/60 ≈ 3.33)
  const expectedReadSeconds = piece.length_chars > 0 ? piece.length_chars / (200 / 60) : 1;
  const normalizedDwell = session.active_dwell_seconds / expectedReadSeconds;

  // Convert view_price_paid from base units (6 dec) to display dollars
  const pricePaidAmount = fromBaseUnits(BigInt(session.view_price_paid), USDC_ERC20_DECIMALS);
  const viewPricePaid = parseFloat(toDisplay(pricePaidAmount).replace('$', ''));

  return { focusRatio, scrollDepth, normalizedDwell, viewPricePaid };
}

/** Build the judgment prompt fed to the LLM. Contains "tip" keyword so mock routing works. */
function buildPrompt(
  session: SessionRow,
  piece: PieceRow,
  metrics: DerivedMetrics,
): string {
  const { focusRatio, scrollDepth, normalizedDwell, viewPricePaid } = metrics;

  return `You are ReaderAgent evaluating a reader session to decide whether to suggest a tip.

## Session metrics
- active_dwell_seconds: ${session.active_dwell_seconds}
- completion_pct: ${session.completion_pct.toFixed(1)}%
- revisit_count: ${session.revisit_count}
- focus_ratio: ${focusRatio.toFixed(2)} (fraction of heartbeats where tab was focused)
- scroll_depth_pct: ${scrollDepth.toFixed(1)}%
- normalized_dwell: ${normalizedDwell.toFixed(2)} (1.0 = expected reading time for piece length)
- view_price_paid: $${viewPricePaid.toFixed(6)}

## Piece metadata
- title: "${piece.title}"
- length_chars: ${piece.length_chars}

## Your task — make TWO genuine judgments

### Judgment 1: Should we prompt a tip at all?
Judge whether the reader plausibly got value from this piece. Do NOT apply a fixed time threshold.
Consider: Did they finish a long essay vs bounce at 20%? Was dwell genuine (high focus_ratio) or
tab-left-open (low focus_ratio)? Did they revisit? Does scroll depth match completion claims?
A low dwell on a short piece can still show real value. A long dwell on low completion may be distraction.

### Judgment 2: If prompting — how much tip?
If you decide to prompt (kind="tip"), reason a specific suggestedTip in [10%, 100%] of view_price_paid.
The amount should reflect the SHAPE of engagement: full completion with high focus earns more; partial
completion with low focus earns less. Express the suggestion in one short, human-readable sentence
that will be shown to the reader (readerMessage).

If you decide NOT to prompt, set kind="tip_skip", suggestedTip=null, readerMessage=null.

Return valid JSON matching exactly this shape:
{
  "kind": "tip" or "tip_skip",
  "suggestedTip": number or null,
  "viewPricePaid": ${viewPricePaid},
  "signalsCited": ["signal1", "signal2"],
  "reasoning": "creator-readable rationale (one paragraph)",
  "readerMessage": "one sentence for the reader explaining the tip suggestion, or null",
  "confidence": 0.0 to 1.0
}`;
}

/**
 * Validate and clamp an AgentDecision returned by the LLM.
 * Ensures: kind is valid, suggestedTip is in [10%, 100%] of viewPricePaid (§7.7),
 * arrays are arrays, confidence is clamped to 0..1.
 */
function validateAndClamp(raw: unknown, viewPricePaid: number, piece: PieceRow): AgentDecision {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('[reader] LLM returned non-object JSON');
  }

  const obj = raw as Record<string, unknown>;

  const kind = obj['kind'];
  if (kind !== 'tip' && kind !== 'tip_skip') {
    throw new Error(`[reader] Invalid kind: ${String(kind)}`);
  }

  const signalsCited = Array.isArray(obj['signalsCited'])
    ? (obj['signalsCited'] as unknown[]).map(String)
    : [];

  const reasoning =
    typeof obj['reasoning'] === 'string' && obj['reasoning'].trim()
      ? obj['reasoning']
      : 'No reasoning provided.';

  const readerMessage =
    typeof obj['readerMessage'] === 'string' && obj['readerMessage'].trim()
      ? obj['readerMessage']
      : null;

  const rawConfidence = typeof obj['confidence'] === 'number' ? obj['confidence'] : 0.5;
  const confidence = Math.min(1, Math.max(0, rawConfidence));

  if (kind === 'tip_skip') {
    return {
      kind: 'tip_skip',
      suggestedTip: null,
      viewPricePaid,
      signalsCited,
      reasoning,
      readerMessage: null,
      confidence,
    };
  }

  // kind === 'tip' — clamp suggestedTip to [10%, 100%] of viewPricePaid (§7.7)
  const minTip = viewPricePaid * 0.1;
  const maxTip = viewPricePaid * 1.0;

  const rawTip = typeof obj['suggestedTip'] === 'number' ? obj['suggestedTip'] : minTip;

  const minAmount: UsdcAmount = fromDisplay(minTip, USDC_ERC20_DECIMALS);
  const maxAmount: UsdcAmount = fromDisplay(maxTip, USDC_ERC20_DECIMALS);
  const tipAmount: UsdcAmount = fromDisplay(rawTip, USDC_ERC20_DECIMALS);
  const clamped = clamp(tipAmount, minAmount, maxAmount);
  const clampedTip = parseFloat(toDisplay(clamped).replace('$', ''));

  const fallbackMessage = `You spent quality time with "${piece.title}" — a small tip supports the creator.`;

  return {
    kind: 'tip',
    suggestedTip: clampedTip,
    viewPricePaid,
    signalsCited,
    reasoning,
    readerMessage: readerMessage ?? fallbackMessage,
    confidence,
  };
}

export function makeReaderWorker(db: SupabaseClient) {
  return async function readerWorker(rawPayload: unknown): Promise<void> {
    const { sessionId } = rawPayload as ReaderEvalPayload;

    console.log(`[reader] evaluating session ${sessionId}`);

    // --- Step 1: Fetch session, heartbeats, piece ---

    const { data: session, error: sessionErr } = await db
      .from('sessions')
      .select('id, piece_id, reader_id, view_price_paid, active_dwell_seconds, completion_pct, revisit_count')
      .eq('id', sessionId)
      .single();

    if (sessionErr || !session) {
      throw new Error(`[reader] session not found: ${sessionId} — ${sessionErr?.message ?? 'null'}`);
    }

    const { data: heartbeats, error: hbErr } = await db
      .from('heartbeats')
      .select('focused, scroll_pct, ts')
      .eq('session_id', sessionId)
      .order('ts', { ascending: true });

    if (hbErr) {
      // Non-fatal: proceed with empty heartbeats — agent will note low signal quality
      console.warn(`[reader] heartbeat fetch error for session ${sessionId}: ${hbErr.message}`);
    }

    const { data: piece, error: pieceErr } = await db
      .from('pieces')
      .select('id, title, length_chars')
      .eq('id', (session as SessionRow).piece_id)
      .single();

    if (pieceErr || !piece) {
      throw new Error(`[reader] piece not found: ${(session as SessionRow).piece_id} — ${pieceErr?.message ?? 'null'}`);
    }

    const typedSession = session as SessionRow;
    const typedHeartbeats = (heartbeats ?? []) as HeartbeatRow[];
    const typedPiece = piece as PieceRow;

    // --- Step 2: Derive metrics & build prompt ---

    const metrics = deriveMetrics(typedSession, typedHeartbeats, typedPiece);
    const { viewPricePaid } = metrics;

    const prompt = buildPrompt(typedSession, typedPiece, metrics);

    // --- Step 3: Call LLM, parse, validate ---

    const systemPrompt =
      'You are ReaderAgent, an AI that evaluates reader sessions on a content platform ' +
      'and decides whether to suggest a voluntary tip to the reader after they finish reading. ' +
      'You reason from engagement signals — not from fixed time rules. ' +
      'Always return valid JSON matching the requested schema exactly.';

    let decision: AgentDecision;
    try {
      const raw = await complete(prompt, { json: true, systemPrompt, maxTokens: 512 });
      const parsed: unknown = JSON.parse(raw);
      decision = validateAndClamp(parsed, viewPricePaid, typedPiece);
    } catch (err) {
      // Fallback to a safe tip_skip rather than crashing the job
      console.error(`[reader] LLM/parse error for session ${sessionId}:`, err);
      decision = {
        kind: 'tip_skip',
        suggestedTip: null,
        viewPricePaid,
        signalsCited: ['error:llm_failure'],
        reasoning: 'Agent error — defaulting to no tip prompt to avoid reader friction.',
        readerMessage: null,
        confidence: 0,
      };
    }

    console.log(
      `[reader] session ${sessionId} → ${decision.kind}` +
        (decision.kind === 'tip' ? ` $${decision.suggestedTip}` : '') +
        ` (confidence ${decision.confidence.toFixed(2)})`,
    );

    // --- Step 4: Persist tip_decisions (always, even for tip_skip) ---

    const suggestedTipBaseUnits =
      decision.kind === 'tip' && decision.suggestedTip !== null
        ? toBaseUnitsString(fromDisplay(decision.suggestedTip, USDC_ERC20_DECIMALS))
        : null;

    const { error: insertDecErr } = await db.from('tip_decisions').insert({
      session_id: sessionId,
      piece_id: typedSession.piece_id,
      prompted: decision.kind === 'tip',
      suggested_tip: suggestedTipBaseUnits,
      view_price_paid: typedSession.view_price_paid,
      signals_cited: decision.signalsCited,
      reasoning: decision.reasoning,
      confidence: decision.confidence,
      accepted: null,    // not yet — set when reader responds
      final_tip: null,
      tip_surplus: null,
    });

    if (insertDecErr) {
      throw new Error(`[reader] tip_decisions insert failed: ${insertDecErr.message}`);
    }

    // --- Step 5: If tip decision — insert notification for the reader ---

    if (decision.kind === 'tip') {
      const { error: insertNotifErr } = await db.from('notifications').insert({
        reader_id: typedSession.reader_id,
        kind: 'tip_prompt',
        payload: {
          sessionId,
          pieceId: typedSession.piece_id,
          suggestedTip: decision.suggestedTip,
          viewPricePaid: decision.viewPricePaid,
          readerMessage: decision.readerMessage,
        },
        read: false,
      });

      if (insertNotifErr) {
        // Non-fatal: decision is already persisted; log and continue
        console.error(
          `[reader] notifications insert failed for session ${sessionId}: ${insertNotifErr.message}`,
        );
      }
    }

    console.log(`[reader] session ${sessionId} complete — prompted=${decision.kind === 'tip'}`);
  };
}
