// src/queue/enqueue.ts — INSERT helper for jobs table (used by agents triggering follow-on sweeps).
import { SupabaseClient } from '@supabase/supabase-js';

export type JobKind = 'pricing_sweep' | 'reader_eval' | 'tip_feedback';

export async function enqueueJob(
  db: SupabaseClient,
  kind: JobKind,
  payload: Record<string, unknown>
): Promise<string> {
  const { data, error } = await db
    .from('jobs')
    .insert({ kind, payload })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}
