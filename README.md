<div align="center">

<img src="./web/public/cresc-logo-transparent.png" alt="Cresc Logo" width="200"/>

**AI-priced content — gas-free nanopayments via the x402 protocol on Circle Arc Testnet.**

[![Arc Testnet](https://img.shields.io/badge/Arc-Testnet-blueviolet?style=flat-square)](https://testnet.arcscan.app)
[![x402 Protocol](https://img.shields.io/badge/x402-Protocol-FF5733?style=flat-square)](https://x402.org)
[![Built with Circle](https://img.shields.io/badge/Built_with-Circle_Stack-00D395?style=flat-square)](https://circle.com)
[![Next.js](https://img.shields.io/badge/Next.js-App_Router-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Supabase](https://img.shields.io/badge/Supabase-DB-3ECF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com)
[Architecture](#architecture) · [Creator Flow](#creator-flow) · [Reader Flow](#reader-flow) · [Agents & Pricing](#agents--pricing) · [Setup](#setup)

</div>

---

## What is Cresc?

Cresc lets any creator — including existing Ghost CMS publishers — monetize their content with **live, self-adjusting prices** between **$0.001 and $0.1 USDC**. Every article has a paywall enforced by the [x402 HTTP 402 protocol](https://x402.org) and settled gas-free through [Circle Gateway](https://developers.circle.com/gateway) on Arc Testnet.

Two AI agents run entirely out of the reader's request path:

- **PricingAgent** — sweeps recency-weighted engagement signals every few minutes and reasons about what the piece should cost right now.
- **ReaderAgent** — evaluates each reading session and decides, at its own discretion, whether to prompt a tip and how much to suggest.

When a reader tips *above* the agent's suggestion, that surplus feeds back into the next pricing sweep — the one emergent loop the whole system is built around.

---

## Architecture

Two TypeScript services share a Supabase Postgres database. They communicate exclusively through a lightweight `jobs` queue table with Realtime wakeups — no HTTP between them.

```
┌──────────────────────────────────────────┐   ┌──────────────────────────────────────────┐
│  web/  (Next.js App Router)              │   │  agents/  (Node.js worker service)       │
│                                          │   │                                          │
│  • x402 paywall API routes               │   │  • PricingAgent sweeps (LLM)             │
│  • Ghost CMS integration (sync/webhook)  │   │  • ReaderAgent session eval (LLM)        │
│  • Reader wallet creation & auto-deposit │   │  • Tip feedback enqueuer                 │
│  • Telemetry ingest (heartbeats)         │   │  • Optimistic-lock queue consumer        │
│  • Tip settlement                        │   │  • Periodic pricing clock                │
│  • Creator dashboard                     │   │                                          │
│  • Job enqueueing only — no LLM calls    │   │  No HTTP server — DB-only                │
└────────────────────┬─────────────────────┘   └──────────────────┬───────────────────────┘
                     │                                             │
                     └──────────────── Supabase ──────────────────┘
                                    (Postgres + Realtime)
```

**Why two services?** Next.js serverless handlers have ~30 s limits and no persistent process. LLM calls and 15-minute sweep clocks need a long-lived worker. The split lets each service do what it's shaped for.

---

## Creator Flow

### Option A — Native Cresc editor

1. Connect a wallet at `/onboard` (MetaMask / WalletConnect).
2. Write and publish a piece at `/create` using the Tiptap rich editor (supports text, images, video).
3. The piece gets a starting price of `$0.001` and is immediately queued for a first pricing sweep.
4. Monitor everything from `/dashboard`.

### Option B — Ghost CMS integration

Creators who already publish on Ghost go to `/ghost-onboard` — a single unified 3-step flow, no UUID copy-pasting.

```
/ghost-onboard
│
├─ Step 1: Display name
│
├─ Step 2: Wallet connect (MetaMask / WalletConnect, Arc Testnet)
│     └─ POST /api/creator → creates account, stores creatorId in localStorage
│
└─ Step 3: Ghost credentials
      ├─ Ghost instance URL + Admin API key
      └─ Submit:
           ├─ POST /api/ghost/connect (validates key, syncs all published posts,
           │     generates HMAC webhook secret)
           └─ Returns copy-ready webhook URL + secret + <script> snippet

After the one-time setup in Ghost Admin (~30 s):
  • Post published / updated  →  webhook fires  →  HMAC verified
    →  piece upserted + pricing_sweep enqueued
  • Post deleted / unpublished  →  piece.status = 'delisted'
  • cresc-ghost.js (~2 KB, no dependencies) runs on every Ghost page:
      1. GET /api/ghost/post-status?site=<creatorId>&slug=<slug>
      2. Clips post content to 300 px + gradient overlay if paywalled
      3. "Unlock for $X.XXX →" button links to /piece/[pieceId]
  • After unlock, reader is redirected to /read (Ghost HTML fetched server-side,
    never exposed pre-payment)
```

### Creator dashboard

| Section | What it shows |
|---------|---------------|
| **Live Ticker** | Real-time price updates via Supabase Realtime — direction arrow, trigger badge (`clock` / `tip_surplus`), confidence score |
| **Reasoning Chain** | Every price decision with the agent's rationale. Low-confidence entries (`< 0.5`) show a **Dispute** button |
| **Price Chart** | Recharts line (price history) + bar (revenue) + purple dots for tip-surplus triggers |
| **Settings** | Toggle `listed` / `delisted`, switch optimization objective (`MAX_REVENUE` / `MAX_REACH`) |
| **Treasury** | Live Circle Gateway balance + **Withdraw** to any external EOA |

---

## Reader Flow

### Wallet setup (first visit)

```
GET /api/reader/wallet
   ├─ Create custodial EOA per reader (cookie-scoped, httpOnly, 1 yr)
   │   └─ Private key encrypted with AES-256-GCM (READER_KEY_SECRET in env)
   │       and stored as "IV:AuthTag:Ciphertext" (hex)
   ├─ If on-chain USDC balance > 0 AND gateway_funded = false:
   │   └─ GatewayClient.deposit() → one-time Arc Testnet tx into Gateway contract
   │       → gateway_funded = true
   └─ Return { address, balance, gatewayFunded }
```

Readers fund their address once from the [Circle Faucet](https://faucet.circle.com/) (Arc Testnet → USDC). The app auto-deposits into the Gateway contract on the first visit after funding.

### Content unlock (x402)

```
GET /piece/[id]  (no Payment-Signature header)
   └─ Read pieces.current_price (precomputed — never an LLM call on this path)
   └─ HTTP 402 + PAYMENT-REQUIRED header (base64 JSON):
         { x402Version: 2, accepts: [{ scheme, network, asset, amount, payTo }] }

Client signs EIP-3009 USDC authorization  ← off-chain, zero gas
   └─ Retry: POST /piece/[id] with PAYMENT-SIGNATURE header

Server → BatchFacilitatorClient.settle()
   └─ Arc Testnet: reader Gateway balance → seller Gateway balance
   └─ Returns txHash (visible on testnet.arcscan.app)
   └─ Writes payment row (status: 'settled')
   └─ Opens session + returns unlocked content

For Ghost pieces: redirect to /read?piece=...&session=...
   └─ Server fetches full HTML from Ghost Admin API (server-side only, never pre-unlock)
   └─ DOMPurify sanitized render in GhostReader component
```

### Reading telemetry

```
useReadingTelemetry(sessionId) runs while the piece is open:
   • POST /api/telemetry/heartbeat  every 5 s
         { focused: document.hasFocus() && visibility === 'visible', scroll_pct }
   • Page Visibility API — backgrounded tabs do NOT accrue dwell time
   • On pagehide: sendBeacon POST /api/telemetry/end  (survives tab close)
   • Fallback: 25 s heartbeat timeout → GET /api/telemetry/detect-end
   Either path: sessions.ended_at written + reader_eval job enqueued
```

### Tip prompt (async, agent-decided)

```
ReaderAgent (agents service) claims the reader_eval job:
   ├─ Derives: focusRatio, scrollDepth, normalizedDwell (vs. piece.length_chars)
   ├─ LLM judgment 1 — Should we prompt? (no fixed time gate)
   ├─ LLM judgment 2 — Suggest how much? ([10%, 100%] of view price)
   └─ Writes tip_decisions row + notifications row (kind: 'tip_prompt')

Client polls /api/notifications every 10 s:
   └─ Shows TipPrompt overlay with slider + agent's one-sentence rationale
   └─ Reader adjusts tip amount, signs EIP-3009, POST /api/tip/accept
   └─ Tip settled via Circle Gateway

If final tip > suggested tip:
   └─ tip_surplus recorded → tip_feedback job → pricing_sweep (trigger: 'tip_surplus')
   └─ PricingAgent cites surplus in next sweep → price rises
```

---

## Agents & Pricing

### PricingAgent

Triggered by a 15-minute clock (all listed pieces) or on-demand by a `tip_surplus` event. Receives a **signal bundle** with multi-window stats (1 h / 24 h / 7 d):

```ts
{
  pieceId, objective, currentPrice, reserve, ceiling, ageHours,
  windows: {
    '1h':  { views, uniqueReaders, avgDwellSeconds, medianDwell, completionPct, bounceRate, tipCount, tipRevenue },
    '24h': { ... },
    '7d':  { ... }
  },
  recentTipSurplus: number   // max surplus from last 24 h
}
```

The agent makes **two LLM calls**:

1. **Reserve decision** — what should the price floor be right now? (not hardcoded)
2. **Price decision** — what should the current price be, given the objective and signals?

The output is clamped to `[reserve, ceiling]` with an asymmetric step limit (-10% / +20% per sweep). Every decision writes a `price_decisions` row with `signals_cited`, `reasoning`, and `confidence`.

### ReaderAgent

Claims `reader_eval` jobs at session end. Makes two genuine judgments with no fixed thresholds:

- **Prompt or skip?** A slow reader of a long essay is treated differently from someone who scrolled fast through a short post.
- **How much?** Suggests a specific amount in [10%, 100%] of the view price with a one-sentence human-readable rationale.

### Emergent feedback loop

```
Reader tips $0.03  →  suggested was $0.01  →  surplus = $0.02
   └─ tip_feedback worker: enqueue pricing_sweep (trigger: 'tip_surplus')
   └─ PricingAgent signal bundle: recentTipSurplus = $0.02
   └─ Agent reasoning: "Reader willingness to pay signals under-pricing"
   └─ Price rises (within envelope)
   └─ Next unlock uses new current_price                         ← loop closes
```

All agents run in **mock mode** when `LLM_API_KEY` is absent — same output shape, deterministic canned decisions. The spine runs without burning tokens during development.

---

## Database schema

11 tables in Supabase Postgres. Migrations in `agents/supabase/migrations/`.

| Table | Purpose |
|-------|---------|
| `creators` | Wallet address, Ghost connection fields |
| `pieces` | Content, standing price, reserve/ceiling, Ghost post metadata |
| `sessions` | Per-reader unlock sessions with dwell + scroll aggregates |
| `heartbeats` | Raw 5-second telemetry ticks (focused, scroll %) |
| `payments` | Every USDC transfer — unlock or tip — with Arc tx hash |
| `price_decisions` | Full agent reasoning log per sweep |
| `tip_decisions` | Agent tip judgment + accepted amount + surplus |
| `disputes` | Creator-flagged low-confidence decisions |
| `jobs` | Async queue: `pricing_sweep` / `reader_eval` / `tip_feedback` |
| `notifications` | Reader-bound tip prompts (Realtime) |
| `reader_wallets` | Custodial EOA per reader — encrypted key, Gateway funding state |

---

## Setup

### Prerequisites

- Node.js v22+
- Supabase project
- Arc Testnet USDC from the [Circle Faucet](https://faucet.circle.com/) (select Arc Testnet → USDC)
- Groq (or OpenAI-compatible) API key — agents run in mock mode without one

### 1. Install dependencies

```bash
cd web && npm install --legacy-peer-deps
cd ../agents && npm install
```

### 2. Environment variables

```bash
cp web/.env.example web/.env.local
cp agents/.env.example agents/.env.local
```

Generate testnet EOA keypairs:

```bash
cd agents && npm run generate-wallets
```

Key variables to fill in each `.env.local`:

| Variable | Where | Purpose |
|----------|-------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | both | Supabase project |
| `ARC_RPC_URL` | both | Arc Testnet RPC (from docs.arc.network) |
| `SELLER_ADDRESS` + `SELLER_PRIVATE_KEY` | both | Creator/platform receiving EOA |
| `READER_KEY_SECRET` | web | 32-byte hex key for AES-256-GCM reader wallet encryption |
| `LLM_API_KEY` + `LLM_BASE_URL` + `LLM_MODEL` | agents | Groq by default; omit for mock mode |

### 3. Apply migrations

```bash
npx supabase db push
```

### 4. Seed data

```bash
cd agents && npm run seed
```

### 5. Run

```bash
# Terminal 1 — Web frontend
cd web && npm run dev

# Terminal 2 — Agents worker
cd agents && npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

> [!NOTE]
> The agents service and web app both need `SUPABASE_SERVICE_ROLE_KEY` and `ARC_RPC_URL`. Keep `.env.local` files out of git — they are gitignored.

---

## Testing the emergent pricing loop

```bash
cd agents && npm run demo -- --tip-surplus
```

This script simulates a full reader session, over-tips relative to the agent's suggestion, and triggers a repricing sweep. Watch the creator dashboard at `/dashboard` update in real time as the PricingAgent cites the surplus in its reasoning.

---

## Ghost CMS quick-start

1. Go to `/ghost-onboard` on your Cresc deployment.
2. Enter your display name, connect MetaMask on Arc Testnet, then enter your Ghost site URL and Admin API key (Ghost Admin → Settings → Integrations → Add custom integration → Admin API Key).
3. Hit **Connect Ghost** — your posts sync automatically and get their first pricing sweep.
4. Copy the webhook URL + secret into Ghost Admin → Settings → Webhooks (Post published, Post updated, Post deleted).
5. Copy the `<script>` snippet into Ghost Admin → Settings → Code Injection → Site Footer.
6. Done. Every published post now has a live AI-priced paywall. New posts sync automatically via the webhook.

---

## Key files

| File | Purpose |
|------|---------|
| `web/lib/circle/index.ts` | Circle Gateway adapter: build requirements, settle, withdraw |
| `web/lib/reader-wallets/index.ts` | Custodial EOA per reader: create, encrypt, auto-deposit |
| `web/lib/ghost/index.ts` | Ghost Admin API client: JWT auth, post sync, HMAC verify |
| `web/app/actions/unlock.ts` | x402 unlock server action (settle + session create) |
| `web/public/cresc-ghost.js` | Self-contained paywall snippet injected into Ghost sites |
| `agents/src/workers/pricing.ts` | PricingAgent: signal bundle + two LLM calls + envelope clamp |
| `agents/src/workers/reader.ts` | ReaderAgent: metrics derivation + tip judgment |
| `agents/src/queue/consumer.ts` | Optimistic-lock queue consumer + Realtime wakeup |
| `agents/scripts/demo-harness.mts` | End-to-end scenario runner |
| `agents/supabase/migrations/` | All DB migrations in order |
