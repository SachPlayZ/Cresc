-- Per-article monetization toggle. When false, the article is served free —
-- Ghost's paywall snippet and Cresc's own /read page both skip the payment gate
-- entirely (see web/app/api/ghost/post-status and web/app/read/page.tsx).
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS monetization_enabled boolean NOT NULL DEFAULT true;
