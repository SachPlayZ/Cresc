// lib/public-article.ts — the ONE shape returned by every /api/public/* route.
//
// This is the public, unauthenticated contract consumed by the cresc-mcp
// server (and anything else built on discovery). Every field here is
// deliberately whitelisted: never spread a raw `articles`/`creators` row into a
// response — `ghost_key_enc`, `ghost_admin_key` and `ghost_webhook_secret` must
// never leave the server.

import { fromBaseUnits, toDisplay } from './money';
import { USDC_ERC20_DECIMALS } from './config';

export type PublicArticle = {
  slug: string;
  /** Creator id — required alongside slug, since slugs are only unique per creator. */
  site: string;
  title: string;
  excerpt: string;
  creator: string;
  topics: string[];
  /** Display string, e.g. "$0.05". */
  price: string;
  /** Atomic 6dp USDC as a string — never a float. */
  price_atomic: string;
  /** Where a reader pays and reads. */
  url: string;
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? '';

export function readUrl(slug: string, site: string): string {
  return `${APP_URL}/read?slug=${encodeURIComponent(slug)}&site=${encodeURIComponent(site)}`;
}

export function toPublicArticle(input: {
  slug: string;
  creator_id: string;
  creator_name: string;
  title: string;
  excerpt: string;
  topics: string[] | null;
  current_price_atomic: string | number | bigint;
}): PublicArticle {
  const atomic = BigInt(String(input.current_price_atomic));
  return {
    slug: input.slug,
    site: input.creator_id,
    title: input.title,
    excerpt: input.excerpt,
    creator: input.creator_name,
    topics: input.topics ?? [],
    price: toDisplay(fromBaseUnits(atomic, USDC_ERC20_DECIMALS)),
    price_atomic: atomic.toString(),
    url: readUrl(input.slug, input.creator_id),
  };
}

/** Parse an int query param, clamping to [min, max]; garbage falls back silently. */
export function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = raw === null || raw.trim() === '' ? NaN : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}
