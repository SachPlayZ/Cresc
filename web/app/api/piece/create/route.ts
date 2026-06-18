import { NextRequest, NextResponse } from "next/server";
import { recoverMessageAddress } from "viem";
import { createServerClient } from "../../../../lib/db";
import { createPiece, getCreator } from "../../../../lib/repo/index";
import { PRICE_CEILING } from "../../../../lib/config";

const DEFAULT_START_PRICE = 0.005;
const DEFAULT_RESERVE    = 0.001;
const DEFAULT_CEILING    = 0.05;

// POST /api/piece/create
// Body: { creator_id, title, body, kind?, objective, signature?, timestamp? }
// When signature + timestamp are present: verifies the creator owns the wallet (M-C7).
// When absent: allowed (mock mode / dev without MetaMask).
export async function POST(req: NextRequest) {
  try {
    const { creator_id, title, body, kind, objective, signature, timestamp } = await req.json() as {
      creator_id: string;
      title: string;
      body: string;
      kind?: "article" | "video";
      objective: "MAX_REVENUE" | "MAX_REACH";
      signature?: string;
      timestamp?: string;
    };

    if (!creator_id?.trim()) return NextResponse.json({ error: "creator_id required" }, { status: 400 });

    const db = createServerClient();
    const creator = await getCreator(db, creator_id.trim());
    if (!creator) {
      return NextResponse.json({ error: "Creator not found" }, { status: 403 });
    }

    // M-C7: verify wallet ownership when signature is provided.
    if (signature && timestamp) {
      const message = `cresc:create:${timestamp}`;
      // Reject stale timestamps (> 5 minutes old) to prevent replay attacks.
      const ts = parseInt(timestamp, 10);
      if (isNaN(ts) || Date.now() - ts > 5 * 60 * 1000) {
        return NextResponse.json({ error: "Signature expired — please try again" }, { status: 403 });
      }
      try {
        const recovered = await recoverMessageAddress({
          message,
          signature: signature as `0x${string}`,
        });
        if (recovered.toLowerCase() !== creator.wallet_address.toLowerCase()) {
          return NextResponse.json({ error: "Signature does not match creator wallet" }, { status: 403 });
        }
      } catch {
        return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
      }
    }

    if (!title?.trim())  return NextResponse.json({ error: "title required" }, { status: 400 });
    if (!body?.trim())   return NextResponse.json({ error: "body required" }, { status: 400 });
    if (objective !== "MAX_REVENUE" && objective !== "MAX_REACH") {
      return NextResponse.json({ error: "objective must be MAX_REVENUE or MAX_REACH" }, { status: 400 });
    }

    const toBaseUnits = (display: number) => Math.round(display * 1_000_000).toString();
    const inferredKind: "article" | "video" = kind ?? (body.includes("<video") ? "video" : "article");

    const piece = await createPiece(db, {
      creator_id,
      title: title.trim(),
      body: body.trim(),
      kind: inferredKind,
      length_chars: body.trim().length,
      topic_tags: [],
      objective,
      current_price: toBaseUnits(DEFAULT_START_PRICE),
      reserve: toBaseUnits(DEFAULT_RESERVE),
      ceiling: toBaseUnits(Math.min(DEFAULT_CEILING, PRICE_CEILING)),
      status: "listed",
    });

    return NextResponse.json({ piece });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
