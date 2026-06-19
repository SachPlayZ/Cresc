import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getOrCreateReaderWallet, getReaderBalance } from "../../../../lib/reader-wallets/index";
import { USDC_ERC20_DECIMALS } from "../../../../lib/config";

// IP-based rate limit: max 3 new wallet creations per IP per 60s.
// Protects against spamming wallet creation without a session cookie.
const ipCreations = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 3;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipCreations.get(ip);
  if (!entry || now > entry.resetAt) {
    ipCreations.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  if (entry.count >= RATE_MAX) return true;
  entry.count++;
  return false;
}

export async function GET() {
  const cookieStore = await cookies();
  let readerId = cookieStore.get("cresc_reader_id")?.value;
  const isNew = !readerId;

  if (isNew) {
    // Gate new wallet creation behind IP rate limit to prevent spam.
    const headerStore = await headers();
    const ip =
      headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      headerStore.get("x-real-ip") ??
      "unknown";

    if (isRateLimited(ip)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    readerId = randomUUID();
  }

  try {
    const wallet = await getOrCreateReaderWallet(readerId!);
    // getReaderBalance triggers auto-deposit of any on-chain USDC and returns the real Gateway balance.
    const { onChain, gatewayAvailable, gatewayFunded } = await getReaderBalance(readerId!);

    const res = NextResponse.json({
      address: wallet.eoa_address,
      balance: (Number(gatewayAvailable) / 10 ** USDC_ERC20_DECIMALS).toFixed(6),
      gatewayFunded,
      // True when USDC is on-chain but auto-deposit hasn't moved it to Gateway yet.
      depositPending: onChain > 0n && !gatewayFunded,
    });

    if (isNew) {
      res.cookies.set("cresc_reader_id", readerId!, {
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 365,
        path: "/",
        sameSite: "lax",
      });
    }

    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
