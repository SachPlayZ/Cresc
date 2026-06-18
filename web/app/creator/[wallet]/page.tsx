import { notFound } from "next/navigation";
import { createServerClient } from "../../../lib/db";
import { getCreatorByWallet, listPiecesByCreator } from "../../../lib/repo/index";
import { isMockMode } from "../../../lib/config";
import CreatorProfileClient from "../../../components/CreatorProfileClient";
import type { Creator, Piece } from "../../../lib/repo/types";

interface PageProps {
  params: Promise<{ wallet: string }>;
}

// Mock details for testing in mock mode
const MOCK_CREATORS: Record<string, Creator & { bio?: string; content_types?: string[]; platforms?: string[] }> = {
  "0x9b86FF5733c6F84E3ECF8E3ECF8E3ECF8E3ECF8E": {
    id: "mock-creator-1",
    display_name: "Dana Okafor",
    wallet_address: "0x9b86FF5733c6F84E3ECF8E3ECF8E3ECF8E3ECF8E",
    created_at: new Date().toISOString(),
    bio: "Independent journalist covering the attention economy, digital ethics, and decentralized networks.",
    content_types: ["writing", "research"],
    platforms: ["substack", "twitter"]
  },
  "0x86D6A8E6C25A1E1633E08A8AE08A8AE08A8AE08A": {
    id: "mock-creator-2",
    display_name: "Studio Vesper",
    wallet_address: "0x86D6A8E6C25A1E1633E08A8AE08A8AE08A8AE08A",
    created_at: new Date().toISOString(),
    bio: "Visual arts collective experimenting with algorithmic video, drone photography, and ambient soundscapes.",
    content_types: ["video", "photography"],
    platforms: ["youtube", "deviantart"]
  },
  "0xE08A8AE6C25A1A6E22E2E6C25A1E1633E08A8AE0": {
    id: "mock-creator-3",
    display_name: "Imo Eshet",
    wallet_address: "0xE08A8AE6C25A1A6E22E2E6C25A1E1633E08A8AE0",
    created_at: new Date().toISOString(),
    bio: "Street photographer and architectural observer capturing geometry in quiet urban environments.",
    content_types: ["photography"],
    platforms: ["behance", "instagram"]
  }
};

const MOCK_PIECES: Record<string, Piece[]> = {
  "mock-creator-1": [
    {
      id: "mock-piece-1",
      creator_id: "mock-creator-1",
      title: "The Quiet Collapse of Attention",
      body: "<p>Mock Content</p>",
      kind: "article",
      length_chars: 4800,
      topic_tags: ["attention", "media", "web"],
      objective: "MAX_REACH",
      current_price: "8200",
      reserve: "1000",
      ceiling: "100000",
      status: "listed",
      created_at: new Date(Date.now() - 3600000).toISOString()
    }
  ],
  "mock-creator-2": [
    {
      id: "mock-piece-2",
      creator_id: "mock-creator-2",
      title: "Field Notes, Ep. 9",
      body: "<p>Mock Video</p>",
      kind: "video",
      length_chars: 0,
      topic_tags: ["video", "arc", "tutorial"],
      objective: "MAX_REVENUE",
      current_price: "21000",
      reserve: "1000",
      ceiling: "100000",
      status: "listed",
      created_at: new Date(Date.now() - 7200000).toISOString()
    }
  ],
  "mock-creator-3": [
    {
      id: "mock-piece-3",
      creator_id: "mock-creator-3",
      title: "Static, 04:12",
      body: "<p>Mock Content</p>",
      kind: "article",
      length_chars: 1200,
      topic_tags: ["photo", "art"],
      objective: "MAX_REACH",
      current_price: "14000",
      reserve: "1000",
      ceiling: "100000",
      status: "listed",
      created_at: new Date(Date.now() - 10800000).toISOString()
    }
  ]
};

const DEFAULT_MOCK_CREATOR = {
  id: "mock-creator-generic",
  display_name: "Creative Explorer",
  wallet_address: "",
  created_at: new Date().toISOString(),
  bio: "Content publisher on the Cresc network.",
  content_types: ["writing"],
  platforms: []
};

export default async function CreatorProfilePage({ params }: PageProps) {
  const { wallet } = await params;
  
  let creator: Creator & { bio?: string; content_types?: string[]; platforms?: string[] };
  let pieces: Piece[] = [];

  if (isMockMode) {
    const formattedWallet = Object.keys(MOCK_CREATORS).find(
      (k) => k.toLowerCase() === wallet.toLowerCase()
    );
    const matched = formattedWallet ? MOCK_CREATORS[formattedWallet] : null;

    if (matched) {
      creator = matched;
      pieces = MOCK_PIECES[matched.id] ?? [];
    } else {
      creator = { ...DEFAULT_MOCK_CREATOR, wallet_address: wallet };
      pieces = [];
    }
  } else {
    try {
      const db = createServerClient();
      const creatorRow = await getCreatorByWallet(db, wallet);
      if (!creatorRow) notFound();
      
      creator = creatorRow;
      // Fetch creator metadata column details if stored in a schema format
      // In onboard, metadata is written inside the _meta or parsed from profile columns.
      // Let's check creator table structure - it only has display_name, wallet_address, created_at.
      // Any bio is in _meta or fallback.
      const rawPieces = await listPiecesByCreator(db, creator.id);
      pieces = (rawPieces ?? []).filter((p) => p.status === "listed");
    } catch (err) {
      console.error("Failed to load creator from db", err);
      notFound();
    }
  }

  return <CreatorProfileClient creator={creator} pieces={pieces} />;
}
