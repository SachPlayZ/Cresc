# PROGRESS — 2026-06-26

## Architecture pivot complete: Ghost-native, EC2 HTTP agent, Circle Gateway

All code typechecks clean (tsc --noEmit: 0 errors on both web + agents).

---

## What's built

### DB Migration (`agents/supabase/migrations/20260626000000_new_arch.sql`)
New tables: `articles`, `readers`, `telemetry`, `telemetry_audited`, `payment_events`, `price_history`, `withdrawals`.
RPC: `record_reader_spend`, `reset_session_budget` (atomic budget tracking).
`payment_events` has RLS: public read, service-role insert.
Old `pieces` table kept for backward compat.

### Vercel (Next.js web app)
- `web/lib/hmac.ts` — HMAC sign/verify for Vercel↔EC2 auth
- `web/lib/repo/articles.ts` — Ghost-native article repo (slug PK, current_price_atomic bigint)
- `web/lib/repo/readers.ts` — per-reader budget tracking (calls `record_reader_spend` RPC)
- `web/lib/repo/types.ts` — new types: Article, Reader, Telemetry, PaymentEvent, PriceHistory, Withdrawal
- `web/lib/repo/index.ts` — barrel updated with new exports
- `web/lib/config.ts` — INTERNAL_HMAC_SECRET, EC2_AGENT_BASE_URL, GHOST_WEBHOOK_SECRET added
- `web/app/api/unlock/[slug]/route.ts` — NEW: POST, HMAC-calls EC2, records payment_events, returns unlock_token
- `web/app/api/ghost/connect/route.ts` — rewrites to `articles` table (was `pieces`)
- `web/app/api/ghost/sync/route.ts` — rewrites to `articles` table
- `web/app/api/ghost/post-status/route.ts` — queries `articles` first, falls back to `pieces`
- `web/app/read/page.tsx` — new slug-based flow (`?slug=...&site=...&unlock_token=...`); legacy pieces flow kept
- `web/components/UnlockButton.tsx` — added `GhostUnlockButton` for new flow
- `web/public/cresc-ghost.js` — unlock URL now `/read?slug=...&site=...` (not `/piece/[id]`)

### EC2 Agent service (`agents/`)
- `agents/src/config.ts` — rewritten: BUYER_PRIVATE_KEY, INTERNAL_HMAC_SECRET, gate thresholds, Watcher tuning
- `agents/src/middleware/hmac.ts` — Express HMAC validation + raw body capture
- `agents/src/workers/reader-agent.ts` — 4 gates (Budget/Quality/Interest/Confidence) + GatewayClient.pay()
- `agents/src/workers/watcher.ts` — hourly repricing (deterministic formula, ±20%/hr damp, writes price_history)
- `agents/src/workers/audit.ts` — 2-layer audit (deterministic filter + LLM authentic_fraction)
- `agents/src/index.ts` — Express HTTP server: /agent/evaluate-and-pay, /agent/tip, /agent/withdraw, /healthz
- `agents/package.json` — added express@5 + @types/express

---

## New flow (end-to-end)

```
Ghost page loads cresc-ghost.js
  → GET /api/ghost/post-status?site=...&slug=...  (fast DB read, <100ms)
  → overlay with price + "Pay & Read" button linking to /read?slug=...&site=...

Reader clicks → lands on /read page (Cresc Vercel)
  → shows GhostUnlockButton
  → user clicks "Pay" → POST /api/unlock/[slug] (Vercel)
  → Vercel HMAC-signs → POST EC2:4000/agent/evaluate-and-pay
  
EC2 Reader Agent:
  Gate 1: budget check (Postgres readers table)
  Gates 2-4: one Groq call → quality/interest/confidence
  Decision: pay IFF all gates pass
  Pay: GatewayClient.pay(unlock_url) with shared BUYER_PRIVATE_KEY
  → returns { decision: paid, unlock_token, payment }

Vercel:
  → inserts payment_events row (append-only)
  → returns unlock_token to browser
  → browser redirects to /read?...&unlock_token=...

/read page (post-unlock):
  → fetches full Ghost HTML via Ghost Admin API (server-side only)
  → renders in GhostReader with telemetry

EC2 Watcher (hourly):
  → reads telemetry_audited (Audit Agent must run first)
  → demand = W_VIEWS*norm(views) + W_DWELL*norm(dwell) + W_TIPS*norm(tips)
  → updates articles.current_price_atomic + appends price_history

EC2 Audit Agent (55min interval, runs before Watcher):
  → deterministic filter: drop dwell<1500ms, rate-limit per reader, self-tip
  → LLM judgment for outliers: authentic_fraction
  → writes telemetry_audited
```

---

## Next steps

1. **Apply migration**: `supabase db push` (or run SQL in Supabase dashboard)
2. **Deploy EC2**: `npm install && npm start` on EC2, PM2 for persistence, set all env vars
3. **Set env vars** (both Vercel + EC2):
   - `INTERNAL_HMAC_SECRET` — shared secret (32 random bytes)
   - `EC2_AGENT_BASE_URL` — e.g. `http://your-ec2-ip:4000`
   - `BUYER_PRIVATE_KEY` — EC2 only (shared buyer EOA raw key)
   - `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` — EC2 only
4. **Fund buyer wallet**: `BUYER_PRIVATE_KEY` wallet needs testnet USDC from faucet.circle.com
5. **Gateway deposit**: `client.deposit("1")` on EC2 startup (or via /healthz check)
6. **Verify testnet settlement**: watch `testnet.arcscan.app`

## Blocked / TODO

- `POST /agent/withdraw` — Circle dev-controlled wallet burn-intent withdrawal not yet implemented (placeholder response)
- Creator dashboard needs update to show `articles` table data instead of `pieces`
- `readers` table: no signup flow yet — browser generates UUID stored in localStorage
- Missing: `/api/telemetry/view` route to ingest view events into `telemetry` table
- Missing: Supabase `IF NOT EXISTS` on policies may need adjustment if running against existing DB

## Old code status
- `agents/src/workers/pricing.ts` — superseded by `watcher.ts` (kept, compiles, unused)
- `agents/src/workers/reader.ts` — superseded by `reader-agent.ts` (kept, compiles, unused)
- `agents/src/queue/` — superseded by HTTP server (kept, compiles, unused)
- `web/app/actions/unlock.ts` — old pieces-based unlock (kept, used by legacy UnlockButton)
- `web/lib/repo/pieces.ts` — kept for legacy UI routes
