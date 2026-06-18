/**
 * app/api/withdraw/route.ts — M8: Gateway withdraw endpoint.
 * POST /api/withdraw
 * Body: { to: string, chain: string, amount: string }  (amount is display dollars, e.g. "1.5")
 * Returns { txHash, explorerUrl }
 * Uses SELLER_PRIVATE_KEY server-side only.
 */

import { NextRequest, NextResponse } from "next/server";
import { withdrawFromGateway, explorerUrl } from "../../../lib/circle/index";
import { fromDisplay } from "../../../lib/money";
import { SELLER_PRIVATE_KEY, USDC_ERC20_DECIMALS } from "../../../lib/config";

export async function POST(req: NextRequest) {
  let body: { to?: string; chain?: string; amount?: string | number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { to, chain, amount } = body;
  if (!to || !chain || amount === undefined) {
    return NextResponse.json(
      { error: "to, chain, and amount are required" },
      { status: 400 }
    );
  }

  try {
    const usdcAmount = fromDisplay(amount, USDC_ERC20_DECIMALS);
    const txRef = await withdrawFromGateway(SELLER_PRIVATE_KEY, to, chain, usdcAmount);
    return NextResponse.json({
      txHash: txRef.hash,
      explorerUrl: explorerUrl(txRef),
    });
  } catch (err) {
    console.error("[api/withdraw]", err);
    return NextResponse.json({ error: "Withdraw failed" }, { status: 500 });
  }
}
