-- Full-text search over articles — powers the public discovery API
-- (web/app/api/public/search) consumed by the standalone cresc-mcp server.
--
-- Weights: title (A) > topics (B) > excerpt (C). Article BODIES are never in
-- Postgres (they live in Ghost, fetched at read time), so excerpt is the
-- deepest text we can index.
--
-- SECURITY: search_articles joins `creators`, which has NO grant to anon /
-- authenticated (unlike `articles`, granted in 20260705213959). It is
-- service_role-only by design and must only ever be called server-side via
-- web/lib/db.ts createServerClient(). Do NOT add anon/authenticated EXECUTE.
--
-- NOTE: ADD COLUMN ... GENERATED ALWAYS AS (...) STORED rewrites the table
-- under ACCESS EXCLUSIVE. Fine at current scale; revisit if articles grows large.

-- The weighting expression cannot be inlined into the generated column:
-- array_to_string() is STABLE (not IMMUTABLE), so Postgres rejects it there with
-- "generation expression is not immutable" (42P17). Wrap it in an IMMUTABLE
-- function instead — safe because every call below is pinned to a fixed regconfig
-- ('pg_catalog.english') and text output, none of which depend on session state.
-- Everything is pg_catalog-qualified so no search_path can shadow it.
CREATE OR REPLACE FUNCTION articles_search_vector(
  p_title   text,
  p_topics  text[],
  p_excerpt text
)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    pg_catalog.setweight(
      pg_catalog.to_tsvector('pg_catalog.english'::pg_catalog.regconfig,
        coalesce(p_title, '')), 'A') ||
    pg_catalog.setweight(
      pg_catalog.to_tsvector('pg_catalog.english'::pg_catalog.regconfig,
        coalesce(pg_catalog.array_to_string(p_topics, ' '), '')), 'B') ||
    pg_catalog.setweight(
      pg_catalog.to_tsvector('pg_catalog.english'::pg_catalog.regconfig,
        coalesce(p_excerpt, '')), 'C')
$$;

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (articles_search_vector(title, topics, excerpt)) STORED;

CREATE INDEX IF NOT EXISTS articles_search_vector_idx
  ON articles USING GIN (search_vector);

-- websearch_to_tsquery (not plainto_): the caller is an LLM emitting freeform
-- text. websearch tolerates quoted phrases, OR, -exclusion, and never throws on
-- malformed input — it silently drops bad tokens.
--
-- Blank p_query = browse mode: rank is 0 for every row, so ORDER BY degrades to
-- updated_at DESC (most recently updated live articles).
--
-- content_contract IS NOT NULL is unconditional, NOT gated on
-- monetization_enabled: web/app/read/page.tsx renders "Content contract pending"
-- before it ever checks monetization, so a null contract is a dead link for
-- free and paid articles alike.
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
  SELECT
    a.slug,
    a.creator_id,
    c.display_name AS creator_name,
    a.title,
    a.excerpt,
    a.topics,
    a.current_price_atomic,
    CASE WHEN coalesce(btrim(p_query), '') = ''
      THEN 0::real
      ELSE ts_rank(a.search_vector, websearch_to_tsquery('english', p_query))
    END AS rank
  FROM articles a
  JOIN creators c ON c.id = a.creator_id
  WHERE a.active = true
    AND a.content_contract IS NOT NULL
    AND (
      coalesce(btrim(p_query), '') = ''
      OR a.search_vector @@ websearch_to_tsquery('english', p_query)
    )
  ORDER BY rank DESC, a.updated_at DESC
  LIMIT LEAST(GREATEST(coalesce(p_limit, 20), 1), 50)
  OFFSET GREATEST(coalesce(p_offset, 0), 0);
$$;

GRANT EXECUTE ON FUNCTION search_articles(text, int, int) TO service_role;
