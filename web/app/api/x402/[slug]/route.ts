// GET /api/x402/[slug]?r=[readerId] — x402 seller gate (Phase 1 core).
//
// No Payment-Signature → 402 + PAYMENT-REQUIRED header.
// Has Payment-Signature → settle via BatchFacilitatorClient → write payment_events
//   → return 200 + PAYMENT-RESPONSE header + { unlock_token }.
//
// GatewayClient.pay() on EC2 drives this flow automatically.

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createServerClient } from '../../../../lib/db';
import { getArticleBySlug } from '../../../../lib/repo/articles';
import { buildPaymentRequirements, verifyAndSettle } from '../../../../lib/circle/index';
import {
  INTERNAL_HMAC_SECRET,
  ARC_CAIP2,
} from '../../../../lib/config';

function generateUnlockToken(slug: string, readerId: string): string {
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const data = `${expiry}:${slug}:${readerId}`;
  const sig = crypto.createHmac('sha256', INTERNAL_HMAC_SECRET).update(data).digest('hex');
  return `${data}:${sig}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const readerId = req.nextUrl.searchParams.get('r') ?? 'anonymous';

  const db = createServerClient();
  const article = await getArticleBySlug(db, slug);
  if (!article) {
    return NextResponse.json({ error: 'article not found' }, { status: 404 });
  }

  const creatorAddress = article.creators?.eoa_address ?? '';
  if (!creatorAddress) {
    return NextResponse.json({ error: 'creator wallet not configured' }, { status: 503 });
  }

  const price = { value: BigInt(article.current_price_atomic), decimals: 6 };
  const requirements = buildPaymentRequirements(price, creatorAddress);

  const requestId = req.nextUrl.searchParams.get('rid') ?? null;
  const sigHeader = req.headers.get('Payment-Signature');

  if (!sigHeader) {
    // No payment yet — return 402 with PAYMENT-REQUIRED header.
    const ridParam = requestId ? `&rid=${encodeURIComponent(requestId)}` : '';
    const resourceUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/x402/${encodeURIComponent(slug)}?r=${encodeURIComponent(readerId)}${ridParam}`;
    const paymentRequired = {
      x402Version: 2,
      accepts: [requirements],
      resource: {
        url: resourceUrl,
        description: article.title,
        mimeType: 'application/json',
      },
    };
    const encoded = Buffer.from(JSON.stringify(paymentRequired)).toString('base64');
    return new NextResponse(
      JSON.stringify({ error: 'Payment Required', price_atomic: String(article.current_price_atomic) }),
      {
        status: 402,
        headers: {
          'Content-Type': 'application/json',
          'PAYMENT-REQUIRED': encoded,
        },
      }
    );
  }

  // Payment signature present — settle.
  let signedPayload: Record<string, unknown>;
  try {
    signedPayload = JSON.parse(Buffer.from(sigHeader, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid Payment-Signature header' }, { status: 400 });
  }

  const result = await verifyAndSettle(
    signedPayload as Parameters<typeof verifyAndSettle>[0],
    requirements
  );

  if (!result.success) {
    return NextResponse.json(
      { error: result.errorReason ?? 'settlement failed' },
      { status: 402 }
    );
  }

  const unlockToken = generateUnlockToken(slug, readerId);

  // Write payment_events (append-only, CLAUDE.md invariant §8).
  try {
    await db.from('payment_events').insert({
      endpoint: `/api/x402/${slug}`,
      payer: result.payer ?? readerId,
      amount_usdc: String(article.current_price_atomic),
      network: ARC_CAIP2,
      gateway_tx: result.txHash ?? null,
      reader_id: readerId,
      article_slug: slug,
      request_id: requestId,
      raw: { result, slug, readerId },
    });
  } catch (e) {
    console.error('[x402] payment_events insert failed:', e);
  }

  const paymentResponse = {
    success: true,
    transaction: result.txHash ?? '',
    network: ARC_CAIP2,
    payer: result.payer ?? readerId,
  };
  const paymentResponseEncoded = Buffer.from(JSON.stringify(paymentResponse)).toString('base64');

  return new NextResponse(
    JSON.stringify({ unlock_token: unlockToken, slug }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'PAYMENT-RESPONSE': paymentResponseEncoded,
      },
    }
  );
}
