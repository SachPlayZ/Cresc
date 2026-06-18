"use server";

/**
 * app/actions/unlock.ts — M4 Server Action for unlocking a piece.
 *
 * Uses GatewayClient (buyer side) to execute the full x402 payment flow:
 * 1. Makes GET /api/piece/<id> → gets 402 with PAYMENT-REQUIRED header.
 * 2. Signs EIP-3009 authorization against GatewayWallet (via BatchEvmScheme).
 * 3. Retries with Payment-Signature header → gets 200 with piece content.
 *
 * Mock mode: if BUYER_PRIVATE_KEY is absent (isMockMode), uses signPaymentAuthorization
 * from lib/circle and sends a mock payment header directly so the dev flow works end-to-end
 * without testnet keys.
 *
 * ZERO LLM calls (CLAUDE.md §7.3).
 */

import { GatewayClient } from "@circle-fin/x402-batching/client";
import {
  isMockMode,
  BUYER_PRIVATE_KEY,
  USDC_ERC20_DECIMALS,
  SELLER_ADDRESS,
} from "../../lib/config";
import { buildPaymentRequirements, signPaymentAuthorization } from "../../lib/circle/index";
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

/**
 * unlockPiece — pay for a piece and return its content.
 *
 * In live mode: uses GatewayClient.pay() which handles the full 402 → sign → retry flow.
 * In mock mode: manually builds and sends the mock payment header.
 *
 * @param pieceId - UUID of the piece to unlock.
 * @returns Content (title + body + arcExplorerUrl) or error.
 */
export async function unlockPiece(pieceId: string): Promise<UnlockResult> {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

  const pieceUrl = `${appUrl}/api/piece/${pieceId}`;

  try {
    if (!isMockMode && BUYER_PRIVATE_KEY) {
      // --- Live mode: GatewayClient handles the full 402 flow ---
      const client = new GatewayClient({
        chain: "arcTestnet",
        privateKey: BUYER_PRIVATE_KEY as `0x${string}`,
        rpcUrl: process.env.ARC_RPC_URL,
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
      };
    } else {
      // --- Mock mode: build mock payment header and send directly ---
      // Step 1: GET to get the 402 and standing price.
      const response402 = await fetch(pieceUrl, { cache: "no-store" });

      if (response402.status === 404) {
        return { error: "Piece not found or not listed" };
      }

      if (response402.status !== 402) {
        // Already a 200 or error — handle gracefully.
        if (response402.ok) {
          const data = (await response402.json()) as UnlockSuccess;
          return {
            body: data.body ?? "",
            title: data.title ?? "",
            arcExplorerUrl: data.arcExplorerUrl ?? null,
            sessionId: data.sessionId ?? "",
          };
        }
        const errBody = await response402.json().catch(() => ({})) as { error?: string };
        return { error: errBody.error ?? `Unexpected status ${response402.status}` };
      }

      // Step 2: Parse PAYMENT-REQUIRED header to get requirements.
      const paymentRequiredHeader = response402.headers.get("PAYMENT-REQUIRED");
      if (!paymentRequiredHeader) {
        return { error: "Server returned 402 but missing PAYMENT-REQUIRED header" };
      }

      const paymentRequired = JSON.parse(
        Buffer.from(paymentRequiredHeader, "base64").toString("utf-8")
      ) as { x402Version: number; resource: string; accepts: Array<{ amount: string }> };

      const accepts = paymentRequired.accepts;
      if (!accepts || accepts.length === 0) {
        return { error: "No payment options in PAYMENT-REQUIRED" };
      }

      const req = accepts[0];
      // Build a UsdcAmount from the requirements amount string.
      const price = moneyFromBaseUnits(BigInt(req.amount), USDC_ERC20_DECIMALS);

      // Build requirements using the same helper (picks up correct extra fields).
      const requirements = buildPaymentRequirements(price, SELLER_ADDRESS);

      // Step 3: Sign with mock (or real key if present in partial mock mode).
      const signedAuth = await signPaymentAuthorization(
        BUYER_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001",
        requirements
      );

      // Step 4: Encode the full payment payload the same way GatewayClient does.
      const paymentPayload = {
        ...signedAuth,
        resource: paymentRequired.resource,
        accepted: req,
      };
      const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");

      // Step 5: Retry with Payment-Signature header.
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
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}
