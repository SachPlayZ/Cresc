/**
 * POST /api/payout
 * Body: { creatorId: string }
 * Returns: { txHash, explorerUrl, amountDisplay }
 *
 * Platform calls withdrawFromGatewayCircle on behalf of the creator.
 * The to address is always creator.wallet_address from DB — never from the request body.
 * Always pays the full unpaid balance (no partial payout to prevent under-payment bugs).
 */

import { NextResponse } from "next/server";
import { createServerClient } from "../../../lib/db";
import { getCreator, getUnpaidEarnings, markPaymentsPaidOut } from "../../../lib/repo/index";
import { withdrawFromGatewayCircle } from "../../../lib/circle/wallets";
import { fromBaseUnits, toDisplay } from "../../../lib/money";
import {
  CIRCLE_SELLER_WALLET_ID,
  CIRCLE_SELLER_WALLET_ADDRESS,
  USDC_ERC20_DECIMALS,
  ARC_EXPLORER_BASE,
} from "../../../lib/config";

export async function POST(request: Request): Promise<NextResponse> {
  let body: { creatorId?: string };
  try {
    body = await request.json() as { creatorId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { creatorId } = body;
  if (!creatorId || typeof creatorId !== "string") {
    return NextResponse.json({ error: "creatorId is required" }, { status: 400 });
  }

  const db = createServerClient();

  // Resolve creator
  const creator = await getCreator(db, creatorId);
  if (!creator) {
    return NextResponse.json({ error: "Creator not found" }, { status: 404 });
  }
  if (!creator.wallet_address) {
    return NextResponse.json(
      { error: "Creator has no registered wallet address" },
      { status: 400 }
    );
  }

  // Compute unpaid balance
  let unpaidAmount: bigint;
  try {
    unpaidAmount = await getUnpaidEarnings(db, creatorId);
  } catch (err) {
    return NextResponse.json(
      { error: `DB error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }

  if (unpaidAmount === 0n) {
    return NextResponse.json({ error: "No unpaid earnings" }, { status: 409 });
  }
  if (unpaidAmount < 1000n) {
    return NextResponse.json(
      { error: "Amount below minimum withdrawal ($0.001)" },
      { status: 409 }
    );
  }

  // Execute withdrawal
  let txHash: string;
  try {
    txHash = await withdrawFromGatewayCircle(
      CIRCLE_SELLER_WALLET_ID,
      CIRCLE_SELLER_WALLET_ADDRESS,
      creator.wallet_address,
      { value: unpaidAmount, decimals: USDC_ERC20_DECIMALS },
    );
  } catch (err) {
    return NextResponse.json(
      { error: `Withdrawal failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }

  // Mark payments as paid out (only after successful withdrawal)
  try {
    await markPaymentsPaidOut(db, creatorId, txHash);
  } catch (err) {
    // Log but don't fail the response — USDC is already sent
    console.error("[payout] markPaymentsPaidOut failed after successful tx:", err);
  }

  const amountDisplay = toDisplay(fromBaseUnits(unpaidAmount, USDC_ERC20_DECIMALS));
  const explorerUrl = `${ARC_EXPLORER_BASE}/tx/${txHash}`;

  return NextResponse.json({ txHash, explorerUrl, amountDisplay });
}
