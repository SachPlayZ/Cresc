# PLAN.md — Cresc build plan

> Read `CLAUDE.md` first (it has the ground-truth Circle/Arc facts and the agent rules). This file breaks the
> system into **independent modules**, each buildable in its own Claude Code session. Every module lists:
> **Goal · Depends on · Public interface · Tasks · Circle/Arc touchpoints · Definition of Done · "If unsure".**
> Build in the order of the dependency graph (§Build order). Update `PROGRESS.md` at the end of every session.

---

## Service architecture (two repos, one Supabase)

```
┌─────────────────────────────────────────┐   ┌──────────────────────────────────────────┐
│  Cresc/  (Next.js web app)              │   │  Cresc-Agents/  (Node.js worker service) │
│  • Landing page, reader UX, dashboard  │   │  • PricingAgent sweep worker (M5)        │
│  • x402 paywall API routes (M4)        │   │  • ReaderAgent session eval (M6)         │
│  • Behavior telemetry ingest (M2)      │   │  • Tip feedback loop (M7)                │
│  • Tip settle API (M7 settle)          │   │  • Queue consumer (polls jobs table)     │
│  • Circle adapter (M3)                 │   │  • LLM calls live here — never on        │
│  • Job enqueueing → jobs table         │   │    the web read path                     │
└───────────────────┬─────────────────────┘   └──────────────────┬───────────────────────┘
                    │                                              │
                    └──────────────┬ Supabase ┬──────────────────┘
                                   │  (shared) │
                           ┌───────┴───────────┴───────┐
                           │  Postgres DB              │
                           │  • All tables (M1 schema) │
                           │  • jobs queue table       │
                           │  • Realtime channels      │
                           └───────────────────────────┘
```

**Key contracts:**
- Web app NEVER makes LLM calls. Reads `pieces.current_price` (precomputed). Enqueues sweep/eval jobs.
- Agents service NEVER serves HTTP to readers. Reads/writes DB only. Consumes queue, emits decisions.
- Both share the Supabase service-role key. Both share `.env` vars (same secrets file shape).
- Tip settle is synchronous (user waiting) → stays in web API route via Circle adapter.
- Price sweeps and reader evals are async → jobs table → agents service worker.

---

## Queue interface (jobs table — canonical contract between services)

```sql
CREATE TABLE jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL,   -- 'pricing_sweep' | 'reader_eval' | 'tip_feedback'
  payload     jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'pending', -- 'pending' | 'processing' | 'done' | 'failed'
  created_at  timestamptz NOT NULL DEFAULT now(),
  started_at  timestamptz,
  done_at     timestamptz,
  error       text,
  retries     int NOT NULL DEFAULT 0
);
CREATE INDEX jobs_status_created ON jobs(status, created_at);
```

**Job payloads:**
```ts
// kind: 'pricing_sweep'
{ pieceId: string; trigger: 'clock' | 'spike' | 'tip_surplus' }

// kind: 'reader_eval'
{ sessionId: string }

// kind: 'tip_feedback'
{ tipDecisionId: string; surplus: string /* base-units bigint string */ }
```

Web app enqueues by INSERT. Agents service polls `WHERE status='pending' ORDER BY created_at` and
claims rows with `UPDATE ... SET status='processing', started_at=now() WHERE id=? AND status='pending'`
(optimistic lock, no lost jobs). Supabase Realtime NOTIFY on the jobs table wakes the worker fast.

---

## Module dependency graph

```
[WEB]  M0  Scaffold ──┬─► M1 Data layer ──┬─► M2 Behavior tracking
                      │   (shared schema)   ├─► M3 Circle adapter ──► M4 x402 wall (SPINE)
                      │                    │         │
                      │                    │         └─► M4 enqueues → jobs table
                      │                    │                               │
                      └─► M8 Dashboard ◄───┘                               ▼
                                                                  [AGENTS] M0b Agents scaffold
                                                                           ├─► M5 PricingAgent
                                                                           ├─► M6 ReaderAgent
                                                                           └─► M7 Tip feedback
```

**Spine (must work first):** M0 → M1 → M3 → M4 (web), then M0b → M5 minimal (agents). Everything else layers on.

---

## Scoring map

| Axis (weight) | Carried by |
| --- | --- |
| Agentic Sophistication (30%) | **M5 PricingAgent**, **M6 ReaderAgent** — genuine reasoning, reasoning chains |
| Traction (30%) | **M4 unlock + real settlement**, **M9 seeding**, dashboard metrics |
| Circle tooling (20%) | **M3 adapter** (Wallets, Gateway, x402, USDC, Contracts), M4, M7 |
| Innovation (20%) | **M7 tip→price feedback loop** (the emergent behavior), live pricing itself |

---

## [WEB] M0 — Scaffold & config

**Status:** DONE (Next.js 16.2.9, shadcn, recharts, @circle-fin/x402-batching, viem, openai, lib structure).

**What was built:**
- `lib/config.ts` — typed env, isMockMode, all CLAUDE.md §5 vars, Arc constants
- `lib/db.ts` — browser + server Supabase clients
- `lib/money.ts` — UsdcAmount bigint type, fromDisplay/toDisplay/add/sub/cmp/clamp, unit tests pass
- `lib/llm/index.ts` — OpenAI-compat client (Groq), mock mode canned responses
- `lib/circle/index.ts` — stub (M3 fills)
- `lib/repo/index.ts` — stub (M1 fills)
- `scripts/generate-wallets.mts` — EOA pair generator
- `.env.example` — all vars, empty values + comments

**Public interface (what later modules rely on):**
- `lib/config.ts` — `validateServerConfig()`, `validatePaymentConfig()`, `isMockMode`, Arc constants
- `lib/llm/index.ts` — `complete(prompt, { json: true })`
- `lib/db.ts` — `createBrowserClient()`, `createServerClient()`
- `lib/money.ts` — `UsdcAmount`, `fromDisplay`, `toDisplay`, `add`, `sub`, `cmp`, `clamp`, `fromBaseUnits`, `toBaseUnitsString`

---

## [AGENTS] M0b — Agents service scaffold

**Goal.** A standalone Node.js (TypeScript, tsx) worker service at `../Cresc-Agents/` with its own
`package.json`, queue consumer loop, and the same lib/ shape as the web app (config, money, db, llm).

**Depends on.** M0 (for reference), M1 (jobs table must exist before workers run).

**Directory:** `/Users/sachplayz/Projects/Cresc-Agents/`

**Structure:**
```
Cresc-Agents/
├── package.json          (Node.js; deps: tsx, openai, @supabase/supabase-js, @circle-fin/x402-batching, viem)
├── tsconfig.json
├── .env.example          (same shape as Cresc/.env.example)
├── src/
│   ├── config.ts         (same validated env — keep in sync with Cresc/lib/config.ts)
│   ├── db.ts             (Supabase server client only)
│   ├── money.ts          (UsdcAmount — copy from Cresc/lib/money.ts, keep in sync)
│   ├── llm/index.ts      (same LLM adapter — copy from Cresc/lib/llm/)
│   ├── circle/index.ts   (M3 fills this — same interface as Cresc/lib/circle/)
│   ├── queue/
│   │   ├── consumer.ts   (poll+claim loop, Realtime wake, job dispatch)
│   │   └── enqueue.ts    (helper to INSERT jobs — used by agents triggering sweeps)
│   ├── workers/
│   │   ├── pricing.ts    (M5 — handles 'pricing_sweep' jobs)
│   │   ├── reader.ts     (M6 — handles 'reader_eval' jobs)
│   │   └── tipFeedback.ts (M7 — handles 'tip_feedback' jobs)
│   └── index.ts          (entry: init queue consumer, wire workers)
└── README.md
```

**Tasks.**
1. `mkdir /Users/sachplayz/Projects/Cresc-Agents && cd Cresc-Agents && npm init -y`
2. Install: `tsx typescript openai @supabase/supabase-js @circle-fin/x402-batching @x402/core @x402/evm viem`
3. Copy `lib/config.ts`, `lib/money.ts`, `lib/llm/index.ts` from Cresc — add `// keep-in-sync: Cresc/lib/...` comments.
4. Implement `src/queue/consumer.ts`:
   - On start: subscribe to Supabase Realtime INSERT on `jobs` table for wakeup.
   - Poll loop: `SELECT ... WHERE status='pending' LIMIT 5 ORDER BY created_at`.
   - Claim: `UPDATE jobs SET status='processing', started_at=now() WHERE id=? AND status='pending'` returning row (optimistic lock). Skip if 0 rows updated.
   - Dispatch to registered worker by `kind`. On success: UPDATE status='done'. On error: UPDATE status='failed', error=message, retries++.
   - Retry limit: 3. Expose `registerWorker(kind, fn)`.
5. Stub workers in `src/workers/` (return immediately, log "TODO"). M5/M6/M7 will fill them.
6. `src/index.ts` — main entry: `registerWorker` all three kinds, start consumer.
7. `package.json` script: `"start": "tsx src/index.ts"`, `"dev": "tsx watch src/index.ts"`
8. Verify: `npm run dev` starts, connects to Supabase (if env set), logs "consumer ready".

**Definition of Done.** `npm run dev` starts without error; worker claims a hand-inserted pending job row
and marks it done; realtime wake fires within 1s of insert.

---

## [WEB] M1 — Data layer (Supabase schema + repositories)

**Goal.** All persistent state with typed repository functions and realtime channels. Includes the `jobs`
queue table (owned by M1 schema but consumed by both services).

**Depends on.** M0.

**Tables (minimum).**
- `creators` (id, display_name, wallet_address, created_at)
- `pieces` (id, creator_id, title, body, length_chars, topic_tags, age_hours derived, objective
  `MAX_REVENUE|MAX_REACH`, current_price `UsdcAmount`, reserve `UsdcAmount`, ceiling, status
  `listed|delisted|draft`, created_at)
- `sessions` (id, piece_id, reader_id, unlocked_at, active_dwell_seconds, completion_pct, revisit_count,
  scroll_pattern jsonb, ended_at, view_price_paid `UsdcAmount`)
- `heartbeats` (session_id, ts, focused bool, scroll_pct)
- `payments` (id, kind `unlock|tip`, piece_id, session_id, reader_id, amount `UsdcAmount`, tx_ref,
  arc_explorer_url, status, created_at)
- `price_decisions` (id, piece_id, old_price, new_price, reserve, objective, signals_cited jsonb, reasoning
  text, confidence, trigger `clock|spike|tip_surplus`, created_at) — reasoning chain for pricing
- `tip_decisions` (id, session_id, piece_id, prompted bool, suggested_tip, view_price_paid, signals_cited
  jsonb, reasoning, confidence, accepted bool, final_tip, tip_surplus, created_at)
- `disputes` (id, price_decision_id, creator_id, note, status `open|reviewed`, created_at)
- **`jobs`** — queue table (schema in §Queue interface above)
- **`notifications`** (id, reader_id, kind `tip_prompt`, payload jsonb, read bool, created_at) — agent pushes, web reads

**Public interface.** `lib/repo/*.ts` — one repository per table. Key queries:
- `getSignalBundle(pieceId)` — recency-windowed {1h, 24h, 7d} view/dwell/bounce/tip stats → M5 input
- `enqueueJob(kind, payload)` — INSERT into jobs table; used by web app to trigger agents
- `getStandingPrice(pieceId)` — instant read of `pieces.current_price` for x402 wall

**Tasks.** Write Supabase migrations; generate TS types; implement repositories; add realtime subscription
helpers for `payments` and `price_decisions`; write `getSignalBundle`; write `enqueueJob`.

**Circle/Arc touchpoints.** `payments.amount` is UsdcAmount; `arc_explorer_url` → `testnet.arcscan.app`.

**Definition of Done.** Migrations apply; repositories unit-tested; `getSignalBundle` returns M5's expected
shape; `enqueueJob` inserts a row; realtime helpers verified.

---

## [WEB] M2 — Behavior tracking

**Goal.** Capture active dwell, completion, scroll, revisits, and reliable session-end — server-side ingest.

**Depends on.** M0, M1.

**Public interface.**
- Client hook `useReadingTelemetry(sessionId)` — heartbeats while focused, scroll depth, pagehide flush.
- `POST /api/telemetry/heartbeat` and `POST /api/telemetry/end` — persist to sessions/heartbeats.
- Server job `detectSessionEnd()` — marks session ended on heartbeat timeout, then calls `enqueueJob('reader_eval', { sessionId })`.

**Tasks.**
1. Page Visibility API hook: count time only while `visibilityState === 'visible'` and focused.
2. Gate to after-unlock only.
3. Server ingest routes + cron/interval `detectSessionEnd`.
4. Compute `active_dwell_seconds`, `completion_pct`, `revisit_count`.
5. On session-end: `enqueueJob('reader_eval', { sessionId })` → agents service picks it up.

**Circle/Arc touchpoints.** None. Feeds M5/M6 via queue.

**Definition of Done.** Open piece → read → leave → correct `sessions` row; backgrounded tab doesn't
inflate dwell; `reader_eval` job enqueued within the timeout even without `pagehide`. §7.5, §7.6 hold.

---

## [WEB] M3 — Circle adapter

**Goal.** Thin adapter `lib/circle/` isolating all Circle/Arc SDK calls.

**Depends on.** M0.

**Public interface (`lib/circle/index.ts`).**
```ts
getUsdcBalance(address: string): Promise<UsdcAmount>;
depositToGateway(privKeyRef: string, amount: UsdcAmount): Promise<TxRef>;
getGatewayBalance(address: string): Promise<{ total; withdrawable; withdrawing }>;
buildPaymentRequirements(price: UsdcAmount, sellerAddress: string): X402Requirements;
verifyAndSettle(signedAuth: EIP3009Auth, requirements: X402Requirements): Promise<PaymentResult>;
signPaymentAuthorization(privKeyRef: string, requirements: X402Requirements): Promise<EIP3009Auth>;
withdrawFromGateway(privKeyRef: string, to: string, chain: string, amount: UsdcAmount): Promise<TxRef>;
explorerUrl(txRef: TxRef): string;
```

**Tasks.**
0. **Install + read `use-gateway` and `use-arc` Circle Skills** (CLAUDE.md §4.5) before writing any SDK call.
1. Buyer: wrap `GatewayClient({ chain: "arcTestnet", privateKey })`.
2. Seller: use `BatchFacilitatorClient` for dynamic pricing (NOT static `gateway.require("$X")`).
3. Balance reads via USDC ERC-20 interface, reading `decimals()` (no hardcoded 1e6).
4. EOA wallets only on payment path (§4.3 SCA restriction).
5. All callers get UsdcAmount in / TxRef out — no SDK type leaks.

**Same adapter is copied to `Cresc-Agents/src/circle/`** — keep in sync (or share via symlink in dev).

**Definition of Done.** Script: deposit testnet USDC → read balance → sign + verify sub-cent payment →
visible on `testnet.arcscan.app`. Decimals from `decimals()`. No SDK leaks.

---

## [WEB] M4 — x402 wall + instant unlock (THE SPINE)

**Goal.** Reader pays standing price → content unlocks instantly → session row created → `reader_eval`
job enqueued at session-end.

**Depends on.** M1, M3.

**Public interface.**
- `GET /api/piece/[id]` — wrapped with `BatchFacilitatorClient` dynamic pricing. Unpaid → 402.
  Paid → serve body + write `payments(kind:'unlock')` + create `sessions` row.
- After unlock, M2 telemetry attaches. At session-end, `enqueueJob('reader_eval', { sessionId })`.

**Tasks.**
1. Piece route: read `pieces.current_price`, build requirements, inject into 402 or settle.
   NEVER calls LLM. NEVER computes price. Just reads stored standing price.
2. Client unlock UX: `client.pay(url)` flow, tiny "paying" state during EIP-3009 sign.
3. On settle success: persist payment + session, trigger M2.
4. Gateway-unreachable: clear error + retry. `maxTimeoutSeconds: 604900` (>7 days).

**Circle/Arc touchpoints.** x402 402-flow, EIP-3009 signing, Gateway settle/batch, USDC, explorer link.

**Definition of Done.** Reader pays $0.01 for a piece, content appears <~1s after signing, payment on
`testnet.arcscan.app`, session row exists. **Zero LLM calls on this path (§7.3).**

---

## [AGENTS] M5 — PricingAgent (sweep worker)

**Goal.** Consumes `pricing_sweep` jobs. Reasons over signal bundle → new standing price + reasoning chain.
Off the read path entirely. Runs in Cresc-Agents service.

**Depends on.** M0b, M1 (`getSignalBundle`), M0 (mock mode).

**Public interface (`src/workers/pricing.ts`).**
```ts
handlePricingSweep(job: Job<{ pieceId: string; trigger: string }>): Promise<void>;
// reads getSignalBundle, calls LLM, clamps to envelope, writes price_decisions, updates pieces.current_price
```

**Tasks.**
1. Build signal-bundle → prompt. Elicit three proof behaviors (CLAUDE.md §6.2).
2. Call LLM via `src/llm/`; parse to `AgentDecision`. Mock mode.
3. Clamp `newPrice` to `[reserve, ceiling]`, enforce `max_step`.
4. Persist `price_decisions` + update `pieces.current_price`.
5. `chooseReserve` — separate slower agent call for per-piece floor.
6. Clock trigger: on startup, start `setInterval(sweep_all_listed_pieces, SWEEP_INTERVAL_MINUTES * 60000)`.
7. Spike/tip_surplus triggers: arrive via jobs table.

**Definition of Done.** Sweep produces sensible price move + reasoning row; price never violates §7.1/§7.2;
mock mode keyless; three proof behaviors demonstrable in tests.

---

## [AGENTS] M6 — ReaderAgent (session eval worker)

**Goal.** Consumes `reader_eval` jobs. Decides whether to tip-prompt and how much. Pushes notification.
Runs in Cresc-Agents service.

**Depends on.** M0b, M1, M0 (mock mode).

**Public interface (`src/workers/reader.ts`).**
```ts
handleReaderEval(job: Job<{ sessionId: string }>): Promise<void>;
// reads session, calls LLM, writes tip_decisions, inserts notifications row if tip
```

**Tasks.**
1. Assemble session behavior inputs from DB.
2. Two LLM judgments: prompt-or-skip; amount [10%,100%] of view price.
3. Persist `tip_decisions`. If tip: INSERT into `notifications` table.
4. Web app reads `notifications` via Realtime and shows tip prompt to reader.

**Definition of Done.** High-engagement session → tip prompt + reasoned amount; low-engagement → tip_skip;
both write tip_decisions; runs off read path; mock mode works. §7.7, §7.8 hold.

---

## [AGENTS+WEB] M7 — Tip settlement + feedback loop

**Goal.** Settle accepted tips (web), feed tip_surplus back into pricing (agents).

**Web side (M7a — in Cresc):**
- `POST /api/tip/accept` — called on user Accept click. Settles tip via M3 Circle adapter
  (synchronous, user is waiting). Writes `payments(kind:'tip')`. Computes `tip_surplus`.
  If surplus > 0: `enqueueJob('tip_feedback', { tipDecisionId, surplus })`.

**Agents side (M7b — in Cresc-Agents):**
- `src/workers/tipFeedback.ts` — handles `tip_feedback` jobs. Updates `tip_decisions.tip_surplus`.
  Calls `enqueueJob('pricing_sweep', { pieceId, trigger:'tip_surplus' })` to trigger re-sweep.

**Definition of Done.** Tip above suggestion settles on Arc AND causes a subsequent price-up decision
that cites the surplus in its reasoning chain. This instance is reproducible for the demo (§6.5).

---

## [WEB] M8 — Creator dashboard

**Goal.** Make agency visible: live price ticker with rationale, reasoning chain, charts, list/delist,
settings, dispute affordance.

**Depends on.** M1 (realtime), M5 decisions, M7 payments. Build UI against seeded data first.

**Tasks.**
1. Live ticker — piece prices updating via Realtime, each annotated with signals + one-line reasoning.
2. Reasoning chain view — expandable `price_decisions` log; flag low-confidence rows.
3. Charts (recharts) — price over time vs views/dwell/tips; cumulative revenue; unique paid readers.
4. List/delist + settings — objective toggle, ceiling override.
5. Dispute — button writes `disputes` row; status shown. Human resolution only, no dispute agent.
6. Top-bar Gateway balance + withdraw dialog.

**Definition of Done.** Ticker updates live; reasoning visible; charts real data; list/delist persists;
dispute writes row; withdraw works on testnet.

---

## M9 — Seeding & demo harness

**Goal.** Real payments during the event window. Traction is 30%.

**Depends on.** All of the above.

**Tasks.**
1. Seed 5–10 creators with funded wallets; list pieces (articles, photos, video, art).
2. Traffic driver: 20–30 real readers, or a controlled load script funding reader wallets from faucet.
3. Metrics view: RFB-6 numbers (total creator payouts, reader-to-payer conversion, avg price/piece,
   autonomous price decisions count).
4. Demo script: instant unlock (explorer), live price move, tip prompt, §6.5 tip→price-rise instance.

**Definition of Done.** Real payouts on `testnet.arcscan.app`; metrics view populated; demo script
runs end-to-end and surfaces the emergent loop.

---

## Two-week calendar

| Days | Modules | Milestone |
| --- | --- | --- |
| 1–2 | M0 ✓, M0b, M1 | M0 done; agents scaffold live; schema migrated |
| 3–4 | M3, M4 | x402 wall + instant unlock working locally |
| 5–7 | M4 finish + M5 minimal | **SPINE: real sub-cent settlement + visible price move** |
| 8–9 | M5 full, M2 finish | Sweeps, reserve logic, reliable session-end |
| 10–11 | M6, M7 | ReaderAgent + tip settlement + feedback loop |
| 12–13 | M8 | Dashboard: ticker, reasoning, charts, list/delist, withdraw |
| 14 | M9 | Seed, generate payouts, capture emergent loop, record demo |

**Cut order if behind:** trim M8 polish → trim M9 synthetic load → never trim spine (M0–M4) or M5
reasoning quality or M7 loop.

---

## Session checklist

1. Read `CLAUDE.md` (§4 ground truth, §6 agent rules, §7 invariants) and `PROGRESS.md`.
2. Identify module + which service it belongs to (`[WEB]` vs `[AGENTS]`).
3. For Circle/Arc details not in `CLAUDE.md §4`: web-search official source, don't guess.
4. Keep mock mode; assert §7 invariants in tests.
5. For payment-touching modules, observe one real settlement on `testnet.arcscan.app`.
6. Update `PROGRESS.md`: module, done, stubbed, blocked, next step + assumptions.
7. Commit referencing module id (e.g. `M5: pricing sweep worker`).
