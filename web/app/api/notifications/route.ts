import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "../../../lib/db";
import { getUnreadNotifications, markNotificationRead } from "../../../lib/repo/index";

// GET /api/notifications?reader=<address>
export async function GET(req: NextRequest) {
  const readerId = req.nextUrl.searchParams.get("reader");
  if (!readerId) return NextResponse.json({ error: "reader param required" }, { status: 400 });
  try {
    const db = createServerClient();
    const notifications = await getUnreadNotifications(db, readerId);
    return NextResponse.json({ notifications });
  } catch (err) {
    return NextResponse.json({ notifications: [] });
  }
}

// POST /api/notifications/read  body: { id: string }
export async function POST(req: NextRequest) {
  try {
    const { id } = await req.json() as { id: string };
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const db = createServerClient();
    await markNotificationRead(db, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
