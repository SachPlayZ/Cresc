/**
 * app/api/dispute/route.ts — M8: Dispute creation endpoint.
 * POST /api/dispute
 * Body: { priceDecisionId: string, creatorId: string, note: string }
 * Writes a disputes row via createDispute.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "../../../lib/db";
import { createDispute } from "../../../lib/repo/index";

export async function POST(req: NextRequest) {
  let body: { priceDecisionId?: string; creatorId?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { priceDecisionId, creatorId, note } = body;
  if (!priceDecisionId || !creatorId || !note) {
    return NextResponse.json(
      { error: "priceDecisionId, creatorId, and note are required" },
      { status: 400 }
    );
  }

  try {
    const db = createServerClient();
    await createDispute(db, {
      price_decision_id: priceDecisionId,
      creator_id: creatorId,
      note,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/dispute]", err);
    return NextResponse.json({ error: "Failed to create dispute" }, { status: 500 });
  }
}
