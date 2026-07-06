import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "../../../../lib/db";
import { getCreatorByEoaAddress } from "../../../../lib/repo/index";
import { listUserWallets } from "../../../../lib/circle/ucw";
import {
  generateSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from "../../../../lib/auth/creator";

// POST /api/creator/login — re-establish identity after localStorage/cookies are lost.
// userToken comes from a fresh Circle Google-OAuth login (see app/login/page.tsx);
// listUserWallets(userToken) is Circle's own proof of which wallet(s) belong to that
// login, so matching against eoa_address here can't be spoofed by just claiming an address.
export async function POST(req: NextRequest) {
  try {
    const { userToken } = await req.json() as { userToken?: string };
    if (!userToken) {
      return NextResponse.json({ error: "userToken required" }, { status: 400 });
    }

    const wallets = await listUserWallets(userToken);
    if (wallets.length === 0) {
      return NextResponse.json({ error: "No Circle wallet found for this account" }, { status: 404 });
    }

    const db = createServerClient();
    let creator = null;
    for (const wallet of wallets) {
      creator = await getCreatorByEoaAddress(db, wallet.address);
      if (creator) break;
    }
    if (!creator) {
      return NextResponse.json(
        { error: "No Cresc creator account is linked to this Google account yet" },
        { status: 404 }
      );
    }

    const res = NextResponse.json({ creator });
    res.cookies.set(SESSION_COOKIE_NAME, generateSessionToken(creator.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return res;
  } catch (err) {
    console.error("[POST /api/creator/login] failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
