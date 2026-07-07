# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

Pay-per-article monetization for Ghost, settled in USDC on **Arc** via Circle Nanopayments (Gateway + x402). Next.js frontend on **Vercel**, always-on agents on **EC2**, per-content contracts on Arc.

This file is the design source of truth.

> **README.md is stale.** The actual architecture is an HTTP Express server on EC2 with HMAC-authenticated calls from Vercel, plus Arc content contracts deployed by a factory.

---

## Commands

```bash
# Web (run from web/)
npm run dev          # Next.js dev server — http://localhost:3000
npm run build        # production build
npm run lint         # ESLint
npx tsx --test lib/money.test.ts   # money module unit tests (Node built-in runner)

# Agents (run from agents/)
npm run dev          # tsx watch with .env.local hot-reload
npm run typecheck    # tsc --noEmit (also runs in CI before deploy)
npm run seed         # seed test articles/readers into Supabase
npm run generate-wallets  # generate testnet EOA keypairs (outputs to stdout)

# Database (run from agents/)
npx supabase db push    # apply all migrations in agents/supabase/migrations/
```

CI runs `npm run typecheck` in `agents/` on every push to main before deploying to EC2 via SSH. See `.github/workflows/deploy-agents.yml`.

---

## Non-negotiable invariants

These cause silent, expensive bugs if violated. Treat them as hard constraints, not suggestions.

1. **The x402 buyer is a raw-key EOA. Forced by `ecrecover`.** Gateway verifies payment signatures offchain with `ecrecover`, which cannot recover an SCA's EIP-1271 signature, so SCA wallets are rejected for nanopayments. There is no Circle-Wallets-SDK substitute for the buyer pay path. `BUYER_PRIVATE_KEY` lives **only on EC2** and is used only for x402/Gateway payments.

2. **Creators do not need seller raw keys.** The read path verifies/settles through the facilitator API and pays the content contract. Creator wallets receive withdrawals from content contracts; `SELLER_PRIVATE_KEY` staying **empty is correct** — do not "fix" it.

2a. **The content tuner is an EC2-only operational signer.** `CONTENT_TUNER_PRIVATE_KEY` deploys content contracts, tunes prices, and executes payout-operator withdrawals. Treat it as a hot admin key: EC2 only, never Vercel/client, never reused as the buyer key.

3. **There is no "EIP-719."** Buyer-pay = **EIP-3009** (transfer-with-authorization). Content withdrawals are ERC-20 transfers from the content contract. The "Hits X402" step is a `402 Payment Required` carrying a base64 `PAYMENT-REQUIRED` header.

4. **Money is atomic 6dp integers, end to end.** Every money column is `bigint` (or `numeric(78,0)`) storing atomic USDC. `$0.05 = 50000`. Never a float, never dollars in storage. Convert dollars→atomic only at ingest (`Math.round(dollars * 1e6)`) and atomic→display only at the UI edge. The reference repo's `payment_events.amount_usdc` is `text` — keep it `text` to match the schema, but treat it as an atomic-integer string.

5. **Arc USDC is one token, two interfaces — not two tokens.** ERC-20 (6dp) for everything the app touches (x402 amounts, transfers, prices, displayed balances). Native (18dp) **only** for gas/fee accounting. Conversion is exactly `×10^12` (native = erc20 × 1e12). Always read `decimals()` and **assert it is 6 at startup**. The classic bug is mixing an 18dp native figure into a 6dp ERC-20 amount — off by 10^12. Gas and spendable USDC are the same balance; one top-up funds both.

6. **`ARC_RPC_URL` is a secret.** EC2 env + Vercel encrypted env only. **Never** in any `NEXT_PUBLIC_*` var, never client-side.

7. **Single writer for the buyer nonce.** Run exactly **one** Reader Agent instance against the shared buyer key. Two instances signing from the same EOA collide on nonces. To scale, shard readers across keys or serialize signing — never naively run two copies.

8. **`payment_events` is append-only.** RLS: public read, service-role insert. It mirrors settlements for dashboards/idempotency. **It is written by the Vercel `/api/x402/[slug]` route at settlement time — not by the EC2 agent.** Contract balances are the payout source of truth.

9. **Idempotency.** Key each unlock attempt by `(reader_id, content_contract, request_id)`; check `payment_events` before signing; a settled row means already-paid. A mid-payment crash must not double-pay.

10. **Every monetized post has a content contract.** Ghost webhook → EC2 agent → `ContentFactory.createContent(...)`. The content contract stores metadata + current price and receives Gateway USDC payments.

11. **Pricing source of truth is onchain.** The agent may compute demand offchain, but price changes happen through `ContentVault.tunePrice(...)`. Postgres price fields are cache/UI only.

---

## Architecture in one screen

Three planes, two deploy targets, one settlement rail, one content contract per post.

- **Creator (writer):** Circle wallet, one per creator. Owns content contracts and withdraws their balances.
- **Reader (+ Reader Agent):** one shared raw-key EOA + per-reader budget rows in Postgres. Signs via `GatewayClient({ privateKey })`. Always-on, EC2.
- **Content contracts:** one `ContentVault` per Ghost post, deployed by `ContentFactory`. Stores metadata, price, owner, and revenue.
- **Settlement:** Circle Gateway on Arc batches EIP-3009 authorizations and credits each content contract's USDC balance.

**Vercel** (stateless, no hot keys): creator dashboard, Ghost content gate, x402 unlock route (`withGateway` → facilitator `verify`/`settle`), HMAC internal API.

**EC2** (always-on, holds the buyer raw key + operational signing access): Ghost webhook receiver, Reader Agent HTTP service + redeposit loop, Pricing Agent (`tunePrice` txs), Creator Audit Agent, content deployment and withdrawal orchestration. Systemd with `Restart=always`.

### Payment flow (critical path)

```
Ghost post published
  → POST /agent/ghost/webhook (EC2)
  → agent calls ContentFactory.createContent(...)
  → ContentVault deployed; Postgres indexes content_contract

Reader → POST /api/unlock/:slug (Vercel)
  → HMAC-signed POST /agent/evaluate-and-pay (EC2)
  → 4 gates pass → agent calls GatewayClient.pay(unlock_url)
  → GET /api/x402/:slug — 402, agent signs EIP-3009, retries with Payment-Signature
  → Vercel: BatchFacilitatorClient.verify() + .settle() with payTo=content_contract
  → payment_events row written (by /api/x402/[slug] route, NOT the agent)
  → Gateway settlement credits the content contract
  → unlock_token returned to agent → agent returns it to Vercel → content served
```

### unlock_token format

Generated in `web/app/api/x402/[slug]/route.ts`. Format: `${expiry}:${slug}:${readerId}:${hmacSig}` where expiry is unix seconds (1-hour TTL) and sig is `hmacSHA256(INTERNAL_HMAC_SECRET, data)`. Verified by the same route on subsequent content-fetch requests.

---

## Vercel ↔ EC2 boundary (build exactly)

HTTP, not a queue. Reader Agent runs Express; Vercel calls synchronously. No public agent port — security group admits only Vercel egress + your IP.

**Auth on every internal call (both directions):**
- `X-Cresc-Timestamp`: unix seconds (reject if skew > 300s).
- `X-Cresc-Signature`: `hex(hmacSHA256(INTERNAL_HMAC_SECRET, \`${timestamp}.${rawBody}\`))`.
- Recompute over the **raw** body, constant-time compare. Reject missing/expired/mismatched with `401`.
- Implementation: `web/lib/hmac.ts` (Vercel side), `agents/src/middleware/hmac.ts` (EC2 side).

**Endpoints (EC2, called by Vercel):**
- `POST /agent/evaluate-and-pay` → `{ decision: paid|declined|error, gates, payment?, unlock_token?, reason?, error? }`. `paid`/`declined` both return `200`; `error` returns `502`.
- `POST /agent/tip` → budget-gate only, second `pay()` to the content contract.
- `POST /agent/ghost/webhook` → validate Ghost webhook, deploy/index content contract.
- `POST /agent/withdraw-content` → withdraw Arc USDC from a content contract to the creator wallet.
- `GET /healthz` → Gateway balance, last-payment timestamp, LLM reachability. **Not HMAC-protected** — must be reachable by external monitors.

---

## Agent decision logic (build exactly)

**Reader Agent — four gates, short-circuit on first hard fail:**
- **Gate 1 Budget (deterministic, no LLM):** fail if `spent_today + price > daily_budget` OR `spent_session + price > session_budget`. On fail return `declined / reason: "budget_exceeded"` before any LLM call.
- **Gates 2–4 Quality / Interest / Confidence (one Groq call):** strict-JSON output `{ quality: 0-1, interest: 0-1, confidence: 0-100, reason }`, no prose. Inputs: article `title`/`excerpt`/`topics`/`price_atomic` + reader's last ~20 telemetry rows summarized to topics + avg dwell.
- **Decision rule (deterministic, after LLM):** pay IFF `budget_ok AND quality ≥ QUALITY_MIN (0.5) AND interest ≥ INTEREST_MIN (0.5) AND confidence ≥ CONFIDENCE_MIN (80)`. Thresholds env-configurable.
- **Mock mode:** if `GROQ_API_KEY` unset, return deterministic stubs (`quality 0.7, interest 0.7, confidence 85`) so the pay loop is testable without Groq.

**Pricing Agent — per active content contract, on AUDITED counts only:**
```
demand = W_VIEWS*norm(views_24h) + W_DWELL*norm(avg_dwell_24h) + W_TIPS*norm(tips_24h)
target = round(base_price_atomic * (0.5 + demand))
new_price = clamp(target, PRICE_MIN_ATOMIC, PRICE_MAX_ATOMIC)
new_price = clamp(new_price, prev*0.8, prev*1.2)   # ±20%/hr volatility damp
```
Normalization uses 7-day rolling medians across all articles. Call `ContentVault.tunePrice(new_price, reasonHash)`; append `price_history` with tx hash/reason. `ContentVault.priceAtomic()` is what the seller route reads for `PAYMENT-REQUIRED`.

**Creator Audit Agent — runs before Pricing Agent consumes telemetry:**
1. Deterministic pre-filter: drop view if `dwell_ms < 1500`; same `reader_id` on same `content_contract` > N/hr (default 3); self-tip from creator wallet; flag per-IP/reader z-score spikes.
2. LLM judgment for statistical outliers: send access *pattern* to Groq, get `{ authentic_fraction: 0-1, reason }`. Pricing Agent scales raw counts by `authentic_fraction`.

Output is **audited counts** (`telemetry_audited`) — the Pricing Agent never reads raw counts.

---

## Datastore (Postgres / Supabase)

Migrations live in `agents/supabase/migrations/` — apply with `npx supabase db push` from `agents/`.

- `creators` (user_id, circle_wallet_id, wallet_address, ghost_url, ghost_key_enc)
- `readers` (user_id, daily_budget_atomic bigint, session_budget_atomic bigint, spent_today_atomic bigint, spent_session_atomic bigint, session_reset_at)
- `articles` (slug, creator_id, ghost_post_id, content_id, content_contract, metadata_uri, metadata_hash, last_seen_price_atomic, factory_tx, active)
- `telemetry` (content_contract, reader_id, event_type, dwell_ms, ip_hash, ts)
- `telemetry_audited` (content_contract, window_start, views, avg_dwell_ms, tips_atomic, authentic_fraction) — Pricing Agent reads this
- `payment_events` (endpoint, payer, pay_to, amount_usdc text [atomic string], network, gateway_tx, reader_id, content_contract, request_id, raw) — append-only, RLS
- `withdrawals` (content_contract, amount_atomic, destination_chain, destination_address, status, tx_hash)
- `price_history` (content_contract, old_price_atomic, new_price_atomic, reason_hash, tune_tx, ts)
- `contract_deployments` (content_id, content_contract, factory, tx_hash, status, raw)

Stored procedures: `record_reader_spend(p_user_id, p_amount)`, `reset_daily_budgets()` (called at midnight UTC by the agent).

---

## Stack

- Frontend + x402 seller: Next.js on Vercel.
- Agents: Node/TS on EC2, systemd (`Restart=always`, `MemoryMax=500M`).
- Contracts: Solidity `ContentFactory` + per-post `ContentVault` contracts on Arc.
- Buyer signing (x402): `viem` + `@circle-fin/x402-batching` (raw `BUYER_PRIVATE_KEY`).
- Content contract ops: `viem` wallet client with EC2-only `CONTENT_TUNER_PRIVATE_KEY`.
- Contract deployment/tuning: `viem` or Circle transaction APIs.
- Creator payout: withdraw from content contract; use CCTP V2/Gateway for cross-chain after Arc withdrawal.
- Groq: OpenAI-compatible (`GROQ_BASE_URL`/`GROQ_MODEL`). No key → mock mode.
- State: Supabase Postgres. Blobs: S3. Cross-chain payout: **CCTP V2** (V1 is legacy).

---

## Arc Testnet constants (read from env, don't hardcode blindly)

```
ARC_CHAIN_ID / CAIP-2:  5042002 / eip155:5042002
ARC_SDK_CHAIN:          arcTestnet
USDC (ERC-20):          0x3600000000000000000000000000000000000000  (call decimals() — assert 6)
Gateway Wallet:         0x0077777d7EBA4688BDeF3E311b846F25870A19B9   (EIP-3009 verifyingContract, domain 26)
Gateway Minter:         0x0022222ABE238Cc2C7Bb1f21003F0a260052475B   (withdraw / mint)
Facilitator API:        https://gateway-api-testnet.circle.com
RPC (keyed, SECRET):    ARC_RPC_URL — server-side only
```

x402 payment requirements `extra` block:
```
scheme "exact", network ARC_CAIP2, asset USDC, amount (atomic 6dp),
payTo <content contract>, maxTimeoutSeconds 345600,
extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: GATEWAY_WALLET_ADDRESS }
```

---

## Startup assertions (every service, fail fast)

1. `USDC.decimals() === 6`.
2. chain id `5042002`.
3. On EC2 live mode: `BUYER_PRIVATE_KEY`, `CONTENT_TUNER_PRIVATE_KEY`, and `CONTENT_FACTORY_ADDRESS` present; `SELLER_PRIVATE_KEY` absent.
4. `INTERNAL_HMAC_SECRET` present on both Vercel and EC2.

Assertions 1–2 are skipped in mock mode (when `GROQ_API_KEY` is unset) but should still run in production. `CIRCLE_ENTITY_SECRET` should also be asserted present on EC2 when using Circle-controlled operational wallets. The config reads it from either `CIRCLE_ENTITY_SECRET` or the legacy `ENTITY_SECRET` env var.

---

## Ghost integration

`web/public/cresc-ghost.js` is a self-contained ~2KB snippet injected into Ghost sites via Code Injection → Site Footer. It:
1. Checks `GET /api/ghost/post-status?site=<creatorId>&slug=<slug>` on every Ghost page load.
2. Clips post content to 300px + gradient overlay if paywalled.
3. Shows an "Unlock for $X →" button linking to `/read?slug=<slug>`.

Ghost sends `post.published` / `post.updated` / `post.deleted` webhooks to `POST /agent/ghost/webhook` on EC2. The agent validates `GHOST_WEBHOOK_SECRET`, creates/updates metadata, calls `ContentFactory.createContent(...)` for new posts, and stores `content_contract` in Postgres. Creator onboarding happens at `/ghost-onboard`.

---

## EC2 production hygiene

- State lives in Postgres/Gateway/contracts, never process memory — a restart loses nothing. Only in-memory state is the redeposit timer; on boot, re-read Gateway balance and resume the loop.
- Redeposit loop self-heals (~30s interval, top up below threshold), survives restarts, tolerates in-flight funder transfers (nonce-retry).
- Graceful shutdown: trap SIGTERM, stop accepting new `evaluate-and-pay`, drain in-flight payments, then close — prevents a half-signed authorization on deploy.
- Single GatewayClient instance must be shared across all routes — two instances on the same private key cause nonce collisions.

---

## Resolved architecture decisions

These were once open questions; they are now decided:

- **Auth provider:** Circle User Controlled Wallets on Arc Testnet. No external wallet connector, Supabase Auth, or Clerk. `user_id` = UCW wallet address.
- **Ghost gate mechanism:** theme snippet (`web/public/cresc-ghost.js`) injected via Ghost Code Injection.
- **`unlock_token` exchange:** HMAC-signed string `${expiry}:${slug}:${readerId}:${sig}`, 1-hour TTL, verified server-side by the x402 route.
- **Rolling-median window:** 7 days for Pricing Agent demand normalization.

---

## Working conventions

- TypeScript everywhere. Strict mode. No `any` on money or signing paths.
- Money helpers in `web/lib/money.ts` and `agents/src/money.ts` (kept in sync). Never inline atomic↔display or erc20↔native conversions.
- The two `config.ts` files (`web/lib/config.ts`, `agents/src/config.ts`) are the single source of truth for env var names. Comments in both files say "keep-in-sync."
- HMAC helpers: `web/lib/hmac.ts` (builds + verifies), `agents/src/middleware/hmac.ts` (Express middleware). Both use the same algorithm — changes to one require a matching change in the other.
- Env var `ENTITY_SECRET` (legacy) and `CIRCLE_ENTITY_SECRET` are both accepted by `agents/src/config.ts`; prefer `CIRCLE_ENTITY_SECRET`.
- Log every agent decision (gate scores + outcome) — it is both observability and traction evidence.
- After changing any signing path, re-verify the four startup assertions still hold.
