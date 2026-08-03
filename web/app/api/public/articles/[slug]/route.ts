// GET /api/public/articles/<slug>?site=<creatorId>
// Public, unauthenticated single-article lookup. `site` is required — slugs are
// only unique per creator (articles_creator_slug_idx).
//
// Used by cresc-mcp to re-confirm the current price and read link right before
// pointing a reader at it (prices retune hourly). Teaser metadata only.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/db';
import { getArticleBySlug } from '../../../../../lib/repo/articles';
import { toPublicArticle } from '../../../../../lib/public-article';

const CACHE = 'public, max-age=60, stale-while-revalidate=600';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  const { slug } = await ctx.params;
  const site = req.nextUrl.searchParams.get('site');

  if (!site) {
    return NextResponse.json({ error: 'site (creator id) required' }, { status: 400 });
  }

  try {
    const db = createServerClient();
    const article = await getArticleBySlug(db, slug, site);

    // No content contract => /read renders "Content contract pending", i.e. a
    // dead link. Treat as not found so we never hand out an unreadable URL.
    if (!article || !article.content_contract) {
      return NextResponse.json({ error: 'article not found' }, { status: 404 });
    }

    return NextResponse.json(
      toPublicArticle({
        slug: article.slug,
        creator_id: article.creator_id,
        creator_name: article.creators?.display_name ?? '',
        title: article.title,
        excerpt: article.excerpt,
        topics: article.topics,
        current_price_atomic: article.current_price_atomic,
      }),
      { headers: { 'Cache-Control': CACHE } }
    );
  } catch (err) {
    console.error('[public/articles] failed:', err);
    return NextResponse.json({ error: 'lookup failed' }, { status: 500 });
  }
}
