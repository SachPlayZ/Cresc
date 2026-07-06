// GET /api/ghost/post-status?site=<creatorId>&slug=<ghostSlug>
// Called by cresc-ghost.js on every Ghost page load. Must be <100ms.
// Returns whether the post is paywalled in Cresc + the standing price.
// NO Groq, NO settlement — pure DB read.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/db';
import { fromBaseUnits, toDisplay } from '../../../../lib/money';
import { USDC_ERC20_DECIMALS } from '../../../../lib/config';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  const site = req.nextUrl.searchParams.get('site');
  const slug = req.nextUrl.searchParams.get('slug');

  if (!site || !slug) {
    return NextResponse.json({ paywalled: false }, { headers: CORS });
  }

  try {
    const db = createServerClient();

    // Query articles table first (new architecture)
    const { data: article } = await db
      .from('articles')
      .select('slug, current_price_atomic, content_contract')
      .eq('creator_id', site)
      .eq('slug', slug)
      .eq('active', true)
      .single();

    if (article) {
      const price = fromBaseUnits(BigInt(String(article.current_price_atomic)), USDC_ERC20_DECIMALS);
      return NextResponse.json(
        { paywalled: true, slug: article.slug, priceDisplay: toDisplay(price), contentContract: article.content_contract },
        { headers: CORS }
      );
    }

    return NextResponse.json({ paywalled: false }, { headers: CORS });
  } catch {
    return NextResponse.json({ paywalled: false }, { headers: CORS });
  }
}
