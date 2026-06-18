import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "../../../../lib/db";
import { createPiece } from "../../../../lib/repo/index";
import { PRICE_CEILING, PRICE_FLOOR_MIN } from "../../../../lib/config";

const DEFAULT_START_PRICE = 0.005;  // $0.005 — midpoint; PricingAgent sweeps from here
const DEFAULT_RESERVE    = 0.001;
const DEFAULT_CEILING    = 0.05;

// POST /api/piece/create
// Body: { creator_id, title, body, objective: 'MAX_REVENUE'|'MAX_REACH' }
export async function POST(req: NextRequest) {
  try {
    const { creator_id, title, body, objective } = await req.json() as {
      creator_id: string;
      title: string;
      body: string;
      objective: "MAX_REVENUE" | "MAX_REACH";
    };

    if (!creator_id?.trim()) return NextResponse.json({ error: "creator_id required" }, { status: 400 });
    if (!title?.trim())      return NextResponse.json({ error: "title required" }, { status: 400 });
    if (!body?.trim())       return NextResponse.json({ error: "body required" }, { status: 400 });
    if (objective !== "MAX_REVENUE" && objective !== "MAX_REACH") {
      return NextResponse.json({ error: "objective must be MAX_REVENUE or MAX_REACH" }, { status: 400 });
    }

    const toBaseUnits = (display: number) => Math.round(display * 1_000_000).toString();

    const db = createServerClient();
    const piece = await createPiece(db, {
      creator_id,
      title: title.trim(),
      body: body.trim(),
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
