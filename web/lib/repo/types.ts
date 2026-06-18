// lib/repo/types.ts — DB row types (snake_case matching Supabase columns).
// Money columns are base-unit strings (6-dec USDC ERC-20 on Arc Testnet).

export type Creator = {
  id: string;
  display_name: string;
  wallet_address: string;
  created_at: string;
};

export type Piece = {
  id: string;
  creator_id: string;
  title: string;
  body: string;
  kind: 'article' | 'video';
  length_chars: number;
  topic_tags: string[];
  objective: 'MAX_REVENUE' | 'MAX_REACH';
  current_price: string; // base units
  reserve: string;       // base units
  ceiling: string;       // base units
  status: 'listed' | 'delisted' | 'draft';
  created_at: string;
};

export type Session = {
  id: string;
  piece_id: string;
  reader_id: string;
  unlocked_at: string;
  active_dwell_seconds: number;
  completion_pct: number;
  revisit_count: number;
  scroll_pattern: unknown;
  ended_at: string | null;
  view_price_paid: string; // base units
};

export type Heartbeat = {
  id: string;
  session_id: string;
  ts: string;
  focused: boolean;
  scroll_pct: number;
};

export type Payment = {
  id: string;
  kind: 'unlock' | 'tip';
  piece_id: string;
  session_id: string | null;
  reader_id: string;
  amount: string; // base units
  tx_ref: string | null;
  arc_explorer_url: string | null;
  status: 'pending' | 'settled' | 'failed';
  payout_ref: string | null; // tx hash of creator payout, null = not yet paid out
  created_at: string;
};

export type PriceDecision = {
  id: string;
  piece_id: string;
  old_price: string;
  new_price: string;
  reserve: string;
  objective: 'MAX_REVENUE' | 'MAX_REACH';
  signals_cited: string[];
  reasoning: string;
  confidence: number;
  trigger: 'clock' | 'spike' | 'tip_surplus';
  created_at: string;
};

export type TipDecision = {
  id: string;
  session_id: string;
  piece_id: string;
  prompted: boolean;
  suggested_tip: string | null; // base units
  view_price_paid: string;
  signals_cited: string[];
  reasoning: string;
  confidence: number;
  accepted: boolean | null;
  final_tip: string | null;
  tip_surplus: string | null;
  created_at: string;
};

export type Dispute = {
  id: string;
  price_decision_id: string;
  creator_id: string;
  note: string;
  status: 'open' | 'reviewed';
  created_at: string;
};

export type Job = {
  id: string;
  kind: 'pricing_sweep' | 'reader_eval' | 'tip_feedback';
  payload: JobPayload;
  status: 'pending' | 'processing' | 'done' | 'failed';
  created_at: string;
  started_at: string | null;
  done_at: string | null;
  error: string | null;
  retries: number;
};

export type Notification = {
  id: string;
  reader_id: string;
  kind: 'tip_prompt';
  payload: unknown;
  read: boolean;
  created_at: string;
};

export type ReaderWallet = {
  id: string;
  reader_id: string;
  eoa_address: string;
  key_enc: string | null;
  circle_wallet_id: string | null;
  usdc_deposited: string;  // 6-dec base units
  usdc_spent: string;      // 6-dec base units
  gateway_funded: boolean;
  created_at: string;
  last_seen_at: string;
};

// --- Job payload types (CLAUDE.md §Queue interface) ---

export type PricingSweepPayload = {
  pieceId: string;
  trigger: 'clock' | 'spike' | 'tip_surplus';
};

export type ReaderEvalPayload = {
  sessionId: string;
};

export type TipFeedbackPayload = {
  tipDecisionId: string;
  surplus: string; // base-unit bigint string
};

export type JobPayload = PricingSweepPayload | ReaderEvalPayload | TipFeedbackPayload;

// --- Signal bundle (getSignalBundle output → M5 PricingAgent input) ---

export type WindowStats = {
  views: number;
  uniqueReaders: number;
  avgDwellSeconds: number;
  medianDwellSeconds: number;
  completionPct: number;
  bounceRate: number; // 0..1
  tipCount: number;
  tipRevenue: number; // display dollars
};

export type SignalBundle = {
  pieceId: string;
  objective: 'MAX_REVENUE' | 'MAX_REACH';
  currentPrice: number;  // display dollars
  reserve: number;
  ceiling: number;
  ageHours: number;
  windows: {
    '1h': WindowStats;
    '24h': WindowStats;
    '7d': WindowStats;
  };
  recentTipSurplus: number; // total tip_surplus display dollars past 24h
};
