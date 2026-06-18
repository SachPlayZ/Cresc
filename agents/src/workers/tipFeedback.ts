// src/workers/tipFeedback.ts — M7b: tip surplus feedback worker.
// Handles jobs of kind: 'tip_feedback'
//
// Payload: { tipDecisionId: string, surplus: string /* base-unit bigint string */ }
//
// Responsibility:
//  1. Load tip_decision → get piece_id (for the pricing_sweep enqueue).
//  2. Write tip_decisions.tip_surplus (belt-and-suspenders — M7a's acceptTip already sets it,
//     but the worker re-asserts it so the signal is guaranteed before the sweep reads it).
//  3. Enqueue a 'pricing_sweep' job with trigger='tip_surplus'.
//     → PricingAgent reads getSignalBundle(pieceId) which includes recentTipSurplus > 0.
//     → PricingAgent cites the surplus in its reasoning chain → price rises.
//     → THIS IS THE EMERGENT LOOP (CLAUDE.md §6.5).
//
// Error handling: throws on fatal errors so the job runner marks the job 'failed' + retries.

import type { SupabaseClient } from '@supabase/supabase-js';

export type TipFeedbackPayload = {
  tipDecisionId: string;
  surplus: string; // base-unit bigint string (6-dec USDC ERC-20 on Arc Testnet)
};

export function makeTipFeedbackWorker(db: SupabaseClient) {
  return async function tipFeedbackWorker(rawPayload: unknown): Promise<void> {
    const { tipDecisionId, surplus } = rawPayload as TipFeedbackPayload;

    if (!tipDecisionId || typeof tipDecisionId !== 'string') {
      throw new Error('[tipFeedback] Invalid payload: tipDecisionId must be a non-empty string');
    }
    if (!surplus || typeof surplus !== 'string') {
      throw new Error('[tipFeedback] Invalid payload: surplus must be a non-empty string');
    }

    // --- 1. Load tip_decision to get piece_id ---
    const { data: tipDecision, error: fetchError } = await db
      .from('tip_decisions')
      .select('piece_id, suggested_tip, final_tip')
      .eq('id', tipDecisionId)
      .single();

    if (fetchError || !tipDecision) {
      throw new Error(
        `[tipFeedback] tip_decision ${tipDecisionId} not found: ${fetchError?.message ?? 'null row'}`
      );
    }

    const pieceId: string = tipDecision.piece_id as string;

    // --- 2. Write tip_surplus (belt-and-suspenders) ---
    // M7a's acceptTip() already sets this, but we assert it here so the field is
    // guaranteed present before the pricing_sweep job reads getSignalBundle.
    const { error: updateError } = await db
      .from('tip_decisions')
      .update({ tip_surplus: surplus })
      .eq('id', tipDecisionId);

    if (updateError) {
      // Non-fatal if M7a already wrote it — log and continue.
      console.warn(
        `[tipFeedback] tip_surplus update warning for ${tipDecisionId}: ${updateError.message}`
      );
    }

    // --- 3. Enqueue pricing_sweep with tip_surplus trigger ---
    // The PricingAgent sweep will call getSignalBundle(pieceId), which queries
    // tip_decisions WHERE accepted=true AND tip_surplus IS NOT NULL for the past 24h.
    // recentTipSurplus > 0 → agent cites it in reasoning → price rises.
    // This is the emergent loop: tip_surplus → pricing_sweep → price rise.
    const { error: enqueueError } = await db
      .from('jobs')
      .insert({
        kind: 'pricing_sweep',
        payload: { pieceId, trigger: 'tip_surplus' },
        status: 'pending',
      });

    if (enqueueError) {
      throw new Error(
        `[tipFeedback] failed to enqueue pricing_sweep for piece ${pieceId}: ${enqueueError.message}`
      );
    }

    console.log(
      `[tipFeedback] surplus ${surplus} base-units on tip_decision ${tipDecisionId} ` +
      `→ queued pricing_sweep (trigger=tip_surplus) for piece ${pieceId}` +
      ` | emergent loop: signal recorded, PricingAgent will cite surplus in next sweep`
    );
  };
}
