-- M-C3: Add kind column to pieces table
ALTER TABLE pieces
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'article'
  CHECK (kind IN ('article', 'video'));
