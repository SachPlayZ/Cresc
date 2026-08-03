# Todo

## App audit (2026-07-14)

### Plan

- [x] Inventory runtime surfaces, dependencies, configuration, and deployment paths.
- [x] Audit web/API auth, x402 settlement, idempotency, Ghost gate, and data exposure.
- [x] Audit agent payment, budget, worker, HMAC, lifecycle, and operational safety paths.
- [x] Audit contracts, migrations/RLS/functions, and cross-plane consistency.
- [x] Run available tests, typecheck, lint/build, static scans, and inspect diffs.
- [x] Rank actionable findings with code evidence and missing production controls.

Likely files: `web/app/api/**`, `web/lib/**`, `agents/src/**`,
`agents/supabase/migrations/**`, `contracts/src/**`, deploy/CI/env files.

### Verification

- [x] `agents`: typecheck/tests.
- [x] `web`: lint/build/tests.
- [x] `contracts`: fmt/build/test/static checks where available.
- [x] Secrets/stale-symbol/dependency/config scans.

### Review

#### Changed

- Audit only; no application code changed.
- Ranked findings delivered with file/line evidence.

#### Verified

- Agents typecheck passes; no agent test suite exists.
- Web production build passes. ESLint fails with 3 errors.
- Web money/Circle tests: 36 pass when `INTERNAL_HMAC_SECRET` is injected; default
  documented invocation fails before Circle tests start.
- Foundry fmt/build/sizes and 24 contract tests pass.
- Live Arc chain id and factory USDC are correct.
- Live anon Data API advertises `POST` on `payment_events`.
- Live DB contains duplicate creator-scoped slugs (`how-to-write-loops`, `hello-test`,
  `coming-soon`), proving current telemetry/pricing keys collide.
- Dependency audit: agents 2 high; web 3 high + 13 moderate.
- No tracked secrets found; `git diff --check` passes.

#### Risks

- Critical: anonymous callers can forge `payment_events` and bypass settlement.
- Critical: synthetic reader IDs can drain the shared buyer wallet; no platform cap/rate limit.
- Critical: missing production config activates payment mocks that accept fake settlement.
- High: Ghost overlay is not a real paywall and fails open.
- High: tip/payment idempotency, budget accounting, slug tenancy, signer concurrency,
  receipt handling, and price-source consistency are unsafe.
- High: deployed factory/vault bytecode sizes differ from current compiled artifacts; current
  source/tests are not proof of deployed behavior.
- High: SSRF, bearer-token URL leakage, webhook replay, and deployment/CI gaps remain.

#### Follow-ups

- Emergency: revoke anon/authenticated writes on `payment_events`; remove permissive insert policy.
- Add authenticated reader identity, global spend circuit breaker, and rate limits before funding.
- Make all production mock modes explicit and fail closed.
- Replace Ghost DOM clipping with server/private-content enforcement.
- Migrate telemetry/audit/history to article UUID/content contract keys.
- Add durable payment attempts + atomic budget reservation/reconciliation.
- Serialize all tuner transactions and require successful receipts before DB state changes.
- Redeploy/version contracts, verify bytecode/config, and audit before real value.
- Add web/agent/contracts/migration CI plus real readiness and rollback checks.

## Follow-up audit pass (2026-07-06)

Full end-to-end audit of the contract-native pivot (agents + contracts + web) plus env var
cleanup. See git log for the commit; summary below.

### Fixed

- **Contracts**: `payoutOperator` could withdraw to any address unsigned — added EIP-712
  `withdrawSigned(to, amount, nonce, v, r, s)` verified against `creator`; direct
  `withdraw`/`withdrawAll` now creator-only. Added `setPriceTuner` (rotation), events on
  `setPayoutOperator`/`setPriceTuner`, zero-amount/zero-balance guards, minimal reentrancy
  guard, checked-transfer helper, `priceTuner` in `ContentCreated`. 22 Foundry tests, all pass.
- **Agents**: fixed idempotency case-sensitivity bug (`payment_events.content_contract` compare
  vs `lower()` DB index) via `ilike`; added amount/nonce validation on `/agent/withdraw-content`;
  isolated `tuneContentPrice` failures from the DB price update; clamped `PRICE_MAX_ATOMIC` to
  the contract's hardcoded ceiling; wired `withdrawFromContent` to the new signed path; removed
  dead Circle-wallet env exports and `captureRawBody`.
- **Web**: fixed a creator-row collision — `POST /api/creator` upserted on empty
  `wallet_address`, merging concurrent onboarding attempts into one row (now always inserts;
  `wallet_address` is nullable with a partial unique index, migration
  `20260706120000_creator_wallet_address_nullable.sql`). Closed an IDOR on wallet binding via a
  stateless HMAC onboarding token. Added an SSRF guard on the Ghost `instanceUrl`. Fixed a
  zombie `withdrawals` row on network-level fetch failure. Wired the EIP-712 signed withdrawal
  flow end-to-end (`/api/withdraw/sign-request` + Circle UCW `signTypedData` + `WithdrawSection.tsx`).
  Removed dead code: `verifyGhostSignature`, `isUcwMode`, `web/lib/llm/` (entirely unused),
  `web/lib/repo/pieces.ts` (entirely unused legacy module).
- **Env vars**: removed ~20 dead vars (old Circle-wallet withdraw path, unused AWS/S3, unused
  pricing-in-web vars) from both `.env.example` files, both `.env.local` files, `agents/src/config.ts`,
  `web/lib/config.ts`. Updated `CLAUDE.md` and `cresc-architecture.md` §13 to match (creator
  model, withdrawal path, unlock_token format, env manifest).

### Verified

- `agents` typecheck, `web` lint + build, `money.test.ts`, `circle.test.ts`, `forge fmt/build/test`
  (22/22) — all pass.

### Deferred (flagged, not fixed — needs a product decision)

- None outstanding from this pass; the one open question (arbitrary-destination withdrawal risk)
  was resolved by adding the signed-withdrawal path above rather than deferred.

### Still true from the prior pass

- Supabase migration apply still needs to be run for real (`npx supabase db push` from `agents/`)
  — this pass added one more migration file on top of the contract-native one.
- Live deploy/staging smoke still needs real env (deployed factory, funded keys, Ghost test site).

## Plan

- [x] Add contract tests and deploy tooling.
- [ ] Validate/apply Supabase migration path.
- [x] Add live staging smoke script/checklist for Ghost/pay/withdraw.
- [x] Fix audit blockers from contract-native review.
- [x] Audit contract-native implementation end to end.
- [x] Add Foundry scaffold plus `ContentFactory` / `ContentVault` contracts.
- [x] Add contract-native DB migration (`content_contract`, `pay_to`, deployment/index tables).
- [x] Add shared creator ownership helper based on Circle UCW `userToken`.
- [x] Move Ghost connect/sync target to EC2 contract deployment flow.
- [x] Change x402/unlock/read/status/tip flows to use `content_contract` + onchain/cached price.
- [x] Replace Watcher DB repricing with Pricing Agent `tunePrice` transaction path.
- [x] Change withdrawal path to content-contract withdrawals.
- [x] Remove/guard invalid Circle-wallet buyer x402 signing path.

## Verification

- [x] `agents` typecheck.
- [x] `web` lint/build.
- [x] Money/circle tests where practical.
- [x] Solidity build.
- [x] Diff and stale-symbol scan.

## Review

### Changed

- Added `creatorId` to `ContentVault` constructor/storage via factory-created metadata.
- Enforced live contract config when real payments are enabled.
- Bound unlock/x402/read/telemetry routes to `site + slug`.
- Added creator/content-contract ownership checks on web and EC2 withdrawal paths.
- Removed contractless Ghost connect fallback.
- Filtered inactive/deleted posts from read/status/audit/watcher paths.
- Fixed tip accounting to use `content_contract`.
- Made payment event logging fail closed instead of silently unlocking.
- Added Foundry tests and deploy script/docs.
- Replaced stale Circle-MPC buyer scripts with raw-key Gateway-safe scripts.
- Added staging smoke script for health, DB, x402 402 shape, and optional paid unlock.
- Updated docs for EC2-only buyer/tuner operator keys.
- Contract-native content model: factory/vault contracts, DB contract columns, per-content pay-to routing.
- Ghost webhook/connect now drives EC2 content-contract creation/upsert.
- x402 unlock/tip/payment rows now route to `content_contract`.
- Pricing agent calls `tunePrice`; withdrawals call `/agent/withdraw-content`.
- Deprecated Gateway-mint withdrawal path now returns `410`.
- Creator wallet ownership checks added before sensitive wallet/Ghost/withdraw updates.

### Verified

- `npm run typecheck` in `agents/`.
- `npm run lint` in `web/` (passes with existing image/eslint-disable warnings).
- `npm run build` in `web/` with dummy server env.
- `npx tsx --test lib/money.test.ts`.
- `INTERNAL_HMAC_SECRET=test npx tsx --test lib/circle/circle.test.ts`.
- `forge build --sizes`.
- `forge test -vvv`.
- `forge inspect ... storage-layout`.
- `git diff --check`.
- Stale-symbol scan for old BurnIntent/GatewayMinter/Circle wallet withdrawal references.
- Re-ran verification after audit-blocker fixes.

### Risks

- Supabase migration apply could not be run here: Docker daemon/Postgres unavailable, remote CLI waits for login.
- Contracts are still not third-party audited; `slither`, `aderyn`, and `solhint` are not installed locally.
- Live deploy/staging smoke needs real env: Supabase, Arc RPC, funded keys, deployed factory, EC2/Vercel URLs, Ghost test site.
- Existing articles still need re-sync/backfill after migration.
- Content withdrawal uses `CONTENT_TUNER_PRIVATE_KEY` as payout operator; keep EC2-only and rotate/multisig before serious value.

### Follow-ups

- Enforce withdrawal ownership and live contract config.
- Filter inactive content and remove broken Ghost fallback.
- Fix site-aware unlock/x402 routing and tip telemetry.
- Start Docker/Supabase or login remote, then run `supabase db push`.
- Deploy factory, set `CONTENT_FACTORY_ADDRESS`, re-sync Ghost, then run `npm run smoke:staging` and `npm run smoke:staging -- --pay`.

---

## MCP article-discovery server (`cresc-mcp`)

Ship an npx-installable stdio MCP server so any MCP client can search onboarded
creators' Ghost articles by natural-language query and get a pay-and-read link.
Link-only: no keys, no payment, no article bodies in the MCP process.

- [x] `agents/supabase/migrations/20260802120000_article_search.sql` — `search_vector`
      generated tsvector (title A / topics B / excerpt C), GIN index, `search_articles`
      RPC (`websearch_to_tsquery`, blank query = browse, `content_contract IS NOT NULL`,
      service_role EXECUTE only since it joins `creators`).
- [x] `searchArticles` + `ArticleSearchRow` in `web/lib/repo/articles.ts`, re-exported.
- [x] `web/lib/public-article.ts` — single whitelisted `PublicArticle` shape; reuses
      `fromBaseUnits`/`toDisplay`/`USDC_ERC20_DECIMALS`, never spreads a raw row.
- [x] `web/app/api/public/search/route.ts`, `web/app/api/public/articles/[slug]/route.ts`.
- [x] `mcp/` package: stdio server on `@modelcontextprotocol/sdk` ^1.30, tools
      `search_articles` + `get_article`, `CRESC_API_URL` (default cresc.vercel.app).
- [x] `agents/supabase/migrations/20260803090000_article_search_loose_fallback.sql` —
      strict→loose search tiers (see Bugs found below).
- [x] Both migrations applied to remote Supabase (`pygowakpbxhumobxkduk`).
- [x] Live routes curled against real data (9 active articles, all contract-backed).
- [ ] `npm publish` from `mcp/` — unscoped name `cresc-mcp`, confirmed free on npm.

### Bugs found by running the verification (neither visible to typecheck/stub tests)

1. **`generation expression is not immutable` (42P17)** — `array_to_string` is STABLE,
   so it cannot appear in a `GENERATED ALWAYS AS ... STORED` expression. Fixed with an
   `IMMUTABLE PARALLEL SAFE` wrapper `articles_search_vector(title, topics, excerpt)`,
   fully `pg_catalog`-qualified so no `search_path` can shadow it.
2. **Natural-language queries returned nothing** — `websearch_to_tsquery` ANDs every
   lexeme. `"monetize content"` hit; `"how do I monetize my writing"` (what an LLM
   actually sends) did not. Fixed with a second migration: strict websearch tier first,
   OR-of-lexemes fallback only when strict matches zero. Loose query is derived from
   `plainto_tsquery`, never `websearch_to_tsquery` — plainto_ emits a flat AND with no
   `<->`/`!` operators, so the `&`→`|` rewrite is always safe.

### Verified

- `web`: `tsc --noEmit` clean; `npm run lint` — only 3 pre-existing errors in
  `app/page.tsx` / `ghost-onboard/page.tsx`, none in new files.
- `mcp`: `npm run build` clean, shebang preserved, `dist/index.js` executable.
- MCP stdio handshake: `initialize` + `tools/list` return both tools.
- `tools/call`: hit, zero-hit (non-error text), `get_article`, and unreachable-API
  (`isError: true`) all correct — against a stub *and* against the live API.
- FTS semantics on real rows: stemming (`monetize`→`monetizing`, `writing`→`write`),
  quoted phrase, `-exclusion`, `OR`, stopword-only, and nonsense queries all behave.
  Precision on operator queries survived the loose-fallback change.
- Routes: `200` + correct `Cache-Control` on both; `400` missing `site`; `404` wrong
  `site`; `count: 0` on no match; `limit=abc` and `limit=999` both clamped.
- Secret-leak scan over every public response: zero hits for `ghost_key_enc`,
  `ghost_admin_key`, `ghost_webhook_secret`, `eoa_address`, `circle_wallet_id`,
  `content_contract`, `ghost_post_id`, `metadata_hash`.
- Full chain: MCP tool call → live API → returned `/read` URL fetched → `200`, renders
  `Pay … Read →` at `$0.02608` (matching the price MCP reported), **not** "Content
  contract pending".
- No `search_articles` / `search_vector` name collision in existing migrations.

### Risks

- Migration uses `ADD COLUMN ... GENERATED ALWAYS AS ... STORED` → full table rewrite
  under ACCESS EXCLUSIVE. Fine at current scale.
- `/api/public/*` is unauthenticated with no per-IP limiter (none exists in `web/`).
  Mitigation is SQL+route clamps and CDN `Cache-Control`; add a limiter if abused.
- Search recall is capped by Ghost's auto-excerpt — bodies are never in Postgres.
- Every article currently has `topics = []`, so the B-weight tier contributes nothing.
  Ranking today is title (A) + excerpt (C) only. Populating topics at Ghost sync time
  would measurably improve relevance.
- Test data has duplicate slugs across creators (`how-to-write-loops` twice), so search
  returns visually identical rows. Correct — slugs are only unique per creator — but it
  reads as a bug. Consider surfacing the creator more prominently in tool output.
