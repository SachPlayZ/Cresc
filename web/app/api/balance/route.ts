/**
 * app/api/balance/route.ts — M8: Gateway balance endpoint.
 * GET /api/balance?address=<creator_wallet_address>
 * Returns { total, withdrawable, withdrawing } as display strings.
 * Server-only — uses SELLER_PRIVATE_KEY via getGatewayBalance adapter.
 */

import { NextRequest, NextResponse } from "next/server";
import { getGatewayBalance } from "../../../lib/circle/index";
import { toDisplay } from "../../../lib/money";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address) {
    return NextResponse.json({ error: "address query param required" }, { status: 400 });
  }

  try {
    const balance = await getGatewayBalance(address);
    return NextResponse.json({
      total: toDisplay(balance.total),
      withdrawable: toDisplay(balance.withdrawable),
      withdrawing: toDisplay(balance.withdrawing),
    });
  } catch (err) {
    console.error("[api/balance]", err);
    return NextResponse.json({ error: "Failed to fetch balance" }, { status: 500 });
  }
}
