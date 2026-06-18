/**
 * app/api/piece/[id]/settings/route.ts — M8: Piece settings update endpoint.
 * PATCH /api/piece/<id>/settings
 * Body: { status?: 'listed'|'delisted'|'draft', objective?: 'MAX_REVENUE'|'MAX_REACH' }
 * Updates piece status and/or objective.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "../../../../../lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: { status?: string; objective?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { status, objective } = body;

  // Validate
  const validStatuses = ["listed", "delisted", "draft"];
  const validObjectives = ["MAX_REVENUE", "MAX_REACH"];

  if (status && !validStatuses.includes(status)) {
    return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
  }
  if (objective && !validObjectives.includes(objective)) {
    return NextResponse.json({ error: `Invalid objective: ${objective}` }, { status: 400 });
  }

  const updates: Record<string, string> = {};
  if (status) updates.status = status;
  if (objective) updates.objective = objective;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    const db = createServerClient();
    const { error } = await db.from("pieces").update(updates).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/piece/settings]", err);
    return NextResponse.json({ error: "Failed to update piece" }, { status: 500 });
  }
}
