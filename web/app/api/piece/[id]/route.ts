/**
 * app/api/piece/[id]/route.ts — M4 x402 seller endpoint.
 *
 * GET /api/piece/<pieceId>
 *   - No Payment-Signature header → return HTTP 402 with PAYMENT-REQUIRED header (base64 JSON).
 *   - With Payment-Signature header → settle via Circle Gateway, write payment + session rows, return content.
 *
 * ZERO LLM calls on this path (CLAUDE.md §7.3).
 * Price is read from pieces.current_price — never computed here.
 *
 * Header protocol (verified from @circle-fin/x402-batching dist):
 *   402 response:  `PAYMENT-REQUIRED: <base64(JSON { x402Version, resource, accepts })>`
 *   Client retry:  `Payment-Signature: <base64(JSON { x402Version, payload, resource, accepted })>`
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "../../../../lib/db";
import {
  getStandingPrice,
  getPiece,
  createPayment,
  settlePayment,
  failPayment,
  createSession,
} from "../../../../lib/repo/index";
import {
  buildPaymentRequirements,
  verifyAndSettle,
  explorerUrl,
  type EIP3009Auth,
} from "../../../../lib/circle/index";
import {
  USDC_ERC20_DECIMALS,
  SELLER_ADDRESS,
  isMockMode,
} from "../../../../lib/config";
import { fromBaseUnits as moneyFromBaseUnits } from "../../../../lib/money";

// ---------------------------------------------------------------------------
// Mock standing price (for mock mode when no piece in DB yet).
// $0.001 = 1000 base units (6 decimals)
// ---------------------------------------------------------------------------
const MOCK_STANDING_PRICE = "1000";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: pieceId } = await params;
  const db = createServerClient();

  // --- 1. Fetch standing price (fast DB read — no LLM) ---
  let standingPriceStr: string | null;
  try {
    standingPriceStr = await getStandingPrice(db, pieceId);
  } catch {
    // In mock mode with no DB, use the mock price so the flow is testable.
    if (isMockMode) {
      standingPriceStr = MOCK_STANDING_PRICE;
    } else {
      return NextResponse.json({ error: "DB error fetching price" }, { status: 500 });
    }
  }

  if (!standingPriceStr) {
    // Piece not found or not listed — 404.
    return NextResponse.json({ error: "Piece not found or not listed" }, { status: 404 });
  }

  const standingPrice = moneyFromBaseUnits(BigInt(standingPriceStr), USDC_ERC20_DECIMALS);

  // --- 2. Build requirements (pure function — no network call) ---
  // payTo is SELLER_ADDRESS (platform wallet). Gateway credits accumulate there and
  // can be withdrawn via the dashboard. Creator earnings are tracked per-piece in the
  // payments table — that's the source of truth for revenue, not Gateway balance.
  const requirements = buildPaymentRequirements(standingPrice, SELLER_ADDRESS);

  // --- 3. Check for incoming payment ---
  const paymentHeader = req.headers.get("Payment-Signature");

  if (!paymentHeader) {
    // No payment — return HTTP 402 with PAYMENT-REQUIRED header.
    // resource must be an object with url + description + mimeType (Gateway schema).
    const resource = {
      url: `${req.nextUrl.origin}/api/piece/${pieceId}`,
      description: "Cresc article unlock",
      mimeType: "application/json",
    };
    const paymentRequired = {
      x402Version: 2,
      resource,
      accepts: [requirements],
    };
    const encoded = Buffer.from(JSON.stringify(paymentRequired)).toString("base64");

    return new NextResponse(null, {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": encoded,
        "Content-Type": "application/json",
      },
    });
  }

  // --- 4. Payment header present — parse and settle ---
  let signedAuth: EIP3009Auth;
  try {
    const decoded = Buffer.from(paymentHeader, "base64").toString("utf-8");
    signedAuth = JSON.parse(decoded) as EIP3009Auth;
  } catch {
    return NextResponse.json({ error: "Invalid Payment-Signature header" }, { status: 400 });
  }

  // Determine reader address — prefer payer from auth payload; fall back to query param.
  // After settlement we'll get payer from PaymentResult.
  const readerQuery = req.nextUrl.searchParams.get("reader") ?? "0xunknown";

  // --- 5. Fetch piece body (need it to return content) ---
  let piece;
  try {
    piece = await getPiece(db, pieceId);
  } catch {
    if (isMockMode) {
      piece = null; // handled below
    } else {
      return NextResponse.json({ error: "DB error fetching piece" }, { status: 500 });
    }
  }

  if (!piece && !isMockMode) {
    return NextResponse.json({ error: "Piece not found" }, { status: 404 });
  }

  // --- 6. Write pending payment row BEFORE settling (audit trail) ---
  let paymentRow;
  try {
    paymentRow = await createPayment(db, {
      kind: "unlock",
      piece_id: pieceId,
      session_id: null, // will be linked once session row is created
      reader_id: readerQuery,
      amount: standingPriceStr,
      status: "pending",
      tx_ref: null,
      arc_explorer_url: null,
      payout_ref: null,
    });
  } catch {
    // In mock mode without DB, synthesize a row.
    if (isMockMode) {
      paymentRow = { id: "mock-payment-id" };
    } else {
      return NextResponse.json({ error: "Failed to record payment" }, { status: 500 });
    }
  }

  // --- 7. Settle with Circle Gateway ---
  const result = await verifyAndSettle(signedAuth, requirements);

  if (!result.success) {
    try {
      await failPayment(db, paymentRow.id);
    } catch {
      // Best-effort — don't mask the original failure.
    }
    return NextResponse.json(
      { error: "Payment settlement failed", reason: result.errorReason },
      { status: 402 }
    );
  }

  // Resolved reader address — use payer from settlement if available.
  const readerId = result.payer ?? readerQuery;

  // --- 8. Create session row ---
  let session;
  try {
    session = await createSession(db, {
      piece_id: pieceId,
      reader_id: readerId,
      view_price_paid: standingPriceStr,
    });
  } catch {
    if (isMockMode) {
      session = { id: "mock-session-id" };
    } else {
      // Session failure is non-fatal for unlock — still serve content.
      session = { id: "unknown" };
    }
  }

  // --- 9. Mark payment as settled ---
  const txRef = result.txHash ?? "0x0";
  const arcUrl = result.txHash
    ? explorerUrl({ hash: result.txHash as `0x${string}`, chain: "arcTestnet" })
    : null;

  try {
    await settlePayment(db, paymentRow.id, txRef, arcUrl ?? "");
  } catch {
    // Best-effort — don't fail the unlock if settle-status update fails.
  }

  // --- 10. Return piece content ---
  const responseBody = isMockMode && !piece
    ? {
        title: "Mock Article",
        body: "This is mock content. Set up Supabase and insert a piece to see real content.",
        arcExplorerUrl: arcUrl,
        sessionId: session.id,
        payer: readerId,
      }
    : {
        title: piece!.title,
        body: piece!.body,
        arcExplorerUrl: arcUrl,
        sessionId: session.id,
        payer: readerId,
      };

  return NextResponse.json(responseBody, { status: 200 });
}
