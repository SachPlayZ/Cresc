// src/workers/watcher.ts — Hourly Watcher: reads audited telemetry, recomputes article prices.
// Deterministic formula (CLAUDE.md §Agent decision logic / Watcher):
//   demand = W_VIEWS*norm(views_24h) + W_DWELL*norm(avg_dwell_24h) + W_TIPS*norm(tips_24h)
//   target = round(base_price_atomic * (0.5 + demand))
//   new_price = clamp(target, PRICE_MIN, PRICE_MAX)
//   new_price = clamp(new_price, prev*0.8, prev*1.2)  -- ±20%/hr volatility damp

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  PRICE_MIN_ATOMIC,
  PRICE_MAX_ATOMIC,
  W_VIEWS,
  W_DWELL,
  W_TIPS,
} from '../config.js';

type AuditedRow = {
  article_slug: string;
  views: number;
  avg_dwell_ms: number;
  tips_atomic: number;
  authentic_fraction: number;
};

type ArticleRow = {
  slug: string;
  base_price_atomic: number;
  current_price_atomic: number;
};

/** Compute rolling medians for normalization from recent audited windows. */
async function computeMedians(
  db: SupabaseClient,
  slugs: string[]
): Promise<{ medViews: number; medDwell: number; medTips: number }> {
  if (slugs.length === 0) return { medViews: 1, medDwell: 1000, medTips: 1 };

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await db
    .from('telemetry_audited')
    .select('views, avg_dwell_ms, tips_atomic')
    .in('article_slug', slugs)
    .gte('window_start', since);

  if (!data || data.length === 0) return { medViews: 1, medDwell: 1000, medTips: 1 };

  const views = data.map((r) => r.views as number).sort((a, b) => a - b);
  const dwells = data.map((r) => r.avg_dwell_ms as number).sort((a, b) => a - b);
  const tips = data.map((r) => r.tips_atomic as number).sort((a, b) => a - b);

  const med = (arr: number[]) => {
    const m = Math.floor(arr.length / 2);
    return arr.length % 2 === 0 ? (arr[m - 1] + arr[m]) / 2 : arr[m];
  };

  return {
    medViews: Math.max(med(views), 1),
    medDwell: Math.max(med(dwells), 1),
    medTips:  Math.max(med(tips),  1),
  };
}

async function repriceArticle(
  db: SupabaseClient,
  article: ArticleRow,
  medians: { medViews: number; medDwell: number; medTips: number }
): Promise<void> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: rows } = await db
    .from('telemetry_audited')
    .select('views, avg_dwell_ms, tips_atomic, authentic_fraction')
    .eq('article_slug', article.slug)
    .gte('window_start', since24h)
    .order('window_start', { ascending: false })
    .limit(1);

  const audited = (rows?.[0] ?? { views: 0, avg_dwell_ms: 0, tips_atomic: 0, authentic_fraction: 1.0 }) as AuditedRow;
  const af = audited.authentic_fraction ?? 1.0;

  const views24h    = (audited.views ?? 0) * af;
  const avgDwell24h = audited.avg_dwell_ms ?? 0;
  const tips24h     = (audited.tips_atomic ?? 0) * af;

  const viewsNorm = views24h    / medians.medViews;
  const dwellNorm = avgDwell24h / medians.medDwell;
  const tipsNorm  = tips24h     / medians.medTips;

  const demand = W_VIEWS * viewsNorm + W_DWELL * dwellNorm + W_TIPS * tipsNorm;

  let target = Math.round(article.base_price_atomic * (0.5 + demand));
  target = Math.min(Math.max(target, PRICE_MIN_ATOMIC), PRICE_MAX_ATOMIC);

  const prev = article.current_price_atomic;
  const newPrice = Math.min(Math.max(target, Math.round(prev * 0.8)), Math.round(prev * 1.2));

  if (newPrice === prev) return; // no change

  await db
    .from('articles')
    .update({ current_price_atomic: newPrice, updated_at: new Date().toISOString() })
    .eq('slug', article.slug);

  await db.from('price_history').insert({
    article_slug: article.slug,
    price_atomic: newPrice,
    reason: { views_norm: viewsNorm, dwell_norm: dwellNorm, tips_norm: tipsNorm, demand },
  });

  console.log(
    `[watcher] ${article.slug}: ${prev} → ${newPrice} (demand=${demand.toFixed(3)})`
  );
}

export async function runWatcher(db: SupabaseClient): Promise<void> {
  console.log('[watcher] starting hourly reprice run...');

  const { data: articles, error } = await db
    .from('articles')
    .select('slug, base_price_atomic, current_price_atomic');

  if (error || !articles || articles.length === 0) {
    console.log('[watcher] no articles to reprice');
    return;
  }

  const slugs = articles.map((a) => a.slug as string);
  const medians = await computeMedians(db, slugs);

  for (const article of articles) {
    try {
      await repriceArticle(db, article as ArticleRow, medians);
    } catch (err) {
      console.error(`[watcher] reprice failed for ${article.slug}:`, err);
    }
  }

  console.log(`[watcher] done — repriced ${articles.length} article(s)`);
}

export function startWatcher(db: SupabaseClient, intervalMs: number): void {
  console.log(`[watcher] starting — interval ${Math.round(intervalMs / 60000)}min`);
  runWatcher(db).catch((err) => console.error('[watcher] initial run error:', err));
  setInterval(() => {
    runWatcher(db).catch((err) => console.error('[watcher] interval error:', err));
  }, intervalMs);
}
