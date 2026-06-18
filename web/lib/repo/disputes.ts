// lib/repo/disputes.ts
import { SupabaseClient } from '@supabase/supabase-js';
import type { Dispute } from './types.js';

export async function createDispute(
  db: SupabaseClient,
  input: { price_decision_id: string; creator_id: string; note: string }
): Promise<Dispute> {
  const { data, error } = await db.from('disputes').insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function getDisputesByCreator(db: SupabaseClient, creatorId: string): Promise<Dispute[]> {
  const { data, error } = await db
    .from('disputes')
    .select('*')
    .eq('creator_id', creatorId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
