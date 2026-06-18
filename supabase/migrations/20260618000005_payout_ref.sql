-- Track which settled payments have been included in a payout to the creator.
-- NULL = unpaid. Non-null = the on-chain tx hash of the payout that covered this payment.
ALTER TABLE payments ADD COLUMN payout_ref text;

-- Partial index speeds up the "sum unpaid" query.
CREATE INDEX idx_payments_unpaid
  ON payments (piece_id)
  WHERE payout_ref IS NULL AND status = 'settled';
