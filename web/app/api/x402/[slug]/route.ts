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
import { buildPaymentRequirements, readContentPriceAtomic, verifyAndSettle } from '../../../../lib/circle/index';
import {
  INTERNAL_HMAC_SECRET,
  ARC_CAIP2,
} from '../../../../lib/config';

function generateUnlockToken(site: string, slug: string, readerId: string): string {
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const data = `${expiry}:${site}:${slug}:${readerId}`;
  const sig = crypto.createHmac('sha256', INTERNAL_HMAC_SECRET).update(data).digest('hex');
  return `${data}:${sig}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const site = req.nextUrl.searchParams.get('site');
  const readerId = req.nextUrl.searchParams.get('r') ?? 'anonymous';
  if (!site) {
    return NextResponse.json({ error: 'site query param required' }, { status: 400 });
  }

  const db = createServerClient();
  const article = await getArticleBySlug(db, slug, site);
  if (!article) {
    return NextResponse.json({ error: 'article not found' }, { status: 404 });
  }

  const contentContract = article.content_contract ?? '';
  if (!contentContract) {
    return NextResponse.json({ error: 'content contract not deployed' }, { status: 503 });
  }

  const priceAtomic = await readContentPriceAtomic(contentContract, String(article.current_price_atomic));
  const price = { value: BigInt(priceAtomic), decimals: 6 };
  const requirements = buildPaymentRequirements(price, contentContract);

  const requestId = req.nextUrl.searchParams.get('rid') ?? null;
  const sigHeader = req.headers.get('Payment-Signature');

  if (!sigHeader) {
    // No payment yet — return 402 with PAYMENT-REQUIRED header.
    const ridParam = requestId ? `&rid=${encodeURIComponent(requestId)}` : '';
    const resourceUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/x402/${encodeURIComponent(slug)}?site=${encodeURIComponent(site)}&r=${encodeURIComponent(readerId)}${ridParam}`;
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
      JSON.stringify({ error: 'Payment Required', price_atomic: priceAtomic, content_contract: contentContract }),
      {
        status: 402,
        headers: {
          'Content-Type': 'application/json',
          'PAYMENT-REQUIRED': encoded,
        },
      }
    );
  }

  if (requestId) {
    const { data: existing } = await db
      .from('payment_events')
      .select('id')
      .eq('reader_id', readerId)
      .eq('content_contract', contentContract)
      .eq('request_id', requestId)
      .maybeSingle();
    if (existing) {
      const unlockToken = generateUnlockToken(site, slug, readerId);
      return NextResponse.json({ unlock_token: unlockToken, slug });
    }
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

  const unlockToken = generateUnlockToken(site, slug, readerId);

  // Write payment_events (append-only, CLAUDE.md invariant §8).
  const { error: insertError } = await db.from('payment_events').insert({
    endpoint: `/api/x402/${slug}`,
    payer: result.payer ?? readerId,
    amount_usdc: priceAtomic,
    network: ARC_CAIP2,
    gateway_tx: result.txHash ?? null,
    pay_to: contentContract,
    content_contract: contentContract,
    reader_id: readerId,
    article_slug: slug,
    request_id: requestId,
    raw: { result, slug, site, readerId },
  });
  if (insertError) {
    console.error('[x402] payment_events insert failed:', insertError);
    return NextResponse.json({ error: 'payment settled but event logging failed' }, { status: 500 });
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
