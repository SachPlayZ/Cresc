# PROGRESS.md

> Update this at the END of every Claude Code session. The next session reads it FIRST (after CLAUDE.md).

## Status snapshot
- **Current module:** CREATOR_PAYOUT.md — all 5 modules complete (M-P0 through M-P4/P5).
- **Spine status:** Full system built + Circle payout flow added. `npx tsc --noEmit` clean.
- **Mock mode working:** yes (withdrawFromGatewayCircle returns fake hash when !isCircleWalletMode)
- **Last real testnet settlement seen:** none yet

## NEXT STEPS — payout bring-up

Apply migration: `supabase db push` (adds `payout_ref` column + index to payments table)

Then testnet bring-up:

## NEXT STEPS — testnet bring-up

**Apply new migration first:**
```
supabase db push   # or paste 20260618000003_reader_wallets.sql into Supabase SQL editor
```

**Generate READER_KEY_SECRET:**
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Add to `.env.local` as `READER_KEY_SECRET=<output>`.

**Then follow the Option A or B testnet flow from the previous next steps section.**

**Done checklist (READER_WALLET_PLAN.md §DoD):**
- [x] `supabase/migrations/20260618000003_reader_wallets.sql` — reader_wallets table + sessions FK
- [x] `lib/reader-wallets/index.ts` — getOrCreateReaderWallet, getReaderBalance, signReaderPayment, recordSpend, getSpendableBalance
- [x] `GET /api/reader/wallet` — cookie set + wallet create
- [x] `GET /api/reader/balance` — on-chain + gateway balance + auto-deposit
- [x] `app/actions/unlock.ts` — reader wallet path (preferred), platform key fallback, mock fallback
- [x] `components/DepositPrompt.tsx` — EIP-681 MetaMask link, copy address, check balance polling
- [x] `components/UnlockButton.tsx` — wallet state machine (loading→no-usdc→depositing→ready), balance display
- [x] `READER_KEY_SECRET` in `.env.example` + `lib/config.ts`
- [x] `lib/repo/types.ts` — ReaderWallet type added
- [x] `npx tsc --noEmit` clean

## Previous next steps (testnet integration)
**Option A — raw EOA keys (simplest):**
1. Create Supabase project → apply `supabase/migrations/` → fill NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
2. `npm run generate-wallets` → fill SELLER_ADDRESS, SELLER_PRIVATE_KEY, BUYER_ADDRESS, BUYER_PRIVATE_KEY
3. Fund BUYER from https://faucet.circle.com/ (Arc Testnet USDC)
4. Fill ARC_RPC_URL, LLM_API_KEY → `npm run dev` + agents `npm run dev`

**Option B — Circle developer-controlled wallets (Circle tooling score):**
1. Get API key from console.circle.com; generate+register entity secret
2. `npx tsx --env-file=.env.local scripts/setup-circle-wallets.mts` → copy output to .env.local
3. Faucet CIRCLE_BUYER_WALLET_ADDRESS; deposit into Gateway
4. Signing auto-detects CIRCLE_API_KEY → uses MPC signTypedData instead of raw private key

**Both:**
- `npm run seed` → `npm run dev` → unlock piece → observe testnet.arcscan.app
- `npm run demo -- --tip-surplus` → emergent loop
- /dashboard → live price moves + reasoning chains

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

## NEXT STEPS — Creator editor bring-up

**AWS S3 (one-time, outside code):**
1. Create bucket `piece-media-cresc` in `us-east-1` (or your region), block all public access.
2. Add CORS: `[{ "AllowedOrigins":["*"], "AllowedMethods":["PUT","GET"], "AllowedHeaders":["*"], "MaxAgeSeconds":3600 }]`
3. Create IAM user with `s3:PutObject + s3:GetObject` on `arn:aws:s3:::piece-media-cresc/*`. Save key + secret.
4. Add to `.env.local`: `AWS_ACCESS_KEY_ID=`, `AWS_SECRET_ACCESS_KEY=`, `AWS_REGION=us-east-1`, `S3_BUCKET=piece-media-cresc`

**DB migration:**
```
supabase db push   # applies 20260618000004_piece_kind.sql (pieces.kind column)
```

**Done checklist (CREATOR_EDITOR.md):**
- [x] `supabase/migrations/20260618000004_piece_kind.sql` — pieces.kind column ('article'|'video')
- [x] `lib/repo/types.ts` — kind added to Piece type
- [x] `POST /api/media/presign` — S3 presigned PUT, mock mode when no AWS keys
- [x] `components/RichEditor.tsx` — Tiptap (StarterKit + Image + Link + Placeholder + VideoBlock), toolbar, image/video upload via presign
- [x] `app/create/page.tsx` — swapped Textarea → RichEditor, kind inferred from HTML, wordCount on HTML
- [x] `app/api/piece/create/route.ts` — accepts kind field, infers from body HTML as fallback
- [x] `app/piece/[id]/page.tsx` — isVideo flag, video placeholder pre-unlock, "HTTP 402 · video locked" badge
- [x] `components/UnlockButton.tsx` — dangerouslySetInnerHTML with client-side DOMPurify sanitize, prose styles, isVideo prop
- [x] `.env.example` — AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET, S3_CDN_BASE added
- [x] M-C7: `app/create/page.tsx` — `useSignMessage` signs `cresc:create:<timestamp>` before publish; `ConnectButton` gate when wallet not connected; button label changes to "Sign & Publish →"
- [x] M-C7: `app/api/piece/create/route.ts` — `recoverMessageAddress` (viem) verifies signature matches `creator.wallet_address`; 5-minute timestamp window prevents replay; absent signature allowed (mock/dev)
- [x] `npx tsc --noEmit` clean

### 2026-06-18 (Circle fixes + deployment-prep session)
- **Critical bugs fixed:**
  - `isMockCircle` in `web/lib/circle/index.ts` + `agents/src/circle/index.ts` was `!SELLER_PRIVATE_KEY` which forced mock mode when using Circle wallets. Fixed to `(!SELLER_PRIVATE_KEY && !isCircleWalletMode)`.
  - `getGatewayBalance` in both files crashed in Circle mode (tried to create GatewayClient with empty key). Fixed to use `getCircleWalletBalance(CIRCLE_SELLER_WALLET_ID)` fallback in Circle mode.
  - `depositToGateway` for Circle reader wallets was doing a plain `transferUsdc` which sends ERC-20 tokens to Gateway address but Gateway never registers the balance. Fixed to `depositToGatewayCircle`: `approve(GATEWAY, amount)` then `deposit(USDC, amount)` via `createContractExecutionTransaction`.
  - `web/lib/reader-wallets/index.ts` auto-deposit now calls `depositToGatewayCircle` for Circle wallets.
  - `READER_KEY_SECRET` check added before `createRawEOA` with clear error message.
  - `agents/src/config.ts` `validateAgentConfig()` now checks `ARC_RPC_URL`, `SELLER_ADDRESS`, `SELLER_PRIVATE_KEY` (non-Circle) + `LLM_API_KEY` (non-mock) at startup.
  - `agents/package.json` `start` script: removed `--env-file=../.env.local` (fails on Railway). Moved `tsx` to `dependencies` (needed at runtime).
- **Creator editor (CREATOR_EDITOR.md):** All 7 modules complete — S3 presign, Tiptap rich editor, pieces.kind migration, create page, unlock render, video placeholder, M-C7 wallet signature verify.
- **NEXT STEPS:**
  1. Apply migrations: `supabase db push`
  2. Set `READER_KEY_SECRET` (raw EOA mode) or use Circle wallet mode (CIRCLE_API_KEY + ENTITY_SECRET)
  3. Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` from cloud.walletconnect.com
  4. Deploy agents to Railway: set all env vars in Railway dashboard, run `npm start`
  5. Set `NEXT_PUBLIC_APP_URL` to your Vercel domain
  6. Verify S3 bucket CORS (AllowedMethods: PUT, GET; AllowedOrigins: *)
  7. Do one testnet unlock → observe on testnet.arcscan.app

## Session log

### 2026-06-18 (creator editor session)
- **Module:** CREATOR_EDITOR.md — all 7 modules (M-C1 through M-C6)
- **Done (M-C1):** `POST /api/media/presign` — S3 presign route, allowlist MIME + ext validation, UUID key, mock mode without AWS creds
- **Done (M-C2):** `components/RichEditor.tsx` — Tiptap StarterKit + Image + Link + Placeholder + custom VideoBlock; toolbar H1/H2/B/I/S/Link/Image/Video/Code/Quote; upload flow (presign→PUT S3→insert at cursor)
- **Done (M-C3):** `supabase/migrations/20260618000004_piece_kind.sql` — `pieces.kind` column; `lib/repo/types.ts` updated
- **Done (M-C4):** `app/create/page.tsx` — Textarea replaced with RichEditor; kind inferred from HTML; HTML-aware word count
- **Done (M-C5):** `app/api/piece/create/route.ts` — accepts kind; `components/UnlockButton.tsx` — renders HTML with DOMPurify client-side sanitize + prose CSS; `app/piece/[id]/page.tsx` — isVideo prop plumbed
- **Done (M-C6):** `app/piece/[id]/page.tsx` — video placeholder (dark box + padlock icon) pre-unlock; "HTTP 402 · video locked" badge; "Unlock to watch" meta copy
- **Packages installed:** @tiptap/react, @tiptap/pm, @tiptap/starter-kit, @tiptap/extension-image, @tiptap/extension-link, @tiptap/extension-placeholder, @tiptap/extension-youtube, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, isomorphic-dompurify, @types/dompurify
- **Stubbed:** nothing — all 7 modules complete
- **Blocked on:** AWS setup (one-time console steps) and `supabase db push` for new migration
- **Real settlement observed?** No
- **Next concrete step:** AWS S3 bucket + CORS + IAM setup, apply migration, then testnet bring-up

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
