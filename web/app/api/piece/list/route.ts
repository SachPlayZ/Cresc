import { NextResponse } from "next/server";
import { createServerClient } from "../../../../lib/db";
import { isMockMode } from "../../../../lib/config";

export async function GET() {
  if (isMockMode) {
    return NextResponse.json([
      { id: "mock-piece-1", title: "Mock Piece: The Quiet Collapse of Attention", current_price: "1000" },
      { id: "mock-piece-2", title: "Mock Piece: Arc Testnet Field Notes", current_price: "2000" },
    ]);
  }
  try {
    const db = createServerClient();
    const { data, error } = await db
      .from("pieces")
      .select("id, title, current_price")
      .eq("status", "listed")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    return NextResponse.json([]);
  }
}
