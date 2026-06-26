// POST /api/tip — Vercel proxy to EC2 /agent/tip.
// Called by the read page after a reader finishes an article.
// Validates inputs, HMAC-signs the request, forwards to EC2.

import { NextRequest, NextResponse } from 'next/server';
import { buildHmacHeaders } from '../../../lib/hmac';

const EC2_AGENT_BASE = process.env.EC2_AGENT_BASE_URL ?? '';

export async function POST(req: NextRequest) {
  let body: { reader_id?: string; creator_id?: string; amount_atomic?: string };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const { reader_id, creator_id, amount_atomic } = body;

  if (!reader_id || !creator_id || !amount_atomic) {
    return NextResponse.json(
      { error: 'reader_id, creator_id, amount_atomic required' },
      { status: 400 }
    );
  }

  if (!EC2_AGENT_BASE) {
    return NextResponse.json({ error: 'EC2_AGENT_BASE_URL not configured' }, { status: 503 });
  }

  const rawBody = JSON.stringify({ reader_id, creator_id, amount_atomic });

  let agentRes: Response;
  try {
    agentRes = await fetch(`${EC2_AGENT_BASE}/agent/tip`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildHmacHeaders(rawBody),
      },
      body: rawBody,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Agent unreachable: ${msg}` }, { status: 502 });
  }

  let result: unknown;
  try {
    result = await agentRes.json();
  } catch {
    return NextResponse.json({ error: 'Agent returned invalid JSON' }, { status: 502 });
  }

  return NextResponse.json(result, { status: agentRes.status === 200 ? 200 : agentRes.status });
}
