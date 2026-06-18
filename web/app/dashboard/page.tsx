/**
 * app/dashboard/page.tsx — M8 Creator Dashboard (Server Component)
 * URL: /dashboard?creator=<creatorId>
 *
 * Fetches all pieces, their latest price decisions, and payments server-side.
 * Passes initial data to DashboardClient for hydration + realtime.
 * No LLM calls (CLAUDE.md §7.3).
 */

import { Metadata } from "next";
import { createServerClient } from "../../lib/db";
import {
  listPiecesByCreator,
  getCreator,
  getRecentPriceDecisions,
  getPaymentsByPiece,
} from "../../lib/repo/index";
import type { Piece, PriceDecision, Payment, Creator } from "../../lib/repo/types";
import DashboardClient from "../../components/dashboard/DashboardClient";

export const metadata: Metadata = {
  title: "Creator Dashboard — Cresc",
  description: "Live price decisions, reasoning chains, and earnings for your pieces.",
};

// Dev fallback creator ID — used when no ?creator= param is passed.
// Replace with a real creator UUID once seeded in DB.
const DEV_CREATOR_ID = process.env.DEV_CREATOR_ID ?? "00000000-0000-0000-0000-000000000001";

// Mock data for when DB is not yet configured (isMockMode)
const MOCK_CREATOR: Creator = {
  id: DEV_CREATOR_ID,
  display_name: "Demo Creator",
  wallet_address: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  created_at: new Date().toISOString(),
};

const MOCK_PIECE: Piece = {
  id: "mock-piece-1",
  creator_id: DEV_CREATOR_ID,
  title: "The Last Honest Metric",
  body: "Article body here.",
  length_chars: 4800,
  topic_tags: ["tech", "media"],
  objective: "MAX_REVENUE",
  current_price: "8200",  // $0.0082
  reserve: "1000",
  ceiling: "100000",
  status: "listed",
  created_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
};

const MOCK_DECISION: PriceDecision = {
  id: "mock-decision-1",
  piece_id: "mock-piece-1",
  old_price: "7400",
  new_price: "8200",
  reserve: "1000",
  objective: "MAX_REVENUE",
  signals_cited: ["views_1h:3.1x", "dwell_median:220s", "bounce:thin"],
  reasoning:
    "Dwell median climbed to 220s this hour while bounce stayed thin — readers are engaging deeply. " +
    "Views also spiked 3.1× over the prior hour. This combination signals genuine momentum, not noise. " +
    "Raising price from $0.0074 to $0.0082 to capture value while engagement holds.",
  confidence: 0.81,
  trigger: "clock",
  created_at: new Date(Date.now() - 12 * 60_000).toISOString(),
};

const MOCK_DECISION_2: PriceDecision = {
  id: "mock-decision-2",
  piece_id: "mock-piece-1",
  old_price: "6800",
  new_price: "7400",
  reserve: "1000",
  objective: "MAX_REVENUE",
  signals_cited: ["tip_surplus:0.0012", "views_1h:2.1x"],
  reasoning:
    "A reader tipped $0.0082 against the $0.007 suggestion — $0.0012 surplus. This is a clear signal " +
    "the piece was underpriced at the time of that read. Adjusting upward by $0.0006 to approach fair value.",
  confidence: 0.73,
  trigger: "tip_surplus",
  created_at: new Date(Date.now() - 40 * 60_000).toISOString(),
};

const MOCK_DECISION_3: PriceDecision = {
  id: "mock-decision-3",
  piece_id: "mock-piece-1",
  old_price: "7200",
  new_price: "6800",
  reserve: "1000",
  objective: "MAX_REVENUE",
  signals_cited: ["dwell_1h_trend:-14%", "views_1h:flat", "bounce:rising"],
  reasoning:
    "Dwell is declining faster than views — readers are starting but leaving sooner. " +
    "This pattern suggests the content is hitting its saturation point for the current audience. " +
    "Cutting slightly to re-stimulate interest before the audience fully exhausts.",
  confidence: 0.41,
  trigger: "clock",
  created_at: new Date(Date.now() - 80 * 60_000).toISOString(),
};

interface SearchParams {
  creator?: string;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { creator: creatorParam } = await searchParams;
  const creatorId = creatorParam ?? DEV_CREATOR_ID;

  let creator: Creator;
  let pieces: Piece[];
  let decisionsByPiece: Record<string, PriceDecision[]> = {};
  let paymentsByPiece: Record<string, Payment[]> = {};

  try {
    const db = createServerClient();

    // Fetch creator
    const creatorRow = await getCreator(db, creatorId);
    if (!creatorRow) {
      // Fall back to mock so the page still renders in dev without DB
      creator = MOCK_CREATOR;
      pieces = [MOCK_PIECE];
      decisionsByPiece = {
        "mock-piece-1": [MOCK_DECISION, MOCK_DECISION_2, MOCK_DECISION_3],
      };
      paymentsByPiece = { "mock-piece-1": [] };
    } else {
      creator = creatorRow;
      pieces = await listPiecesByCreator(db, creatorId);

      // Fetch decisions + payments for each piece in parallel
      await Promise.all(
        pieces.map(async (piece) => {
          const [decisions, payments] = await Promise.all([
            getRecentPriceDecisions(db, piece.id, 30),
            getPaymentsByPiece(db, piece.id, 50),
          ]);
          decisionsByPiece[piece.id] = decisions;
          paymentsByPiece[piece.id] = payments;
        })
      );
    }
  } catch {
    // DB unavailable — use mock data so the page renders without secrets
    creator = MOCK_CREATOR;
    pieces = [MOCK_PIECE];
    decisionsByPiece = {
      "mock-piece-1": [MOCK_DECISION, MOCK_DECISION_2, MOCK_DECISION_3],
    };
    paymentsByPiece = { "mock-piece-1": [] };
  }

  return (
    <DashboardClient
      creator={creator}
      initialPieces={pieces}
      initialDecisionsByPiece={decisionsByPiece}
      initialPaymentsByPiece={paymentsByPiece}
    />
  );
}
