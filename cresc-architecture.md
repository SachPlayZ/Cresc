# Cresc — End-to-End Architecture

*Pay-per-article monetization for Ghost, settled in USDC on Arc via Circle Nanopayments (Gateway + x402).*
*Deployment: Next.js frontend on Vercel, always-on agents on EC2, Circle Gateway for settlement.*

This plan maps the whiteboard onto the Circle Agent Stack as it actually ships in `circlefin/arc-nanopayments`, corrected for three hard constraints verified against Circle's live docs and skill references (`use-gateway`, the nanopayments buyer quickstart) and the project's own env file:

- **The x402 buyer MUST be a raw-key EOA — this is not a preference, it's enforced by `ecrecover`.** Circle's nanopayments buyer quickstart states it directly: *"Nanopayments require an EOA wallet. SCA wallets are not supported because Gateway verifies payment signatures offchain using `ecrecover`, which is incompatible with EIP-1271 contract signatures."* The buyer signs an **EIP-3009** authorization with a real private key via `GatewayClient({ privateKey })`. There is no Circle-Wallets-SDK substitute for the buyer pay path. So the reader/buyer wallet holds a raw key; this is why `BUYER_PRIVATE_KEY` must be filled.
- **The creator/seller side does NOT need a raw key, so it stays fully Circle-Wallets-managed.** The seller never signs an x402 authorization — it *verifies and settles* the buyer's via the facilitator API (no key on the read path). The only place a creator signs is **withdrawal/payout**, which is a Gateway burn-intent transfer signed through `client.signTypedData()` in the developer-controlled-wallets SDK (verified in the `transfer-evm-circle-wallet` / delegate references). So `SELLER_PRIVATE_KEY` being empty is *correct* — the seller is a Circle wallet.
- **There is no "EIP-719."** The buyer-pay standard is **EIP-3009** (transfer-with-authorization); the Gateway *transfer/withdraw* path signs an **EIP-712 `BurnIntent`** against domain `{ name: "GatewayWallet", version: "1" }`. The whiteboard's "Hits X402" is the `402 Payment Required` response carrying the base64 `PAYMENT-REQUIRED` header, exactly as `withGateway()` emits it.

---

## 1. System at a glance

Three logical planes, two deployment targets, one settlement rail.

| Plane | Who | Wallet | Signs via | Runs on | Role |
|---|---|---|---|---|---|
| **Creator** | Writers on Ghost | Circle dev-controlled wallet (one per creator) | Circle SDK (`signTypedData`) — payout only | Vercel (UI) + EC2 (payout) | Receive payments, set prices, withdraw |
| **Reader** | Readers + Reader Agent | One shared **raw-key EOA** + per-reader budget in Postgres | `GatewayClient({ privateKey })` — forced by `ecrecover` | EC2 (always-on) | Decide, sign x402 authorizations, tip |
| **Settlement** | Circle Gateway on Arc | Gateway Wallet `0x0077…19B9` / Minter `0x0022…475B` | — | Circle infra | Batch EIP-3009 authorizations → one onchain USDC settlement |

Everything paid clears as a **gas-free, sub-cent USDC nanopayment**: the agent signs offchain, the seller serves instantly, and Gateway nets many authorizations into a single onchain transaction so a $0.05 article is economical to sell.

---

## 2. Deployment topology (Vercel + EC2)

### Vercel — Next.js (stateless, no hot signing keys)

- **Creator dashboard** — earnings, per-article performance, Gateway balance, withdraw button.
- **Ghost content gate / plugin** — intercepts a read, calls the unlock route.
- **x402 unlock route (`withGateway`)** — the seller side. On an unpaid request returns `402` + `PAYMENT-REQUIRED`; on a signed request calls `BatchFacilitatorClient.verify()` then `.settle()`, records the payment, and serves the content. This path uses the facilitator **API**, not a raw key, so Vercel never custodies a private key for the read path.
- **Webhook intake + internal API** — receives Ghost `post.published`, and exposes HMAC-authenticated endpoints that EC2 calls (and that call EC2).

Why the unlock route stays on Vercel: it's stateless request/response and needs no signing key, which fits serverless perfectly and keeps it next to the UI it serves.

### EC2 — always-on agent services (PM2 / systemd)

Everything that **signs** or **runs continuously** lives here, behind a locked security group (only Vercel egress + your IP; agent ports never public).

- **Reader Agent service** — the reason EC2 is needed. Holds the shared buyer EOA's raw key, checks the per-reader budget row, makes the Groq-powered four-gate decision, signs the **EIP-3009** authorization, and calls `GatewayClient.pay()`. Also owns the Gateway deposit/redeposit loop. Ephemeral serverless functions can't safely hold a hot signing key or maintain that loop — hence always-on.
- **Watcher worker** — hourly: pulls audited traction, recomputes the demand signal, updates the article's `current_price`.
- **Creator Audit Agent worker** — filters inflated/bot metrics before they reach the Watcher.
- **Signing layer** — two distinct paths. The **buyer** x402 path uses `viem` + `@circle-fin/x402-batching` with the raw `BUYER_PRIVATE_KEY` (the only raw key in the system). The **creator withdrawal** path uses the Circle developer-controlled-wallets SDK (`signTypedData` + `createContractExecutionTransaction`) — no raw key. Both run on EC2, not Vercel.

The Watcher and Audit Agent don't strictly need to be always-on, but since PM2 is already running them as interval timers in the same process group is simpler than standing up separate cron infrastructure.

### Running the EC2 agent as a 24/7 service

The Reader Agent is a continuously-running service (HTTP server + interval workers in one process), so it needs production-process hygiene, not just `node agent.mts`:

- **Process manager:** PM2 (`pm2 start`, `pm2 save`, `pm2 startup` for boot persistence) or a systemd unit with `Restart=always` and `RestartSec=2`. Crash → auto-restart. Set `max_memory_restart` (e.g. 500M) to recycle on leaks.
- **State lives in Postgres/Gateway, never in process memory.** Budgets, spent totals, and the article→price map are all read from the DB per request, so a restart loses nothing. The only in-memory state is the Gateway redeposit loop's timer — on boot the agent must **re-read the Gateway balance and resume the loop**, not assume it deposited.
- **Idempotency across restarts:** if the process dies mid-payment, the next call must not double-pay. Key each unlock attempt by `(reader_id, article_slug, request_id)` and check `payment_events` before signing; treat a settled row as already-paid.
- **Redeposit loop is self-healing:** the balance-check interval (every ~30s, from the reference) tops up Gateway when it drops below threshold. This must survive restarts and tolerate the funder transfer being in-flight (the reference's nonce-retry handles concurrent signing).
- **Health + observability:** expose `GET /healthz` (returns Gateway balance, last-payment timestamp, LLM reachability) for an uptime check and for the security-group-allowed monitor. Log every decision (gate scores + outcome) — it's also your traction evidence for judging.
- **Graceful shutdown:** trap SIGTERM, stop accepting new `evaluate-and-pay` calls, let in-flight payments settle (the reference drains `inFlight` before exit), then close. Prevents a half-signed authorization on deploy.
- **Single writer for the buyer nonce:** run **one** Reader Agent instance against the shared buyer key. Two instances signing from the same EOA will collide on nonces. If you need to scale, shard readers across keys or serialize signing — don't naively run two copies.

### The Vercel ↔ EC2 boundary

Vercel calls EC2 ("reader X wants article Y — decide and pay") and EC2 writes results back. Sign these internal calls with an **HMAC shared secret** and lock the EC2 security group. Never expose the signing service publicly. The keyed `ARC_RPC_URL` token is a secret: it lives in EC2's env and Vercel's encrypted env vars only — never in any `NEXT_PUBLIC_*` var, never client-side.

---

## 2a. Interface contract — Vercel ↔ EC2 (build this exactly)

**Decision: HTTP endpoint, not a queue.** The Reader Agent on EC2 runs an HTTP server (Express/Fastify); Vercel calls it synchronously per unlock. Rationale: simpler to build and test than a polling queue, and the security concern (no public port) is met by HMAC auth + a security group that only admits Vercel's egress IP range and your own. *(If you later want zero inbound ports, swap to a Postgres-backed job queue the agent polls — but build the HTTP version first.)*

### Auth scheme (both directions)

Every internal call carries two headers:
- `X-Cresc-Timestamp`: unix seconds (reject if skew > 300s).
- `X-Cresc-Signature`: `hex(hmacSHA256(INTERNAL_HMAC_SECRET, \`${timestamp}.${rawBody}\`))`.

Receiver recomputes over the raw body and constant-time-compares. `INTERNAL_HMAC_SECRET` is a shared env var on both Vercel and EC2. Reject on missing/expired/mismatched signature with `401`.

### Endpoint: `POST /agent/evaluate-and-pay` (EC2, called by Vercel)

Request body:
```json
{
  "reader_id": "uuid",
  "article": {
    "slug": "my-post",
    "unlock_url": "https://<vercel-app>/api/unlock/my-post",
    "price_atomic": "50000",
    "creator_wallet": "0x…",
    "title": "…",
    "excerpt": "…first 500 chars for the quality gate…",
    "topics": ["ai", "payments"]
  }
}
```

Success response (`200`):
```json
{
  "decision": "paid",
  "gates": { "budget": true, "quality": 0.82, "interest": 0.74, "confidence": 88 },
  "payment": { "tx": "0x…", "amount_atomic": "50000", "settled_at": "ISO-8601" },
  "unlock_token": "opaque-token-vercel-exchanges-for-content"
}
```

Declined response (also `200` — a decline is a valid outcome, not an error):
```json
{
  "decision": "declined",
  "gates": { "budget": false, "quality": 0.4, "interest": 0.3, "confidence": 41 },
  "reason": "below_confidence_threshold"
}
```

`decision` ∈ `paid | declined | error`. On `error`, include `error: string` and return `502`. Vercel: on `paid`, serve content and exchange `unlock_token`; on `declined`, show the decline reason / signup-topup prompt; on `error`, surface a retry.

### Endpoint: `POST /agent/tip` (EC2, called by Vercel at session end)

Request: `{ "reader_id", "creator_wallet", "amount_atomic" }`. Same gate/budget check (budget only), then a second `pay()` to the creator. Returns the same `payment` shape.

### Endpoint: `POST /agent/withdraw` (EC2, called by Vercel from the dashboard)

Request: `{ "creator_id", "amount_atomic", "destination_chain", "destination_address" }`. Runs the Circle-SDK burn-intent withdrawal (§3, creator side). Returns `{ "status", "tx_hash", "destination_chain" }`. This is the one creator-signing path and it stays on EC2 because it touches the Circle entity secret.

### Callback: `POST /internal/telemetry` (Vercel, called by EC2 or written direct)

Telemetry can be written straight to Postgres by either side; if EC2 needs Vercel to emit a server-sent event to the live dashboard, it posts `{ "article_id", "reader_id", "event_type", "dwell_ms" }` here. Optional for v1 — direct Postgres insert + Supabase realtime is enough.

---

## 3. Wallet model (verified: raw-key buyer, Circle-Wallets seller)

The single most important correction in this plan. The two sides of the marketplace have *different* signing requirements, so they use *different* wallet types — and your env file's mix of Circle credentials and (empty) private keys is exactly right once split this way.

### Reader / buyer → one shared raw-key EOA (mandatory)

The x402 buyer **must** hold a raw private key. Circle's nanopayments buyer quickstart is explicit: Gateway verifies the payment signature offchain with `ecrecover`, which only recovers a plain ECDSA (EOA) signature — an SCA's EIP-1271 contract signature can't be recovered this way, so SCA wallets are rejected for nanopayments. The Circle developer-controlled-wallets SDK has **no** substitute call for the x402 pay path. So:

- A single well-funded **raw-key EOA** is the buyer. `GatewayClient({ chain: "arcTestnet", privateKey: BUYER_PRIVATE_KEY })` deposits once and signs every `pay()`.
- **`BUYER_PRIVATE_KEY` is the one field you must fill** (run `generate-wallets`, or `privateKeyToAccount` once).
- Budget is enforced **per `reader_id` in Postgres** (daily cap, session cap, spent-so-far) — the reference `agent.mts` `--limit` mechanism, keyed by reader instead of global. `READER_KEY_SECRET` protects that one key, not one-per-user.

Why shared rather than per-reader: per-reader EOAs would mean N raw keys, N Gateway deposits, and N redeposit loops for readers spending fractions of a cent. Pooled custody is the right hackathon call.

> **Honest limitation to state in the writeup:** this is pooled custody, not true reader self-custody. The production path is per-reader user-controlled wallets — but note those *still* can't pay x402 directly (ecrecover), so production would route reader payments through a per-reader EOA or a session-key delegate, not the embedded SCA itself.

### Creator / seller → Circle dev-controlled wallet (no raw key)

The seller never signs an x402 authorization — on the read path it only *verifies and settles* the buyer's signature via the facilitator API, which needs no key. The one time a creator signs is **withdrawal/payout**, and that's a Gateway burn-intent transfer, which the Circle SDK signs for you. So creators are fully Circle-Wallets-managed:

- Provision one dev-controlled wallet per creator via `@circle-fin/developer-controlled-wallets` (`CIRCLE_API_KEY` + `ENTITY_SECRET` + `CIRCLE_WALLET_SET_ID`). The wallet address is the `payTo` in that creator's x402 requirements.
- **Withdraw / payout** (EC2): build the EIP-712 `BurnIntent`, sign with `client.signTypedData({ walletAddress, blockchain: "ARC-TESTNET", data })`, POST to `gateway-api-testnet.circle.com/v1/transfer` for an attestation, then `client.createContractExecutionTransaction(... gatewayMint(bytes,bytes) ...)` on the destination chain. Verified against the `transfer-evm-circle-wallet` reference.
- **`SELLER_PRIVATE_KEY` stays empty — that's correct.** The seller is a Circle wallet; the raw-key field belongs to the other (self-managed) model you're not using on this side.

> If a creator wallet is provisioned as an SCA, Gateway withdrawal needs an **EOA delegate** added on the source chain (set `sourceDepositor` = SCA, `sourceSigner` = delegate EOA), per the `transfer-evm-delegate` reference. Simplest to provision creator wallets as EOAs through Circle and skip the delegate entirely.

---

## 4. The two core flows

### Flow A — Creator onboarding & content monetization

1. **Sign up.** Creator authenticates; Cresc provisions a Circle dev-controlled wallet via `@circle-fin/developer-controlled-wallets`, linked to their `userId`.
2. **Connect Ghost.** Creator supplies their Ghost **Admin API URL + API key** (stored encrypted). Cresc registers a `post.published` webhook.
3. **Wallet = payout address.** The creator's EOA address becomes `payTo` in the article's x402 requirements.
4. **Post published → Watcher attaches.** On each webhook, Cresc records the post + creator mapping, assigns a **base price ($0.05)**, and the Watcher begins tracking it.
5. **Dynamic pricing loop.** The Watcher tracks audited traction (views, dwell, tips) and hourly updates `current_price`. The Creator Audit Agent filters bot/inflated metrics first, so a botted spike can't pump the price.
6. **Dashboard + withdraw.** Creator sees earnings and Gateway balance, and withdraws to any supported chain (CCTP V2 cross-chain).

### Flow B — Reader access & payment

1. **Reader opens a Ghost article.** The Cresc gate/plugin intercepts the read and calls the Vercel unlock route.
2. **New reader →** prompted to sign up + (testnet) is covered by the shared buyer balance; a budget row is created.
3. **Existing reader →** Vercel forwards the request to the EC2 Reader Agent, which evaluates four gates:
   - **Budget** — within the reader's daily/session cap (Postgres),
   - **Content quality** — is the article worth the price,
   - **Interest alignment** — matches the reader's reading patterns,
   - **Confidence ≥ 80** — combined score threshold (Groq LLM call).
4. **All gates pass → pay.** Request hits the x402 route, gets `402`, the agent signs the **EIP-3009** authorization for the article price, retries with `PAYMENT-SIGNATURE`, Gateway settles, content unlocks.
5. **Telemetry in background.** View + dwell stream to Postgres (and raw logs to S3), feeding the Watcher.
6. **Session ends → tip prompt.** Optional second nanopayment straight to the creator's EOA.

---

## 5. The payment rail (grounded in the reference repo + your env)

**Arc Testnet constants** (from your env — read, don't hardcode blindly):

```
ARC_CHAIN_ID / CAIP-2:  5042002  /  eip155:5042002
ARC_SDK_CHAIN:          arcTestnet
USDC (ERC-20):          0x3600000000000000000000000000000000000000   (call decimals() — 6)
EURC (optional):        0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a
Gateway Wallet:         0x0077777d7EBA4688BDeF3E311b846F25870A19B9    (EIP-3009 verifyingContract, domain 26)
Gateway Minter:         0x0022222ABE238Cc2C7Bb1f21003F0a260052475B    (withdraw / mint)
Facilitator API:        https://gateway-api-testnet.circle.com
RPC (keyed, secret):    ARC_RPC_URL  — server-side only
```

> **Arc's USDC is one token with two interfaces — not two tokens (verified against Arc docs + Circle `use-arc` skill).** The native balance (18dp, used for gas) and the ERC-20 balance (6dp, used for app logic) are the *same* USDC, held in parity by an Arc precompile automatically — you never reconcile them. Rules: (1) **use the ERC-20 interface (6dp) for everything the app touches** — x402 amounts, transfers, prices, displayed balances; (2) the **native interface (18dp) is only for gas/fee accounting** (`getBalance`, fee estimation); (3) the conversion between them is exactly `×10^12` (native = erc20 × 1e12); (4) **always read `decimals()`** rather than hardcoding, and assert it's 6 at startup. Because gas is paid in the same USDC, "fund the buyer wallet" and "give it gas" are a single top-up — one balance covers both. The classic bug is feeding an 18dp native figure into a 6dp ERC-20 amount (or vice-versa); a wrong conversion is off by 10^12.

**Seller side (Vercel unlock route).** Wrap each article-unlock route with Gateway middleware; price is per-article and dynamic.

```ts
// withGateway() pattern from lib/x402.ts
export const GET = withGateway(unlockHandler, articlePrice, `/api/unlock/${slug}`);
// No PAYMENT-SIGNATURE  -> 402 + base64 PAYMENT-REQUIRED (accepts[] with Gateway "extra")
// Signature present      -> facilitator.verify() then facilitator.settle() -> serve
```

Payment requirements use the Gateway batching `extra` block:

```
scheme: "exact", network: ARC_CAIP2, asset: USDC, amount (atomic, 6dp),
payTo: <creator EOA>, maxTimeoutSeconds: 345600,
extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: GATEWAY_WALLET_ADDRESS }
```

**Buyer side (EC2 Reader Agent).** `GatewayClient` from `@circle-fin/x402-batching/client`, signing with the shared buyer EOA key:

```ts
const gateway = new GatewayClient({ chain: "arcTestnet", privateKey: BUYER_PRIVATE_KEY });
await gateway.deposit("1");                              // one-time USDC deposit into Gateway
const res = await gateway.pay(unlockUrl, { method: "GET" });  // signs EIP-3009 + retries
```

Copy the reference agent's production touches: **auto-redeposit** below a threshold, **spend limits** (now per `reader_id`), and **nonce-retry** for concurrent signing. The "Upholds Budget" gate is this `--limit` mechanism.

**Withdrawals (creator, on EC2).** `gateway.withdraw(amount, { chain, recipient })`. Same-chain (Arc) or cross-chain via **CCTP V2** (docs flag V1 as legacy). Record each as a `withdrawals` row (`submitted -> confirmed/failed`). Cross-chain withdrawals need native gas on the destination chain to mint — pre-check it, as the reference withdraw route does.

---

## 5a. Agent specification (build the decisions exactly)

This is the product — don't let it be improvised. All money is **atomic 6dp integers** end to end (see §6 units rule).

### Reader Agent — the four gates

Evaluated in order; **short-circuit on the first hard fail** (cheaper, and no LLM call when the budget already says no).

**Gate 1 — Budget (deterministic, no LLM).** Read the reader's row. Fail if `spent_today + price_atomic > daily_budget_atomic` OR `spent_session + price_atomic > session_budget_atomic`. Pure arithmetic. If this fails, return `declined / reason: "budget_exceeded"` immediately.

**Gates 2–4 — Quality, Interest, Confidence (one Groq call).** A single structured call returns all three, so the model sees the whole picture at once. Inputs: the article `title`, `excerpt`, `topics`, `price_atomic`; and the reader's recent history (last ~20 `telemetry` rows summarized to topics + avg dwell). Output is strict JSON — instruct Groq to return only this, no prose:

```json
{ "quality": 0.0-1.0, "interest": 0.0-1.0, "confidence": 0-100, "reason": "one short clause" }
```

- `quality` — is the content substantive for the price (excerpt coherence, depth signals).
- `interest` — does it align with what this reader actually reads.
- `confidence` — the model's combined certainty that this reader will find it worth the price.

**Decision rule (deterministic, after the LLM):**
```
pay  IFF  budget_ok
     AND  quality   >= QUALITY_MIN     (default 0.5)
     AND  interest  >= INTEREST_MIN     (default 0.5)
     AND  confidence >= CONFIDENCE_MIN  (default 80)
```
Thresholds are env-configurable. **Build thresholded first, then let Groq drive** — the agency score (30%) rewards the model genuinely deciding, so once the loop works, widen the model's latitude (e.g. let it choose to pay slightly below threshold when interest is exceptional, and log why).

**Mock mode:** if `GROQ_API_KEY` is unset, return deterministic stub scores (e.g. `quality 0.7, interest 0.7, confidence 85`) so the pay loop is testable without Groq. Mirrors the reference repo's mock fallback.

### Watcher — the pricing function

Runs hourly per active article. Operates only on **audited** counts (post-filter). Multiplicative demand signal around the base price, clamped:

```
PRICE_MIN_ATOMIC = 10000      # $0.01
PRICE_MAX_ATOMIC = 1000000    # $1.00
W_VIEWS = 0.4 ; W_DWELL = 0.4 ; W_TIPS = 0.2   # env-tunable

# normalize each signal to ~[0,2] vs a rolling 7-day median for that creator
demand = W_VIEWS*norm(views_24h) + W_DWELL*norm(avg_dwell_24h) + W_TIPS*norm(tips_24h)
target = round(base_price_atomic * (0.5 + demand))     # demand 0 -> half base; ~0.75 -> ~base; high -> up
new_price = clamp(target, PRICE_MIN_ATOMIC, PRICE_MAX_ATOMIC)

# damp volatility: move at most ±20% per hour
new_price = clamp(new_price, prev*0.8, prev*1.2)
```
Write `articles.current_price` and append a `price_history` row with the `reason` (the three normalized inputs). `current_price` is what the seller route reads when building `PAYMENT-REQUIRED`.

### Creator Audit Agent — what "filters inflated metrics" means

Runs before the Watcher consumes telemetry. Two layers:

1. **Deterministic pre-filter (cheap, catches the obvious):** drop a view if `dwell_ms < 1500` (bounce), or the same `reader_id` views the same `article_id` more than N times/hour (default 3), or a tip comes from the article's own creator wallet (self-tip). Per-IP/per-reader rate spikes beyond a z-score threshold are flagged.
2. **LLM judgment (the agency surface):** for articles whose 24h traction is a statistical outlier vs the creator's baseline, send the access *pattern* (inter-arrival times, dwell distribution, topic match) to Groq and ask for `{ "authentic_fraction": 0.0-1.0, "reason": "…" }`. The Watcher scales raw counts by `authentic_fraction`. This is what stops a botted spike from pumping `current_price`.

Output of the audit step is the **audited counts** the Watcher reads — never the raw counts.

---

## 6. Components & stack

| Layer | Choice | Why |
|---|---|---|
| Frontend + x402 seller | Next.js on **Vercel** | Stateless, no hot keys, matches reference |
| Agents | Node/TS services on **EC2**, PM2/systemd | Always-on; hold the buyer signing key + redeposit loop |
| Buyer signing (x402) | `viem` + `@circle-fin/x402-batching` (raw `BUYER_PRIVATE_KEY`) | `ecrecover` forces a raw-key EOA — no SDK substitute |
| Creator wallets + payout | **`@circle-fin/developer-controlled-wallets`** (`signTypedData` + `createContractExecutionTransaction`) | No raw key; Circle signs burn intent for withdrawal |
| Groq (agent decisions) | **Groq**, OpenAI-compatible (`GROQ_BASE_URL`/`GROQ_MODEL`) | In your env; fast + cheap for gate calls. Omit key -> deterministic mock mode |
| State | **Supabase** Postgres | Budgets, payments, telemetry, realtime dashboard |
| Blobs | **S3** | Unlocked content, raw telemetry logs |
| Cross-chain payout | **CCTP V2** | Docs flag V1 as legacy |

**Units rule (non-negotiable, prevents the 10^12 bug):** every money column in Postgres is an **atomic 6dp integer stored as `bigint`** (or `numeric(78,0)` if you prefer headroom) — never a float, never dollars. `$0.05` is `50000`. Convert dollars→atomic only at ingest (`Math.round(dollars * 1e6)`) and atomic→display only at the UI edge. The reference repo stores `amount_usdc` as `text`; keep that for the append-only log to match its schema, but treat it as an atomic-integer string. Native gas (18dp) never enters these columns.

**Datastore (Postgres):**
- `creators` (user_id, circle_wallet_id, eoa_address, ghost_url, ghost_key_enc)
- `readers` (user_id, daily_budget_atomic bigint, session_budget_atomic bigint, spent_today_atomic bigint, spent_session_atomic bigint, session_reset_at)
- `articles` (slug, creator_id, base_price_atomic bigint, current_price_atomic bigint, ghost_post_id, topics text[])
- `telemetry` (article_id, reader_id, event_type, dwell_ms, ip_hash, ts)
- `telemetry_audited` (article_id, window_start, views, avg_dwell_ms, tips_atomic, authentic_fraction) — what the Watcher reads
- `payment_events` (endpoint, payer, amount_usdc text [atomic string], network, gateway_tx, raw) — from the reference schema
- `withdrawals` (amount_atomic bigint, destination_chain, destination_address, status, tx_hash)
- `price_history` (article_id, price_atomic bigint, reason jsonb, ts)

**S3:** unlocked rendered content (served after settlement), and raw telemetry/log archives the Audit Agent reasons over.

---

## 7. End-to-end sequence (existing reader, happy path)

```
Reader opens article (Ghost gate, Vercel)
  -> POST /api/unlock/:slug  -> 402 PAYMENT-REQUIRED (price, payTo=creator EOA)
  -> Vercel forwards to EC2 Reader Agent (HMAC-signed)
  -> Agent: budget ok? quality ok? interest aligned? confidence >= 80? (Groq)  -- all yes
  -> Agent signs EIP-3009 (offchain, gasless), retries with PAYMENT-SIGNATURE
  -> Vercel withGateway: facilitator.verify() -> facilitator.settle()
  -> payment_events row inserted; content served from S3; article unlocks
  -> telemetry (view, dwell) -> Postgres + S3
  -> Watcher (EC2, hourly) updates current_price from AUDITED traction
  -> session ends -> tip prompt -> optional second nanopayment to creator EOA
  -> Creator dashboard updates in realtime; withdraw -> EC2 signs -> CCTP V2 cross-chain
```

Gateway nets the session's authorizations into one onchain settlement crediting the creator's Gateway balance.

---

## 8. Build order (2-week window)

1. **Rail first.** Fork the `arc-nanopayments` pattern; one hardcoded article unlocking via `withGateway` (Vercel) + `GatewayClient` (EC2). Prove a sub-cent payment settles on Arc testnet.
2. **Ghost ingest.** `post.published` webhook -> Postgres -> dynamic unlock route keyed by slug.
3. **Creator wallets.** Provision per-creator dev-controlled wallets via `@circle-fin/developer-controlled-wallets`; `payTo` = creator address; dashboard + EC2 withdraw (Circle `signTypedData` burn intent, no raw key).
4. **Reader Agent on EC2.** Shared buyer EOA, per-reader budget, four gates (start thresholded, then let Groq decide — that's the 30% agency score), tip flow.
5. **Watcher + Audit Agent.** Telemetry loop, hourly repricing, bot filtering.
6. **Polish + traction.** Onboard real Ghost writers and real readers — Lepton weighs creators-getting-paid and readers-paying as heavily as the tech.

---

## 9. Security & correctness checklist

- **Buyer must be a raw-key EOA** — x402 verification uses `ecrecover`; SCA/EIP-1271 is rejected. The seller/creator side does not sign x402 and stays Circle-Wallets-managed.
- **Arc USDC = one token, two interfaces.** ERC-20 (6dp) for all app logic / x402 / prices / display; native (18dp) only for gas accounting; convert `×10^12`; always `decimals()` and assert 6 at startup. Gas and spendable USDC are the same balance — one top-up funds both.
- **`ARC_RPC_URL` token is a secret** — EC2 env + Vercel encrypted env only; never `NEXT_PUBLIC_*`.
- **Only `BUYER_PRIVATE_KEY` is a live raw key, and it lives only on EC2.** `SELLER_PRIVATE_KEY` stays empty (seller is a Circle wallet). `READER_KEY_SECRET` protects the shared buyer key. Vercel signs nothing.
- **HMAC the Vercel<->EC2 calls**; lock the EC2 security group to Vercel egress + your IP.
- **Ghost API keys encrypted at rest**; decrypt only in the worker that calls Ghost.
- **`payment_events` append-only** with RLS (public read, service-role insert) for a transparent dashboard.
- **CCTP V2**, not V1; cross-chain withdraw needs destination-chain gas to mint — pre-check.

---

## 10. How this scores against Lepton's rubric

- **Agentic sophistication (30%):** two agents that *decide* — the Reader Agent (pay/skip/tip under budget + interest, via Groq) and the Creator Audit Agent (genuine vs inflated traction -> price).
- **Traction (30%):** built on Ghost (54k-star ecosystem); real writers paid and real readers paying inside two weeks.
- **Circle tool usage (20%):** Wallets API, Gateway + Nanopayments, x402, USDC, CCTP V2 cross-chain withdrawal — the full stack.
- **Innovation (20%):** dynamic per-article pricing driven by *audited* traction — squarely RFB 6, with a novel pricing loop.

---

## 11. Environment variable manifest (per service)

Single source of truth so the two deploy targets agree. **Names matter** — align your `.env` to these exact keys (note `ENTITY_SECRET` → the Circle SDK expects `CIRCLE_ENTITY_SECRET`).

### Shared (both Vercel and EC2)
| Var | Purpose |
|---|---|
| `INTERNAL_HMAC_SECRET` | Signs/verifies all Vercel↔EC2 calls (§2a). |
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side DB writes (payment_events, telemetry). |
| `ARC_CAIP2` = `eip155:5042002` | x402 network id. |
| `USDC_ADDRESS` = `0x3600…0000` | Read `decimals()` at startup; assert 6. |
| `GATEWAY_WALLET_ADDRESS` = `0x0077…19B9` | `verifyingContract` in payment requirements. |

### Vercel only (frontend + seller route — no signing keys)
| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Client reads for the dashboard. |
| `SELLER_FACILITATOR_BASE` = `https://gateway-api-testnet.circle.com` | `BatchFacilitatorClient` verify/settle. |
| `EC2_AGENT_BASE_URL` | Where to reach the Reader Agent. |
| `GHOST_WEBHOOK_SECRET` | Validates inbound `post.published`. |

> The seller route needs the creator `payTo` per article — it reads that from Postgres (`articles.creator_id → creators.eoa_address`), not from env.

### EC2 only (agents — holds the one raw key + Circle entity secret)
| Var | Purpose |
|---|---|
| `ARC_RPC_URL` | Keyed Arc RPC — **secret**, server-side only. |
| `ARC_SDK_CHAIN` = `arcTestnet` | `GatewayClient` chain name. |
| `BUYER_PRIVATE_KEY` | The **only** raw key. Shared buyer EOA for x402 `pay()`. **Fill this.** |
| `READER_KEY_SECRET` | Protects/encrypts the buyer key at rest. |
| `SELLER_PRIVATE_KEY` | **Leave empty** — seller is a Circle wallet. |
| `CIRCLE_API_KEY` | Developer-controlled-wallets SDK. |
| `CIRCLE_ENTITY_SECRET` | (your env's `ENTITY_SECRET`) — SDK auth. |
| `CIRCLE_WALLET_SET_ID` | Wallet set creators are provisioned under. |
| `GATEWAY_MINTER_ADDRESS` = `0x0022…475B` | `gatewayMint` on withdrawal. |
| `GROQ_API_KEY` / `GROQ_BASE_URL` / `GROQ_MODEL` | Groq. Omit `GROQ_API_KEY` → mock mode (§5a). |
| `QUALITY_MIN` / `INTEREST_MIN` / `CONFIDENCE_MIN` | Gate thresholds (defaults 0.5 / 0.5 / 80). |
| `PRICE_MIN_ATOMIC` / `PRICE_MAX_ATOMIC` / `W_VIEWS` / `W_DWELL` / `W_TIPS` | Watcher tuning (§5a). |
| `AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `S3_BUCKET` | Content + log storage. |

### Provisioning / one-time scripts
| Var | Purpose |
|---|---|
| `CIRCLE_SELLER_WALLET_ID` / `CIRCLE_BUYER_WALLET_ID` | Pre-provisioned wallet handles (already in your env). |
| `CIRCLE_SELLER_WALLET_ADDRESS` / `CIRCLE_BUYER_WALLET_ADDRESS` | Their addresses. |
| `EURC_ADDRESS` | Only if multi-currency payout is added. |

**Startup assertions every service should run:** (1) `USDC.decimals() === 6`; (2) chain id `5042002`; (3) on EC2, `BUYER_PRIVATE_KEY` present and `SELLER_PRIVATE_KEY` absent; (4) `INTERNAL_HMAC_SECRET` present on both sides. Fail fast if any is wrong.

---

## 12. Open items Claude Code should NOT invent (decide first)

These are intentionally left to you, not gaps to guess:
- **Auth provider** for creator/reader login (the whiteboard says social sign-in — pick Supabase Auth, Clerk, etc.). The doc assumes a `user_id` exists.
- **Ghost gate mechanism** — official Ghost plugin vs. a theme snippet vs. a proxy. Affects how the unlock route is invoked from a real Ghost site.
- **`unlock_token` exchange** — how Vercel turns the agent's token into served content (signed JWT with short TTL is the suggested default; confirm before building).
- **Rolling-median windows** for the Watcher `norm()` — 7-day default stated; adjust to your data volume.
