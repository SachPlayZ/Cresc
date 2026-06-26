# PLAN.md — Cresc Implementation

Sequenced build plan for Claude Code. Phases are ordered so each one produces something demonstrable and de-risks the next. **Rail first** — prove money settles before building product around it.

Read `CLAUDE.md` and the cited `cresc-architecture.md` sections before starting each phase. Check off items as you go. Do not skip the **Decisions** block — those gate everything downstream.

---

## Phase 0 — Decisions & scaffold (do this first)

Resolve the open items the architecture deliberately leaves to us (arch §12). Do **not** invent these silently — decide explicitly and record the choice at the top of `CLAUDE.md`.

- [ ] Pick **auth provider** (Supabase Auth / Clerk / …). The design assumes a `user_id` exists.
- [ ] Pick **Ghost gate mechanism** (official plugin / theme snippet / proxy).
- [ ] Confirm **`unlock_token` exchange** (default: short-TTL signed JWT).
- [ ] Set **Watcher rolling-median window** (default 7-day).

Scaffold:
- [ ] Monorepo or two packages: `web/` (Next.js, Vercel) and `agent/` (Node/TS, EC2). Shared `lib/` for money + units + types.
- [ ] TypeScript strict mode; lint/format config.
- [ ] **Money module** (`lib/money.ts`): `dollarsToAtomic`, `atomicToDisplay`, `erc20ToNative` (×1e12), `nativeToErc20`. Unit-tested. Nothing inlines these conversions.
- [ ] `.env.example` mirroring arch §11 exactly (note `ENTITY_SECRET` → `CIRCLE_ENTITY_SECRET`). No secrets in `NEXT_PUBLIC_*`.
- [ ] **Startup assertion helper** (arch §11): `decimals()===6`, chain id `5042002`, EC2 has `BUYER_PRIVATE_KEY` & not `SELLER_PRIVATE_KEY`, `INTERNAL_HMAC_SECRET` present. Wire into both service entrypoints; fail fast.

**Done when:** both apps boot, assertions run, money module passes tests including a 10^12 round-trip.

---

## Phase 1 — The rail (one hardcoded article settles on Arc testnet)

Fork the `arc-nanopayments` pattern. Goal: a sub-cent USDC payment actually settles. No DB, no Ghost, no agent gates yet — hardcode one article + price.

- [ ] **Seller (Vercel):** `lib/x402.ts` `withGateway()` wrapping a single unlock route. No signature → `402` + base64 `PAYMENT-REQUIRED` (accepts[] with the Gateway `extra` block, arch §5). Signature present → `BatchFacilitatorClient.verify()` then `.settle()` → serve. Keyless.
- [ ] Payment requirements built exactly per arch §5: `scheme exact`, `network ARC_CAIP2`, atomic amount, `payTo`, `maxTimeoutSeconds 345600`, `extra { GatewayWalletBatched, "1", verifyingContract: GATEWAY_WALLET_ADDRESS }`.
- [ ] **Buyer (EC2):** `GatewayClient({ chain: "arcTestnet", privateKey: BUYER_PRIVATE_KEY })`. One-time `deposit()`. `pay(unlockUrl)` signs EIP-3009 + retries with `PAYMENT-SIGNATURE`.
- [ ] Fund the shared buyer EOA (one top-up = USDC + gas, same balance).
- [ ] Confirm settlement onchain on Arc testnet; capture the tx.

**Done when:** running the buyer script unlocks the hardcoded article and the payment settles on Arc testnet, verifiable by tx hash.

---

## Phase 2 — Ghost ingest & dynamic unlock

Make articles real and slug-keyed.

- [ ] Supabase schema (arch §6): `creators`, `articles`, `payment_events` (append-only, RLS: public read / service-role insert), plus `readers`, `telemetry`, `telemetry_audited`, `withdrawals`, `price_history` stubbed. All money cols `bigint` (or `numeric(78,0)`); `payment_events.amount_usdc` stays `text`.
- [ ] **Ghost webhook intake** (Vercel): validate `GHOST_WEBHOOK_SECRET`, handle `post.published` → upsert `articles` + creator mapping, assign base price `$0.05` (`50000`).
- [ ] **Dynamic unlock route** `/api/unlock/:slug` (Vercel): reads `current_price_atomic` and creator `payTo` (`articles.creator_id → creators.eoa_address`) from Postgres, not env. Wraps with `withGateway`.
- [ ] Record settled payments to `payment_events`.

**Done when:** publishing a Ghost post creates an article row, and its slug-keyed route unlocks at the stored price with a `payment_events` row written.

---

## Phase 3 — Creator wallets & withdrawal

- [ ] Provision one dev-controlled wallet per creator via `@circle-fin/developer-controlled-wallets` (`CIRCLE_API_KEY` + `CIRCLE_ENTITY_SECRET` + `CIRCLE_WALLET_SET_ID`); store `circle_wallet_id` + `eoa_address`. Provision as **EOA** to skip the delegate path. `payTo` = this address.
- [ ] Encrypt Ghost API keys at rest (`ghost_key_enc`); decrypt only in the worker that calls Ghost.
- [ ] **Creator dashboard (Vercel):** earnings, per-article performance, Gateway balance, withdraw button. Client reads via Supabase publishable key.
- [ ] **Withdraw path (EC2 `POST /agent/withdraw`):** build EIP-712 `BurnIntent`, `client.signTypedData({ walletAddress, blockchain: "ARC-TESTNET", data })`, POST to `gateway-api-testnet.circle.com/v1/transfer` for attestation, then `createContractExecutionTransaction(... gatewayMint(bytes,bytes) ...)`. Same-chain or **CCTP V2** cross-chain. Pre-check destination-chain gas for cross-chain mint. Record `withdrawals` row (`submitted → confirmed/failed`). **No raw key.**

**Done when:** a creator can be onboarded with a Circle wallet, sees their balance, and completes a withdrawal (same-chain first, then cross-chain) recorded in `withdrawals`.

---

## Phase 4 — Reader Agent on EC2 (the core)

Stand up the always-on HTTP service + the four gates + tip flow.

- [ ] **HMAC layer (arch §2a)** both directions: `X-Cresc-Timestamp` (skew > 300s → reject), `X-Cresc-Signature` over raw body, constant-time compare, `401` on fail. Lock the security group to Vercel egress + your IP.
- [ ] **`POST /agent/evaluate-and-pay`** with the exact request/response shapes (arch §2a). `paid`/`declined` → `200`, `error` → `502`.
- [ ] **Gate 1 Budget** (deterministic, no LLM): read `readers` row; fail before any LLM call if caps exceeded.
- [ ] **Gates 2–4** via one Groq call, strict JSON `{ quality, interest, confidence, reason }`. Inputs per arch §5a (article fields + last ~20 telemetry rows summarized).
- [ ] **Decision rule** deterministic after Groq scoring (thresholds `QUALITY_MIN 0.5`, `INTEREST_MIN 0.5`, `CONFIDENCE_MIN 80`, env-configurable). Build thresholded first.
- [ ] **Mock mode**: `GROQ_API_KEY` unset → stub `quality 0.7, interest 0.7, confidence 85`.
- [ ] On pass: forward to the Vercel unlock route, get `402`, agent signs EIP-3009, retries, Gateway settles, return `unlock_token`.
- [ ] **Idempotency**: key by `(reader_id, article_slug, request_id)`; check `payment_events` before signing.
- [ ] **`POST /agent/tip`**: budget-gate only, second `pay()` to creator EOA.
- [ ] Per-`reader_id` spend limits (adapt the reference global `--limit`). Daily + session caps; `session_reset_at`.
- [ ] **Redeposit loop**: ~30s interval, top up Gateway below threshold, nonce-retry, self-healing across restarts; on boot re-read balance and resume.
- [ ] **`GET /healthz`**: Gateway balance, last-payment timestamp, LLM reachability.
- [ ] **PM2/systemd**: `Restart=always`, `RestartSec=2`, `max_memory_restart ~500M`, boot persistence. **Single instance only** (buyer nonce single-writer).
- [ ] **Graceful shutdown**: trap SIGTERM, stop new `evaluate-and-pay`, drain in-flight payments, close.
- [ ] **Log every decision** (gate scores + outcome).

**Done when:** Vercel forwards a real reader unlock to EC2, the agent runs four gates, pays on pass, returns a usable `unlock_token`, respects budget, survives a restart mid-loop without double-paying, and a tip lands on the creator EOA.

---

## Phase 5 — Watcher & Creator Audit Agent

- [ ] **Telemetry capture**: view + dwell → `telemetry` (Postgres) + raw logs → S3. Supabase realtime to the dashboard. `/internal/telemetry` callback optional for v1.
- [ ] **Creator Audit Agent** (runs before Watcher): deterministic pre-filter (`dwell_ms < 1500`, same reader >N/hr default 3, self-tip, z-score spike flags), then LLM `{ authentic_fraction, reason }` for statistical outliers. Writes `telemetry_audited`.
- [ ] **Watcher** (hourly per active article, **audited counts only**): demand formula + clamp + ±20%/hr volatility damp (arch §5a). Write `articles.current_price_atomic`; append `price_history` with normalized inputs as `reason`.
- [ ] Wire both as PM2 interval workers in the agent process group.
- [ ] Confirm seller route reads the Watcher-updated `current_price` for `PAYMENT-REQUIRED`.

**Done when:** real traction reprices an article hourly, a botted spike is filtered (does not pump price), and `price_history` shows the reasoning.

---

## Phase 6 — Polish & traction

- [ ] Decline UX on Vercel: `declined` → reason / signup-topup prompt; `error` → retry.
- [ ] New-reader flow: signup + budget row creation (testnet covered by shared buyer balance).
- [ ] Onboard real Ghost writers and real readers.
- [ ] Verify the full §7 happy path end-to-end and the §9 security checklist.

**Done when:** real writers are getting paid and real readers are paying through the live system.

---

## Standing security checklist (verify before any deploy — arch §9)

- [ ] Buyer is raw-key EOA; seller/creator stays Circle-Wallets-managed; `SELLER_PRIVATE_KEY` empty.
- [ ] Only `BUYER_PRIVATE_KEY` is a live raw key, EC2 only; `READER_KEY_SECRET` protects it; Vercel signs nothing.
- [ ] `ARC_RPC_URL` in EC2 + Vercel encrypted env only; never `NEXT_PUBLIC_*`.
- [ ] All four startup assertions pass on both services.
- [ ] HMAC on every Vercel↔EC2 call; EC2 security group locked.
- [ ] Ghost API keys encrypted at rest.
- [ ] `payment_events` append-only with RLS.
- [ ] CCTP **V2**; cross-chain withdraw pre-checks destination gas.
- [ ] All money atomic 6dp `bigint`; ERC-20 (6dp) for app logic, native (18dp) for gas only; `×10^12` conversion isolated in the money module.
