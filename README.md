<div align="center">

<img src="./web/public/cresc-logo-transparent.png" alt="Cresc Logo" width="200"/>

**Pay-per-article monetization for Ghost, settled in USDC on Arc via Circle Nanopayments.**

[![Arc Testnet](https://img.shields.io/badge/Arc-Testnet-blueviolet?style=flat-square)](https://testnet.arcscan.app)
[![x402 Protocol](https://img.shields.io/badge/x402-Protocol-FF5733?style=flat-square)](https://x402.org)
[![Built with Circle](https://img.shields.io/badge/Built_with-Circle_Stack-00D395?style=flat-square)](https://circle.com)
[![Next.js](https://img.shields.io/badge/Next.js-App_Router-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Foundry](https://img.shields.io/badge/Foundry-Solidity-black?style=flat-square)](https://getfoundry.sh)
[![Supabase](https://img.shields.io/badge/Supabase-DB-3ECF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com)

**[🌐 Live App](https://cresc.vercel.app)** · **[▶️ YouTube Demo](https://youtu.be/pduN69BrQxI)** · **[𝕏 @CrescOnChain](https://x.com/CrescOnChain)**

[Architecture](#architecture) · [Payment flow](#payment-flow) · [Deployed contracts](#deployed-contracts) · [Agents](#agents) · [Setup](#setup) · [Ghost quick-start](#ghost-quick-start)

</div>

---

## What is Cresc?

Cresc adds a live, AI-priced paywall to any [Ghost](https://ghost.org) publication. Readers unlock individual articles for a few cents in USDC, paid gas-free through the [x402 HTTP 402 protocol](https://x402.org) and [Circle Gateway](https://developers.circle.com/gateway) on Arc Testnet — no reader wallet setup, no per-article checkout flow.

Creator revenue is **not** custodied by Cresc. Each piece of content gets its own onchain `ContentVault` contract; USDC settles directly into it, and only the creator (or a creator-signed relay) can withdraw.

Two always-on agents drive the loop:

- **Reader Agent** — a shared, budget-constrained EOA that reads an article's price, weighs quality/interest/confidence via an LLM call, and decides whether to pay — entirely autonomously, no human in the request path.
- **Watcher** — reprices every article hourly. Demand signals (views, dwell, tips, normalized against 7-day rolling medians) feed one LLM judgment per article; the returned move is hard-clamped to ±5%/hr, and the full reasoning JSON is pinned to IPFS with its keccak256 hash committed onchain in the `PriceTuned` event — every price move is independently verifiable.

A **Creator Audit Agent** screens raw telemetry for bot/spam patterns before the Watcher ever sees it, so pricing reacts to real readers, not noise.

---

## Architecture

Three planes, two deploy targets, one settlement rail.

```
┌────────────────────────────┐   ┌──────────────────────────────┐   ┌───────────────────────┐
│  web/  (Next.js / Vercel)  │   │  agents/  (Node / EC2)        │   │  contracts/ (Foundry) │
│  stateless, no hot keys    │   │  always-on, holds raw keys    │   │  Arc Testnet          │
│                            │   │                                │   │                       │
│  • Creator onboarding +    │──▶│  • Reader Agent HTTP service  │──▶│  • ContentFactory     │
│    Circle UCW wallet bind  │   │    (budget + LLM gates, pays  │   │    deploys per-post   │
│  • Ghost content gate      │   │    via Gateway)               │   │    ContentVault       │
│    (x402 unlock route)     │   │  • Watcher (hourly tunePrice) │   │  • ContentVault holds │
│  • Ghost webhook proxy     │   │  • Creator Audit Agent        │   │    revenue, exposes   │
│  • Withdrawal sign-request │   │  • Redeposit loop (Gateway)   │   │    withdraw /         │
│    + relay to EC2          │   │                                │   │    withdrawSigned /   │
└─────────────┬──────────────┘   └───────────────┬────────────────┘   │    tunePrice          │
              │        HMAC-signed HTTP, both directions              └───────────┬───────────┘
              │                                   │                                │
              └───────────────── Supabase Postgres ┴──────── Arc RPC (viem) ───────┘
```

**Vercel ↔ EC2 boundary is HTTP, not a queue.** Every internal call carries `X-Cresc-Timestamp` + `X-Cresc-Signature` (`hmacSHA256` over `${timestamp}.${rawBody}`), verified on both sides. No public agent port — only Vercel egress and admin IPs reach it.

---

## Payment flow

```
Reader → POST /api/unlock/:slug (Vercel)
  → HMAC-signed POST /agent/evaluate-and-pay (EC2)
  → 4 gates pass → agent calls GatewayClient.pay(unlock_url)
  → GET /api/x402/:slug — 402, agent signs EIP-3009, retries with Payment-Signature
  → Vercel: BatchFacilitatorClient.verify() + .settle()
  → payment_events row written → unlock_token returned → content served
```

The **Reader Agent** short-circuits on the first hard fail across four gates:

1. **Budget** (deterministic) — reject if daily/session spend would be exceeded. No LLM call is made for a budget fail.
2. **Quality**, **Interest**, **Confidence** — one Groq call returns strict JSON scores against the article's title/excerpt/topics and the reader's recent telemetry. Pay only if all three clear their thresholds.

Runs in a **deterministic mock mode** with no `GROQ_API_KEY` set, so the pay loop is testable without burning LLM tokens.

`unlock_token` is `${expiry}:${site}:${slug}:${readerId}:${hmacSig}` — a 1-hour-TTL, HMAC-signed capability, not a session cookie.

---

## Deployed contracts

All contracts live on **Arc Testnet** (chain id `5042002`) — browse them on [Arcscan](https://testnet.arcscan.app).

| Contract | Address | Role |
|----------|---------|------|
| `ContentFactory` | [`0x2727656c29471415c230C67fb7f6200aB0536EAD`](https://testnet.arcscan.app/address/0x2727656c29471415c230C67fb7f6200aB0536EAD) | Deploys one `ContentVault` per Ghost post ([deploy tx](https://testnet.arcscan.app/tx/0xa8dbd8546cfc917e13720d56e5a541448b10c0679c0cf32a4aaabcade0a497b9)) |
| `ContentVault` (per article) | deployed by the factory — one per post, look up any vault via the factory's read methods | Holds one article's USDC revenue; exposes `tunePrice`, `withdraw`, `withdrawAll`, `withdrawSigned` |

Circle protocol contracts Cresc settles against on Arc Testnet:

| Contract | Address | Role |
|----------|---------|------|
| USDC (ERC-20) | [`0x3600000000000000000000000000000000000000`](https://testnet.arcscan.app/address/0x3600000000000000000000000000000000000000) | Settlement asset — 6-decimal ERC-20 interface |
| Gateway Wallet | [`0x0077777d7EBA4688BDeF3E311b846F25870A19B9`](https://testnet.arcscan.app/address/0x0077777d7EBA4688BDeF3E311b846F25870A19B9) | EIP-3009 `verifyingContract` for batched x402 payments |
| Gateway Minter | [`0x0022222ABE238Cc2C7Bb1f21003F0a260052475B`](https://testnet.arcscan.app/address/0x0022222ABE238Cc2C7Bb1f21003F0a260052475B) | Gateway withdraw / mint |

### Contract design

`contracts/` (Foundry) — `forge test` / `forge build` from the repo root.

| Contract | Role |
|----------|------|
| `ContentFactory` | Deploys one `ContentVault` per Ghost post, keyed by `keccak256(creatorId:ghostPostId)`. Owner-gated (the EC2 relayer). |
| `ContentVault` | Holds one article's USDC revenue. Exposes `tunePrice` (price-tuner only), `withdraw`/`withdrawAll` (creator's own key), and `withdrawSigned` (EIP-712, relayed). |

**Why `withdrawSigned` exists:** the EC2 relayer key can submit withdrawals on the creator's behalf (so a creator never needs gas or a hot wallet), but it cannot originate one. Every relayed withdrawal carries an EIP-712 `Withdraw(to, amountAtomic, nonce)` message signed by the creator's own Circle User-Controlled Wallet — a compromised relayer key alone can't drain a vault.

```bash
forge fmt --check
forge build --sizes
forge test -vv
```

Deploy (see `contracts/DEPLOY.md`): keystore-signed, never a plaintext private key.

```bash
forge script contracts/script/DeployContentFactory.s.sol \
  --rpc-url "$ARC_RPC_URL" --account <keystore-account> --sender <address> --broadcast
```

---

## Agents

`agents/` — Express service on EC2, systemd-managed (`Restart=always`).

| Endpoint / worker | Purpose |
|---|---|
| `POST /agent/evaluate-and-pay` | Reader Agent's four-gate pay decision |
| `POST /agent/tip` | Budget-gated tip to a creator |
| `POST /agent/withdraw-content` | Relays a creator-signed `withdrawSigned` call |
| `GET /healthz` | Gateway balance, last payment, LLM reachability — unauthenticated, for external monitors |
| Watcher | Hourly `tunePrice` per active article from audited telemetry, reasoning pinned to IPFS |
| Creator Audit Agent | Pre-filters bot/spam telemetry before the Watcher reads it |

> [!IMPORTANT]
> Run exactly **one** Reader Agent instance against the shared buyer key — two instances signing from the same EOA collide on nonces.

---

## Database schema

Postgres via Supabase. Migrations in `agents/supabase/migrations/`, applied with `npx supabase db push` from `agents/`.

| Table | Purpose |
|-------|---------|
| `creators` | Ghost connection, Circle wallet binding |
| `readers` | Budgets and spend counters for the shared buyer EOA's sessions |
| `articles` | Slug, `content_contract`, cached price, Ghost post metadata, per-article monetization toggle |
| `telemetry` / `telemetry_audited` | Raw and bot-filtered engagement events — Watcher reads only the audited table |
| `payment_events` | Append-only settlement log (public read, service-role insert) |
| `withdrawals` | Creator payout requests and their onchain status |
| `price_history` | Every `tunePrice` decision with its normalized inputs, IPFS reason CID, and tune tx hash |

> [!NOTE]
> Money is stored as atomic 6-decimal USDC integers end to end (`$0.05 = 50000`) — never a float, never dollars. See `web/lib/money.ts` / `agents/src/money.ts`.

---

## Setup

### Prerequisites

- Node.js v22+
- [Foundry](https://getfoundry.sh) (`forge`, `cast`)
- Supabase project
- Arc Testnet gas from the [Circle Faucet](https://faucet.circle.com/)
- Groq API key (optional — agents run in mock mode without one)

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

Generate the buyer + content-tuner EOA keypairs:

```bash
cd agents && npm run generate-wallets
```

Fill in `ARC_RPC_URL`, `INTERNAL_HMAC_SECRET` (same value in both `.env.local` files), Supabase keys, and Circle UCW credentials. See `agents/src/config.ts` / `web/lib/config.ts` — both are the source of truth for every env var name.

### 3. Deploy the content factory (once per environment)

```bash
forge script contracts/script/DeployContentFactory.s.sol \
  --rpc-url "$ARC_RPC_URL" --account <keystore-account> --sender <address> --broadcast
```

Set the resulting address as `CONTENT_FACTORY_ADDRESS` in both `.env.local` files (the current testnet deployment is [`0x2727…6EAD`](https://testnet.arcscan.app/address/0x2727656c29471415c230C67fb7f6200aB0536EAD)).

### 4. Apply migrations

```bash
cd agents && npx supabase db push
```

### 5. Run

```bash
# Terminal 1 — Web frontend
cd web && npm run dev

# Terminal 2 — Agents service
cd agents && npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

> [!WARNING]
> `.env.local` files hold real secrets (RPC token, service-role key, raw private keys) — never commit them. They're gitignored by default; keep it that way.

---

## Ghost quick-start

1. Go to `/ghost-onboard` on your Cresc deployment.
2. Enter a display name, connect a Circle wallet, then your Ghost instance URL and Admin API key.
3. Cresc syncs your published posts and deploys a `ContentVault` for each.
4. Paste the generated webhook URL + secret into Ghost Admin → Settings → Webhooks (Post published / updated / deleted).
5. Paste the `<script>` snippet into Ghost Admin → Settings → Code Injection → **Site Header** (the header slot lets the snippet cloak paid content before first paint — a footer script would flash the full article).
6. Every published post now has a live paywall; new posts sync automatically via the webhook. Toggle monetization per article from the dashboard to serve any post free.

---

## Key files

| File | Purpose |
|------|---------|
| `contracts/src/ContentVault.sol` | Per-content revenue vault, pricing, EIP-712 withdrawal |
| `contracts/src/ContentFactory.sol` | Deploys/tracks one vault per content id |
| `agents/src/index.ts` | Express server: `/agent/*` HMAC-authenticated endpoints |
| `agents/src/workers/reader-agent.ts` | Four-gate pay decision logic |
| `agents/src/workers/watcher.ts` | Hourly repricing against audited telemetry |
| `agents/src/workers/audit.ts` | Bot/spam telemetry pre-filter + LLM outlier judgment |
| `agents/src/workers/content-contracts.ts` | viem client for factory/vault reads and writes |
| `agents/src/ipfs.ts` | Pins Watcher pricing reasons to IPFS (Pinata) |
| `web/app/api/x402/[slug]/route.ts` | x402 seller route: verify, settle, mint `unlock_token` |
| `web/app/api/withdraw/sign-request/route.ts` | Builds the EIP-712 payload for Circle UCW to sign |
| `web/lib/circle/index.ts` | Circle Gateway + vault read helpers |
| `web/lib/hmac.ts` / `agents/src/middleware/hmac.ts` | Vercel ↔ EC2 request signing (keep in sync) |
| `web/public/cresc-ghost.js` | Self-contained paywall snippet injected into Ghost sites |

For the full design — invariants, startup assertions, resolved architecture decisions — see `CLAUDE.md` and `cresc-architecture.md`.
