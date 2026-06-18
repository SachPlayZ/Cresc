"use server";

/**
 * app/actions/unlock.ts — M4 Server Action for unlocking a piece.
 *
 * Calls business logic directly (no self-referential HTTP fetch) to avoid
 * Vercel Deployment Protection 401s on the server→self fetch path.
 *
 * Priority order:
 *   1. Reader wallet (cookie cresc_reader_id + SUPABASE_URL + ARC_RPC_URL) — per-reader EOA.
 *   2. Circle developer-controlled wallet (CIRCLE_API_KEY + ENTITY_SECRET set).
 *   3. Platform BUYER_PRIVATE_KEY (legacy/compat) — GatewayClient.pay() over HTTP.
 *   4. Mock path — direct settle with a dummy key, no testnet keys required.
 *
 * ZERO LLM calls (CLAUDE.md §7.3).
 */

import { cookies } from "next/headers";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import {
  isMockMode,
  BUYER_PRIVATE_KEY,
  USDC_ERC20_DECIMALS,
  SELLER_ADDRESS,
  ARC_RPC_URL,
  SUPABASE_URL,
  CIRCLE_API_KEY,
  ENTITY_SECRET,
} from "../../lib/config";
import {
  buildPaymentRequirements,
  verifyAndSettle,
  signPaymentAuthorization,
  explorerUrl,
  type X402Requirements,
  type EIP3009Auth,
} from "../../lib/circle/index";
import { signReaderPayment, recordSpend } from "../../lib/reader-wallets/index";
import { fromBaseUnits as moneyFromBaseUnits } from "../../lib/money";
import { createServerClient } from "../../lib/db";
import {
  getStandingPrice,
  getPiece,
  createPayment,
  settlePayment,
  failPayment,
  createSession,
} from "../../lib/repo/index";

type UnlockSuccess = {
  body: string;
  title: string;
  arcExplorerUrl: string | null;
  sessionId: string;
  payer?: string;
};

type UnlockError = {
  error: string;
};

export type UnlockResult = UnlockSuccess | UnlockError;

export async function unlockPiece(pieceId: string): Promise<UnlockResult> {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

  const pieceUrl = `${appUrl}/api/piece/${pieceId}`;

  try {
    const cookieStore = await cookies();
    const readerId = cookieStore.get("cresc_reader_id")?.value;
    const canUseReaderWallet = !!(readerId && ARC_RPC_URL && SUPABASE_URL);
    const isCircleMode = !!(CIRCLE_API_KEY && ENTITY_SECRET);

    if (canUseReaderWallet) {
      return await unlockDirect(
        pieceId,
        readerId!,
        (req) => signReaderPayment(readerId!, req)
      );
    } else if (isCircleMode) {
      const dummyKey =
        "0x0000000000000000000000000000000000000000000000000000000000000001";
      return await unlockDirect(
        pieceId,
        null,
        (req) => signPaymentAuthorization(dummyKey, req)
      );
    } else if (!isMockMode && BUYER_PRIVATE_KEY) {
      // GatewayClient.pay() handles the full HTTP 402 flow.
      // If this 401s on Vercel, set NEXT_PUBLIC_APP_URL to the unprotected production URL.
      const client = new GatewayClient({
        chain: "arcTestnet",
        privateKey: BUYER_PRIVATE_KEY as `0x${string}`,
        rpcUrl: ARC_RPC_URL,
      });
      const payResult = await client.pay<UnlockSuccess>(pieceUrl);
      if (payResult.status !== 200) {
        return { error: `Payment failed with status ${payResult.status}` };
      }
      const data = payResult.data;
      return {
        body: data.body,
        title: data.title,
        arcExplorerUrl: data.arcExplorerUrl ?? null,
        sessionId: data.sessionId,
        payer: data.payer,
      };
    } else {
      const mockKey =
        BUYER_PRIVATE_KEY ||
        "0x0000000000000000000000000000000000000000000000000000000000000001";
      return await unlockDirect(
        pieceId,
        null,
        (req) => signPaymentAuthorization(mockKey, req)
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

/**
 * Direct unlock — no HTTP self-fetch.
 * Gets price from DB, signs, settles, and records in one server-side call chain.
 *
 * @param pieceId - piece to unlock
 * @param readerId - reader ID for spend accounting (null = skip recordSpend)
 * @param signerFn - signs the payment requirements, returns EIP3009Auth
 */
async function unlockDirect(
  pieceId: string,
  readerId: string | null,
  signerFn: (requirements: X402Requirements) => Promise<EIP3009Auth>
): Promise<UnlockResult> {
  const db = createServerClient();

  // 1. Standing price (fast DB read — no LLM)
  let standingPriceStr: string | null;
  try {
    standingPriceStr = await getStandingPrice(db, pieceId);
  } catch {
    if (isMockMode) {
      standingPriceStr = "1000"; // $0.001 mock price (6 decimals)
    } else {
      return { error: "DB error fetching price" };
    }
  }

  if (!standingPriceStr) {
    return { error: "Piece not found or not listed" };
  }

  const standingPrice = moneyFromBaseUnits(
    BigInt(standingPriceStr),
    USDC_ERC20_DECIMALS
  );

  // 2. Build requirements (pure, no network)
  const requirements = buildPaymentRequirements(standingPrice, SELLER_ADDRESS);

  // 3. Sign payment authorization
  const signedAuth = await signerFn(requirements);

  // 4. Fetch piece body
  let piece;
  try {
    piece = await getPiece(db, pieceId);
  } catch {
    if (!isMockMode) return { error: "DB error fetching piece" };
  }
  if (!piece && !isMockMode) return { error: "Piece not found" };

  // 5. Write pending payment row before settling (audit trail)
  let paymentRow: { id: string };
  try {
    paymentRow = await createPayment(db, {
      kind: "unlock",
      piece_id: pieceId,
      session_id: null,
      reader_id: readerId ?? "unknown",
      amount: standingPriceStr,
      status: "pending",
      tx_ref: null,
      arc_explorer_url: null,
      payout_ref: null,
    });
  } catch {
    if (isMockMode) {
      paymentRow = { id: "mock-payment-id" };
    } else {
      return { error: "Failed to record payment" };
    }
  }

  // 6. Settle with Circle Gateway
  const result = await verifyAndSettle(signedAuth, requirements);

  if (!result.success) {
    try {
      await failPayment(db, paymentRow.id);
    } catch {
      // best-effort
    }
    return {
      error: `Payment settlement failed${result.errorReason ? `: ${result.errorReason}` : ""}`,
    };
  }

  const payerAddress = result.payer ?? readerId ?? "unknown";

  // 7. Create session row
  let session: { id: string };
  try {
    session = await createSession(db, {
      piece_id: pieceId,
      reader_id: payerAddress,
      view_price_paid: standingPriceStr,
    });
  } catch {
    session = { id: isMockMode ? "mock-session-id" : "unknown" };
  }

  // 8. Mark payment settled (best-effort)
  const txRef = result.txHash ?? "0x0";
  const arcUrl = result.txHash
    ? explorerUrl({
        hash: result.txHash as `0x${string}`,
        chain: "arcTestnet",
      })
    : null;

  try {
    await settlePayment(db, paymentRow.id, txRef, arcUrl ?? "");
  } catch {
    // best-effort
  }

  // 9. Record spend on reader wallet (non-fatal, only when readerId is known)
  if (readerId) {
    try {
      await recordSpend(readerId, BigInt(standingPriceStr));
    } catch (e) {
      console.error("[unlock] recordSpend failed:", e);
    }
  }

  // 10. Return content
  if (isMockMode && !piece) {
    return {
      title: "Mock Article",
      body: "This is mock content. Set up Supabase and insert a piece to see real content.",
      arcExplorerUrl: arcUrl,
      sessionId: session.id,
      payer: payerAddress,
    };
  }

  return {
    title: piece!.title,
    body: piece!.body,
    arcExplorerUrl: arcUrl,
    sessionId: session.id,
    payer: payerAddress,
  };
}
