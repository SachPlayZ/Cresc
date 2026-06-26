import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "../../../lib/db";
import { upsertCreator, getCreatorByWallet } from "../../../lib/repo/index";
import { createWallet, isCircleWalletMode } from "../../../lib/circle/wallets";
import { CIRCLE_WALLET_SET_ID } from "../../../lib/config";

// POST /api/creator — create or return existing creator by wallet address
export async function POST(req: NextRequest) {
  try {
    const { display_name, wallet_address } = await req.json() as {
      display_name: string;
      wallet_address: string;
    };

    if (!display_name?.trim()) {
      return NextResponse.json({ error: "display_name required" }, { status: 400 });
    }
    if (!wallet_address?.trim()) {
      return NextResponse.json({ error: "wallet_address required" }, { status: 400 });
    }

    const db = createServerClient();
    const creator = await upsertCreator(db, {
      display_name: display_name.trim(),
      wallet_address: wallet_address.trim().toLowerCase(),
    });

    // Provision Circle dev-controlled wallet if not already set
    if (isCircleWalletMode && CIRCLE_WALLET_SET_ID && !creator.circle_wallet_id) {
      try {
        const { walletId, address } = await createWallet(CIRCLE_WALLET_SET_ID, creator.id);
        await db.from('creators').update({
          circle_wallet_id: walletId,
          eoa_address: address,
        }).eq('id', creator.id);
        creator.circle_wallet_id = walletId;
        creator.eoa_address = address;
      } catch (err) {
        console.error('[creator] Circle wallet provisioning failed:', err);
        // Non-fatal — creator still created, wallet can be provisioned later
      }
    }

    return NextResponse.json({ creator });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// GET /api/creator?wallet=<address> — look up creator by wallet
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ error: "wallet param required" }, { status: 400 });
  try {
    const db = createServerClient();
    const creator = await getCreatorByWallet(db, wallet.toLowerCase());
    if (!creator) return NextResponse.json({ creator: null });
    return NextResponse.json({ creator });
  } catch {
    return NextResponse.json({ creator: null });
  }
}
