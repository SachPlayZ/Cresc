// POST /api/ghost/connect — Creator connects Ghost instance to Cresc.
// Validates Admin API key, syncs published posts → articles table, returns snippet + webhook config.
// GET /api/ghost/connect?creatorId=<id> — returns connection status.

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createServerClient } from '../../../../lib/db';
import { GhostAdminClient } from '../../../../lib/ghost/index';
import { getCreator, updateGhostConnection } from '../../../../lib/repo/creators';
import { upsertGhostArticle } from '../../../../lib/repo/articles';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export async function GET(req: NextRequest) {
  const creatorId = req.nextUrl.searchParams.get('creatorId');
  if (!creatorId) return NextResponse.json({ error: 'missing creatorId' }, { status: 400 });

  const db = createServerClient();
  const creator = await getCreator(db, creatorId);
  if (!creator) return NextResponse.json({ error: 'creator not found' }, { status: 404 });

  return NextResponse.json({
    connected: !!creator.ghost_instance_url,
    instanceUrl: creator.ghost_instance_url ?? null,
  });
}

export async function POST(req: NextRequest) {
  const { instanceUrl, adminKey, creatorId } = await req.json() as {
    instanceUrl?: string;
    adminKey?: string;
    creatorId?: string;
  };

  if (!instanceUrl || !adminKey || !creatorId) {
    return NextResponse.json({ error: 'instanceUrl, adminKey, creatorId required' }, { status: 400 });
  }

  const db = createServerClient();
  const creator = await getCreator(db, creatorId);
  if (!creator) return NextResponse.json({ error: 'creator not found' }, { status: 404 });

  const ghostClient = new GhostAdminClient(instanceUrl, adminKey);
  const valid = await ghostClient.validateKey();
  if (!valid) {
    return NextResponse.json(
      { error: 'Ghost Admin API key validation failed. Check the instance URL and key.' },
      { status: 400 }
    );
  }

  const webhookSecret = crypto.randomBytes(32).toString('hex');

  await updateGhostConnection(db, creatorId, {
    ghost_instance_url: instanceUrl,
    ghost_admin_key: adminKey,
    ghost_webhook_secret: webhookSecret,
  });

  // Sync all published posts → articles table
  let syncedCount = 0;
  const errors: string[] = [];
  try {
    const posts = await ghostClient.listPosts();
    for (const post of posts) {
      try {
        await upsertGhostArticle(db, {
          slug: post.slug,
          creator_id: creatorId,
          title: post.title,
          excerpt: post.custom_excerpt ?? '',
          topics: [],
          base_price_atomic: 50000,    // $0.05 starting price
          current_price_atomic: 50000,
          ghost_post_id: post.id,
          ghost_instance_url: instanceUrl,
        });
        syncedCount++;
      } catch (err) {
        errors.push(`${post.slug}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to sync posts: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }

  const webhookUrl = `${APP_URL}/api/ghost/sync?site=${creatorId}`;
  const snippetHtml = `<script src="${APP_URL}/cresc-ghost.js" data-site="${creatorId}"></script>`;

  return NextResponse.json({
    ok: true,
    syncedCount,
    errors,
    webhookUrl,
    webhookSecret,
    snippetHtml,
    setup: [
      `1. Ghost Admin → Settings → Webhooks → Add webhook`,
      `   Events: "Post published", "Post updated", "Post deleted"`,
      `   URL: ${webhookUrl}`,
      `   Secret: ${webhookSecret}`,
      `2. Ghost Admin → Settings → Code Injection → Site Footer`,
      `   Paste: ${snippetHtml}`,
    ],
  });
}
