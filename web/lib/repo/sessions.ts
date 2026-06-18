// lib/repo/sessions.ts
import { SupabaseClient } from '@supabase/supabase-js';
import type { Session } from './types.js';

export async function getSession(db: SupabaseClient, id: string): Promise<Session | null> {
  const { data, error } = await db.from('sessions').select('*').eq('id', id).single();
  if (error && error.code !== 'PGRST116') throw error;
  return data ?? null;
}

export async function createSession(
  db: SupabaseClient,
  input: {
    piece_id: string;
    reader_id: string;
    view_price_paid: string;
  }
): Promise<Session> {
  const { data, error } = await db.from('sessions').insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateSessionDwell(
  db: SupabaseClient,
  id: string,
  activeDwellSeconds: number,
  completionPct: number,
  scrollPattern?: unknown
): Promise<void> {
  const update: Record<string, unknown> = {
    active_dwell_seconds: activeDwellSeconds,
    completion_pct: completionPct,
  };
  if (scrollPattern !== undefined) update.scroll_pattern = scrollPattern;
  const { error } = await db.from('sessions').update(update).eq('id', id);
  if (error) throw error;
}

export async function endSession(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db
    .from('sessions')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', id)
    .is('ended_at', null);
  if (error) throw error;
}

export async function incrementRevisit(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.rpc('increment_revisit', { session_id: id });
  if (error) throw error;
}

export async function getOpenSessions(db: SupabaseClient, timeoutSeconds: number): Promise<Session[]> {
  const cutoff = new Date(Date.now() - timeoutSeconds * 1000).toISOString();
  const { data, error } = await db
    .from('sessions')
    .select('*')
    .is('ended_at', null)
    .lt('unlocked_at', cutoff);
  if (error) throw error;
  return data ?? [];
}
