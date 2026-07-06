# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Pay-per-article monetization for Ghost, settled in USDC on **Arc** via Circle Nanopayments (Gateway + x402). Next.js frontend on **Vercel**, always-on agents on **EC2**, Circle Gateway for settlement.

The full design lives in `cresc-architecture.md` — when this file and the architecture doc disagree, the architecture doc wins; flag the conflict instead of guessing.

> **README.md is stale.** It describes an old DB-queue architecture ("No HTTP server — DB-only"). The actual architecture is an HTTP Express server on EC2 with HMAC-authenticated calls from Vercel, as documented below.

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

1. **The x402 buyer is a raw-key EOA. Forced by `ecrecover`.** Gateway verifies payment signatures offchain with `ecrecover`, which cannot recover an SCA's EIP-1271 signature, so SCA wallets are rejected for nanopayments. There is no Circle-Wallets-SDK substitute for the buyer pay path. `BUYER_PRIVATE_KEY` is the **only** live raw key in the system, and it lives **only on EC2**.

2. **The creator/seller is a ContentVault contract — no app-held raw key.** The seller never signs an x402 authorization; on the read path it only *verifies and settles* via the facilitator API (keyless). Creator revenue accrues onchain in a per-content `ContentVault` (see `contracts/src/ContentVault.sol`). A creator withdraws either directly (their own wallet calls `withdraw`/`withdrawAll`) or via a relayed, creator-signed `withdrawSigned` — the creator signs an EIP-712 `Withdraw(to, amountAtomic, nonce)` message via Circle UCW `signTypedData`, and `CONTENT_TUNER_PRIVATE_KEY` (EC2-only) submits it onchain. `SELLER_PRIVATE_KEY` staying **empty is correct** — do not "fix" it.

3. **There is no "EIP-719."** Buyer-pay = **EIP-3009** (transfer-with-authorization), settled through Circle Gateway. Creator withdrawal = **EIP-712 `Withdraw`** against domain `{ name: "ContentVault", version: "1", verifyingContract: <the vault address> }` — not a Gateway `BurnIntent`; that path is deprecated (`/agent/gateway-mint` returns `410`). The "Hits X402" step is a `402 Payment Required` carrying a base64 `PAYMENT-REQUIRED` header.

4. **Money is atomic 6dp integers, end to end.** Every money column is `bigint` (or `numeric(78,0)`) storing atomic USDC. `$0.05 = 50000`. Never a float, never dollars in storage. Convert dollars→atomic only at ingest (`Math.round(dollars * 1e6)`) and atomic→display only at the UI edge. The reference repo's `payment_events.amount_usdc` is `text` — keep it `text` to match the schema, but treat it as an atomic-integer string.

5. **Arc USDC is one token, two interfaces — not two tokens.** ERC-20 (6dp) for everything the app touches (x402 amounts, transfers, prices, displayed balances). Native (18dp) **only** for gas/fee accounting. Conversion is exactly `×10^12` (native = erc20 × 1e12). Always read `decimals()` and **assert it is 6 at startup**. The classic bug is mixing an 18dp native figure into a 6dp ERC-20 amount — off by 10^12. Gas and spendable USDC are the same balance; one top-up funds both.

6. **`ARC_RPC_URL` is a secret.** EC2 env + Vercel encrypted env only. **Never** in any `NEXT_PUBLIC_*` var, never client-side.

7. **Single writer for the buyer nonce.** Run exactly **one** Reader Agent instance against the shared buyer key. Two instances signing from the same EOA collide on nonces. To scale, shard readers across keys or serialize signing — never naively run two copies.

8. **`payment_events` is append-only.** RLS: public read, service-role insert. It is the transparent dashboard's source of truth. **It is written by the Vercel `/api/x402/[slug]` route at settlement time — not by the EC2 agent.**

9. **Idempotency.** Key each unlock attempt by `(reader_id, lower(content_contract), request_id)` — the DB unique index is on `lower(content_contract)`, so always compare case-insensitively (viem returns checksummed addresses). Check `payment_events` before signing; a settled row means already-paid. A mid-payment crash must not double-pay.

---

## Architecture in one screen

Three planes, two deploy targets, one settlement rail.

- **Creator (writer):** per-content `ContentVault` contract (see `contracts/src/ContentVault.sol`), deployed by `ContentFactory`. Revenue accrues onchain; withdrawal is direct (creator's own key) or relayed via a creator-signed EIP-712 message. UI on Vercel, relay on EC2.
- **Reader (+ Reader Agent):** one shared raw-key EOA + per-reader budget rows in Postgres. Signs via `GatewayClient({ privateKey })`. Always-on, EC2.
- **Settlement:** Circle Gateway on Arc batches EIP-3009 authorizations into one onchain USDC settlement.

**Vercel** (stateless, no hot keys): creator dashboard, Ghost content gate, x402 unlock route (`withGateway` → facilitator `verify`/`settle`), Ghost webhook intake + HMAC internal API.

**EC2** (always-on, holds the buyer raw key + the content-tuner relayer key): Reader Agent HTTP service + redeposit loop, Watcher/Pricing worker (hourly `tunePrice` calls), Creator Audit Agent worker, both signing paths (buyer x402 raw key; content-tuner relaying creator-signed withdrawals and price tunes). Systemd with `Restart=always`.

### Payment flow (critical path)

```
Reader → POST /api/unlock/:slug (Vercel)
  → HMAC-signed POST /agent/evaluate-and-pay (EC2)
  → 4 gates pass → agent calls GatewayClient.pay(unlock_url)
  → GET /api/x402/:slug — 402, agent signs EIP-3009, retries with Payment-Signature
  → Vercel: BatchFacilitatorClient.verify() + .settle()
  → payment_events row written (by /api/x402/[slug] route, NOT the agent)
  → unlock_token returned to agent → agent returns it to Vercel → content served
```

### unlock_token format

Generated in `web/app/api/x402/[slug]/route.ts`. Format: `${expiry}:${site}:${slug}:${readerId}:${hmacSig}` where expiry is unix seconds (1-hour TTL) and sig is `hmacSHA256(INTERNAL_HMAC_SECRET, data)`. Verified by the same route on subsequent content-fetch requests.

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
- `POST /agent/tip` → budget-gate only, second `pay()` to creator EOA.
- `POST /agent/withdraw-content` → relays a creator-signed `ContentVault.withdrawSigned` call (v/r/s + nonce required). `POST /agent/gateway-mint` is the deprecated old path and always returns `410`.
- `GET /healthz` → Gateway balance, last-payment timestamp, LLM reachability. **Not HMAC-protected** — must be reachable by external monitors.

---

## Agent decision logic (build exactly)

**Reader Agent — four gates, short-circuit on first hard fail:**
- **Gate 1 Budget (deterministic, no LLM):** fail if `spent_today + price > daily_budget` OR `spent_session + price > session_budget`. On fail return `declined / reason: "budget_exceeded"` before any LLM call.
- **Gates 2–4 Quality / Interest / Confidence (one Groq call):** strict-JSON output `{ quality: 0-1, interest: 0-1, confidence: 0-100, reason }`, no prose. Inputs: article `title`/`excerpt`/`topics`/`price_atomic` + reader's last ~20 telemetry rows summarized to topics + avg dwell.
- **Decision rule (deterministic, after LLM):** pay IFF `budget_ok AND quality ≥ QUALITY_MIN (0.5) AND interest ≥ INTEREST_MIN (0.5) AND confidence ≥ CONFIDENCE_MIN (80)`. Thresholds env-configurable.
- **Mock mode:** if `GROQ_API_KEY` unset, return deterministic stubs (`quality 0.7, interest 0.7, confidence 85`) so the pay loop is testable without Groq.

**Watcher — hourly per active article, on AUDITED counts only:**
```
demand = W_VIEWS*norm(views_24h) + W_DWELL*norm(avg_dwell_24h) + W_TIPS*norm(tips_24h)
```
The demand signals above are context, not a hard target. One Groq call judges the actual
hourly move: strict-JSON `{ move_pct: -5..5, reason }`, given the signals plus what a naive
demand-only formula would have implied (a reference point, not a target). The returned
`move_pct` is hard-clamped to `±PRICE_MAX_HOURLY_MOVE_PCT` (default 0.05, i.e. ±5%/hr)
regardless of what the model says — never trust LLM output unbounded.
```
new_price = clamp(round(prev * (1 + move_pct/100)), PRICE_MIN_ATOMIC, PRICE_MAX_ATOMIC)
```
**Mock mode:** if `GROQ_API_KEY` unset, `move_pct` is derived from the naive formula above,
clamped to ±5% — same fallback pattern as the Reader Agent gates.
Normalization uses 7-day rolling medians across all articles. Write `articles.current_price_atomic`; append `price_history` with the normalized inputs plus `llm_move_pct`/`llm_reason` as `reason`. `current_price` is what the seller route reads for `PAYMENT-REQUIRED`.

**Creator Audit Agent — runs before Watcher consumes telemetry:**
1. Deterministic pre-filter: drop view if `dwell_ms < 1500`; same `reader_id` on same `article_id` > N/hr (default 3); self-tip from creator wallet; flag per-IP/reader z-score spikes.
2. LLM judgment for statistical outliers: send access *pattern* to Groq, get `{ authentic_fraction: 0-1, reason }`. Watcher scales raw counts by `authentic_fraction`.

Output is **audited counts** (`telemetry_audited`) — the Watcher never reads raw counts.

---

## Datastore (Postgres / Supabase)

Migrations live in `agents/supabase/migrations/` — apply with `npx supabase db push` from `agents/`.

- `creators` (user_id, circle_wallet_id, eoa_address, ghost_url, ghost_key_enc)
- `readers` (user_id, daily_budget_atomic bigint, session_budget_atomic bigint, spent_today_atomic bigint, spent_session_atomic bigint, session_reset_at)
- `articles` (slug, creator_id, base_price_atomic bigint, current_price_atomic bigint, ghost_post_id, topics text[])
- `telemetry` (article_id, reader_id, event_type, dwell_ms, ip_hash, ts)
- `telemetry_audited` (article_slug, window_start, views, avg_dwell_ms, tips_atomic, authentic_fraction) — Watcher reads this
- `payment_events` (endpoint, payer, amount_usdc text [atomic string], network, gateway_tx, reader_id, article_slug, request_id, raw) — append-only, RLS
- `withdrawals` (amount_atomic bigint, destination_chain, destination_address, status, tx_hash)
- `price_history` (article_slug, price_atomic bigint, reason jsonb, ts)

Stored procedures: `record_reader_spend(p_user_id, p_amount)`, `reset_daily_budgets()` (called at midnight UTC by the agent).

---

## Stack

- Frontend + x402 seller: Next.js on Vercel.
- Agents: Node/TS on EC2, systemd (`Restart=always`, `MemoryMax=500M`).
- Buyer signing (x402): `viem` + `@circle-fin/x402-batching` (raw `BUYER_PRIVATE_KEY`).
- Creator payout: `contracts/src/ContentVault.sol` (`withdraw`/`withdrawAll`/`withdrawSigned`) + `@circle-fin/user-controlled-wallets` (creator's UCW wallet signs the EIP-712 `Withdraw` message via `signTypedData`).
- LLM: Groq, OpenAI-compatible (`GROQ_BASE_URL`/`GROQ_MODEL`). No key → mock mode.
- State: Supabase Postgres. Cross-chain payout: **CCTP V2** (V1 is legacy).

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
payTo <creator EOA>, maxTimeoutSeconds 345600,
extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: GATEWAY_WALLET_ADDRESS }
```

---

## Startup assertions (every service, fail fast)

1. `USDC.decimals() === 6`.
2. chain id `5042002`.
3. On EC2: `BUYER_PRIVATE_KEY` present **and** `SELLER_PRIVATE_KEY` absent.
4. `INTERNAL_HMAC_SECRET` present on both Vercel and EC2.

Assertions 1–2 are skipped in mock mode (when `GROQ_API_KEY` is unset) but should still run in production. `CONTENT_TUNER_PRIVATE_KEY` and `CONTENT_FACTORY_ADDRESS` should also be present on EC2 in live payment mode (required for content-contract creation, price tuning, and relayed withdrawals) — `agents/src/config.ts`'s `validateAgentConfig()` enforces this.

---

## Ghost integration

`web/public/cresc-ghost.js` is a self-contained ~2KB snippet injected into Ghost sites via Code Injection → **Site Header** (not Footer — a footer script only runs after the browser has already painted the full article, causing a flash of unpaywalled content). It:
1. Synchronously injects a `<style>` cloak (`max-height:300px;overflow:hidden`) on the content selectors before first paint, so paid content is never visible even momentarily.
2. Checks `GET /api/ghost/post-status?site=<creatorId>&slug=<slug>` on every Ghost page load.
3. If not paywalled, removes the cloak. If paywalled, replaces it with a styled clip + gradient overlay once the DOM is ready.
4. Shows an "Unlock for $X →" button linking to `/read?slug=<slug>`.

Ghost sends `post.published` / `post.updated` / `post.deleted` webhooks directly to EC2's `POST /agent/ghost/webhook?site=<creatorId>` (validated against that creator's own `ghost_webhook_secret` DB column, not a global env var); `web/app/api/ghost/sync/route.ts` is a compat proxy for old webhook URLs only. Upserts into `articles` and, live, deploys/registers the post's `ContentVault`. Creator onboarding happens at `/ghost-onboard`.

---

## EC2 production hygiene

- State lives in Postgres/Gateway, never process memory — a restart loses nothing. Only in-memory state is the redeposit timer; on boot, re-read Gateway balance and resume the loop.
- Redeposit loop self-heals (~30s interval, top up below threshold), survives restarts, tolerates in-flight funder transfers (nonce-retry).
- Graceful shutdown: trap SIGTERM, stop accepting new `evaluate-and-pay`, drain in-flight payments, then close — prevents a half-signed authorization on deploy.
- Single GatewayClient instance must be shared across all routes — two instances on the same private key cause nonce collisions.

---

## Resolved architecture decisions

These were open in `cresc-architecture.md §12`; they are now decided:

- **Auth provider:** wallet-based (RainbowKit/wagmi on Arc Testnet). No Supabase Auth or Clerk. `user_id` = wallet address.
- **Ghost gate mechanism:** theme snippet (`web/public/cresc-ghost.js`) injected via Ghost Code Injection.
- **`unlock_token` exchange:** HMAC-signed string `${expiry}:${site}:${slug}:${readerId}:${sig}`, 1-hour TTL, verified server-side by the x402 route.
- **Rolling-median window:** 7 days (hardcoded in `agents/src/workers/watcher.ts`).

---

## Working conventions

- TypeScript everywhere. Strict mode. No `any` on money or signing paths.
- Money helpers in `web/lib/money.ts` and `agents/src/money.ts` (kept in sync). Never inline atomic↔display or erc20↔native conversions.
- The two `config.ts` files (`web/lib/config.ts`, `agents/src/config.ts`) are the single source of truth for env var names. Comments in both files say "keep-in-sync."
- HMAC helpers: `web/lib/hmac.ts` (builds + verifies), `agents/src/middleware/hmac.ts` (Express middleware). Both use the same algorithm — changes to one require a matching change in the other.
- Log every agent decision (gate scores + outcome) — it is both observability and traction evidence.
- After changing any signing path, re-verify the four startup assertions still hold.
