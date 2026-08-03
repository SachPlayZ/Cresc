// GET /api/public/search?q=<text>&limit=<1-25>&offset=<int>
// Public, unauthenticated article discovery. Consumed by the cresc-mcp server.
// Ranked Postgres FTS over title/topics/excerpt — see the search_articles RPC in
// agents/supabase/migrations/20260802120000_article_search.sql.
//
// Returns teaser metadata + the /read pay-and-read link ONLY. Never article bodies.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/db';
import { searchArticles } from '../../../../lib/repo/articles';
import { clampInt, toPublicArticle } from '../../../../lib/public-article';

// max-age is the primary abuse mitigation: identical queries are served from the
// CDN without touching the DB. There is no per-IP limiter in web/ yet.
const CACHE = 'public, max-age=30, stale-while-revalidate=300';

export async function GET(req: NextRequest) {
  const query = (req.nextUrl.searchParams.get('q') ?? '').trim();
  const limit = clampInt(req.nextUrl.searchParams.get('limit'), 10, 1, 25);
  const offset = clampInt(req.nextUrl.searchParams.get('offset'), 0, 0, 10_000);

  try {
    const db = createServerClient();
    const rows = await searchArticles(db, { query, limit, offset });
    const results = rows.map(toPublicArticle);

    return NextResponse.json(
      { query, count: results.length, results },
      { headers: { 'Cache-Control': CACHE } }
    );
  } catch (err) {
    console.error('[public/search] failed:', err);
    return NextResponse.json({ error: 'search failed' }, { status: 500 });
  }
}
