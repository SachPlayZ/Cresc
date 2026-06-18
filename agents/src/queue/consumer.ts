// src/queue/consumer.ts — poll+claim queue consumer for the jobs table.
// Uses optimistic lock (UPDATE WHERE status='pending') so multiple instances don't double-process.
// Supabase Realtime INSERT on jobs table wakes the consumer fast; polling is a safety net.

import { SupabaseClient } from '@supabase/supabase-js';

export type WorkerFn = (payload: unknown) => Promise<void>;
const _workers = new Map<string, WorkerFn>();

export function registerWorker(kind: string, fn: WorkerFn): void {
  _workers.set(kind, fn);
}

const POLL_INTERVAL_MS = 2000;
const MAX_RETRIES = 3;
const CLAIM_BATCH = 5;

let _polling = false;

async function claimAndProcess(db: SupabaseClient): Promise<void> {
  // Fetch a batch of pending jobs ordered by age
  const { data: pending, error: fetchErr } = await db
    .from('jobs')
    .select('id, kind, payload, retries')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(CLAIM_BATCH);

  if (fetchErr) {
    console.error('[consumer] fetch error:', fetchErr.message);
    return;
  }

  for (const job of pending ?? []) {
    // Optimistic lock: only proceeds if status is still 'pending'
    const { data: claimed, error: claimErr } = await db
      .from('jobs')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('status', 'pending')
      .select('id')
      .single();

    if (claimErr || !claimed) continue; // another instance claimed it first

    const worker = _workers.get(job.kind as string);
    if (!worker) {
      console.warn(`[consumer] no worker registered for kind: ${job.kind}`);
      await db
        .from('jobs')
        .update({ status: 'failed', error: `no worker for kind: ${job.kind}`, done_at: new Date().toISOString() })
        .eq('id', job.id);
      continue;
    }

    try {
      await worker(job.payload);
      await db
        .from('jobs')
        .update({ status: 'done', done_at: new Date().toISOString() })
        .eq('id', job.id);
      console.log(`[consumer] job ${job.id} (${job.kind}) done`);
    } catch (err) {
      const retries = (job.retries as number) + 1;
      const failed = retries >= MAX_RETRIES;
      await db
        .from('jobs')
        .update({
          status: failed ? 'failed' : 'pending',
          error: err instanceof Error ? err.message : String(err),
          retries,
          started_at: null,
          ...(failed ? { done_at: new Date().toISOString() } : {}),
        })
        .eq('id', job.id);
      console.error(`[consumer] job ${job.id} (${job.kind}) ${failed ? 'FAILED' : 'retry ' + retries}:`, err);
    }
  }
}

export async function startConsumer(db: SupabaseClient): Promise<void> {
  console.log('[consumer] starting...');

  // Realtime wakeup on new job inserts
  db
    .channel('jobs-wakeup')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'jobs' },
      () => {
        if (!_polling) claimAndProcess(db).catch(console.error);
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') console.log('[consumer] realtime ready');
    });

  // Safety-net poll loop
  const poll = async () => {
    _polling = true;
    await claimAndProcess(db).catch(console.error);
    _polling = false;
  };

  // Initial drain of any jobs inserted while service was down
  await poll();

  setInterval(poll, POLL_INTERVAL_MS);
  console.log('[consumer] ready — polling every', POLL_INTERVAL_MS, 'ms');
}
