// POST /api/withdraw/submit
// Receives BurnIntent + signature from browser (after W3S SDK challenge).
// Submits to Gateway /transfer, then calls EC2 /agent/gateway-mint to finalize.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/db';
import { buildHmacHeaders } from '../../../../lib/hmac';
import { GATEWAY_FACILITATOR_URL } from '../../../../lib/config';

const EC2_AGENT_BASE = process.env.EC2_AGENT_BASE_URL ?? '';

export async function POST(req: NextRequest) {
  let withdrawalId: string | null | undefined;
  try {
    const body = await req.json() as {
      burnIntent?: Record<string, unknown>;
      signature?: string;
      withdrawalId?: string | null;
    };
    const { burnIntent, signature } = body;
    withdrawalId = body.withdrawalId;

    if (!burnIntent || !signature) {
      return NextResponse.json({ error: 'burnIntent and signature required' }, { status: 400 });
    }

    // POST to Gateway /transfer to get attestation
    const transferRes = await fetch(`${GATEWAY_FACILITATOR_URL}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ burnIntent, signature }]),
    });

    const transferJson = await transferRes.json() as { attestation?: string; signature?: string };
    if (!transferJson.attestation || !transferJson.signature) {
      return NextResponse.json(
        { error: `Gateway /transfer failed: ${JSON.stringify(transferJson)}` },
        { status: 502 }
      );
    }

    if (!EC2_AGENT_BASE) {
      return NextResponse.json({ error: 'EC2_AGENT_BASE_URL not configured' }, { status: 503 });
    }

    // HMAC-call EC2 to execute gatewayMint via buyer EOA
    const mintPayload = JSON.stringify({
      attestation: transferJson.attestation,
      attestationSig: transferJson.signature,
    });

    const mintRes = await fetch(`${EC2_AGENT_BASE}/agent/gateway-mint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...buildHmacHeaders(mintPayload) },
      body: mintPayload,
    });

    const mintJson = await mintRes.json() as { txHash?: string; error?: string };
    if (!mintRes.ok || !mintJson.txHash) {
      return NextResponse.json(
        { error: mintJson.error ?? 'gatewayMint failed' },
        { status: 502 }
      );
    }

    // Update withdrawal record
    if (withdrawalId) {
      const db = createServerClient();
      await db.from('withdrawals')
        .update({ status: 'confirmed', tx_hash: mintJson.txHash })
        .eq('id', withdrawalId);
    }

    return NextResponse.json({ status: 'confirmed', txHash: mintJson.txHash });
  } catch (err) {
    if (withdrawalId) {
      try {
        const db = createServerClient();
        await db.from('withdrawals').update({ status: 'failed' }).eq('id', withdrawalId);
      } catch { /* non-fatal */ }
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
