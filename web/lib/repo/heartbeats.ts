// lib/repo/heartbeats.ts
import { SupabaseClient } from '@supabase/supabase-js';
import type { Heartbeat } from './types';

export async function insertHeartbeat(
  db: SupabaseClient,
  input: { session_id: string; focused: boolean; scroll_pct: number }
): Promise<void> {
  const { error } = await db.from('heartbeats').insert(input);
  if (error) throw error;
}

export async function getLastHeartbeat(
  db: SupabaseClient,
  sessionId: string
): Promise<Heartbeat | null> {
  const { data, error } = await db
    .from('heartbeats')
    .select('*')
    .eq('session_id', sessionId)
    .order('ts', { ascending: false })
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data ?? null;
}

export async function getHeartbeatsSince(
  db: SupabaseClient,
  sessionId: string,
  since: Date
): Promise<Heartbeat[]> {
  const { data, error } = await db
    .from('heartbeats')
    .select('*')
    .eq('session_id', sessionId)
    .gte('ts', since.toISOString())
    .order('ts', { ascending: true });
  if (error) throw error;
  return data ?? [];
}
