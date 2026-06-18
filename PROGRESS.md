# PROGRESS.md

> Update this at the END of every Claude Code session. The next session reads it FIRST (after CLAUDE.md).

## Status snapshot
- **Current module:** ALL DONE — M0–M9 complete, typecheck clean
- **Spine status:** Full system built. Ready for testnet integration.
- **Mock mode working:** yes (both services, no keys needed)
- **Last real testnet settlement seen:** none yet

## Next steps (testnet integration)
1. Create Supabase project → paste migrations from `supabase/migrations/` → fill NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local
2. Run `npm run seed` to populate creators + pieces
3. Fund BUYER wallet from https://faucet.circle.com/ (Arc Testnet USDC)
4. Fill ARC_RPC_URL, SELLER_ADDRESS, SELLER_PRIVATE_KEY, BUYER_ADDRESS, BUYER_PRIVATE_KEY, LLM_API_KEY (Groq) in .env.local
5. `npm run dev` (Cresc) + `npm run dev` (Cresc-Agents) → visit /piece/<id> and unlock
6. Observe settlement on testnet.arcscan.app
7. `npm run demo -- --tip-surplus` to generate signals + trigger emergent loop
8. Visit /dashboard to see live price moves + reasoning chains

## Module checklist
- [x] M0 Scaffold & config
- [x] M0-UI Landing page
- [x] M0b Agents scaffold
- [x] M1 Data layer
- [x] M2 Behavior tracking (useReadingTelemetry hook, /api/telemetry/{heartbeat,end,detect-end}, detectSessionEnd, enqueueJob reader_eval — both session-end paths)
- [x] M3 Circle adapter [WEB+AGENTS]
- [x] M4 x402 wall + instant unlock (app/api/piece/[id]/route.ts, app/actions/unlock.ts, app/piece/[id]/page.tsx, components/UnlockButton.tsx — telemetry + TipPrompt wired in)
- [x] M5 PricingAgent sweep worker [AGENTS] (getSignalBundle inline, 3 proof behaviors, envelope clamp, reserve reasoning, clock trigger via startPricingClock)
- [x] M6 ReaderAgent session eval worker [AGENTS] (2 genuine judgments, tip clamp [10%–100%], notifications insert, mock mode)
- [x] M7a Tip settle API [WEB] + M7b Tip feedback worker [AGENTS] (emergent loop: tip_surplus → pricing_sweep trigger=tip_surplus → PricingAgent cites surplus → price rises)
- [x] M8 Creator dashboard (LiveTicker, ReasoningChain, PriceChart with tip_surplus dots, ListDelistControl, Gateway balance + withdraw)
- [x] M9 Seeding & demo harness (scripts/seed.mts — 3 creators + 10 pieces + demo decisions; scripts/demo-harness.mts — simulated reader sessions, tip surplus, emergent loop trigger; app/api/piece/list, app/api/notifications)

## Architecture decision (2026-06-18)
Switched from monolith Next.js to two-service split:
- `Cresc/` = Next.js web (UI + x402 routes + telemetry + tip settle)
- `Cresc-Agents/` = Node.js workers (PricingAgent + ReaderAgent + queue consumer)
Queue = Supabase `jobs` table (no extra infra). Both TypeScript.
See CLAUDE.md §0.5 and PLAN.md §Service architecture.

## Session log

### 2026-06-18
- **Module:** M0
- **Done:** Next.js scaffold, shadcn/ui, recharts, Circle deps, lib/config.ts, lib/db.ts, lib/money.ts
  (27 tests pass), lib/llm/index.ts (mock mode), lib/circle stub, lib/repo stub, scripts/generate-wallets.mts
- **Stubbed / mocked:** lib/circle, lib/repo (stubs only)
- **Blocked on:** nothing — M0 complete
- **Assumptions:** Next.js 16.2.9 (latest at time); Tailwind v4 via shadcn nova preset
- **Next concrete step:** Build M0b (Cresc-Agents scaffold) + M1 (Supabase migrations + repos)
- **Real settlement observed?** No

### 2026-06-18 (session 2)
- **Module:** M0-UI Landing page
- **Done:** Full landing page implemented from Cresc design bundle (cresc-landing-page-design). layout.tsx updated (Sora+Manrope+JetBrains Mono fonts, metadata). globals.css extended with Cresc design tokens (--c-* custom props, dark/light themes, keyframe animations, hover classes). app/page.tsx full rewrite: loader (x402 padlock animation), frosted nav, hero with interactive x402 unlock demo (idle→locked→paying→settling→unlocked with coin animation), live marquee ticker, How It Works 3-col, Live Price Demo with sparkline SVG + pulse ring, Creator Dashboard with mini-spark + revenue chart + live reasoning log feed, Tip Mechanic card, Stats bar, CTA, Footer. Build passes, TS clean.
- **Next concrete step:** M0b (Cresc-Agents scaffold) + M1 (Supabase schema + repos)

### 2026-06-18 (session 3)
- **Modules:** M0b + M1
- **Done (M0b):** `../Cresc-Agents/` scaffold — package.json, tsconfig (ES2022/NodeNext), .env.example, src/config.ts, src/db.ts, src/money.ts, src/llm/index.ts (all keep-in-sync copies from Cresc), src/circle/index.ts stub, src/queue/consumer.ts (poll+claim+Realtime wakeup, optimistic lock, retry ≤3), src/queue/enqueue.ts, src/workers/{pricing,reader,tipFeedback}.ts stubs, src/index.ts entry. `npm run typecheck` clean.
- **Done (M1):** `supabase/migrations/20260618000000_init.sql` (10 tables: creators, pieces, sessions, heartbeats, payments, price_decisions, tip_decisions, disputes, jobs, notifications + Realtime on jobs). `supabase/migrations/20260618000001_functions.sql` (increment_revisit RPC). `lib/repo/types.ts` (all row types + SignalBundle + JobPayload union). Repos: creators, pieces, sessions, heartbeats, payments, price_decisions, tip_decisions, disputes, jobs, notifications, signals (getSignalBundle — multi-window parallel fetch). `lib/repo/index.ts` barrel. Cresc typecheck clean.
- **Blocked on:** Supabase project URL + service role key (migrations not applied yet — need real Supabase project). Apply with `supabase db push` or paste into dashboard SQL editor.
- **Next concrete step:** M3 (Circle/Gateway adapter) — run `use-gateway` skill first per CLAUDE.md §4.5
- **Real settlement observed?** No

### 2026-06-18 (session 4)
- **Module:** M3 (Circle adapter)
- **Done:** `lib/circle/index.ts` — full impl: getUsdcBalance (viem + ERC-20 decimals()), depositToGateway (GatewayClient), getGatewayBalance, buildPaymentRequirements, verifyAndSettle (BatchFacilitatorClient.settle() direct — no verify+settle), signPaymentAuthorization (BatchEvmScheme + viem WalletClient), withdrawFromGateway, explorerUrl. Mock mode gated on !ARC_RPC_URL || !SELLER_PRIVATE_KEY. 9 unit tests pass. `Cresc-Agents/src/circle/index.ts` synced. Both repos typecheck clean.
- **Stubbed:** Nothing — all functions live (mock mode for testnet ops)
- **Blocked on:** Nothing
- **Next concrete step:** M4 — x402 wall + instant unlock. Build `app/api/piece/[id]/route.ts` using BatchFacilitatorClient dynamic pricing (read pieces.current_price → buildPaymentRequirements → 402 or settle → create session row).
- **Real settlement observed?** No

### 2026-06-18 (session 6)
- **Modules:** M2, M4, M5, M6, M7a, M7b, M8 (parallel agents), M9 + integration wiring
- **Done (M2):** hooks/useReadingTelemetry.ts (Page Visibility + hasFocus gate, sendBeacon on pagehide), /api/telemetry/{heartbeat,end,detect-end}, lib/telemetry/detectSessionEnd
- **Done (M4):** app/api/piece/[id]/route.ts (402 + settle), app/actions/unlock.ts (buyer GatewayClient + mock path), app/piece/[id]/page.tsx, components/UnlockButton.tsx (wired telemetry + TipPrompt polling)
- **Done (M5):** Cresc-Agents/src/workers/pricing.ts — full PricingAgent: getSignalBundle inline, 3 proof behaviors elicited in prompt, envelope clamp, reserve re-eval, startPricingClock
- **Done (M6):** Cresc-Agents/src/workers/reader.ts — full ReaderAgent: deriveMetrics, 2 genuine judgments, tip clamp [10%–100%], notifications insert
- **Done (M7a):** app/api/tip/accept/route.ts, components/TipPrompt.tsx (slider, surplus detection)
- **Done (M7b):** Cresc-Agents/src/workers/tipFeedback.ts — emergent loop: tip_surplus → enqueue pricing_sweep trigger=tip_surplus
- **Done (M8):** app/dashboard/page.tsx + components/dashboard/{DashboardClient,LiveTicker,ReasoningChain,PriceChart,ListDelistControl} + /api/{balance,dispute,withdraw,piece/[id]/settings}
- **Done (M9):** scripts/seed.mts (3 creators, 10 pieces, 3 demo price_decisions), scripts/demo-harness.mts (simulated sessions + tip surplus trigger), app/api/piece/list, app/api/notifications
- **Integration wiring:** UnlockButton now wires useReadingTelemetry(sessionId) + polls /api/notifications for TipPrompt. payer returned from unlock action.
- **Blocked on:** Supabase project + Circle testnet keys
- **Real settlement observed?** No

### 2026-06-18 (session 5)
- **Module:** M8 (Creator dashboard)
- **Done:**
  - `app/dashboard/page.tsx` — Server Component; fetches creator + pieces + decisions + payments in parallel; falls back to mock data if DB unavailable.
  - `components/dashboard/DashboardClient.tsx` — Main shell: sticky top bar (creator info + Gateway balance + Withdraw); stats bar (listed pieces, total revenue, total decisions, unique readers); two-column layout (pieces sidebar + detail panel); Tabs (chart / reasoning / payments); realtime subscription for incoming payments.
  - `components/dashboard/LiveTicker.tsx` — Supabase Realtime subscription for price_decisions; price with direction arrow + trend color + reasoning snippet + confidence bar + trigger badge; pulse ring animation on update.
  - `components/dashboard/ReasoningChain.tsx` — Expandable decision list; low-confidence (< 0.5) entries flagged with Dispute button; dialog posts to /api/dispute; realtime for new decisions.
  - `components/dashboard/PriceChart.tsx` — Recharts ComposedChart: price line + revenue bars; tip_surplus trigger points as purple ReferenceDots.
  - `components/dashboard/ListDelistControl.tsx` — Status toggle + objective buttons; calls PATCH /api/piece/[id]/settings.
  - `app/api/balance/route.ts` — GET ?address → getGatewayBalance → display strings.
  - `app/api/dispute/route.ts` — POST { priceDecisionId, creatorId, note } → createDispute.
  - `app/api/piece/[id]/settings/route.ts` — PATCH { status?, objective? } → updates piece.
  - `app/api/withdraw/route.ts` — POST { to, chain, amount } → withdrawFromGateway → { txHash, explorerUrl }.
- **Stubbed:** Nothing — all live (mock Gateway when keys absent).
- **Blocked on:** Pre-existing M1 build issue — `lib/repo/index.ts` `.js` extension imports fail in Turbopack. `npx tsc --noEmit` clean; all new files error-free.
- **Next concrete step:** Fix M1 `.js` extensions in lib/repo/index.ts; then M9 seeding + demo harness.
- **Real settlement observed?** No
