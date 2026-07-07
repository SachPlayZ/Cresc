// POST /api/withdraw/prepare
// Contract-native withdrawal: verifies creator ownership and asks EC2 to withdraw from ContentVault.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/db';
import { assertCreatorOwnership } from '../../../../lib/auth/creator';
import { buildHmacHeaders } from '../../../../lib/hmac';

const EC2_AGENT_BASE = process.env.EC2_AGENT_BASE_URL ?? '';

// Splits a 65-byte ECDSA signature (0x + 130 hex chars: r(32) + s(32) + v(1)) as
// returned by Circle's signTypedData challenge into the (v, r, s) triple the
// ContentVault.withdrawSigned ABI expects.
function splitSignature(sig: string): { v: number; r: string; s: string } {
  const clean = sig.startsWith('0x') ? sig.slice(2) : sig;
  if (clean.length !== 130) throw new Error('invalid signature length');
  const r = `0x${clean.slice(0, 64)}`;
  const s = `0x${clean.slice(64, 128)}`;
  let v = parseInt(clean.slice(128, 130), 16);
  if (v < 27) v += 27;
  return { v, r, s };
}

export async function POST(req: NextRequest) {
  let withdrawalId: string | null = null;
  const db = createServerClient();
  try {
    const { creator_id, userToken, content_contract, amount_atomic, nonce, signature } =
      await req.json() as {
        creator_id?: string;
        userToken?: string;
        content_contract?: string;
        amount_atomic?: string;
        nonce?: string;
        signature?: string;
      };

    if (!creator_id || !userToken || !content_contract || !amount_atomic || !nonce || !signature) {
      return NextResponse.json({ error: 'creator_id, userToken, content_contract, amount_atomic, nonce, signature required' }, { status: 400 });
    }

    // destination_address is never accepted from the client — always the UCW wallet
    // Circle/Cresc has on record for this creator, matching what sign-request signed.
    const creator = await assertCreatorOwnership(db, creator_id, userToken);
    if (!creator.eoa_address) {
      return NextResponse.json({ error: 'creator has no UCW wallet address on record' }, { status: 400 });
    }
    const destination_address = creator.eoa_address;

    const { data: article, error: articleError } = await db
      .from('articles')
      .select('slug')
      .eq('creator_id', creator_id)
      .eq('content_contract', content_contract)
      .eq('active', true)
      .maybeSingle();
    if (articleError) throw articleError;
    if (!article) {
      return NextResponse.json({ error: 'content contract does not belong to creator' }, { status: 403 });
    }

    if (!EC2_AGENT_BASE) {
      return NextResponse.json({ error: 'EC2_AGENT_BASE_URL not configured' }, { status: 503 });
    }

    const { v, r, s } = splitSignature(signature);

    // Record withdrawal attempt before relaying
    const { data: withdrawal } = await db
      .from('withdrawals')
      .insert({
        creator_id,
        content_contract,
        amount_atomic,
        destination_chain: 'arc',
        destination_address,
        status: 'submitted',
      })
      .select('id')
      .single();
    withdrawalId = withdrawal?.id ?? null;

    const payload = JSON.stringify({
      creator_id,
      content_contract,
      amount_atomic,
      destination_address,
      nonce,
      v,
      r,
      s,
      withdrawal_id: withdrawalId,
    });
    const agentRes = await fetch(`${EC2_AGENT_BASE}/agent/withdraw-content`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...buildHmacHeaders(payload) },
      body: payload,
    });
    const agentJson = await agentRes.json() as { txHash?: string; error?: string };
    if (!agentRes.ok || !agentJson.txHash) {
      if (withdrawalId) await db.from('withdrawals').update({ status: 'failed' }).eq('id', withdrawalId);
      return NextResponse.json({ error: agentJson.error ?? 'withdraw failed' }, { status: 502 });
    }

    await db.from('withdrawals')
      .update({ status: 'confirmed', tx_hash: agentJson.txHash })
      .eq('id', withdrawalId!);

    return NextResponse.json({
      status: 'confirmed',
      txHash: agentJson.txHash,
      withdrawalId,
    });
  } catch (err) {
    // If the withdrawal row was already inserted, don't leave it stuck as 'submitted'
    // forever — a thrown fetch (network error), not just a non-OK response, must also
    // mark it failed.
    if (withdrawalId) {
      try {
        await db.from('withdrawals').update({ status: 'failed' }).eq('id', withdrawalId);
      } catch { /* best-effort — original error is already returned below */ }
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
