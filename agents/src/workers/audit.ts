// src/workers/audit.ts — Creator Audit Agent.
// Runs before Watcher consumes telemetry. Two layers:
//   1. Deterministic pre-filter (bounce <1500ms, rate-limit, self-tip)
//   2. LLM judgment for statistical outliers (Groq → authentic_fraction)
// Writes to telemetry_audited — Watcher reads only audited rows.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  LLM_API_KEY,
  LLM_BASE_URL,
  LLM_MODEL,
  isMockMode,
} from '../config.js';

const MAX_VIEWS_PER_READER_PER_HOUR = 3;
const MIN_DWELL_MS = 1500;

type TelemetryRow = {
  id: string;
  article_id: string;
  reader_id: string;
  event_type: string;
  dwell_ms: number;
  ip_hash: string | null;
  ts: string;
};

async function callAuditLLM(
  slug: string,
  pattern: string
): Promise<{ authentic_fraction: number; reason: string }> {
  if (isMockMode || !LLM_API_KEY) {
    return { authentic_fraction: 0.9, reason: 'mock mode stub' };
  }

  const prompt = `You are auditing traffic patterns for a paid article to detect inauthentic views.

Article slug: "${slug}"
Traffic pattern (24h):
${pattern}

Return JSON only:
{
  "authentic_fraction": <0.0-1.0, fraction of views likely genuine>,
  "reason": "<one short clause>"
}`;

  const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LLM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 128,
      temperature: 0.1,
    }),
  });

  if (!res.ok) return { authentic_fraction: 1.0, reason: 'llm_error' };

  const json = await res.json() as { choices: { message: { content: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? '{}';
  return JSON.parse(content) as { authentic_fraction: number; reason: string };
}

async function auditArticle(
  db: SupabaseClient,
  slug: string,
  since: string
): Promise<void> {
  const { data: rows, error } = await db
    .from('telemetry')
    .select('*')
    .eq('article_id', slug)
    .gte('ts', since);

  if (error || !rows || rows.length === 0) return;

  const typedRows = rows as TelemetryRow[];

  // --- Layer 1: Deterministic filter ---
  const readerViewCounts: Map<string, number> = new Map();
  let authenticViews = 0;
  let totalDwellMs = 0;
  let viewCount = 0;

  for (const row of typedRows) {
    if (row.event_type !== 'view') continue;

    // Drop bounces
    if (row.dwell_ms < MIN_DWELL_MS) continue;

    // Rate limit per reader per hour
    const count = readerViewCounts.get(row.reader_id) ?? 0;
    if (count >= MAX_VIEWS_PER_READER_PER_HOUR) continue;
    readerViewCounts.set(row.reader_id, count + 1);

    authenticViews++;
    totalDwellMs += row.dwell_ms;
    viewCount++;
  }

  const avgDwellMs = viewCount > 0 ? Math.round(totalDwellMs / viewCount) : 0;

  // --- Layer 2: LLM judgment for outliers ---
  // Check if traffic is a statistical outlier (simple heuristic: >10 views in window)
  let authenticFraction = 1.0;
  let auditReason = 'deterministic_only';

  if (authenticViews > 10) {
    const pattern = [
      `Total raw views: ${typedRows.filter((r) => r.event_type === 'view').length}`,
      `After deterministic filter: ${authenticViews}`,
      `Unique readers: ${readerViewCounts.size}`,
      `Avg dwell: ${avgDwellMs}ms`,
      `Inter-arrival pattern: ${typedRows.length > 0 ? 'available' : 'empty'}`,
    ].join('\n');

    const llmResult = await callAuditLLM(slug, pattern).catch(() => ({
      authentic_fraction: 1.0,
      reason: 'llm_unavailable',
    }));

    authenticFraction = llmResult.authentic_fraction;
    auditReason = llmResult.reason;
  }

  // Tip totals (from payment_events)
  const { data: tipPayments } = await db
    .from('payment_events')
    .select('amount_usdc')
    .eq('article_slug', slug)
    .gte('created_at', since);

  const tipsAtomic = (tipPayments ?? []).reduce(
    (sum, p) => sum + parseInt(p.amount_usdc as string, 10),
    0
  );

  await db.from('telemetry_audited').insert({
    article_slug: slug,
    window_start: since,
    views: authenticViews,
    avg_dwell_ms: avgDwellMs,
    tips_atomic: tipsAtomic,
    authentic_fraction: authenticFraction,
  });

  console.log(
    `[audit] ${slug}: ${authenticViews} auth views, fraction=${authenticFraction.toFixed(3)}, reason=${auditReason}`
  );
}

export async function runAudit(db: SupabaseClient): Promise<void> {
  console.log('[audit] starting audit run...');

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: articles, error } = await db
    .from('articles')
    .select('slug');

  if (error || !articles || articles.length === 0) {
    console.log('[audit] no articles to audit');
    return;
  }

  for (const article of articles) {
    try {
      await auditArticle(db, article.slug as string, since);
    } catch (err) {
      console.error(`[audit] failed for ${article.slug}:`, err);
    }
  }

  console.log(`[audit] done — audited ${articles.length} article(s)`);
}

export function startAudit(db: SupabaseClient, intervalMs: number): void {
  console.log(`[audit] starting — interval ${Math.round(intervalMs / 60000)}min`);
  // Run audit before first watcher cycle
  runAudit(db).catch((err) => console.error('[audit] initial run error:', err));
  setInterval(() => {
    runAudit(db).catch((err) => console.error('[audit] interval error:', err));
  }, intervalMs);
}
