import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "../../../lib/db";
import { createCreator, getCreatorByWallet } from "../../../lib/repo/index";
import { generateOnboardingToken } from "../../../lib/auth/creator";

// POST /api/creator — always creates a fresh creator row.
// Wallet provisioning happens separately via /api/ucw/* (user-controlled wallet flow);
// until a wallet is bound, `onboarding_token` is the caller's proof that they are the
// one who just created this row (see web/lib/auth/creator.ts).
export async function POST(req: NextRequest) {
  try {
    const { display_name, wallet_address } = await req.json() as {
      display_name: string;
      wallet_address?: string;
    };

    if (!display_name?.trim()) {
      return NextResponse.json({ error: "display_name required" }, { status: 400 });
    }

    const db = createServerClient();
    const creator = await createCreator(db, {
      display_name: display_name.trim(),
      wallet_address: (wallet_address ?? '').trim().toLowerCase(),
    });

    return NextResponse.json({ creator, onboarding_token: generateOnboardingToken(creator.id) });
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
