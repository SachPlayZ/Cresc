// Compatibility proxy for old Ghost webhook URLs.
// New setup points Ghost directly at EC2 /agent/ghost/webhook.

import { NextRequest, NextResponse } from 'next/server';

const EC2_AGENT_BASE = process.env.EC2_AGENT_BASE_URL ?? '';

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const site = req.nextUrl.searchParams.get('site');
  const sigHeader = req.headers.get('x-ghost-signature') ?? '';

  if (!site) {
    return NextResponse.json({ error: 'site query param required' }, { status: 400 });
  }
  if (!EC2_AGENT_BASE) {
    return NextResponse.json({ error: 'EC2_AGENT_BASE_URL not configured' }, { status: 503 });
  }

  const agentRes = await fetch(`${EC2_AGENT_BASE}/agent/ghost/webhook?site=${encodeURIComponent(site)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-ghost-signature': sigHeader,
    },
    body: rawBody,
  });

  const text = await agentRes.text();
  return new NextResponse(text, {
    status: agentRes.status,
    headers: { 'Content-Type': agentRes.headers.get('content-type') ?? 'application/json' },
  });
}
