# CLAUDE.md — Cresc

Pay-per-article monetization for Ghost, settled in USDC on **Arc** via Circle Nanopayments (Gateway + x402). Next.js frontend on **Vercel**, always-on agents on **EC2**, Circle Gateway for settlement.

This file is the standing context for working on this repo. Read it before every task. The full design lives in `cresc-architecture.md` — when this file and the architecture doc disagree, the architecture doc wins; flag the conflict instead of guessing.

---

## Non-negotiable invariants

These cause silent, expensive bugs if violated. Treat them as hard constraints, not suggestions.

1. **The x402 buyer is a raw-key EOA. Forced by `ecrecover`.** Gateway verifies payment signatures offchain with `ecrecover`, which cannot recover an SCA's EIP-1271 signature, so SCA wallets are rejected for nanopayments. There is no Circle-Wallets-SDK substitute for the buyer pay path. `BUYER_PRIVATE_KEY` is the **only** live raw key in the system, and it lives **only on EC2**.

2. **The creator/seller is a Circle dev-controlled wallet — no raw key.** The seller never signs an x402 authorization; on the read path it only *verifies and settles* via the facilitator API (keyless). A creator signs exactly once: **withdrawal**, via Circle SDK `signTypedData` on a Gateway burn intent. `SELLER_PRIVATE_KEY` staying **empty is correct** — do not "fix" it.

3. **There is no "EIP-719."** Buyer-pay = **EIP-3009** (transfer-with-authorization). Gateway transfer/withdraw = **EIP-712 `BurnIntent`** against domain `{ name: "GatewayWallet", version: "1" }`. The "Hits X402" step is a `402 Payment Required` carrying a base64 `PAYMENT-REQUIRED` header.

4. **Money is atomic 6dp integers, end to end.** Every money column is `bigint` (or `numeric(78,0)`) storing atomic USDC. `$0.05 = 50000`. Never a float, never dollars in storage. Convert dollars→atomic only at ingest (`Math.round(dollars * 1e6)`) and atomic→display only at the UI edge. The reference repo's `payment_events.amount_usdc` is `text` — keep it `text` to match the schema, but treat it as an atomic-integer string.

5. **Arc USDC is one token, two interfaces — not two tokens.** ERC-20 (6dp) for everything the app touches (x402 amounts, transfers, prices, displayed balances). Native (18dp) **only** for gas/fee accounting. Conversion is exactly `×10^12` (native = erc20 × 1e12). Always read `decimals()` and **assert it is 6 at startup**. The classic bug is mixing an 18dp native figure into a 6dp ERC-20 amount — off by 10^12. Gas and spendable USDC are the same balance; one top-up funds both.

6. **`ARC_RPC_URL` is a secret.** EC2 env + Vercel encrypted env only. **Never** in any `NEXT_PUBLIC_*` var, never client-side.

7. **Single writer for the buyer nonce.** Run exactly **one** Reader Agent instance against the shared buyer key. Two instances signing from the same EOA collide on nonces. To scale, shard readers across keys or serialize signing — never naively run two copies.

8. **`payment_events` is append-only.** RLS: public read, service-role insert. It is the transparent dashboard's source of truth.

9. **Idempotency.** Key each unlock attempt by `(reader_id, article_slug, request_id)`; check `payment_events` before signing; a settled row means already-paid. A mid-payment crash must not double-pay.

---

## Architecture in one screen

Three planes, two deploy targets, one settlement rail.

- **Creator (writer):** Circle dev-controlled wallet, one per creator. Signs via Circle SDK (`signTypedData`) — payout only. UI on Vercel, payout on EC2.
- **Reader (+ Reader Agent):** one shared raw-key EOA + per-reader budget rows in Postgres. Signs via `GatewayClient({ privateKey })`. Always-on, EC2.
- **Settlement:** Circle Gateway on Arc batches EIP-3009 authorizations into one onchain USDC settlement.

**Vercel** (stateless, no hot keys): creator dashboard, Ghost content gate, x402 unlock route (`withGateway` → facilitator `verify`/`settle`), Ghost webhook intake + HMAC internal API.

**EC2** (always-on, holds the one raw key + Circle entity secret): Reader Agent HTTP service + redeposit loop, Watcher worker (hourly repricing), Creator Audit Agent worker, both signing paths (buyer x402 raw key; creator withdrawal Circle SDK). PM2/systemd, `Restart=always`, `max_memory_restart` ~500M.

---

## Vercel ↔ EC2 boundary (build exactly)

HTTP, not a queue. Reader Agent runs Express/Fastify; Vercel calls synchronously. No public agent port — security group admits only Vercel egress + your IP.

**Auth on every internal call (both directions):**
- `X-Cresc-Timestamp`: unix seconds (reject if skew > 300s).
- `X-Cresc-Signature`: `hex(hmacSHA256(INTERNAL_HMAC_SECRET, \`${timestamp}.${rawBody}\`))`.
- Recompute over the **raw** body, constant-time compare. Reject missing/expired/mismatched with `401`.

**Endpoints (EC2, called by Vercel):**
- `POST /agent/evaluate-and-pay` → `{ decision: paid|declined|error, gates, payment?, unlock_token?, reason?, error? }`. `paid`/`declined` both return `200`; `error` returns `502`.
- `POST /agent/tip` → budget-gate only, second `pay()` to creator EOA.
- `POST /agent/withdraw` → Circle burn-intent withdrawal (the one creator-signing path; stays on EC2 for the entity secret).
- `GET /healthz` → Gateway balance, last-payment timestamp, LLM reachability.

**Callback (Vercel, optional v1):** `POST /internal/telemetry`. Direct Postgres insert + Supabase realtime is enough for v1.

---

## Agent decision logic (build exactly)

**Reader Agent — four gates, short-circuit on first hard fail:**
- **Gate 1 Budget (deterministic, no LLM):** fail if `spent_today + price > daily_budget` OR `spent_session + price > session_budget`. On fail return `declined / reason: "budget_exceeded"` before any LLM call.
- **Gates 2–4 Quality / Interest / Confidence (one Groq call):** strict-JSON output `{ quality: 0-1, interest: 0-1, confidence: 0-100, reason }`, no prose. Inputs: article `title`/`excerpt`/`topics`/`price_atomic` + reader's last ~20 telemetry rows summarized to topics + avg dwell.
- **Decision rule (deterministic, after LLM):** pay IFF `budget_ok AND quality ≥ QUALITY_MIN (0.5) AND interest ≥ INTEREST_MIN (0.5) AND confidence ≥ CONFIDENCE_MIN (80)`. Thresholds env-configurable.
- **Build thresholded first, then widen the model's latitude** — the agency score rewards the model genuinely deciding. Log every decision (gate scores + outcome).
- **Mock mode:** if `LLM_API_KEY` unset, return deterministic stubs (`quality 0.7, interest 0.7, confidence 85`) so the pay loop is testable without Groq.

**Watcher — hourly per active article, on AUDITED counts only:**
```
demand = W_VIEWS*norm(views_24h) + W_DWELL*norm(avg_dwell_24h) + W_TIPS*norm(tips_24h)
target = round(base_price_atomic * (0.5 + demand))
new_price = clamp(target, PRICE_MIN_ATOMIC, PRICE_MAX_ATOMIC)
new_price = clamp(new_price, prev*0.8, prev*1.2)   # ±20%/hr volatility damp
```
Write `articles.current_price_atomic`; append `price_history` with the three normalized inputs as `reason`. `current_price` is what the seller route reads for `PAYMENT-REQUIRED`.

**Creator Audit Agent — runs before Watcher consumes telemetry:**
1. Deterministic pre-filter: drop view if `dwell_ms < 1500`; same `reader_id` on same `article_id` > N/hr (default 3); self-tip from creator wallet; flag per-IP/reader z-score spikes.
2. LLM judgment for statistical outliers: send access *pattern* to Groq, get `{ authentic_fraction: 0-1, reason }`. Watcher scales raw counts by `authentic_fraction`.

Output is **audited counts** (`telemetry_audited`) — the Watcher never reads raw counts.

---

## Datastore (Postgres / Supabase)

- `creators` (user_id, circle_wallet_id, eoa_address, ghost_url, ghost_key_enc)
- `readers` (user_id, daily_budget_atomic bigint, session_budget_atomic bigint, spent_today_atomic bigint, spent_session_atomic bigint, session_reset_at)
- `articles` (slug, creator_id, base_price_atomic bigint, current_price_atomic bigint, ghost_post_id, topics text[])
- `telemetry` (article_id, reader_id, event_type, dwell_ms, ip_hash, ts)
- `telemetry_audited` (article_id, window_start, views, avg_dwell_ms, tips_atomic, authentic_fraction) — Watcher reads this
- `payment_events` (endpoint, payer, amount_usdc text [atomic string], network, gateway_tx, raw) — append-only, RLS
- `withdrawals` (amount_atomic bigint, destination_chain, destination_address, status, tx_hash)
- `price_history` (article_id, price_atomic bigint, reason jsonb, ts)

S3: unlocked rendered content (served post-settlement) + raw telemetry/log archives the Audit Agent reasons over.

---

## Stack

- Frontend + x402 seller: Next.js on Vercel.
- Agents: Node/TS on EC2, PM2/systemd.
- Buyer signing (x402): `viem` + `@circle-fin/x402-batching` (raw `BUYER_PRIVATE_KEY`).
- Creator wallets + payout: `@circle-fin/developer-controlled-wallets` (`signTypedData` + `createContractExecutionTransaction`).
- LLM: Groq, OpenAI-compatible (`LLM_BASE_URL`/`LLM_MODEL`). No key → mock mode.
- State: Supabase Postgres. Blobs: S3. Cross-chain payout: **CCTP V2** (V1 is legacy).

---

## Arc Testnet constants (read from env, don't hardcode blindly)

```
ARC_CHAIN_ID / CAIP-2:  5042002 / eip155:5042002
ARC_SDK_CHAIN:          arcTestnet
USDC (ERC-20):          0x3600000000000000000000000000000000000000  (call decimals() — assert 6)
Gateway Wallet:         0x0077777d7EBA4688BDeF3E311b846F25870A19B9   (EIP-3009 verifyingContract)
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

---

## EC2 production hygiene

- State lives in Postgres/Gateway, never process memory — a restart loses nothing. Only in-memory state is the redeposit timer; on boot, re-read Gateway balance and resume the loop.
- Redeposit loop self-heals (~30s interval, top up below threshold), survives restarts, tolerates in-flight funder transfers (nonce-retry).
- Graceful shutdown: trap SIGTERM, stop accepting new `evaluate-and-pay`, drain in-flight payments, then close — prevents a half-signed authorization on deploy.

---

## Decisions you must make first — do NOT invent (see arch §12)

Stop and ask / decide explicitly before building anything that depends on these:
- **Auth provider** for creator/reader login (Supabase Auth, Clerk, …). The design assumes a `user_id` exists.
- **Ghost gate mechanism**: official plugin vs theme snippet vs proxy. Affects how the unlock route is invoked.
- **`unlock_token` exchange**: how Vercel turns the agent's token into served content. Default suggestion: short-TTL signed JWT — confirm before building.
- **Rolling-median window** for Watcher `norm()`: 7-day default; adjust to data volume.

---

## Working conventions

- Read `cresc-architecture.md` and the relevant section before implementing a component. Section refs (e.g. §2a, §5a) are the contract.
- TypeScript everywhere. Strict mode. No `any` on money or signing paths.
- Money helpers in one module (`atomic <-> dollars`, `erc20 <-> native ×10^12`). Never inline these conversions.
- Use the installed skills (Circle `use-gateway`, `use-arc`, nanopayments buyer quickstart, `transfer-evm-circle-wallet`, `transfer-evm-delegate`) as the source of truth for SDK call shapes. When a reference and your memory disagree, the reference wins.
- Match the reference `arc-nanopayments` schema and patterns where they exist (auto-redeposit, spend limits, nonce-retry, mock fallback). Adapt the global `--limit` to per-`reader_id`.
- Env var names matter exactly (note: your env's `ENTITY_SECRET` → the Circle SDK expects `CIRCLE_ENTITY_SECRET`). Never put secrets in `NEXT_PUBLIC_*`.
- Log agent decisions (gate scores + outcome) — it is both observability and traction evidence.
- After changing a signing path, re-verify the four startup assertions still hold.

## Build order (see PLAN.md for detail)

1. Rail first — one hardcoded article unlocking via `withGateway` + `GatewayClient`; prove a sub-cent payment settles on Arc testnet.
2. Ghost ingest — webhook → Postgres → dynamic slug-keyed unlock route.
3. Creator wallets — provision dev-controlled wallets, `payTo` = creator address, dashboard + EC2 withdraw.
4. Reader Agent — shared buyer EOA, per-reader budget, four gates (thresholded → Groq), tip flow.
5. Watcher + Audit Agent — telemetry loop, hourly repricing, bot filtering.
6. Polish + traction — onboard real writers and readers.
