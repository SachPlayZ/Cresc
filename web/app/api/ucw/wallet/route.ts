import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/db';
import { listUserWallets } from '../../../../lib/circle/ucw';
import { assertCreatorOwnership, verifyOnboardingToken } from '../../../../lib/auth/creator';

// GET /api/ucw/wallet?userToken=...&creator_id=...&onboarding_token=...
// Called after W3S SDK executes wallet-creation challenge.
// Fetches first ARC-TESTNET wallet, saves to creators row.
export async function GET(req: NextRequest) {
  try {
    const userToken = req.nextUrl.searchParams.get('userToken');
    const creatorId = req.nextUrl.searchParams.get('creator_id');
    const ucwUserId = req.nextUrl.searchParams.get('ucw_user_id') ?? null;
    const onboardingToken = req.nextUrl.searchParams.get('onboarding_token');

    if (!userToken || !creatorId) {
      return NextResponse.json({ error: 'userToken and creator_id required' }, { status: 400 });
    }

    const wallets = await listUserWallets(userToken);
    const wallet = wallets[0];
    if (!wallet) {
      return NextResponse.json({ error: 'no wallet found — challenge may not be complete yet' }, { status: 404 });
    }

    const db = createServerClient();
    const { data: creator } = await db
      .from('creators')
      .select('circle_wallet_id, eoa_address')
      .eq('id', creatorId)
      .single();
    if (creator?.circle_wallet_id || creator?.eoa_address) {
      await assertCreatorOwnership(db, creatorId, userToken);
    } else if (!verifyOnboardingToken(creatorId, onboardingToken)) {
      return NextResponse.json({ error: 'invalid or missing onboarding_token' }, { status: 403 });
    }
    const update: Record<string, string> = {
      circle_wallet_id: wallet.id,
      eoa_address: wallet.address,
    };
    if (ucwUserId) update['ucw_user_id'] = ucwUserId;

    await db.from('creators').update(update).eq('id', creatorId);

    return NextResponse.json({ walletId: wallet.id, address: wallet.address });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
