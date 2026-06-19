/**
 * app/api/tip/accept/route.ts — M7a: tip settlement endpoint.
 *
 * POST /api/tip/accept
 * Body: { tipDecisionId: string, finalTip: number /* display dollars * / }
 *
 * Flow:
 * 1. Load tip_decision → suggested_tip, view_price_paid, session_id, piece_id
 * 2. Load session → reader_id
 * 3. Build payment requirements for finalTip amount
 * 4. Create payment row (kind:'tip', status:'pending')
 * 5. Sign with BUYER_PRIVATE_KEY + settle via Circle Gateway (verifyAndSettle)
 * 6. On success: settlePayment(db, paymentId, txHash, explorerUrl)
 * 7. Compute tip_surplus = finalTip - suggested_tip (0 if finalTip <= suggested_tip)
 * 8. Call acceptTip(db, tipDecisionId, finalTip_baseUnits, surplus_baseUnits_or_null)
 * 9. If surplus > 0: enqueueJob(db, 'tip_feedback', { tipDecisionId, surplus: surplusBaseUnits })
 *    → Cresc-Agents tipFeedbackWorker picks this up → enqueues pricing_sweep
 *    → PricingAgent sees tip_surplus in signal bundle → price rises (CLAUDE.md §6.5 emergent loop)
 * 10. Return { ok: true, txHash, arcExplorerUrl, surplusDetected: surplus > 0 }
 *
 * Zero LLM calls on this path (CLAUDE.md §7.3).
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/db";
import {
  getTipDecision,
  getSession,
  createPayment,
  settlePayment,
  failPayment,
  acceptTip,
  enqueueJob,
} from "@/lib/repo";
import {
  buildPaymentRequirements,
  signPaymentAuthorization,
  verifyAndSettle,
  explorerUrl,
} from "@/lib/circle/index";
import {
  SELLER_ADDRESS,
  BUYER_PRIVATE_KEY,
  USDC_ERC20_DECIMALS,
  isMockMode,
} from "@/lib/config";
import { fromDisplay, fromBaseUnits, toBaseUnitsString } from "@/lib/money";

type AcceptBody = {
  tipDecisionId: string;
  finalTip: number; // display dollars (e.g. 0.005 = $0.005)
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  // --- Parse body ---
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { tipDecisionId, finalTip } = body as AcceptBody;

  if (
    typeof tipDecisionId !== "string" ||
    !tipDecisionId ||
    typeof finalTip !== "number" ||
    finalTip <= 0
  ) {
    return NextResponse.json(
      { error: "Missing or invalid fields: tipDecisionId (string) and finalTip (number > 0) required" },
      { status: 400 }
    );
  }

  const db = createServerClient();

  // --- 1. Load tip_decision ---
  let tipDecision;
  try {
    tipDecision = await getTipDecision(db, tipDecisionId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[tip/accept] DB error loading tip_decision:", message);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  if (!tipDecision && !isMockMode) {
    return NextResponse.json({ error: "Tip decision not found" }, { status: 404 });
  }

  // In mock mode without a DB row, synthesize a stub decision so the flow is testable.
  const decision = tipDecision ?? {
    id: tipDecisionId,
    session_id: "mock-session-id",
    piece_id: "mock-piece-id",
    suggested_tip: "500",   // $0.0005 in base units
    view_price_paid: "1000", // $0.001 in base units
    prompted: true,
    signals_cited: [],
    reasoning: "mock",
    confidence: 1,
    accepted: null,
    final_tip: null,
    tip_surplus: null,
    created_at: new Date().toISOString(),
  };

  if (decision.accepted !== null) {
    return NextResponse.json(
      { error: "Tip decision already actioned (accepted or declined)" },
      { status: 409 }
    );
  }

  // --- 2. Load session → reader_id ---
  let session;
  try {
    session = await getSession(db, decision.session_id);
  } catch {
    // non-fatal in mock mode
    session = null;
  }

  const readerId = session?.reader_id ?? "0xunknown";

  // --- 3. Convert finalTip display dollars → UsdcAmount ---
  // fromDisplay takes (amount: string|number, decimals: number)
  const finalTipAmount = fromDisplay(finalTip, USDC_ERC20_DECIMALS);

  // Build payment requirements (pure fn, no network calls)
  const requirements = buildPaymentRequirements(finalTipAmount, SELLER_ADDRESS);

  // --- 4. Create pending payment row ---
  let paymentRow;
  try {
    paymentRow = await createPayment(db, {
      kind: "tip",
      piece_id: decision.piece_id,
      session_id: decision.session_id,
      reader_id: readerId,
      amount: toBaseUnitsString(finalTipAmount),
      status: "pending",
      tx_ref: null,
      arc_explorer_url: null,
      payout_ref: null,
    });
  } catch {
    if (isMockMode) {
      paymentRow = { id: "mock-tip-payment-id" };
    } else {
      return NextResponse.json({ error: "Failed to create payment record" }, { status: 500 });
    }
  }

  // --- 5. Sign + settle (reader pays seller via Circle Gateway) ---
  let signedAuth;
  try {
    signedAuth = await signPaymentAuthorization(BUYER_PRIVATE_KEY, requirements);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[tip/accept] signing error:", message);
    await failPayment(db, paymentRow.id).catch(() => {});
    return NextResponse.json({ error: "Payment signing failed", reason: message }, { status: 502 });
  }

  const result = await verifyAndSettle(signedAuth, requirements);

  if (!result.success) {
    await failPayment(db, paymentRow.id).catch(() => {});
    return NextResponse.json(
      { error: "Tip settlement failed", reason: result.errorReason },
      { status: 402 }
    );
  }

  // --- 6. Mark payment as settled ---
  const txHash = result.txHash ?? "0x0";
  const arcUrl = result.txHash
    ? explorerUrl({ hash: result.txHash as `0x${string}`, chain: "arcTestnet" })
    : null;

  await settlePayment(db, paymentRow.id, txHash, arcUrl ?? "", result.payer).catch((e) => {
    console.error("[tip/accept] settlePayment DB update failed (tip settled on-chain):", e);
  });

  // --- 7. Compute tip_surplus ---
  // surplus = finalTip - suggestedTip, clamped to 0 if reader tipped at or below suggestion.
  // All arithmetic in base units (bigint) to avoid float corruption (CLAUDE.md §8).
  const suggestedBaseUnits = decision.suggested_tip
    ? BigInt(decision.suggested_tip)
    : 0n;
  const finalBaseUnits = finalTipAmount.value;
  const surplusValue = finalBaseUnits > suggestedBaseUnits
    ? finalBaseUnits - suggestedBaseUnits
    : 0n;

  const finalTipBaseUnitsStr = toBaseUnitsString(finalTipAmount);
  const surplusBaseUnitsStr = surplusValue > 0n
    ? toBaseUnitsString(fromBaseUnits(surplusValue, USDC_ERC20_DECIMALS))
    : null;

  // --- 8. Mark tip_decision as accepted ---
  try {
    await acceptTip(db, tipDecisionId, finalTipBaseUnitsStr, surplusBaseUnitsStr);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[tip/accept] acceptTip DB error:", message);
    // Payment already settled — don't return error, just log and continue.
  }

  // --- 9. Enqueue tip_feedback job if surplus detected ---
  // This is the emergent loop trigger: Cresc-Agents tipFeedbackWorker picks it up,
  // enqueues a pricing_sweep with trigger='tip_surplus', PricingAgent cites the surplus
  // in its reasoning chain → price rises. (CLAUDE.md §6.5)
  const surplusDetected = surplusValue > 0n;
  if (surplusDetected && surplusBaseUnitsStr) {
    try {
      await enqueueJob(db, "tip_feedback", {
        tipDecisionId,
        surplus: surplusBaseUnitsStr,
      });
      console.log(
        `[tip/accept] surplus detected: ${surplusBaseUnitsStr} base-units → tip_feedback job enqueued`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[tip/accept] enqueueJob(tip_feedback) error:", message);
      // Non-fatal: tip already accepted and settled; best-effort for the feedback loop.
    }
  }

  // --- 10. Return result ---
  return NextResponse.json({
    ok: true,
    txHash,
    arcExplorerUrl: arcUrl,
    surplusDetected,
    finalTip: finalTip,
    suggestedTip: decision.suggested_tip
      ? Number(decision.suggested_tip) / 10 ** USDC_ERC20_DECIMALS
      : null,
  });
}
