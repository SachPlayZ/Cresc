// lib/repo/payments.ts
import { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import type { Payment } from './types';

export async function createPayment(
  db: SupabaseClient,
  input: Omit<Payment, 'id' | 'created_at'>
): Promise<Payment> {
  const { data, error } = await db.from('payments').insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function settlePayment(
  db: SupabaseClient,
  id: string,
  txRef: string,
  arcExplorerUrl: string,
  /** Verified payer EOA from Gateway result — fixes reader_id from cookie UUID to EOA address. */
  payer?: string
): Promise<void> {
  const update: Record<string, string> = {
    status: 'settled',
    tx_ref: txRef,
    arc_explorer_url: arcExplorerUrl,
  };
  if (payer) update.reader_id = payer;
  const { error } = await db.from('payments').update(update).eq('id', id);
  if (error) throw error;
}

export async function failPayment(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from('payments').update({ status: 'failed' }).eq('id', id);
  if (error) throw error;
}

export async function getPaymentsByPiece(
  db: SupabaseClient,
  pieceId: string,
  limit = 50
): Promise<Payment[]> {
  const { data, error } = await db
    .from('payments')
    .select('*')
    .eq('piece_id', pieceId)
    .eq('status', 'settled')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/**
 * Sum of settled, not-yet-paid-out payments for all pieces owned by creatorId.
 * Returns base-unit bigint (6-dec USDC).
 */
export async function getUnpaidEarnings(
  db: SupabaseClient,
  creatorId: string
): Promise<bigint> {
  const { data: pieces } = await db
    .from('pieces')
    .select('id')
    .eq('creator_id', creatorId);
  const pieceIds = (pieces ?? []).map((p: { id: string }) => p.id);
  if (!pieceIds.length) return 0n;
  const { data, error } = await db
    .from('payments')
    .select('amount')
    .in('piece_id', pieceIds)
    .eq('status', 'settled')
    .is('payout_ref', null);
  if (error) throw error;
  return (data ?? []).reduce((sum: bigint, p: { amount: string }) => sum + BigInt(p.amount), 0n);
}

/**
 * Mark all unpaid settled payments for creatorId as paid out.
 * Called immediately after a successful withdrawFromGatewayCircle.
 * The WHERE payout_ref IS NULL guard is atomic — safe against concurrent payout requests.
 */
export async function markPaymentsPaidOut(
  db: SupabaseClient,
  creatorId: string,
  payoutTxRef: string
): Promise<void> {
  const { data: pieces } = await db
    .from('pieces')
    .select('id')
    .eq('creator_id', creatorId);
  const pieceIds = (pieces ?? []).map((p: { id: string }) => p.id);
  if (!pieceIds.length) return;
  const { error } = await db
    .from('payments')
    .update({ payout_ref: payoutTxRef })
    .in('piece_id', pieceIds)
    .eq('status', 'settled')
    .is('payout_ref', null);
  if (error) throw error;
}

// Realtime subscription for settled payments on a piece (dashboard live feed)
export function subscribeToPayments(
  db: SupabaseClient,
  pieceId: string,
  onPayment: (p: Payment) => void
): RealtimeChannel {
  return db
    .channel(`payments:${pieceId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'payments', filter: `piece_id=eq.${pieceId}` },
      (payload) => {
        if ((payload.new as Payment).status === 'settled') {
          onPayment(payload.new as Payment);
        }
      }
    )
    .subscribe();
}
