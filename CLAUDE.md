# CLAUDE.md — Cresc

> This file is loaded into **every** Claude Code session for this repo. It is the source of truth for
> what we are building, the rules of the codebase, and the ground-truth Circle/Arc facts you must not
> re-derive from memory. Read this fully before touching code. For the module-by-module build plan and
> task breakdown, read `PLAN.md`. If anything here conflicts with your training knowledge, **this file and
> a fresh web search win** — Circle/Arc move fast and your priors are likely stale.

---

## 0.5 Two-service architecture (decided — do not re-litigate)

The project is **two separate services**, both TypeScript:

- **`Cresc/`** (this repo) — Next.js App Router web app. Serves the UI, x402 paywall API, telemetry
  ingest, tip settle, creator dashboard. **Never makes LLM calls.** Enqueues jobs via a Supabase `jobs`
  table for the agents service to process.
- **`Cresc-Agents/`** (sibling repo at `../Cresc-Agents/`) — Long-running Node.js worker service.
  Consumes the `jobs` queue. Runs PricingAgent sweeps (M5), ReaderAgent evals (M6), and tip feedback
  (M7b). All LLM calls live here. Has no HTTP server — DB only.

**Why separate:** Next.js serverless handlers have ~30s time limits and no persistent process — wrong
shape for a long-lived sweep clock (`setInterval` every 15 min) or for LLM calls that can take 5–30s.
The agents service is a permanent worker that polls a queue; it can't be a Next.js route.

**Language: TypeScript for both.** Mirrors the `circlefin/arc-nanopayments` reference (96% TS). Shared
type shapes (UsdcAmount, AgentDecision, etc.) are duplicated between repos with `// keep-in-sync` comments.
No Python.

**Queue: Supabase `jobs` table.** No extra infra. Web app INSERTs rows; agents service polls + Realtime-
wakes, claims rows with optimistic lock (`UPDATE ... WHERE status='pending'`), marks done/failed.
Full schema in `PLAN.md §Queue interface`.

---

## 0. Prime directives (read first)

1. **Never invent Circle/Arc API signatures, package names, addresses, or chain params.** They are pinned in
   §4 of this file. If a needed detail is NOT in §4 and NOT in the code already, **stop and web-search the
   official source** (`developers.circle.com`, `docs.arc.network`, the `circlefin/arc-nanopayments` repo)
   before writing code. Do not guess. A wrong contract address or SDK call silently burns a whole session.
2. **The reference implementation is `circlefin/arc-nanopayments`.** When unsure how a Gateway/x402 flow
   works, read that repo's code rather than guessing. We mirror its stack deliberately (see §3).
3. **Money rails are testnet-only.** Everything settles on **Arc Testnet**. Never write code that assumes
   mainnet. Never hardcode a private key in source — secrets live in `.env.local` only.
4. **Agency is the product.** Two agents (PricingAgent, ReaderAgent) must *reason and decide*, never run a
   hardcoded formula. If you find yourself writing a decay curve, a `tip = time * rate` line, or a fixed
   threshold where a judgment belongs, you are building the wrong thing — see §6.
5. **The reader's read path must never block on an agent.** Pricing is precomputed; unlock is instant. If a
   change would put an LLM call or a multi-second wait between "click" and "content shown," it is wrong.
6. **Work module by module.** Each module in `PLAN.md` has explicit inputs, outputs, a contract (interface),
   and a Definition of Done. Build to the interface so modules compose across sessions. Do not reach into
   another module's internals; go through its declared interface.
7. **Persist progress.** At the end of every session update `PROGRESS.md` (create it if absent): what module,
   what's done, what's stubbed, what's blocked, and the next concrete step. The next session reads it first.
8. **When a task is ambiguous, search the web, then state the assumption you made inline in code comments**
   and in `PROGRESS.md`. Never silently assume.

---

## 1. What we are building (one paragraph)

**Cresc** is a content platform where every article carries a *live, self-adjusting price* between
**$0.001 and $0.1**, set autonomously by an AI **PricingAgent** that reasons over recency-weighted attention
signals (views, dwell, completion, bounce, tips) to maximize each creator's chosen objective (revenue or
reach) over the piece's lifetime. Readers pay the standing price per view via **x402 + Circle Gateway
nanopayments** (gas-free, sub-cent, on Arc) — the unlock is instant because the price is always precomputed.
After a read, a server-side **ReaderAgent** analyzes the session's behavior and, *at its own discretion*,
decides whether the reader engaged enough to be worth a tip prompt and how much to suggest (10–100% of the
view price), pushing an async notification. Accepted tips settle as additional nanopayments, and any tip
*above* the agent's suggestion feeds back into the PricingAgent as an under-pricing signal — the one
emergent loop we showcase. Creators see every price decision, with its reasoning, on a live dashboard, and
can dispute incoherent ones.

**RFBs:** 6 (Creator & Publisher Monetization) + 2 (Selling Agent Services via Nanopayments).
**Hackathon:** Lepton / Circle on Arc. Judging axes: Agentic Sophistication 30%, Traction 30%, Circle tooling
20%, Innovation 20%. Every architectural choice traces to one of these — see `PLAN.md` §Scoring.

---

## 2. Glossary (use these exact terms in code and comments)

- **Piece** — a unit of content (article) that has a price.
- **Standing price** — the current precomputed price of a piece, returned instantly at the x402 wall.
- **Sweep** — one asynchronous run of the PricingAgent over a piece (or a creator's pieces), producing a new
  standing price + reasoning. Clock- or event-triggered. Never on the read path.
- **Signal bundle** — the structured, recency-weighted input handed to the PricingAgent.
- **Reserve** — the per-piece price floor, itself *chosen by the agent*, never a global constant.
- **Objective** — per-piece creator setting: `MAX_REVENUE` | `MAX_REACH`.
- **Heartbeat** — periodic ping from an open reader page recording active, focused dwell.
- **Session** — one reader's continuous engagement with one piece, from unlock to session-end.
- **Session-end** — exit event OR heartbeat-stop for ~20–30s (the reliable trigger).
- **Tip surplus** — amount a reader tipped *above* the ReaderAgent's suggested tip.
- **Reasoning chain** — the stored, creator-readable log of why the agent made each price/tip decision.
- **Envelope** — the smart-contract-enforced hard bounds (`[reserve, ceiling]`, `max_step`) inside which the
  agent is free. The agent cannot breach the envelope even if it decides to.

---

## 3. Tech stack (mirrors the Circle reference repo — do not substitute without reason)

- **Framework:** Next.js (App Router), TypeScript. (The reference `circlefin/arc-nanopayments` is Next.js +
  TS, 96% TypeScript.)
- **DB + realtime:** Supabase (Postgres + realtime subscriptions). Used for pieces, payments, sessions,
  signals, reasoning chains. The reference repo persists payment events to Supabase with realtime — we extend
  the same pattern.
- **Payments SDK:** `@circle-fin/x402-batching` — exposes `GatewayClient` for gasless x402 batching. This is
  the package the reference repo uses. Seller endpoints are wrapped with **`withGateway()`** middleware.
- **x402:** HTTP 402 protocol (`x402.org`). Buyer signs an **EIP-3009** authorization offchain (zero gas),
  retries the request with the signed auth, seller verifies via Gateway and serves immediately.
- **Agents:** LLM-driven. The reference uses **LangChain + Deep Agents** (`deepagents` npm) for the buyer
  agent. We use LLM reasoners for PricingAgent and ReaderAgent. **Provider: Groq** for now, via an
  **OpenAI-compatible** client pointed at Groq's base URL — accessed through a provider-agnostic adapter
  (`lib/llm/`) keyed on `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`, so swapping providers later is a config
  change, not a code change. The reference falls back to a scripted mock when no LLM key is set — we keep a
  mock mode too (see §6.4) so the system runs without burning tokens during dev. Pick a Groq model that
  follows instructions and returns clean JSON reliably (reasoning quality IS the agency score — don't pick the
  smallest/fastest model for the agents).
- **Chain:** Arc Testnet. **Native gas token is USDC** (no ETH on Arc). Sub-second finality.
- **Styling:** Tailwind CSS + shadcn/ui (reference repo uses both; charts via a React chart lib — recharts).
- **Node:** v22+ required by the reference toolchain.

---

## 4. GROUND TRUTH — Circle / Arc facts (verified, do not re-derive)

> Verified against developers.circle.com, docs.arc.network, chainid.network, and the circlefin/arc-nanopayments
> repo as of **June 2026**. If you need a value not listed here, **web-search the official docs** — do not guess.
> Re-verify before mainnet (mainnet addresses were not published at authoring time).

### 4.1 Arc Testnet network
- **Chain ID:** `5042002`
- **Native gas token:** **USDC** (Arc uses USDC for gas; there is NO native ETH — do not look for test ETH).
- **Finality:** sub-second, deterministic (Malachite consensus).
- **Explorer:** `https://testnet.arcscan.app`
- **Faucet:** `https://faucet.circle.com/` — select **Arc Testnet**, choose USDC (and/or EURC). ~10 USDC/req.
- **RPC URL:** Using a **keyed Canteen Arc Testnet endpoint**
  (`https://rpc.testnet.arc-node.thecanteenapp.com/v1/swrm_<token>`). The token after `/v1/` is a **secret** —
  it lives in `.env.local` as `ARC_RPC_URL` only, never in `.env.example`, source, or git. (Keyless public
  fallback if ever needed: `https://arc-testnet.drpc.org`.)

### 4.2 Token contracts (Arc Testnet)
- **USDC (ERC-20 interface):** `0x3600000000000000000000000000000000000000`
- **EURC (ERC-20 interface):** `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`
- **CRITICAL DECIMALS FOOTGUN:** On Arc, the **native USDC gas balance uses 18 decimals**, but the **USDC
  ERC-20 interface uses 6 decimals**. Do **not** mix them. **Rule for this codebase: always read `decimals()`
  from the contract and use the ERC-20 (6-decimal) interface for all balance reads and transfers.** Never
  hardcode `1e18` or `1e6` — read it. A mismatch here corrupts every price calculation.
- Other Arc contracts (CCTP, StableFX, Permit2, Multicall3) are on the Arc "Contract addresses" docs page.
- **Gateway contracts on Arc Testnet (VERIFIED — domain 26):**
  - **GatewayWallet:** `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` ← this is the `verifyingContract` in the
    EIP-3009 domain (`extra.verifyingContract`) for x402 requirements. Use this value for `GATEWAY_WALLET_ADDRESS`.
  - **GatewayMinter:** `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` (used in withdraw/mint flows).
- **SDK chain name** for Arc Testnet is `"arcTestnet"` (Gateway domain 26, nanopayments supported, ~0.5s
  attestation — confirmed on the Gateway supported-blockchains page).

### 4.3 Nanopayments / Gateway flow (the canonical sequence — verified against the official quickstarts)
1. Buyer deposits USDC into a **Gateway Wallet contract** (one-time onchain tx; needs native gas on that chain).
2. Buyer requests a paid resource from the seller API.
3. Seller responds **HTTP 402 Payment Required** with a base64 **`PAYMENT-REQUIRED`** header carrying the options.
4. Buyer signs an **EIP-3009** payment authorization **offchain (zero gas)**.
5. Buyer retries the request with the signed auth in the **`PAYMENT-SIGNATURE`** header.
6. Seller **settles** the signature via Gateway's `settle()` and **serves the resource immediately**.
7. Gateway **batches** many signed authorizations and settles net positions in **one onchain tx** later,
   crediting the seller's **Gateway balance**.
- Payment size: **$0.000001 minimum**, up to $1M. This is what makes our $0.001–$0.1 range viable.
- **EOA WALLETS ONLY.** Nanopayments require an externally-owned account. **Smart-contract-account (SCA)
  wallets are NOT supported** — Gateway verifies signatures offchain with `ecrecover`, incompatible with
  EIP-1271 contract signatures. (Consequence: if we use Circle Wallets for readers/creators, they must be
  EOA-type for the *paying/receiving* key, or we keep raw EOA keys for the payment path — see M3.)
- **`validBefore` must be ≥ 7 days in the future** (plus a small buffer) in the buyer's EIP-3009 auth, or
  Gateway rejects it. Bake this into how we build payment authorizations.

### 4.4 SDK / package facts (VERIFIED — use these exact names)
**Packages:** `@circle-fin/x402-batching` plus peers `@x402/core`, `@x402/evm`, `viem`, and (seller) `express`.

**Testnet facilitator (Gateway API) URL:** `https://gateway-api-testnet.circle.com`
**CAIP-2 network id for Arc Testnet:** `eip155:5042002`
**Chain name string used by the SDK client:** `"arcTestnet"`

**Buyer side** — `import { GatewayClient } from "@circle-fin/x402-batching/client";`
```ts
const client = new GatewayClient({ chain: "arcTestnet", privateKey: process.env.PRIVATE_KEY as `0x${string}` });
await client.getBalances();          // -> { wallet:{formatted}, gateway:{available(bigint), formattedAvailable} }
await client.deposit("1");           // one-time: deposit 1 USDC into Gateway (onchain tx, returns depositTxHash)
await client.supports(url);          // -> { supported: boolean }  (check before paying)
const { data, status } = await client.pay(url);  // does the whole 402 -> sign EIP-3009 -> retry flow
await client.withdraw("5");                       // same-chain instant withdraw
await client.withdraw("5", { chain: "baseSepolia" }); // crosschain withdraw (needs gas on destination)
```
USDC base units are **6 decimals**: `1 USDC = 1_000_000n`. `gateway.available` is a bigint in base units.

**Seller side (Express middleware)** — `import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";`
```ts
const gateway = createGatewayMiddleware({
  sellerAddress: process.env.SELLER_ADDRESS!,
  facilitatorUrl: "https://gateway-api-testnet.circle.com",
  // networks: ["eip155:5042002"], // optional: restrict to Arc Testnet only
});
app.get("/route", gateway.require("$0.01"), (req, res) => {
  // req.payment = { verified, payer, amount /* base units */, network, transaction? }
});
```
Price is passed as a **dollar string** like `"$0.01"`. `req.payment.amount` is in 6-decimal base units
(`formatUnits(BigInt(amount), 6)` to display).

**Seller side (dynamic pricing — THIS IS WHAT WE USE for the standing price).** Do NOT use the static
`gateway.require("$X")` string for our pieces, because our price changes per piece per sweep. Use
**`BatchFacilitatorClient`** directly so we can inject the precomputed standing price at request time:
```ts
import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
const facilitator = new BatchFacilitatorClient({ url: "https://gateway-api-testnet.circle.com" });

// Build requirements with OUR standing price (amount in 6-decimal base units, as a string):
const requirements = {
  scheme: "exact",
  network: "eip155:5042002",
  asset: USDC_ADDRESS,                 // Arc Testnet USDC (see §4.2)
  amount: standingPriceBaseUnits,      // e.g. "10000" = $0.01
  maxTimeoutSeconds: 604900,           // > 7 days (see validBefore rule in §4.3)
  payTo: SELLER_ADDRESS,
  extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: GATEWAY_WALLET_ADDRESS },
};
// No signature yet -> return 402 with base64 PAYMENT-REQUIRED header { x402Version:2, resource, accepts:[requirements] }.
// With PAYMENT-SIGNATURE header -> JSON.parse(base64) the payload, then:
const settlement = await facilitator.settle(payload, requirements);  // guarantees settlement, low latency
if (!settlement.success) return 402; else serve content.
```
**Use `settle()` directly — do NOT call `verify()` then `settle()`** in production flows (docs guidance).
`asset` = USDC (§4.2). `verifyingContract` = **GatewayWallet `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`**
(pinned in §4.2; set as `GATEWAY_WALLET_ADDRESS`).

**Reference price points in Circle's sample seller** (sanity-check our integration): `$0.0003`, `$0.001`,
`$0.01`, `$0.03`. Our pieces price in the same regime ($0.001–$0.1).

**Circle Wallets** (managed creator/reader wallets): three types — developer-controlled, user-controlled,
modular. **For the payment path we need EOA keys (§4.3 SCA restriction).** Simplest hackathon path = raw EOA
keys via `generate-wallets` (matches the reference repo). If managed wallets are wanted, read the
use-circle-wallets skill (§4.6) and confirm the dev-controlled-wallet flow (entity secret + API key) before
coding — and ensure the paying account is an EOA.

### 4.5 Circle Skills + MCP (USE THESE — they're built for coding agents)
Circle publishes **Skills** (LLM-optimized instructions) and an **MCP server** (live SDK signatures + addresses).
**Before building M3 (and any Wallets/Contracts work), install and read the relevant skill.** They supersede
guesswork and are more current than this file.
- Install in Claude Code: `/plugin marketplace add circlefin/skills` then `/plugin install circle-skills@circle`
- Skills repo: `github.com/circlefin/skills` — relevant ones: **use-gateway** (Nanopayments), **use-arc**,
  **use-circle-wallets**, **use-developer-controlled-wallets**, **use-smart-contract-platform**, **use-usdc**.
- Circle MCP server (live signatures/addresses/chain IDs): add
  `{ "mcpServers": { "circle": { "url": "https://api.circle.com/v1/codegen/mcp" } } }`
- Gateway OpenAPI spec: `developers.circle.com/openapi/gateway.yaml` (authoritative endpoint shapes).
- Key API endpoints behind the SDK: **Settle x402 Payment**, **Get Supported x402 Payment Kinds**,
  **Get Token Balances** (all under `/api-reference/gateway/all/...`).

### 4.6 Circle Agent Stack — Agent Wallets (optional upgrade, NOT the spine)
Agent Stack components: **Agent Wallets, Agent Marketplace, Circle CLI, Nanopayments, Circle Skills.**
- **Agent Wallets** = policy-controlled wallets letting an agent hold/spend/earn USDC within onchain spending
  policies you define; 2-of-2 MPC, key shares never exposed to the agent; operated via **Circle CLI**; Arc
  testnet supported. Good for the "agency inside a spending policy" story (show it in M8).
- **CRITICAL caveat:** Agent Wallets are MPC/user-controlled, but **Gateway nanopayments require an EOA signing
  key** (§4.3). Before using an Agent Wallet on the *paying* path, verify it can produce the EIP-3009 EOA
  signature Gateway needs (use Circle MCP + the Agent Stack/use-circle-wallets skill). If it can't, use Agent
  Wallets only for treasury/policy/earnings and keep raw EOA keys on the nanopayment path.
- **Decision: do this only AFTER the spine works.** It is a narrative/agency upgrade, not a dependency.

### 4.7 Primitive scope (decided — see PLAN.md M3 for the full rationale)
- **USE:** Nanopayments/Gateway, x402, USDC, Contracts (envelope), Wallets (EOA), Skills + MCP.
- **OPTIONAL post-spine:** Agent Wallets (policy spend, EOA caveat above), Agent CLI for wallet setup.
- **DECLINE (scope creep, no score):** App Kit Send/Bridge/Swap/Unified Balance (we're single-chain Arc /
  single-currency USDC; cross-chain withdraw already covered by `GatewayClient.withdraw(amt,{chain})`); Agent
  Marketplace (no discovery needed for one platform); EURC/multi-currency (roadmap); other Arc sample apps
  (alternative references, not integrations). *Conditional:* App Kit **Swap** + **EURC** only matter if we add
  euro creator payouts — roadmap only.

### 4.8 Where to look when stuck (in priority order)
1. The local codebase + `PROGRESS.md`.
2. This file (§4) and `PLAN.md`.
3. **Circle Skills** (`github.com/circlefin/skills`) + **Circle MCP** (live signatures) — §4.5.
4. The official `.md` docs (append `.md` to any developers.circle.com page; index at
   `developers.circle.com/llms.txt`). Key pages: `/gateway/nanopayments/quickstarts/seller.md`,
   `/buyer.md`, `/gateway/nanopayments/concepts/x402.md`, `/gateway/references/supported-blockchains.md`.
5. `github.com/circlefin/arc-nanopayments` source (the reference app).
6. Arc docs `.md` index at `docs.arc.io/llms.txt` (network config, contract addresses, App Kit).
7. `x402.org` for the protocol spec.
General web search only after the above. **Always prefer official Circle/Arc sources over blog posts/tutorials.**

---

## 5. Environment & secrets (`.env.local`, never committed)

```
# --- Supabase ---
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# --- Arc / Circle ---
ARC_RPC_URL=                      # canonical Arc Testnet RPC (fetch from docs.arc.network)
ARC_CHAIN_ID=5042002
USDC_ADDRESS=0x3600000000000000000000000000000000000000
SELLER_ADDRESS=                   # creator/platform receiving wallet (generate-wallets)
SELLER_PRIVATE_KEY=               # server-side only
BUYER_ADDRESS=                    # reader/agent wallet (generate-wallets)
BUYER_PRIVATE_KEY=                # server-side / agent only

# --- LLM (agents). Groq for now, via OpenAI-compatible API. Omit LLM_API_KEY => deterministic mock mode (§6.4) ---
LLM_API_KEY=                      # Groq API key
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=                        # pick a strong instruction-following Groq model (clean JSON output)

# --- App config ---
PRICE_CEILING=0.1                 # global hard ceiling (USDC)
PRICE_FLOOR_MIN=0.001             # absolute floor the agent's reserve may not go below
SWEEP_INTERVAL_MINUTES=15
HEARTBEAT_INTERVAL_SECONDS=5
SESSION_END_TIMEOUT_SECONDS=25
```

Rules: secrets are server-side only; anything `NEXT_PUBLIC_*` is exposed to the browser, so never put a key
there. Provide a committed `.env.example` with empty values + comments.

---

## 6. Agent design rules (the heart of the score)

### 6.1 Agents reason, they do not compute
Both agents are **LLM reasoners over a structured context**, returning a **decision + machine-usable fields +
a human-readable rationale**. The rule of thumb for a judge: *"Could this exact behavior be a spreadsheet
formula?"* If yes, you built it wrong. The agent must do things a formula cannot — see §6.2/§6.3.

### 6.2 PricingAgent — what makes it agentic (not a decay curve)
- It is asked, each sweep: *given the signal bundle and objective, what should the price be now and why?*
- It must demonstrably be able to: **cut pre-emptively** when it predicts decay (dwell falling before views),
  **hold through a quiet patch** it judges temporary, and **distinguish boredom (falling dwell, steady views
  → too long/mispriced) from topic-death (falling views, steady dwell → audience exhausted)** and respond
  differently. These three behaviors are the proof; make sure the prompt elicits them and the reasoning chain
  records them.
- Output is clamped by the **envelope** in the contract (`[reserve, ceiling]`, `max_step`). The agent proposes;
  the contract enforces. A hallucinated price can never settle.
- The **reserve is the agent's decision**, re-evaluated slowly. Never a hardcoded floor.

### 6.3 ReaderAgent — two genuine judgments, no time threshold
- **Decision 1: prompt or not?** Judge whether the reader plausibly got value, *relative to the piece*
  (finished a long essay vs bounced at 20%; revisits; genuine pace vs tab-left-open). **No fixed time rule.**
- **Decision 2: how much?** If prompting, reason a specific amount in **[10%, 100%] of the view price** from
  the *shape* of engagement, and explain it to the reader in one human sentence.
- Runs **server-side at session-end**, fully off the read path. Pushes an async notification.
- On accept, if tip > suggestion, emit `tip_surplus` → feed PricingAgent (§6.5).

### 6.4 Mock mode (so dev doesn't burn tokens or block on keys)
Every agent must run with **no LLM key** in a deterministic *mock mode* that returns plausible decisions +
canned rationales, mirroring the reference repo's scripted fallback. Gate on `LLM_API_KEY` presence.
This keeps the spine runnable and demos reproducible. Mock decisions must still pass through the same
envelope clamp and produce the same output shape.

### 6.5 The one emergent loop to protect (innovation score)
`reader tips above suggestion → tip_surplus recorded → next PricingAgent sweep cites it → price rises`.
Instrument end-to-end so you can point at a concrete instance in the demo. Do not let other work cannibalize
the time to wire this.

### 6.6 Reasoning output contract (both agents emit this shape)
```ts
type AgentDecision = {
  kind: "price" | "tip" | "tip_skip";
  // price-only:
  oldPrice?: number; newPrice?: number; reserve?: number; objective?: "MAX_REVENUE" | "MAX_REACH";
  // tip-only:
  suggestedTip?: number; viewPricePaid?: number;
  signalsCited: string[];        // e.g. ["views_1h:3.1x","dwell_median:220s","bounce:thin"]
  reasoning: string;             // one short, creator/reader-readable paragraph
  confidence: number;            // 0..1 ; low confidence flags a price decision for dispute review
};
```

---

## 7. Hard rules / invariants (CI should assert these where possible)

1. **No price ever settles outside `[reserve, ceiling]`** and `reserve >= PRICE_FLOOR_MIN`, `ceiling <= PRICE_CEILING`.
2. **No price moves more than `max_step` per sweep.** Enforced in contract, asserted in tests.
3. **The read path makes zero LLM calls and zero awaited agent work.** x402 returns the stored standing price.
4. **All USDC math reads `decimals()` from the contract.** No hardcoded `1e6`/`1e18`. (§4.2 footgun.)
5. **Heartbeat counts active+focused time only** (Page Visibility). Backgrounded tabs do not accrue dwell.
6. **Session-end is heartbeat-timeout OR exit event**, never exit-event-only (mobile/hard-kill).
7. **Tip is in [10%, 100%] of the view price.** Slider and agent both bounded.
8. **Tip prompt is the agent's discretionary decision**, never a `dwell > N` gate.
9. **Secrets never appear in `NEXT_PUBLIC_*` or in source.** Testnet only.
10. **Every agent decision writes a reasoning-chain row** (for dashboard + dispute + audit).

---

## 8. Coding conventions

- TypeScript strict mode on. No `any` in module interfaces (internal `any` tolerated only behind a TODO).
- One module = one directory under `lib/` (logic) and, where it has routes/UI, under `app/`. See `PLAN.md`.
- Each module exposes a single `index.ts` barrel with its declared public interface; everything else is private.
- Side-effecting Circle/chain calls live behind a thin adapter (`lib/circle/`) so modules depend on *our*
  interface, not the SDK directly — this isolates SDK churn to one place.
- Money is represented as a `UsdcAmount` (string or bigint of base units + decimals), never a float in storage.
  Convert to/from display `number` only at the edges. (Floating-point cents will corrupt sub-cent accounting.)
- Tests: every `lib/` module ships a unit test; the envelope invariants (§7.1–7.2) and the decimals rule
  (§7.4) get explicit tests. Use mock mode for agent tests so they're deterministic.
- Commit messages reference the module id from `PLAN.md` (e.g. `M3: gateway adapter — deposit + balance`).

---

## 9. Definition of Done (applies to every module)

A module is done when: its public interface matches `PLAN.md`; unit tests pass; it runs in mock mode without
secrets; relevant §7 invariants are asserted in tests; `PROGRESS.md` is updated; and it composes with already
-built modules through declared interfaces (no reaching into internals). For payment-touching modules, "done"
additionally requires a **real testnet settlement observed on `testnet.arcscan.app`** at least once.

---

## 10. Demo & submission reminders (so we build toward the score)

- **Spine first** (PLAN M0–M4): a real sub-cent unlock settling on Arc + a visible price move by ~day 7. If
  that's not working, cut dashboard scope, not the payment loop. Traction is 30% and needs *real* payments.
- Report metrics in RFB-6 terms: total creator payouts, reader-to-payer conversion, avg price/piece.
- Have the §6.5 emergent loop reproducible on demand.
- Keep the dispute flow minimal (affordance + reasoning chain; human resolution). Do NOT build a dispute agent.
- Pitch as RFB 6 + 2 with a genuinely autonomous PricingAgent. **Do not claim agent-to-agent negotiation** —
  the architecture deliberately does not do it; claiming it invites a code inspection that fails.
