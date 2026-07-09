// GET /api/x402/tip/[contentContract]?amount=<atomic>&r=<readerId>
// x402 tip endpoint — same flow as article unlock but for tips.
//
// No Payment-Signature → 402 + PAYMENT-REQUIRED header.
// Has Payment-Signature → verify + settle → write payment_events → 200.
//
// Called by GatewayClient.pay() on EC2 after /agent/tip budget gate passes.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/db';
import { buildPaymentRequirements, verifyAndSettle } from '../../../../../lib/circle/index';
import { ARC_CAIP2 } from '../../../../../lib/config';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ creatorId: string }> }
) {
  const { creatorId: contentContract } = await params;
  const amountStr = req.nextUrl.searchParams.get('amount');
  const readerId = req.nextUrl.searchParams.get('r') ?? 'anonymous';
  const creatorId = req.nextUrl.searchParams.get('creator');
  const requestId = req.nextUrl.searchParams.get('rid') ?? null;

  if (!amountStr || !/^[0-9]+$/.test(amountStr)) {
    return NextResponse.json({ error: 'amount query param required (atomic USDC)' }, { status: 400 });
  }

  const amountAtomic = BigInt(amountStr);
  if (amountAtomic <= 0n) {
    return NextResponse.json({ error: 'amount must be positive' }, { status: 400 });
  }

  const db = createServerClient();
  if (!creatorId) {
    return NextResponse.json({ error: 'creator query param required' }, { status: 400 });
  }
  const { data: article } = await db
    .from('articles')
    .select('slug')
    .eq('creator_id', creatorId)
    .eq('content_contract', contentContract)
    .eq('active', true)
    .maybeSingle();
  if (!article) {
    return NextResponse.json({ error: 'content contract not found for creator' }, { status: 404 });
  }

  const price = { value: amountAtomic, decimals: 6 };
  const requirements = buildPaymentRequirements(price, contentContract);

  const sigHeader = req.headers.get('Payment-Signature');

  if (!sigHeader) {
    const resourceUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/x402/tip/${encodeURIComponent(contentContract)}?amount=${amountStr}&r=${encodeURIComponent(readerId)}${creatorId ? `&creator=${encodeURIComponent(creatorId)}` : ''}`;
    const paymentRequired = {
      x402Version: 2,
      accepts: [requirements],
      resource: {
        url: resourceUrl,
        description: `Tip for content ${contentContract}`,
        mimeType: 'application/json',
      },
    };
    const encoded = Buffer.from(JSON.stringify(paymentRequired)).toString('base64');
    return new NextResponse(
      JSON.stringify({ error: 'Payment Required', amount_atomic: amountStr }),
      {
        status: 402,
        headers: {
          'Content-Type': 'application/json',
          'PAYMENT-REQUIRED': encoded,
        },
      }
    );
  }

  const contentContractLower = contentContract.toLowerCase();

  if (requestId) {
    const { data: existing } = await db
      .from('payment_events')
      .select('id')
      .eq('reader_id', readerId)
      .eq('content_contract', contentContractLower)
      .eq('request_id', requestId)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ ok: true, tip_settled: true });
    }
  }

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
      { error: result.errorReason ?? 'tip settlement failed' },
      { status: 402 }
    );
  }

  const { error: insertError } = await db.from('payment_events').insert({
    endpoint: `/api/x402/tip/${contentContract}`,
    payer: result.payer ?? readerId,
    amount_usdc: amountStr,
    network: ARC_CAIP2,
    gateway_tx: result.txHash ?? null,
    pay_to: contentContract,
    content_contract: contentContractLower,
    reader_id: readerId,
    article_slug: null,
    request_id: requestId,
    raw: { result, creatorId, contentContract, readerId, type: 'tip' },
  });
  if (insertError) {
    console.error('[x402/tip] payment_events insert failed:', insertError);
    return NextResponse.json({ error: 'tip settled but event logging failed' }, { status: 500 });
  }

  const paymentResponse = {
    success: true,
    transaction: result.txHash ?? '',
    network: ARC_CAIP2,
    payer: result.payer ?? readerId,
  };
  const paymentResponseEncoded = Buffer.from(JSON.stringify(paymentResponse)).toString('base64');

  return new NextResponse(
    JSON.stringify({ ok: true, tip_settled: true }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'PAYMENT-RESPONSE': paymentResponseEncoded,
      },
    }
  );
}
