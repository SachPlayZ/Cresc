import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "../../../lib/db";
import { upsertCreator, getCreatorByWallet } from "../../../lib/repo/index";

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
