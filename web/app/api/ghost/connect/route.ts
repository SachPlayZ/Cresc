// POST /api/ghost/connect — Creator connects Ghost instance to Cresc.
// Validates Admin API key, syncs published posts → articles table, returns snippet + webhook config.
// GET /api/ghost/connect?creatorId=<id> — returns connection status.

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createServerClient } from '../../../../lib/db';
import { GhostAdminClient, assertPublicHttpsUrl } from '../../../../lib/ghost/index';
import { getCreator, updateGhostConnection } from '../../../../lib/repo/creators';
import { assertCreatorOwnership } from '../../../../lib/auth/creator';
import { buildHmacHeaders } from '../../../../lib/hmac';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const EC2_AGENT_BASE = process.env.EC2_AGENT_BASE_URL ?? '';

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
  const { instanceUrl, adminKey, creatorId, userToken } = await req.json() as {
    instanceUrl?: string;
    adminKey?: string;
    creatorId?: string;
    userToken?: string;
  };

  if (!instanceUrl || !adminKey || !creatorId || !userToken) {
    return NextResponse.json({ error: 'instanceUrl, adminKey, creatorId, userToken required' }, { status: 400 });
  }
  if (!EC2_AGENT_BASE) {
    return NextResponse.json({ error: 'EC2_AGENT_BASE_URL required for contract-native Ghost sync' }, { status: 503 });
  }

  const db = createServerClient();
  const creator = await getCreator(db, creatorId);
  if (!creator) return NextResponse.json({ error: 'creator not found' }, { status: 404 });
  try {
    await assertCreatorOwnership(db, creatorId, userToken);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'ownership check failed' }, { status: 403 });
  }
  const creatorWallet = creator.eoa_address;
  if (!creatorWallet) return NextResponse.json({ error: 'creator wallet not provisioned' }, { status: 400 });

  try {
    await assertPublicHttpsUrl(instanceUrl);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'invalid instance URL' }, { status: 400 });
  }

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
        const agentPayload = {
          creator_id: creatorId,
          creator_wallet: creatorWallet,
          slug: post.slug,
          ghost_post_id: post.id,
          title: post.title,
          excerpt: post.custom_excerpt ?? '',
          ghost_instance_url: instanceUrl,
          initial_price_atomic: 50000,
        };
        const rawBody = JSON.stringify(agentPayload);
        const agentRes = await fetch(`${EC2_AGENT_BASE}/agent/content/upsert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...buildHmacHeaders(rawBody) },
          body: rawBody,
        });
        if (!agentRes.ok) {
          throw new Error(`agent content upsert failed: ${await agentRes.text().catch(() => '')}`);
        }
        syncedCount++;
      } catch (err) {
        const cause = err instanceof Error && err.cause ? ` (${String(err.cause)})` : '';
        errors.push(`${post.slug}: ${(err instanceof Error ? err.message : String(err))}${cause}`);
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to sync posts: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }

  const webhookUrl = `${EC2_AGENT_BASE || APP_URL}/agent/ghost/webhook?site=${creatorId}`;
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
      `2. Ghost Admin → Settings → Code Injection → Site Header`,
      `   Paste: ${snippetHtml}`,
    ],
  });
}
