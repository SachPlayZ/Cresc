// POST /api/articles/monetization — toggle whether an article is gated behind
// payment. This is a plain app-level setting (not an on-chain/signing action), so
// it's authenticated by the creator's Cresc dashboard session cookie, same as the
// rest of the dashboard — no Circle wallet re-auth needed.

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '../../../../lib/db';
import { setArticleMonetization } from '../../../../lib/repo/index';
import { SESSION_COOKIE_NAME, verifySessionToken } from '../../../../lib/auth/creator';

const DEV_CREATOR_ID = process.env.DEV_CREATOR_ID ?? '';

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const creatorId = verifySessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value) || DEV_CREATOR_ID;
    if (!creatorId) {
      return NextResponse.json({ error: 'not logged in' }, { status: 401 });
    }

    const { slug, enabled } = await req.json() as { slug?: string; enabled?: boolean };
    if (!slug || typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'slug and enabled (boolean) required' }, { status: 400 });
    }

    const db = createServerClient();
    const { data: article } = await db
      .from('articles')
      .select('slug')
      .eq('slug', slug)
      .eq('creator_id', creatorId)
      .maybeSingle();
    if (!article) {
      return NextResponse.json({ error: 'article not found or not owned by this creator' }, { status: 403 });
    }

    await setArticleMonetization(db, creatorId, slug, enabled);
    return NextResponse.json({ ok: true, slug, monetization_enabled: enabled });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
