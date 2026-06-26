// src/workers/audit.ts — Creator Audit Agent.
// Runs before Watcher consumes telemetry. Two layers:
//   1. Deterministic pre-filter (bounce <1500ms, per-hour rate-limit, self-tip, z-score)
//   2. Groq judgment for statistical outliers (authentic_fraction)
// Writes to telemetry_audited via upsert — Watcher reads only audited rows.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  GROQ_API_KEY,
  GROQ_BASE_URL,
  GROQ_MODEL,
  isGroqMockMode,
} from '../config.js';

const MAX_VIEWS_PER_READER_PER_HOUR = 3;
const MIN_DWELL_MS = 1500;
const OUTLIER_VIEW_THRESHOLD = 10; // Groq check triggers if >10 authentic views OR z-score spike

type TelemetryRow = {
  id: string;
  article_id: string;
  reader_id: string;
  event_type: string;
  dwell_ms: number;
  ip_hash: string | null;
  ts: string;
};

function validateAuditGroqResult(raw: unknown): { authentic_fraction: number; reason: string } {
  if (!raw || typeof raw !== 'object') {
    return { authentic_fraction: 1.0, reason: 'invalid_response' };
  }
  const r = raw as Record<string, unknown>;
  const af = typeof r.authentic_fraction === 'number'
    ? r.authentic_fraction
    : parseFloat(String(r.authentic_fraction));
  const reason = typeof r.reason === 'string' ? r.reason : '';
  if (isNaN(af) || af < 0 || af > 1) {
    return { authentic_fraction: 1.0, reason: 'invalid_fraction' };
  }
  return { authentic_fraction: af, reason };
}

async function callAuditGroq(
  slug: string,
  pattern: string
): Promise<{ authentic_fraction: number; reason: string }> {
  if (isGroqMockMode || !GROQ_API_KEY) {
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

  try {
    const res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: 128,
        temperature: 0.1,
      }),
    });

    if (!res.ok) return { authentic_fraction: 1.0, reason: 'groq_error' };

    const json = await res.json() as { choices: { message: { content: string } }[] };
    const content = json.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(content) as unknown;
    return validateAuditGroqResult(parsed);
  } catch {
    return { authentic_fraction: 1.0, reason: 'groq_unavailable' };
  }
}

/** Compute mean and population std-dev of a number array. */
function stats(arr: number[]): { mean: number; stddev: number } {
  if (arr.length === 0) return { mean: 0, stddev: 0 };
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  return { mean, stddev: Math.sqrt(variance) };
}

async function auditArticle(
  db: SupabaseClient,
  slug: string,
  creatorEoa: string | null,
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
  // Key: `${reader_id}:${hourBucket}` — rate-limit is per reader per hour, not per window
  const readerHourCounts: Map<string, number> = new Map();
  let authenticViews = 0;
  let totalDwellMs = 0;
  let viewCount = 0;

  for (const row of typedRows) {
    if (row.event_type !== 'view') continue;

    // Drop bounces
    if (row.dwell_ms < MIN_DWELL_MS) continue;

    // Self-tip / self-view: skip views from the creator's own wallet
    if (creatorEoa && row.reader_id.toLowerCase() === creatorEoa.toLowerCase()) continue;

    // Per-hour rate limit per reader
    const hourBucket = Math.floor(new Date(row.ts).getTime() / 3_600_000);
    const key = `${row.reader_id}:${hourBucket}`;
    const count = readerHourCounts.get(key) ?? 0;
    if (count >= MAX_VIEWS_PER_READER_PER_HOUR) continue;
    readerHourCounts.set(key, count + 1);

    authenticViews++;
    totalDwellMs += row.dwell_ms;
    viewCount++;
  }

  const avgDwellMs = viewCount > 0 ? Math.round(totalDwellMs / viewCount) : 0;

  // --- Z-score spike detection ---
  // Compare current window's authentic views against the last 7d baseline for this article.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: history } = await db
    .from('telemetry_audited')
    .select('views')
    .eq('article_slug', slug)
    .gte('window_start', sevenDaysAgo);

  let zScoreSpike = false;
  if (history && history.length >= 3) {
    const historicalViews = history.map((r) => r.views as number);
    const { mean, stddev } = stats(historicalViews);
    if (stddev > 0 && (authenticViews - mean) / stddev > 2.5) {
      zScoreSpike = true;
      console.log(
        `[audit] ${slug}: z-score spike detected (views=${authenticViews}, mean=${mean.toFixed(1)}, stddev=${stddev.toFixed(1)})`
      );
    }
  }

  // --- Layer 2: Groq judgment for outliers ---
  let authenticFraction = 1.0;
  let auditReason = 'deterministic_only';

  const needsGroq = authenticViews > OUTLIER_VIEW_THRESHOLD || zScoreSpike;
  if (needsGroq) {
    const uniqueReaders = new Set(
      typedRows.filter((r) => r.event_type === 'view').map((r) => r.reader_id)
    ).size;

    const pattern = [
      `Total raw views: ${typedRows.filter((r) => r.event_type === 'view').length}`,
      `After deterministic filter: ${authenticViews}`,
      `Unique readers: ${uniqueReaders}`,
      `Avg dwell: ${avgDwellMs}ms`,
      `Z-score spike: ${zScoreSpike}`,
    ].join('\n');

    const groqResult = await callAuditGroq(slug, pattern);
    authenticFraction = groqResult.authentic_fraction;
    auditReason = groqResult.reason;
  }

  // --- Tip totals: only count tips, not unlock payments ---
  // Tips have endpoint matching /api/x402/tip/%; unlocks have /api/x402/<slug>.
  // Find the creator's ID to match the tip endpoint.
  let tipsAtomic = 0;
  if (creatorEoa) {
    // Look up creator by eoa_address to get their ID for the tip endpoint
    const { data: creator } = await db
      .from('creators')
      .select('id')
      .eq('eoa_address', creatorEoa)
      .single();

    if (creator?.id) {
      const tipEndpoint = `/api/x402/tip/${creator.id as string}`;
      const { data: tipPayments } = await db
        .from('payment_events')
        .select('amount_usdc')
        .eq('endpoint', tipEndpoint)
        .gte('created_at', since);

      tipsAtomic = (tipPayments ?? []).reduce(
        (sum, p) => sum + parseInt(p.amount_usdc as string, 10),
        0
      );
    }
  }

  // Upsert: one canonical row per (article_slug, window_start hour bucket)
  const windowHour = new Date(since);
  windowHour.setMinutes(0, 0, 0);

  await db.from('telemetry_audited').upsert({
    article_slug: slug,
    window_start: windowHour.toISOString(),
    views: authenticViews,
    avg_dwell_ms: avgDwellMs,
    tips_atomic: tipsAtomic,
    authentic_fraction: authenticFraction,
  }, { onConflict: 'article_slug,window_start' });

  console.log(
    `[audit] ${slug}: ${authenticViews} auth views, fraction=${authenticFraction.toFixed(3)}, reason=${auditReason}, zSpike=${zScoreSpike}`
  );
}

export async function runAudit(db: SupabaseClient): Promise<void> {
  console.log('[audit] starting audit run...');

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Fetch articles with their creator EOA for self-tip / tip-endpoint filtering
  const { data: articles, error } = await db
    .from('articles')
    .select('slug, creators(eoa_address)');

  if (error || !articles || articles.length === 0) {
    console.log('[audit] no articles to audit');
    return;
  }

  for (const article of articles) {
    try {
      const creatorEoa = (article.creators as { eoa_address?: string } | null)?.eoa_address ?? null;
      await auditArticle(db, article.slug as string, creatorEoa, since);
    } catch (err) {
      console.error(`[audit] failed for ${article.slug}:`, err);
    }
  }

  console.log(`[audit] done — audited ${articles.length} article(s)`);
}

export function startAudit(db: SupabaseClient, intervalMs: number): void {
  console.log(`[audit] starting — interval ${Math.round(intervalMs / 60000)}min`);
  runAudit(db).catch((err) => console.error('[audit] initial run error:', err));
  setInterval(() => {
    runAudit(db).catch((err) => console.error('[audit] interval error:', err));
  }, intervalMs);
}
