// GET /api/x402/tip/[creatorId]?amount=<atomic>&r=<readerId>
// x402 tip endpoint — same flow as article unlock but for tips.
//
// No Payment-Signature → 402 + PAYMENT-REQUIRED header.
// Has Payment-Signature → verify + settle → write payment_events → 200.
//
// Called by GatewayClient.pay() on EC2 after /agent/tip budget gate passes.

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createServerClient } from '../../../../../lib/db';
import { buildPaymentRequirements, verifyAndSettle } from '../../../../../lib/circle/index';
import {
  INTERNAL_HMAC_SECRET,
  ARC_CAIP2,
} from '../../../../../lib/config';
import { fromBaseUnits } from '../../../../../lib/money';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ creatorId: string }> }
) {
  const { creatorId } = await params;
  const amountStr = req.nextUrl.searchParams.get('amount');
  const readerId = req.nextUrl.searchParams.get('r') ?? 'anonymous';
  const requestId = req.nextUrl.searchParams.get('rid') ?? null;

  if (!amountStr || isNaN(parseInt(amountStr, 10))) {
    return NextResponse.json({ error: 'amount query param required (atomic USDC)' }, { status: 400 });
  }

  const amountAtomic = BigInt(amountStr);

  const db = createServerClient();
  const { data: creator } = await db
    .from('creators')
    .select('eoa_address, display_name')
    .eq('id', creatorId)
    .single();

  if (!creator?.eoa_address) {
    return NextResponse.json({ error: 'creator not found or has no wallet' }, { status: 404 });
  }

  const price = { value: amountAtomic, decimals: 6 };
  const requirements = buildPaymentRequirements(price, creator.eoa_address as string);

  const sigHeader = req.headers.get('Payment-Signature');

  if (!sigHeader) {
    const resourceUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/x402/tip/${encodeURIComponent(creatorId)}?amount=${amountStr}&r=${encodeURIComponent(readerId)}`;
    const paymentRequired = {
      x402Version: 2,
      accepts: [requirements],
      resource: {
        url: resourceUrl,
        description: `Tip for ${creator.display_name as string}`,
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

  // Append-only tip record
  try {
    await db.from('payment_events').insert({
      endpoint: `/api/x402/tip/${creatorId}`,
      payer: result.payer ?? readerId,
      amount_usdc: amountStr,
      network: ARC_CAIP2,
      gateway_tx: result.txHash ?? null,
      reader_id: readerId,
      article_slug: null,
      request_id: requestId,
      raw: { result, creatorId, readerId, type: 'tip' },
    });
  } catch (e) {
    console.error('[x402/tip] payment_events insert failed:', e);
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
