// src/workers/watcher.ts — Pricing Agent: reads audited telemetry, tunes content-contract prices.
// Two-stage design (CLAUDE.md §Agent decision logic / Watcher):
//   1. demand = W_VIEWS*norm(views_24h) + W_DWELL*norm(avg_dwell_24h) + W_TIPS*norm(tips_24h)
//      (same normalized signals as before — fed to the agent as context, not a hard target)
//   2. Groq call judges the actual move: { move_pct: -5..5, reason }, mirroring the Reader
//      Agent's quality/interest/confidence gate call (reader-agent.ts). The returned move_pct
//      is hard-clamped to ±PRICE_MAX_HOURLY_MOVE_PCT regardless of what the model says —
//      never trust LLM output unbounded.
//   new_price = clamp(round(prev * (1 + move_pct/100)), PRICE_MIN, PRICE_MAX)

import type { SupabaseClient } from '@supabase/supabase-js';
import { keccak256, toHex } from 'viem';
import {
  PRICE_MIN_ATOMIC,
  PRICE_MAX_ATOMIC,
  PRICE_MAX_HOURLY_MOVE_PCT,
  W_VIEWS,
  W_DWELL,
  W_TIPS,
  GROQ_API_KEY,
  GROQ_BASE_URL,
  GROQ_MODEL,
  isGroqMockMode,
} from '../config.js';
import { tuneContentPrice } from './content-contracts.js';

// Must match ContentVault.PRICE_MAX_ATOMIC (contracts/src/ContentVault.sol) — the contract
// ceiling always wins. If PRICE_MAX_ATOMIC env is set above this, tunePrice would revert on
// every call.
const CONTRACT_PRICE_MAX_ATOMIC = 1_000_000;

type AuditedRow = {
  article_slug: string;
  views: number;
  avg_dwell_ms: number;
  tips_atomic: number;
  authentic_fraction: number;
};

type ArticleRow = {
  slug: string;
  title: string | null;
  content_contract: string | null;
  base_price_atomic: string | number;
  current_price_atomic: string | number;
};

type PriceMove = { move_pct: number; reason: string };

function clampMovePct(pct: number): number {
  const bound = PRICE_MAX_HOURLY_MOVE_PCT * 100;
  if (!Number.isFinite(pct)) return 0;
  return Math.min(Math.max(pct, -bound), bound);
}

/**
 * Groq judges the hourly price move for one article, given the normalized demand
 * signals as context (not a hard target). Mirrors reader-agent.ts's callGroq shape
 * (strict JSON, mock-mode stub when GROQ_API_KEY is unset).
 */
async function judgePriceMove(
  article: ArticleRow,
  signals: { viewsNorm: number; dwellNorm: number; tipsNorm: number; demand: number },
  prev: number,
  basePriceAtomic: number
): Promise<PriceMove> {
  // Deterministic reference: what the old formula would have implied, as a prior for
  // the model (and the mock-mode fallback below) — never used as the final value directly.
  const formulaTarget = basePriceAtomic * (0.5 + signals.demand);
  const formulaPct = prev > 0 ? ((formulaTarget - prev) / prev) * 100 : 0;

  if (isGroqMockMode || !GROQ_API_KEY) {
    return { move_pct: clampMovePct(formulaPct), reason: 'mock mode stub' };
  }

  const prompt = `You are the Pricing Agent for a pay-per-article content platform. Decide how much \
to move this article's price for the next hour.

Article: "${article.title ?? article.slug}"
Current price: $${(prev / 1_000_000).toFixed(4)} USDC
Base price: $${(basePriceAtomic / 1_000_000).toFixed(4)} USDC

Demand signals (normalized against 7-day rolling medians across all articles):
- views (24h), normalized: ${signals.viewsNorm.toFixed(3)}
- avg dwell time (24h), normalized: ${signals.dwellNorm.toFixed(3)}
- tips (24h), normalized: ${signals.tipsNorm.toFixed(3)}
- combined demand score: ${signals.demand.toFixed(3)}
- reference: a naive demand-only formula implies a ${formulaPct.toFixed(2)}% change this hour

You MUST return a move strictly between -5 and 5 (percent). Use your judgement — the naive
formula above is a reference point, not a target; you may move less, more (within the band),
or the opposite direction if the signals don't support the naive read.

Respond strictly as JSON with no prose:
{
  "move_pct": <number between -5 and 5>,
  "reason": "<one short clause>"
}`;

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
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`[pricing] Groq call failed: ${res.status} ${txt.slice(0, 200)}`);
  }

  const json = await res.json() as { choices: { message: { content: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(content) as { move_pct?: unknown; reason?: unknown };
  const movePct = typeof parsed.move_pct === 'number' ? parsed.move_pct : parseFloat(String(parsed.move_pct));
  if (isNaN(movePct)) {
    throw new Error(`[pricing] Groq response missing numeric move_pct: ${content}`);
  }
  const reason = typeof parsed.reason === 'string' ? parsed.reason : '';
  return { move_pct: clampMovePct(movePct), reason };
}

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

  const basePriceAtomic = Number(BigInt(String(article.base_price_atomic)));
  const prev = Number(BigInt(String(article.current_price_atomic)));

  const effectiveMaxAtomic = Math.min(PRICE_MAX_ATOMIC, CONTRACT_PRICE_MAX_ATOMIC);

  const { move_pct: movePct, reason: llmReason } = await judgePriceMove(
    article,
    { viewsNorm, dwellNorm, tipsNorm, demand },
    prev,
    basePriceAtomic
  );

  let target = Math.round(prev * (1 + movePct / 100));
  target = Math.min(Math.max(target, PRICE_MIN_ATOMIC), effectiveMaxAtomic);
  const newPrice = target;

  if (newPrice === prev) return; // no change

  let tuneTx: string | null = null;
  const reason = {
    views_norm: viewsNorm,
    dwell_norm: dwellNorm,
    tips_norm: tipsNorm,
    demand,
    llm_move_pct: movePct,
    llm_reason: llmReason,
  };
  const reasonHash = keccak256(toHex(JSON.stringify(reason)));
  if (article.content_contract) {
    try {
      tuneTx = await tuneContentPrice(article.content_contract, BigInt(newPrice), reasonHash);
    } catch (err) {
      // Don't let an onchain failure (RPC blip, revert) block the DB update below —
      // the x402 route reads price onchain directly, so a stuck DB write here would
      // only desync the watcher's own normalization inputs, not reader-facing price.
      console.error(`[pricing] tuneContentPrice failed for ${article.slug} (DB still updated):`, err);
    }
  }

  await db
    .from('articles')
    .update({ current_price_atomic: newPrice, updated_at: new Date().toISOString() })
    .eq('slug', article.slug);

  await db.from('price_history').insert({
    article_slug: article.slug,
    content_contract: article.content_contract,
    old_price_atomic: prev,
    new_price_atomic: newPrice,
    price_atomic: newPrice,
    reason,
    reason_hash: reasonHash,
    tune_tx: tuneTx,
  });

  console.log(
	    `[pricing] ${article.slug}: ${prev} → ${newPrice} tx=${tuneTx ?? 'mock/cache'} (demand=${demand.toFixed(3)}, move_pct=${movePct.toFixed(2)}, reason="${llmReason}")`
  );
}

export async function runWatcher(db: SupabaseClient): Promise<void> {
  console.log('[pricing] starting price tune run...');

  const { data: articles, error } = await db
    .from('articles')
    .select('slug, title, content_contract, base_price_atomic, current_price_atomic')
    .eq('active', true);

  if (error || !articles || articles.length === 0) {
    console.log('[pricing] no articles to reprice');
    return;
  }

  const slugs = articles.map((a) => a.slug as string);
  const medians = await computeMedians(db, slugs);

  for (const article of articles) {
    try {
      await repriceArticle(db, article as ArticleRow, medians);
    } catch (err) {
      console.error(`[pricing] tune failed for ${article.slug}:`, err);
    }
  }

  console.log(`[pricing] done — processed ${articles.length} article(s)`);
}

export function startWatcher(db: SupabaseClient, intervalMs: number): void {
  console.log(`[pricing] starting — interval ${Math.round(intervalMs / 60000)}min`);
  runWatcher(db).catch((err) => console.error('[pricing] initial run error:', err));
  setInterval(() => {
    runWatcher(db).catch((err) => console.error('[pricing] interval error:', err));
  }, intervalMs);
}
