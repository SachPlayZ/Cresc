// lib/repo/tip_decisions.ts
import { SupabaseClient } from '@supabase/supabase-js';
import type { TipDecision } from './types';

export async function createTipDecision(
  db: SupabaseClient,
  input: Omit<TipDecision, 'id' | 'created_at'>
): Promise<TipDecision> {
  const { data, error } = await db.from('tip_decisions').insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function getTipDecision(db: SupabaseClient, id: string): Promise<TipDecision | null> {
  const { data, error } = await db.from('tip_decisions').select('*').eq('id', id).single();
  if (error && error.code !== 'PGRST116') throw error;
  return data ?? null;
}

export async function getTipDecisionBySession(
  db: SupabaseClient,
  sessionId: string
): Promise<TipDecision | null> {
  const { data, error } = await db
    .from('tip_decisions')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data ?? null;
}

export async function acceptTip(
  db: SupabaseClient,
  id: string,
  finalTip: string,
  tipSurplus: string | null
): Promise<void> {
  const { error } = await db
    .from('tip_decisions')
    .update({ accepted: true, final_tip: finalTip, tip_surplus: tipSurplus })
    .eq('id', id);
  if (error) throw error;
}

export async function declineTip(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db
    .from('tip_decisions')
    .update({ accepted: false })
    .eq('id', id);
  if (error) throw error;
}
