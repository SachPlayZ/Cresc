// lib/repo/payments.ts
import { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import type { Payment } from './types.js';

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
  arcExplorerUrl: string
): Promise<void> {
  const { error } = await db
    .from('payments')
    .update({ status: 'settled', tx_ref: txRef, arc_explorer_url: arcExplorerUrl })
    .eq('id', id);
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
