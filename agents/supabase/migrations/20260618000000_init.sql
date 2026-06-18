-- M1: Initial Cresc schema
-- All money columns store base-unit strings (6-decimal USDC ERC-20 on Arc Testnet).
-- Never store floats for money (CLAUDE.md §8).

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Creators
CREATE TABLE IF NOT EXISTS creators (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name  text NOT NULL,
  wallet_address text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Pieces (articles with live prices)
CREATE TABLE IF NOT EXISTS pieces (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id    uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  title         text NOT NULL,
  body          text NOT NULL,
  length_chars  int NOT NULL DEFAULT 0,
  topic_tags    text[] NOT NULL DEFAULT '{}',
  -- objective drives PricingAgent goal
  objective     text NOT NULL DEFAULT 'MAX_REVENUE' CHECK (objective IN ('MAX_REVENUE', 'MAX_REACH')),
  -- prices stored as base-unit strings (6-dec USDC, read decimals() from contract)
  current_price text NOT NULL DEFAULT '1000',   -- $0.001 in base units
  reserve       text NOT NULL DEFAULT '1000',   -- agent-chosen floor; >= PRICE_FLOOR_MIN
  ceiling       text NOT NULL DEFAULT '100000', -- $0.1 in base units
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('listed', 'delisted', 'draft')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pieces_creator ON pieces(creator_id);
CREATE INDEX IF NOT EXISTS pieces_status ON pieces(status);

-- Sessions (one reader × one piece, from unlock to session-end)
CREATE TABLE IF NOT EXISTS sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  piece_id            uuid NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  reader_id           text NOT NULL,  -- wallet address of reader
  unlocked_at         timestamptz NOT NULL DEFAULT now(),
  active_dwell_seconds int NOT NULL DEFAULT 0,
  completion_pct      numeric(5,2) NOT NULL DEFAULT 0,
  revisit_count       int NOT NULL DEFAULT 0,
  scroll_pattern      jsonb,
  ended_at            timestamptz,
  view_price_paid     text NOT NULL DEFAULT '0'  -- base units paid at unlock
);

CREATE INDEX IF NOT EXISTS sessions_piece ON sessions(piece_id);
CREATE INDEX IF NOT EXISTS sessions_reader ON sessions(reader_id);
CREATE INDEX IF NOT EXISTS sessions_unlocked ON sessions(unlocked_at);

-- Heartbeats (active+focused dwell pings from open reader tabs)
CREATE TABLE IF NOT EXISTS heartbeats (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ts          timestamptz NOT NULL DEFAULT now(),
  focused     bool NOT NULL DEFAULT true,
  scroll_pct  numeric(5,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS heartbeats_session ON heartbeats(session_id, ts);

-- Payments (unlocks + tips)
CREATE TABLE IF NOT EXISTS payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL CHECK (kind IN ('unlock', 'tip')),
  piece_id         uuid NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  session_id       uuid REFERENCES sessions(id) ON DELETE SET NULL,
  reader_id        text NOT NULL,
  amount           text NOT NULL,       -- base units
  tx_ref           text,               -- Gateway settlement reference
  arc_explorer_url text,               -- testnet.arcscan.app link
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'settled', 'failed')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_piece ON payments(piece_id);
CREATE INDEX IF NOT EXISTS payments_reader ON payments(reader_id);
CREATE INDEX IF NOT EXISTS payments_created ON payments(created_at);

-- Price decisions (PricingAgent reasoning chain — creator-readable)
CREATE TABLE IF NOT EXISTS price_decisions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  piece_id       uuid NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  old_price      text NOT NULL,   -- base units
  new_price      text NOT NULL,   -- base units
  reserve        text NOT NULL,
  objective      text NOT NULL CHECK (objective IN ('MAX_REVENUE', 'MAX_REACH')),
  signals_cited  jsonb NOT NULL DEFAULT '[]',
  reasoning      text NOT NULL,
  confidence     numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  trigger        text NOT NULL CHECK (trigger IN ('clock', 'spike', 'tip_surplus')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS price_decisions_piece ON price_decisions(piece_id, created_at DESC);

-- Tip decisions (ReaderAgent judgment — whether to prompt + how much)
CREATE TABLE IF NOT EXISTS tip_decisions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  piece_id        uuid NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  prompted        bool NOT NULL DEFAULT false,
  suggested_tip   text,   -- base units; null if tip_skip
  view_price_paid text NOT NULL,
  signals_cited   jsonb NOT NULL DEFAULT '[]',
  reasoning       text NOT NULL,
  confidence      numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  accepted        bool,
  final_tip       text,   -- actual tip paid (base units)
  tip_surplus     text,   -- final_tip - suggested_tip if positive (base units)
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tip_decisions_session ON tip_decisions(session_id);
CREATE INDEX IF NOT EXISTS tip_decisions_piece ON tip_decisions(piece_id, created_at DESC);

-- Disputes (creator flags incoherent price decision)
CREATE TABLE IF NOT EXISTS disputes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  price_decision_id  uuid NOT NULL REFERENCES price_decisions(id) ON DELETE CASCADE,
  creator_id         uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  note               text NOT NULL,
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed')),
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Jobs queue (web app enqueues; agents service consumes — CLAUDE.md §Queue interface)
CREATE TABLE IF NOT EXISTS jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('pricing_sweep', 'reader_eval', 'tip_feedback')),
  payload     jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  started_at  timestamptz,
  done_at     timestamptz,
  error       text,
  retries     int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS jobs_status_created ON jobs(status, created_at);

-- Enable Realtime on jobs so agents service wakes immediately on INSERT
ALTER PUBLICATION supabase_realtime ADD TABLE jobs;

-- Notifications (ReaderAgent pushes tip prompts; web app reads)
CREATE TABLE IF NOT EXISTS notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reader_id  text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('tip_prompt')),
  payload    jsonb NOT NULL,
  read       bool NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_reader ON notifications(reader_id, read, created_at DESC);
