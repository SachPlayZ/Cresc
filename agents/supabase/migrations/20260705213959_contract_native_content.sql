-- Contract-native content architecture.
-- Adds per-content contract indexing while preserving existing article rows.
-- Supabase July 2026 note: new public tables may require explicit grants to be exposed via Data API.

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS content_id text,
  ADD COLUMN IF NOT EXISTS content_contract text,
  ADD COLUMN IF NOT EXISTS metadata_uri text,
  ADD COLUMN IF NOT EXISTS metadata_hash text,
  ADD COLUMN IF NOT EXISTS factory_tx text,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

UPDATE articles SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE articles ALTER COLUMN id SET NOT NULL;

ALTER TABLE telemetry DROP CONSTRAINT IF EXISTS telemetry_article_id_fkey;
ALTER TABLE telemetry_audited DROP CONSTRAINT IF EXISTS telemetry_audited_article_slug_fkey;
ALTER TABLE price_history DROP CONSTRAINT IF EXISTS price_history_article_slug_fkey;
ALTER TABLE articles DROP CONSTRAINT IF EXISTS articles_pkey;
ALTER TABLE articles ADD PRIMARY KEY (id);

CREATE UNIQUE INDEX IF NOT EXISTS articles_creator_slug_idx
  ON articles(creator_id, slug);

CREATE UNIQUE INDEX IF NOT EXISTS articles_creator_ghost_post_unique
  ON articles(creator_id, ghost_post_id);

CREATE UNIQUE INDEX IF NOT EXISTS articles_content_id_idx
  ON articles(content_id)
  WHERE content_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS articles_content_contract_idx
  ON articles(lower(content_contract))
  WHERE content_contract IS NOT NULL;

CREATE TABLE IF NOT EXISTS contract_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id text NOT NULL,
  content_contract text,
  factory text,
  tx_hash text,
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'confirmed', 'mock', 'failed')),
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS contract_deployments_content_id_idx
  ON contract_deployments(content_id);

ALTER TABLE payment_events
  ADD COLUMN IF NOT EXISTS pay_to text,
  ADD COLUMN IF NOT EXISTS content_contract text;

DROP INDEX IF EXISTS payment_events_request_id;

CREATE INDEX IF NOT EXISTS payment_events_content_contract
  ON payment_events(lower(content_contract), created_at DESC)
  WHERE content_contract IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payment_events_contract_idempotency
  ON payment_events(reader_id, lower(content_contract), request_id)
  WHERE request_id IS NOT NULL AND content_contract IS NOT NULL;

ALTER TABLE price_history
  ADD COLUMN IF NOT EXISTS content_contract text,
  ADD COLUMN IF NOT EXISTS old_price_atomic bigint,
  ADD COLUMN IF NOT EXISTS new_price_atomic bigint,
  ADD COLUMN IF NOT EXISTS reason_hash text,
  ADD COLUMN IF NOT EXISTS tune_tx text;

UPDATE price_history
SET new_price_atomic = COALESCE(new_price_atomic, price_atomic)
WHERE new_price_atomic IS NULL;

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS content_contract text;

ALTER TABLE contract_deployments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'contract_deployments' AND policyname = 'contract_deployments_public_read'
  ) THEN
    CREATE POLICY "contract_deployments_public_read"
      ON contract_deployments FOR SELECT
      USING (true);
  END IF;
END $$;

GRANT SELECT ON articles TO anon, authenticated;
GRANT SELECT ON payment_events TO anon, authenticated;
GRANT SELECT ON price_history TO anon, authenticated;
GRANT SELECT ON telemetry_audited TO anon, authenticated;
GRANT SELECT ON contract_deployments TO anon, authenticated;
