-- Fix creator onboarding collision: wallet_address was `NOT NULL UNIQUE`, so every
-- unauthenticated POST /api/creator (before wallet binding) used '' as a placeholder.
-- upsertCreator's onConflict:'wallet_address' then merged every pending (unbound)
-- creator onto the same row — two people onboarding concurrently got the same
-- creator_id. Make wallet_address nullable with a partial unique index (Postgres
-- allows multiple NULLs through a unique index) so each pending creator gets its own
-- row until a real wallet binds; same pattern already used for content_contract in
-- 20260705213959_contract_native_content.sql.

ALTER TABLE creators ALTER COLUMN wallet_address DROP NOT NULL;
ALTER TABLE creators ALTER COLUMN wallet_address DROP DEFAULT;

UPDATE creators SET wallet_address = NULL WHERE wallet_address = '';

ALTER TABLE creators DROP CONSTRAINT IF EXISTS creators_wallet_address_key;

CREATE UNIQUE INDEX IF NOT EXISTS creators_wallet_address_idx
  ON creators(wallet_address)
  WHERE wallet_address IS NOT NULL;
