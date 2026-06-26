import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/db';
import { initUserWallet } from '../../../../lib/circle/ucw';

export async function POST(req: NextRequest) {
  try {
    const { userToken, creator_id } = await req.json() as {
      userToken?: string;
      creator_id?: string;
    };
    if (!userToken || !creator_id) {
      return NextResponse.json({ error: 'userToken and creator_id required' }, { status: 400 });
    }

    const result = await initUserWallet(userToken);

    if ('alreadyExists' in result) {
      // User already has wallets — save ucw_user_id derived from wallet IDs
      const wallet = result.wallets[0];
      if (wallet) {
        const db = createServerClient();
        await db.from('creators').update({
          circle_wallet_id: wallet.id,
          eoa_address: wallet.address,
        }).eq('id', creator_id);
      }
      return NextResponse.json({ alreadyExists: true, wallets: result.wallets });
    }

    return NextResponse.json({ challengeId: result.challengeId });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
