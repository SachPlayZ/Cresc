// POST /api/withdraw/sign-request
// Step 1 of a contract-native withdrawal: verifies creator ownership of the content
// contract, reads the vault's current on-chain USDC balance and withdrawNonce, and asks
// Circle to create a signTypedData challenge for the creator's own UCW wallet over the
// EIP-712 `Withdraw(address to,uint256 amountAtomic,uint256 nonce)` message (see
// contracts/src/ContentVault.sol withdrawSigned). The frontend completes the challenge
// via sdk.execute(), then posts the resulting signature to /api/withdraw/prepare.
//
// Both `amount_atomic` (the vault's full current balance — "withdraw all") and
// `destination_address` (always the creator's own on-record eoa_address) are derived
// server-side, never accepted from the client — a creator can only ever withdraw their
// full earnings to the UCW wallet Circle/Cresc already has on file for them.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/db';
import { assertCreatorOwnership } from '../../../../lib/auth/creator';
import { requestTypedDataSignature } from '../../../../lib/circle/ucw';
import { readVaultWithdrawNonce, readVaultBalance, readVaultTotalWithdrawn } from '../../../../lib/circle';
import { ARC_CHAIN_ID } from '../../../../lib/config';

export async function POST(req: NextRequest) {
  try {
    const { creator_id, userToken, content_contract } = await req.json() as {
      creator_id?: string;
      userToken?: string;
      content_contract?: string;
    };

    if (!creator_id || !userToken || !content_contract) {
      return NextResponse.json({ error: 'creator_id, userToken, content_contract required' }, { status: 400 });
    }

    const db = createServerClient();
    const creator = await assertCreatorOwnership(db, creator_id, userToken);
    if (!creator.circle_wallet_id) {
      return NextResponse.json({ error: 'creator has no Circle wallet bound' }, { status: 400 });
    }
    if (!creator.eoa_address) {
      return NextResponse.json({ error: 'creator has no UCW wallet address on record' }, { status: 400 });
    }

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

    const balance = await readVaultBalance(content_contract);
    if (balance <= 0n) {
      return NextResponse.json({ skipped: true, reason: 'zero_balance' });
    }

    const destinationAddress = creator.eoa_address;
    const amountAtomic = balance.toString();
    const nonce = await readVaultWithdrawNonce(content_contract);
    // Snapshot cumulative withdrawals now — /prepare re-checks this hasn't moved before
    // relaying, so a stale signature can't be replayed after an intervening withdrawal
    // (ContentVault's deployed withdrawNonce alone doesn't catch that case).
    const totalWithdrawnAtSign = (await readVaultTotalWithdrawn(content_contract)).toString();
    const typedData = {
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        Withdraw: [
          { name: 'to', type: 'address' },
          { name: 'amountAtomic', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
        ],
      },
      primaryType: 'Withdraw',
      domain: {
        name: 'ContentVault',
        version: '1',
        chainId: ARC_CHAIN_ID,
        verifyingContract: content_contract,
      },
      message: {
        to: destinationAddress,
        amountAtomic,
        nonce: nonce.toString(),
      },
    };

    const { challengeId } = await requestTypedDataSignature(userToken, creator.circle_wallet_id, typedData);

    return NextResponse.json({
      challengeId,
      nonce: nonce.toString(),
      amount_atomic: amountAtomic,
      destination_address: destinationAddress,
      total_withdrawn_atomic: totalWithdrawnAtSign,
      signed_at: Date.now(),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
