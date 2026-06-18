import { NextResponse } from "next/server";
import { createServerClient } from "../../../../lib/db";
import { isMockMode } from "../../../../lib/config";

export async function GET() {
  if (isMockMode) {
    return NextResponse.json([
      {
        id: "mock-piece-1",
        title: "The Quiet Collapse of Attention",
        current_price: "8200",
        kind: "article",
        topic_tags: ["attention", "media", "web"],
        created_at: new Date(Date.now() - 3600000).toISOString(),
        creators: {
          display_name: "Dana Okafor",
          wallet_address: "0x9b86FF5733c6F84E3ECF8E3ECF8E3ECF8E3ECF8E"
        }
      },
      {
        id: "mock-piece-2",
        title: "Field Notes, Ep. 9",
        current_price: "21000",
        kind: "video",
        topic_tags: ["video", "arc", "tutorial"],
        created_at: new Date(Date.now() - 7200000).toISOString(),
        creators: {
          display_name: "Studio Vesper",
          wallet_address: "0x86D6A8E6C25A1E1633E08A8AE08A8AE08A8AE08A"
        }
      },
      {
        id: "mock-piece-3",
        title: "Static, 04:12",
        current_price: "14000",
        kind: "article",
        topic_tags: ["photo", "art"],
        created_at: new Date(Date.now() - 10800000).toISOString(),
        creators: {
          display_name: "Imo Eshet",
          wallet_address: "0xE08A8AE6C25A1A6E22E2E6C25A1E1633E08A8AE0"
        }
      },
      {
        id: "mock-piece-4",
        title: "Untitled (Lime)",
        current_price: "30500",
        kind: "article",
        topic_tags: ["art", "design"],
        created_at: new Date(Date.now() - 14400000).toISOString(),
        creators: {
          display_name: "K. Owusu",
          wallet_address: "0x5678ab3e9e6b3ecf8e3ecf8e3ecf8e3ecf8e3ecf"
        }
      }
    ]);
  }
  try {
    const db = createServerClient();
    const { data, error } = await db
      .from("pieces")
      .select("id, title, current_price, kind, topic_tags, created_at, creators(display_name, wallet_address)")
      .eq("status", "listed")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    return NextResponse.json([]);
  }
}
