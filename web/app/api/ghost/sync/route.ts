// POST /api/ghost/sync — Ghost webhook receiver.
// Ghost fires on post.published, post.updated, post.deleted.
// Verifies HMAC, upserts/delists article in articles table.
// Must respond within 5s (Ghost webhook timeout).

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/db';
import { GhostAdminClient, verifyGhostSignature } from '../../../../lib/ghost/index';
import { upsertGhostArticle } from '../../../../lib/repo/articles';
import { decryptGhostKey } from '../../../../lib/repo/creators';

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sigHeader = req.headers.get('x-ghost-signature') ?? '';

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const post = body.post as Record<string, Record<string, unknown>> | undefined;
  const current = post?.current as Record<string, unknown> | undefined;
  const previous = post?.previous as Record<string, unknown> | undefined;

  const ghostPostId = (current?.id ?? previous?.id) as string | undefined;
  if (!ghostPostId) return NextResponse.json({ ok: true });

  const db = createServerClient();

  let webhookSecret: string | null = null;
  let creatorId: string | null = null;
  let instanceUrl: string | null = null;

  const siteParam = req.nextUrl.searchParams.get('site');
  if (siteParam) {
    const { data: creator } = await db
      .from('creators')
      .select('id, ghost_webhook_secret, ghost_admin_key, ghost_instance_url')
      .eq('id', siteParam)
      .single();
    if (creator) {
      creatorId = creator.id as string;
      webhookSecret = creator.ghost_webhook_secret as string | null;
      instanceUrl = creator.ghost_instance_url as string | null;
    }
  } else {
    // Fallback: look up via articles table
    const { data: article } = await db
      .from('articles')
      .select('creator_id, ghost_instance_url')
      .eq('ghost_post_id', ghostPostId)
      .single();

    if (article) {
      creatorId = article.creator_id as string;
      instanceUrl = article.ghost_instance_url as string | null;
      const { data: creator } = await db
        .from('creators')
        .select('ghost_webhook_secret, ghost_admin_key, ghost_instance_url')
        .eq('id', creatorId)
        .single();
      webhookSecret = creator?.ghost_webhook_secret as string | null;
      if (!instanceUrl) instanceUrl = creator?.ghost_instance_url as string | null;
    }
  }

  if (!webhookSecret || !sigHeader || !verifyGhostSignature(rawBody, sigHeader, webhookSecret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!creatorId || !instanceUrl) {
    return NextResponse.json({ ok: true });
  }

  const status = current?.status as string | undefined;
  const isPublished = status === 'published';
  const isDeleted = !current || Object.keys(current).length === 0;

  if (isDeleted || (!isPublished && status)) {
    // Find slug from ghost_post_id and remove from articles
    if (ghostPostId) {
      await db
        .from('articles')
        .delete()
        .eq('creator_id', creatorId)
        .eq('ghost_post_id', ghostPostId);
    }
    return NextResponse.json({ ok: true });
  }

  if (isPublished) {
    const { data: creator } = await db
      .from('creators')
      .select('ghost_admin_key, ghost_key_enc')
      .eq('id', creatorId)
      .single();
    const rawKey = creator?.ghost_key_enc as string | null ?? creator?.ghost_admin_key as string | null;
    const adminKey = rawKey
      ? (creator?.ghost_key_enc ? (() => { try { return decryptGhostKey(rawKey); } catch { return null; } })() : rawKey)
      : null;

    if (adminKey) {
      try {
        const ghostClient = new GhostAdminClient(instanceUrl, adminKey);
        const fullPost = await ghostClient.getPost(ghostPostId);
        await upsertGhostArticle(db, {
          slug: fullPost.slug,
          creator_id: creatorId,
          title: fullPost.title,
          excerpt: fullPost.custom_excerpt ?? '',
          topics: [],
          base_price_atomic: 50000,
          current_price_atomic: 50000,
          ghost_post_id: fullPost.id,
          ghost_instance_url: instanceUrl,
        });
      } catch (err) {
        console.error('[ghost/sync] upsert failed:', err);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
