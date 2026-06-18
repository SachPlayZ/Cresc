// lib/repo/jobs.ts — job queue helpers for the web app (enqueue side).
// The agents service (Cresc-Agents) handles the consume/claim side.
import { SupabaseClient } from '@supabase/supabase-js';
import type { Job, JobPayload } from './types';

export async function enqueueJob(
  db: SupabaseClient,
  kind: Job['kind'],
  payload: JobPayload
): Promise<Job> {
  const { data, error } = await db
    .from('jobs')
    .insert({ kind, payload })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getJob(db: SupabaseClient, id: string): Promise<Job | null> {
  const { data, error } = await db.from('jobs').select('*').eq('id', id).single();
  if (error && error.code !== 'PGRST116') throw error;
  return data ?? null;
}
