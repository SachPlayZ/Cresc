-- reader_wallets: per-reader custodial EOA, cookie-scoped identity.
-- raw EOA path: key_enc holds AES-256-GCM(privKey, READER_KEY_SECRET).
-- Circle wallet path: circle_wallet_id holds Circle dev-controlled wallet ID.

CREATE TABLE IF NOT EXISTS reader_wallets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reader_id        text NOT NULL UNIQUE,
  eoa_address      text NOT NULL UNIQUE,
  key_enc          text,                          -- null when using Circle wallets
  circle_wallet_id text,                          -- null when using raw EOA
  usdc_deposited   text NOT NULL DEFAULT '0',     -- cumulative on-chain deposits (6-dec base units)
  usdc_spent       text NOT NULL DEFAULT '0',     -- total settled via Gateway (6-dec base units)
  gateway_funded   bool NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rw_reader  ON reader_wallets(reader_id);
CREATE INDEX IF NOT EXISTS rw_address ON reader_wallets(eoa_address);

-- Sessions now link to the reader's custodial wallet (nullable for old rows).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS reader_wallet_id uuid REFERENCES reader_wallets(id);
