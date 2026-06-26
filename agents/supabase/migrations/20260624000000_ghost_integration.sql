-- Ghost integration: add ghost fields to pieces and creators tables.
-- Pieces can now map 1:1 to Ghost blog posts.
-- Full content is fetched from Ghost Admin API server-side at read time, not stored here.

ALTER TABLE creators
  ADD COLUMN IF NOT EXISTS ghost_instance_url   text,
  ADD COLUMN IF NOT EXISTS ghost_admin_key      text,   -- Ghost Admin API key (id:secret format)
  ADD COLUMN IF NOT EXISTS ghost_webhook_secret text;   -- HMAC secret for verifying Ghost webhooks

ALTER TABLE pieces
  ADD COLUMN IF NOT EXISTS ghost_post_id       text,   -- Ghost internal UUID
  ADD COLUMN IF NOT EXISTS ghost_slug          text,   -- URL slug (e.g. "my-article")
  ADD COLUMN IF NOT EXISTS ghost_instance_url  text;   -- base URL of the Ghost instance

-- Prevent duplicate piece per Ghost post per creator.
-- Partial index (WHERE ghost_post_id IS NOT NULL) ignores self-published pieces.
CREATE UNIQUE INDEX IF NOT EXISTS pieces_ghost_post_idx
  ON pieces (creator_id, ghost_post_id)
  WHERE ghost_post_id IS NOT NULL;

-- Fast slug lookup for the snippet's post-status check.
CREATE INDEX IF NOT EXISTS pieces_ghost_slug_idx
  ON pieces (creator_id, ghost_slug)
  WHERE ghost_slug IS NOT NULL;
