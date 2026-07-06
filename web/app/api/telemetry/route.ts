// POST /api/telemetry — record view/dwell events for Watcher + Audit Agent.
// Public endpoint (rate-limit at infra layer). No auth — reader_id is not a secret.
// CLAUDE.md: telemetry.dwell_ms < 1500 filtered by Audit Agent.

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createServerClient } from '../../../lib/db';

type TelemetryBody = {
  reader_id?: string;
  article_slug?: string;
  site?: string;
  event_type?: 'view' | 'dwell' | 'complete' | 'bounce';
  dwell_ms?: number;
};

export async function POST(req: NextRequest) {
  let body: TelemetryBody;
  try {
    body = await req.json() as TelemetryBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const { reader_id, article_slug, site, event_type, dwell_ms } = body;

  if (!reader_id || !article_slug || !site || !event_type) {
    return NextResponse.json({ error: 'reader_id, article_slug, site, event_type required' }, { status: 400 });
  }

  const allowed = ['view', 'dwell', 'complete', 'bounce'] as const;
  if (!allowed.includes(event_type as (typeof allowed)[number])) {
    return NextResponse.json({ error: 'invalid event_type' }, { status: 400 });
  }

  const db = createServerClient();

  // Look up article_id from slug
  const { data: article } = await db
    .from('articles')
    .select('slug')
    .eq('slug', article_slug)
    .eq('creator_id', site)
    .eq('active', true)
    .single();

  if (!article) {
    return NextResponse.json({ error: 'article not found' }, { status: 404 });
  }

  // Hash IP for privacy (one-way)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown';
  const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);

  const { error } = await db.from('telemetry').insert({
    article_id: article_slug,
    reader_id,
    event_type,
    dwell_ms: dwell_ms ?? 0,
    ip_hash: ipHash,
  });

  if (error) {
    console.error('[telemetry] insert failed:', error);
    return NextResponse.json({ error: 'insert failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
