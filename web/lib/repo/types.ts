// lib/repo/types.ts — DB row types. Money = atomic bigint strings (6-dec USDC). $0.05 = "50000".

// --- New architecture types ---

export type Article = {
  id?: string;
  slug: string;
  creator_id: string;
  title: string;
  excerpt: string;
  topics: string[];
  base_price_atomic: string;
  current_price_atomic: string;
  content_id: string | null;
  content_contract: string | null;
  metadata_uri: string | null;
  metadata_hash: string | null;
  factory_tx: string | null;
  active: boolean;
  monetization_enabled: boolean;
  ghost_post_id: string | null;
  ghost_instance_url: string | null;
  created_at: string;
  updated_at: string;
  // joined from creators
  creators?: { eoa_address: string | null; circle_wallet_id: string | null; display_name: string };
};

export type Reader = {
  user_id: string;
  daily_budget_atomic: string;
  session_budget_atomic: string;
  spent_today_atomic: string;
  spent_session_atomic: string;
  session_reset_at: string;
  created_at: string;
};

export type Telemetry = {
  id: string;
  article_id: string;
  reader_id: string;
  event_type: 'view' | 'dwell' | 'complete' | 'bounce';
  dwell_ms: number;
  ip_hash: string | null;
  ts: string;
};

export type PaymentEvent = {
  id: string;
  endpoint: string;
  payer: string;
  amount_usdc: string;   // atomic integer string
  network: string;
  gateway_tx: string | null;
  pay_to?: string | null;
  content_contract?: string | null;
  reader_id: string | null;
  article_slug: string | null;
  request_id: string | null;
  raw: unknown;
  created_at: string;
};

export type PriceHistory = {
  id: string;
  article_slug: string;
  price_atomic: string;
  reason: { views_norm: number; dwell_norm: number; tips_norm: number; demand: number };
  ts: string;
};

export type Withdrawal = {
  id: string;
  creator_id: string;
  amount_atomic: string;
  content_contract?: string | null;
  destination_chain: string;
  destination_address: string;
  status: 'submitted' | 'confirmed' | 'failed';
  tx_hash: string | null;
  created_at: string;
};

// --- Shared / legacy types (still referenced by pieces-based dashboard) ---

export type Creator = {
  id: string;
  display_name: string;
  wallet_address: string | null;
  created_at: string;
  circle_wallet_id?: string | null;
  eoa_address?: string | null;
  ucw_user_id?: string | null;
  ghost_key_enc?: string | null;
  ghost_instance_url?: string | null;
  ghost_admin_key?: string | null;
  ghost_webhook_secret?: string | null;
};

