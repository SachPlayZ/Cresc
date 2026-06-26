-- Architecture audit fixes:
-- - idempotency key is the documented triple, not request_id alone
-- - audit upsert needs a real unique key on (article_slug, window_start)
-- - enable RLS for new-architecture tables without granting unsafe public writes

DROP INDEX IF EXISTS payment_events_request_id;

CREATE UNIQUE INDEX IF NOT EXISTS payment_events_idempotency_triple
  ON payment_events(reader_id, article_slug, request_id)
  WHERE request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS telemetry_audited_window_unique
  ON telemetry_audited(article_slug, window_start);

ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE readers ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry_audited ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'articles' AND policyname = 'articles_public_read'
  ) THEN
    CREATE POLICY "articles_public_read" ON articles FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'telemetry_audited' AND policyname = 'telemetry_audited_public_read'
  ) THEN
    CREATE POLICY "telemetry_audited_public_read" ON telemetry_audited FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'price_history' AND policyname = 'price_history_public_read'
  ) THEN
    CREATE POLICY "price_history_public_read" ON price_history FOR SELECT USING (true);
  END IF;
END $$;

