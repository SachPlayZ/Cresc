import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "../../../lib/db";
import { createCreator } from "../../../lib/repo/index";
import {
  generateOnboardingToken,
  generateSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from "../../../lib/auth/creator";

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
    const trimmedWallet = wallet_address?.trim().toLowerCase();
    const creator = await createCreator(db, {
      display_name: display_name.trim(),
      wallet_address: trimmedWallet ? trimmedWallet : null,
    });

    const res = NextResponse.json({ creator, onboarding_token: generateOnboardingToken(creator.id) });
    res.cookies.set(SESSION_COOKIE_NAME, generateSessionToken(creator.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return res;
  } catch (err) {
    console.error("[POST /api/creator] failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
