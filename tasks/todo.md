# Todo

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
