// POST /api/unlock/[slug] — Vercel-side x402 unlock entry point.
// 1. Look up article price + creator address from DB.
// 2. HMAC-sign and call EC2 Reader Agent POST /agent/evaluate-and-pay.
// 3. On paid: record payment_events row, return unlock_token.
// 4. On declined: return reason for gate that failed.
// 5. On error: 502.
//
// This route makes zero LLM calls (CLAUDE.md invariant §3: read path never blocks on agent).

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createServerClient } from '../../../../lib/db';
import { getArticleBySlug } from '../../../../lib/repo/articles';
import { buildHmacHeaders } from '../../../../lib/hmac';

const EC2_AGENT_BASE = process.env.EC2_AGENT_BASE_URL ?? '';

type AgentPaidResponse = {
  decision: 'paid';
  gates: { budget: boolean; quality: number; interest: number; confidence: number };
  payment: { tx: string; amount_atomic: string; settled_at: string };
  unlock_token: string;
};

type AgentDeclinedResponse = {
  decision: 'declined';
  gates: { budget: boolean; quality?: number; interest?: number; confidence?: number };
  reason: string;
};

type AgentErrorResponse = {
  decision: 'error';
  error: string;
};

type AgentResponse = AgentPaidResponse | AgentDeclinedResponse | AgentErrorResponse;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const body = await req.json() as { reader_id?: string };
  const readerId = body.reader_id;

  if (!readerId) {
    return NextResponse.json({ error: 'reader_id required' }, { status: 400 });
  }

  const db = createServerClient();
  const article = await getArticleBySlug(db, slug);
  if (!article) {
    return NextResponse.json({ error: 'article not found' }, { status: 404 });
  }

  const creatorWallet = article.creators?.eoa_address ?? '';

  // Request ID for idempotency (CLAUDE.md invariant §9)
  const requestId = crypto.randomUUID();

  const agentPayload = {
    reader_id: readerId,
    request_id: requestId,
    article: {
      slug,
      unlock_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/x402/${encodeURIComponent(slug)}?r=${encodeURIComponent(readerId)}&rid=${encodeURIComponent(requestId)}`,
      price_atomic: String(article.current_price_atomic),
      creator_wallet: creatorWallet,
      title: article.title,
      excerpt: article.excerpt,
      topics: article.topics,
    },
  };

  const rawBody = JSON.stringify(agentPayload);

  if (!EC2_AGENT_BASE) {
    return NextResponse.json({ error: 'EC2_AGENT_BASE_URL not configured' }, { status: 503 });
  }

  let agentRes: Response;
  try {
    agentRes = await fetch(`${EC2_AGENT_BASE}/agent/evaluate-and-pay`, {
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

  let result: AgentResponse;
  try {
    result = await agentRes.json() as AgentResponse;
  } catch {
    return NextResponse.json({ error: 'Agent returned invalid JSON' }, { status: 502 });
  }

  if (result.decision === 'error') {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  if (result.decision === 'declined') {
    return NextResponse.json({
      decision: 'declined',
      gates: result.gates,
      reason: result.reason,
    }, { status: 402 });
  }

  // payment_events written by /api/x402/[slug] route at settlement time.

  return NextResponse.json({
    decision: 'paid',
    unlock_token: result.unlock_token,
    payment: result.payment,
    gates: result.gates,
  });
}
