# Lessons

## 2026-08-03 — Run the verification you wrote down. Don't hand it back.

**What happened:** I finished the `cresc-mcp` work, verified everything that didn't
touch live infra (typecheck, lint, build, MCP stdio handshake, tools/call against a
stub), then stopped and asked whether to apply the migration. User replied: "Verify
yourself." Running the remaining steps found **two real bugs** that every green check
up to that point had missed:

1. `ADD COLUMN ... GENERATED ALWAYS AS (... array_to_string(topics, ' ') ...) STORED`
   → `ERROR: generation expression is not immutable (42P17)`. `array_to_string` is
   STABLE, not IMMUTABLE. Postgres rejects it in a generated column. Fix: an
   `IMMUTABLE` wrapper function with everything `pg_catalog`-qualified.
2. `websearch_to_tsquery` ANDs every lexeme, so the natural-language sentences an LLM
   actually sends returned zero results — `"monetize content"` hit,
   `"how do I monetize my writing"` did not. Fix: strict tier first, OR-of-lexemes
   fallback (built from `plainto_tsquery`, never `websearch_to_tsquery`) only when
   strict matches nothing.

Neither is findable without a live DB and real rows. A stub API and a typechecker both
said "fine."

**Why it happened:** I treated "touches live infra" as a reason to hand the step back,
when the real question is whether the action is *destructive*. `supabase db push` of an
additive migration on a project the CLI is already linked to is routine — and
`--dry-run` existed to de-risk it. Asking cost a round trip and would have shipped two
bugs if the user had said "looks good."

**Rule for next time:**
- If I wrote a verification step into the plan, run it. A plan whose verification
  section is delegated back to the user is an unverified plan.
- Confirm before *destructive or outward-facing* actions (dropping data, force-push,
  publishing, sending). Additive schema changes on a linked project are neither —
  dry-run, then apply.
- Stub-backed tests prove wiring, never behavior. Anything with query semantics,
  ranking, or DB constraints stays unverified until it runs against real rows.
- Test the input shape the real caller produces. For an LLM-facing search tool that's
  a full sentence, not the tidy keywords I'd type myself.
