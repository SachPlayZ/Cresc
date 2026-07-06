// POST /api/withdraw/sign-request
// Step 1 of a contract-native withdrawal: verifies creator ownership of the content
// contract, reads the vault's current withdrawNonce onchain, and asks Circle to create
// a signTypedData challenge for the creator's own UCW wallet over the EIP-712
// `Withdraw(address to,uint256 amountAtomic,uint256 nonce)` message (see
// contracts/src/ContentVault.sol withdrawSigned). The frontend completes the challenge
// via sdk.execute(), then posts the resulting signature to /api/withdraw/prepare.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/db';
import { assertCreatorOwnership } from '../../../../lib/auth/creator';
import { requestTypedDataSignature } from '../../../../lib/circle/ucw';
import { readVaultWithdrawNonce } from '../../../../lib/circle';
import { ARC_CHAIN_ID } from '../../../../lib/config';

export async function POST(req: NextRequest) {
  try {
    const { creator_id, userToken, content_contract, amount_atomic, destination_address } =
      await req.json() as {
        creator_id?: string;
        userToken?: string;
        content_contract?: string;
        amount_atomic?: string;
        destination_address?: string;
      };

    if (!creator_id || !userToken || !content_contract || !amount_atomic || !destination_address) {
      return NextResponse.json({ error: 'creator_id, userToken, content_contract, amount_atomic, destination_address required' }, { status: 400 });
    }
    if (!/^[0-9]+$/.test(amount_atomic) || BigInt(amount_atomic) <= 0n) {
      return NextResponse.json({ error: 'amount_atomic must be a positive atomic USDC integer' }, { status: 400 });
    }

    const db = createServerClient();
    const creator = await assertCreatorOwnership(db, creator_id, userToken);
    if (!creator.circle_wallet_id) {
      return NextResponse.json({ error: 'creator has no Circle wallet bound' }, { status: 400 });
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

    const nonce = await readVaultWithdrawNonce(content_contract);
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
        to: destination_address,
        amountAtomic: amount_atomic,
        nonce: nonce.toString(),
      },
    };

    const { challengeId } = await requestTypedDataSignature(userToken, creator.circle_wallet_id, typedData);

    return NextResponse.json({ challengeId, nonce: nonce.toString() });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
