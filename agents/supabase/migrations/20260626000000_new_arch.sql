-- New architecture migration: Ghost-native articles, reader budgets, telemetry, payment_events.
-- All money is atomic 6dp bigint. Never floats, never dollars in storage.
-- CLAUDE.md invariant §4: $0.05 = 50000.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Update creators: add Circle wallet id + eoa + encrypted ghost key
ALTER TABLE creators
  ADD COLUMN IF NOT EXISTS circle_wallet_id  text,
  ADD COLUMN IF NOT EXISTS eoa_address       text,
  ADD COLUMN IF NOT EXISTS ghost_key_enc     text;  -- encrypted admin key

-- articles: Ghost-native content units. slug is the lookup key from Ghost URLs.
CREATE TABLE IF NOT EXISTS articles (
  slug                text PRIMARY KEY,
  creator_id          uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  title               text NOT NULL DEFAULT '',
  excerpt             text NOT NULL DEFAULT '',
  topics              text[] NOT NULL DEFAULT '{}',
  base_price_atomic   bigint NOT NULL DEFAULT 50000,    -- $0.05 starting price
  current_price_atomic bigint NOT NULL DEFAULT 50000,
  ghost_post_id       text,
  ghost_instance_url  text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS articles_creator ON articles(creator_id);
CREATE UNIQUE INDEX IF NOT EXISTS articles_ghost_post_idx
  ON articles(creator_id, ghost_post_id)
  WHERE ghost_post_id IS NOT NULL;

-- readers: per-reader budget tracking (shared buyer EOA, budgets in Postgres)
CREATE TABLE IF NOT EXISTS readers (
  user_id                  text PRIMARY KEY,
  daily_budget_atomic      bigint NOT NULL DEFAULT 5000000,   -- $5.00/day
  session_budget_atomic    bigint NOT NULL DEFAULT 1000000,   -- $1.00/session
  spent_today_atomic       bigint NOT NULL DEFAULT 0,
  spent_session_atomic     bigint NOT NULL DEFAULT 0,
  session_reset_at         timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now()
);

-- telemetry: raw view/dwell events from Ghost gate
CREATE TABLE IF NOT EXISTS telemetry (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id  text NOT NULL REFERENCES articles(slug) ON DELETE CASCADE,
  reader_id   text NOT NULL,
  event_type  text NOT NULL CHECK (event_type IN ('view', 'dwell', 'complete', 'bounce')),
  dwell_ms    bigint NOT NULL DEFAULT 0,
  ip_hash     text,
  ts          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telemetry_article ON telemetry(article_id, ts);
CREATE INDEX IF NOT EXISTS telemetry_reader  ON telemetry(reader_id, ts);

-- telemetry_audited: Watcher reads only from here (post-audit)
CREATE TABLE IF NOT EXISTS telemetry_audited (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_slug       text NOT NULL REFERENCES articles(slug) ON DELETE CASCADE,
  window_start       timestamptz NOT NULL,
  views              int NOT NULL DEFAULT 0,
  avg_dwell_ms       bigint NOT NULL DEFAULT 0,
  tips_atomic        bigint NOT NULL DEFAULT 0,
  authentic_fraction numeric(5,4) NOT NULL DEFAULT 1.0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telemetry_audited_article ON telemetry_audited(article_slug, window_start DESC);

-- payment_events: append-only settlement log (from reference repo schema)
CREATE TABLE IF NOT EXISTS payment_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint      text NOT NULL,
  payer         text NOT NULL,
  amount_usdc   text NOT NULL,   -- atomic integer string (6dp)
  network       text NOT NULL DEFAULT 'eip155:5042002',
  gateway_tx    text,
  reader_id     text,
  article_slug  text,
  request_id    text,            -- idempotency key
  raw           jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Idempotency: prevent double-pay for same request
CREATE UNIQUE INDEX IF NOT EXISTS payment_events_request_id
  ON payment_events(request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_events_reader   ON payment_events(reader_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_events_article  ON payment_events(article_slug, created_at DESC);

-- RLS: public read, service-role insert (transparent dashboard)
ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='payment_events' AND policyname='payment_events_public_read') THEN
    CREATE POLICY "payment_events_public_read" ON payment_events FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='payment_events' AND policyname='payment_events_service_insert') THEN
    CREATE POLICY "payment_events_service_insert" ON payment_events FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- price_history: Watcher appends each repricing decision
CREATE TABLE IF NOT EXISTS price_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_slug    text NOT NULL REFERENCES articles(slug) ON DELETE CASCADE,
  price_atomic    bigint NOT NULL,
  reason          jsonb NOT NULL DEFAULT '{}',   -- {views_norm, dwell_norm, tips_norm, demand}
  ts              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS price_history_article ON price_history(article_slug, ts DESC);

-- withdrawals: creator payout records
CREATE TABLE IF NOT EXISTS withdrawals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id           uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  amount_atomic        bigint NOT NULL,
  destination_chain    text NOT NULL,
  destination_address  text NOT NULL,
  status               text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'confirmed', 'failed')),
  tx_hash              text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS withdrawals_creator ON withdrawals(creator_id, created_at DESC);

-- Atomic reader spend tracking (avoids read-modify-write race in reader-agent)
CREATE OR REPLACE FUNCTION record_reader_spend(p_user_id text, p_amount text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO readers (user_id, spent_today_atomic, spent_session_atomic, session_reset_at)
  VALUES (
    p_user_id,
    p_amount::bigint,
    p_amount::bigint,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    spent_today_atomic   = readers.spent_today_atomic   + p_amount::bigint,
    spent_session_atomic = readers.spent_session_atomic + p_amount::bigint;
END;
$$;

-- Reset session spend (call on session start)
CREATE OR REPLACE FUNCTION reset_session_budget(p_user_id text)
RETURNS void LANGUAGE sql AS $$
  UPDATE readers SET spent_session_atomic = 0, session_reset_at = now()
  WHERE user_id = p_user_id;
$$;
