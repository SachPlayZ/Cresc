"use server";

/**
 * app/actions/unlock.ts — M4 Server Action for unlocking a piece.
 *
 * Priority order:
 *   1. Reader wallet (cookie cresc_reader_id + SUPABASE_URL + ARC_RPC_URL) — per-reader EOA.
 *   2. Platform BUYER_PRIVATE_KEY (legacy/compat, not mock mode) — GatewayClient.pay().
 *   3. Mock path — manual 402 flow with a mock/dummy key (no testnet keys required).
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
import { buildPaymentRequirements, signPaymentAuthorization } from "../../lib/circle/index";
import { signReaderPayment, recordSpend } from "../../lib/reader-wallets/index";
import { fromBaseUnits as moneyFromBaseUnits } from "../../lib/money";

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
      // --- Reader wallet path: manual 402 flow, sign with per-reader EOA ---
      return await unlockWithReaderWallet(pieceUrl, readerId!, SELLER_ADDRESS);
    } else if (isCircleMode) {
      // --- Circle developer-controlled wallet path: signPaymentAuthorization uses MPC internally ---
      return await unlockWithCircleWallet(pieceUrl, SELLER_ADDRESS);
    } else if (!isMockMode && BUYER_PRIVATE_KEY) {
      // --- Platform raw EOA key path: GatewayClient.pay() ---
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
      // --- Mock path: dummy key, verifyAndSettle returns mock result ---
      return await unlockMock(pieceUrl, SELLER_ADDRESS);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

// --- Manual 402 flow helpers ---

type RawPaymentRequired = {
  x402Version: number;
  resource: string;
  accepts: Array<{ amount: string; [k: string]: unknown }>;
};

async function do402Flow(
  pieceUrl: string,
  sellerAddress: string,
  signerFn: (req: RawPaymentRequired["accepts"][0], requirements: ReturnType<typeof buildPaymentRequirements>) => Promise<unknown>
): Promise<UnlockResult & { amountPaid?: bigint }> {
  const response402 = await fetch(pieceUrl, { cache: "no-store" });

  if (response402.status === 404) return { error: "Piece not found or not listed" };

  if (response402.status !== 402) {
    if (response402.ok) {
      const data = (await response402.json()) as UnlockSuccess;
      return {
        body: data.body ?? "",
        title: data.title ?? "",
        arcExplorerUrl: data.arcExplorerUrl ?? null,
        sessionId: data.sessionId ?? "",
        payer: data.payer,
      };
    }
    const errBody = await response402.json().catch(() => ({})) as { error?: string };
    return { error: errBody.error ?? `Unexpected status ${response402.status}` };
  }

  const paymentRequiredHeader = response402.headers.get("PAYMENT-REQUIRED");
  if (!paymentRequiredHeader) {
    return { error: "Server returned 402 but missing PAYMENT-REQUIRED header" };
  }

  const paymentRequired = JSON.parse(
    Buffer.from(paymentRequiredHeader, "base64").toString("utf-8")
  ) as RawPaymentRequired;

  const accepts = paymentRequired.accepts;
  if (!accepts?.length) return { error: "No payment options in PAYMENT-REQUIRED" };

  const req = accepts[0];
  const price = moneyFromBaseUnits(BigInt(req.amount), USDC_ERC20_DECIMALS);
  const requirements = buildPaymentRequirements(price, sellerAddress);

  const signedAuth = await signerFn(req, requirements);

  const paymentPayload = {
    ...(signedAuth as object),
    resource: paymentRequired.resource,
    accepted: req,
  };
  const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");

  const paidResponse = await fetch(pieceUrl, {
    headers: { "Payment-Signature": paymentHeader },
    cache: "no-store",
  });

  if (!paidResponse.ok) {
    const errBody = await paidResponse.json().catch(() => ({})) as { error?: string };
    return { error: errBody.error ?? `Payment settled but server returned ${paidResponse.status}` };
  }

  const data = (await paidResponse.json()) as UnlockSuccess;
  return {
    body: data.body ?? "",
    title: data.title ?? "",
    arcExplorerUrl: data.arcExplorerUrl ?? null,
    sessionId: data.sessionId ?? "",
    payer: data.payer ?? "",
    amountPaid: BigInt(req.amount),
  };
}

async function unlockWithReaderWallet(
  pieceUrl: string,
  readerId: string,
  sellerAddress: string
): Promise<UnlockResult> {
  const result = await do402Flow(pieceUrl, sellerAddress, async (_req, requirements) =>
    signReaderPayment(readerId, requirements)
  ) as UnlockSuccess & { error?: string; amountPaid?: bigint };

  if (result.error) return { error: result.error };

  if (result.amountPaid) {
    await recordSpend(readerId, result.amountPaid).catch((e) =>
      console.error("[unlock] recordSpend failed:", e)
    );
  }

  return {
    body: result.body,
    title: result.title,
    arcExplorerUrl: result.arcExplorerUrl,
    sessionId: result.sessionId,
    payer: result.payer,
  };
}

async function unlockWithCircleWallet(
  pieceUrl: string,
  sellerAddress: string
): Promise<UnlockResult> {
  // signPaymentAuthorization detects isCircleWalletMode internally and uses MPC signing.
  // The privKey param is ignored when Circle mode is active.
  const result = await do402Flow(pieceUrl, sellerAddress, async (_req, requirements) =>
    signPaymentAuthorization("0x0000000000000000000000000000000000000000000000000000000000000001", requirements)
  ) as UnlockSuccess & { error?: string };

  if (result.error) return { error: result.error };
  return {
    body: result.body,
    title: result.title,
    arcExplorerUrl: result.arcExplorerUrl,
    sessionId: result.sessionId,
    payer: result.payer,
  };
}

async function unlockMock(
  pieceUrl: string,
  sellerAddress: string
): Promise<UnlockResult> {
  const result = await do402Flow(pieceUrl, sellerAddress, async (_req, requirements) =>
    signPaymentAuthorization(
      BUYER_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001",
      requirements
    )
  ) as UnlockSuccess & { error?: string };

  if (result.error) return { error: result.error };
  return {
    body: result.body,
    title: result.title,
    arcExplorerUrl: result.arcExplorerUrl,
    sessionId: result.sessionId,
    payer: result.payer,
  };
}
