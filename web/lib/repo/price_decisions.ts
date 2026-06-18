// lib/repo/price_decisions.ts
import { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import type { PriceDecision } from './types';

export async function createPriceDecision(
  db: SupabaseClient,
  input: Omit<PriceDecision, 'id' | 'created_at'>
): Promise<PriceDecision> {
  const { data, error } = await db.from('price_decisions').insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function getRecentPriceDecisions(
  db: SupabaseClient,
  pieceId: string,
  limit = 20
): Promise<PriceDecision[]> {
  const { data, error } = await db
    .from('price_decisions')
    .select('*')
    .eq('piece_id', pieceId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// Realtime subscription for new price decisions (creator dashboard live reasoning log)
export function subscribeToPriceDecisions(
  db: SupabaseClient,
  pieceId: string,
  onDecision: (d: PriceDecision) => void
): RealtimeChannel {
  return db
    .channel(`price_decisions:${pieceId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'price_decisions', filter: `piece_id=eq.${pieceId}` },
      (payload) => onDecision(payload.new as PriceDecision)
    )
    .subscribe();
}
