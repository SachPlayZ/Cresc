// lib/repo/readers.ts — per-reader budget tracking (shared buyer EOA pattern).
import { SupabaseClient } from '@supabase/supabase-js';
import type { Reader } from './types';

const DEFAULT_DAILY_BUDGET  = 5_000_000n;  // $5.00 atomic
const DEFAULT_SESSION_BUDGET = 1_000_000n; // $1.00 atomic

export async function getReader(
  db: SupabaseClient,
  userId: string
): Promise<Reader | null> {
  const { data, error } = await db
    .from('readers')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data ?? null;
}

export async function ensureReader(
  db: SupabaseClient,
  userId: string
): Promise<Reader> {
  const { data, error } = await db
    .from('readers')
    .upsert(
      {
        user_id: userId,
        daily_budget_atomic: DEFAULT_DAILY_BUDGET.toString(),
        session_budget_atomic: DEFAULT_SESSION_BUDGET.toString(),
        spent_today_atomic: '0',
        spent_session_atomic: '0',
        session_reset_at: new Date().toISOString(),
      },
      { onConflict: 'user_id', ignoreDuplicates: true }
    )
    .select()
    .single();

  if (error || !data) {
    // Row existed — fetch it
    const existing = await getReader(db, userId);
    if (!existing) throw new Error(`[readers] could not ensure reader ${userId}`);
    return existing;
  }
  return data as Reader;
}

export async function recordReaderSpend(
  db: SupabaseClient,
  userId: string,
  amountAtomic: bigint
): Promise<void> {
  const { error } = await db.rpc('record_reader_spend', {
    p_user_id: userId,
    p_amount: amountAtomic.toString(),
  });
  if (error) throw error;
}
