-- Adds the IPFS CID of the pinned price-tune reasoning JSON, so creators/readers can
-- independently verify the on-chain reasonHash (emitted in ContentVault's PriceTuned
-- event) against the actual pinned content.
ALTER TABLE price_history
  ADD COLUMN IF NOT EXISTS reason_cid text;
