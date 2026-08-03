-- search_articles: add an OR fallback tier.
--
-- Problem found in e2e testing: websearch_to_tsquery ANDs every lexeme, so a
-- natural-language sentence over-constrains and returns nothing. The MCP caller
-- is an LLM, which sends sentences, not keywords:
--   "monetize content"                -> 1 hit
--   "how do I monetize my writing"    -> 0 hits   (needs 'monet' AND 'write')
--
-- Fix: two tiers. Try the strict websearch query first (keeps quoted phrases,
-- OR, -exclusion working, and stays precise). Only if it matches nothing, retry
-- with an OR-of-lexemes built from plainto_tsquery. ts_rank still orders the
-- loose tier, so documents hitting more terms surface first.
--
-- The loose query is derived from plainto_tsquery, NOT websearch_to_tsquery,
-- on purpose: plainto_ emits a flat AND of lexemes with no phrase (<->) or
-- negation (!) operators, so the &->| rewrite is always safe. Rewriting
-- websearch output would turn "a & !b" into "a | !b", which matches nearly
-- everything.
--
-- Signature unchanged — this is a drop-in replacement.
CREATE OR REPLACE FUNCTION search_articles(
  p_query  text DEFAULT '',
  p_limit  int  DEFAULT 20,
  p_offset int  DEFAULT 0
)
RETURNS TABLE (
  slug                 text,
  creator_id           uuid,
  creator_name         text,
  title                text,
  excerpt              text,
  topics               text[],
  current_price_atomic bigint,
  rank                 real
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  WITH queries AS (
    SELECT
      LEAST(GREATEST(coalesce(p_limit, 20), 1), 50) AS lim,
      GREATEST(coalesce(p_offset, 0), 0)            AS off,
      CASE WHEN coalesce(btrim(p_query), '') = '' THEN NULL
           ELSE websearch_to_tsquery('english', p_query)
      END AS q_strict,
      CASE WHEN coalesce(btrim(p_query), '') = '' THEN NULL
           ELSE nullif(replace(plainto_tsquery('english', p_query)::text, '&', '|'), '')::tsquery
      END AS q_loose
  ),
  -- Live, readable articles. content_contract IS NOT NULL is unconditional:
  -- web/app/read/page.tsx renders "Content contract pending" before it ever
  -- checks monetization_enabled, so a null contract is a dead link either way.
  live AS (
    SELECT a.slug, a.creator_id, c.display_name AS creator_name, a.title,
           a.excerpt, a.topics, a.current_price_atomic, a.search_vector, a.updated_at
    FROM articles a
    JOIN creators c ON c.id = a.creator_id
    WHERE a.active = true
      AND a.content_contract IS NOT NULL
  ),
  strict_hits AS (
    SELECT l.slug, l.creator_id, l.creator_name, l.title, l.excerpt, l.topics,
           l.current_price_atomic, l.updated_at,
           ts_rank(l.search_vector, q.q_strict) AS rank
    FROM live l CROSS JOIN queries q
    WHERE q.q_strict IS NOT NULL AND l.search_vector @@ q.q_strict
  ),
  loose_hits AS (
    SELECT l.slug, l.creator_id, l.creator_name, l.title, l.excerpt, l.topics,
           l.current_price_atomic, l.updated_at,
           ts_rank(l.search_vector, q.q_loose) AS rank
    FROM live l CROSS JOIN queries q
    WHERE q.q_loose IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM strict_hits)
      AND l.search_vector @@ q.q_loose
  ),
  -- Blank query = browse: rank 0 everywhere, so ORDER BY falls through to updated_at.
  browse AS (
    SELECT l.slug, l.creator_id, l.creator_name, l.title, l.excerpt, l.topics,
           l.current_price_atomic, l.updated_at, 0::real AS rank
    FROM live l CROSS JOIN queries q
    WHERE q.q_strict IS NULL
  ),
  merged AS (
    SELECT * FROM strict_hits
    UNION ALL SELECT * FROM loose_hits
    UNION ALL SELECT * FROM browse
  )
  SELECT m.slug, m.creator_id, m.creator_name, m.title, m.excerpt, m.topics,
         m.current_price_atomic, m.rank
  FROM merged m
  ORDER BY m.rank DESC, m.updated_at DESC
  LIMIT  (SELECT lim FROM queries)
  OFFSET (SELECT off FROM queries);
$$;

GRANT EXECUTE ON FUNCTION search_articles(text, int, int) TO service_role;
