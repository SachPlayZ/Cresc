# CITATION_TOLL.md — AI Citation Royalty Layer

> **Status: PLANNED — do not implement until Ghost integration is live on testnet.**
>
> Extends Cresc's monetization model beyond human readers to AI agents that ground answers
> in creator content. Every LLM crawl that cites a Cresc-registered article triggers an
> x402 microsettlement to the creator — no upstream changes to the LLM or the blog.

---

## 0. What this is

When an LLM (GPT, Claude, Perplexity, etc.) fetches a URL to ground an answer, it makes a
normal HTTP GET. Cresc inserts a middleware layer — a **Cloudflare Worker** — that:

1. Detects AI crawler traffic (User-Agent + optional API key header)
2. Checks if the requested URL maps to a Cresc-registered piece
3. Returns HTTP 402 with x402 payment requirements
4. On receipt of a signed payment: serves the full content to the LLM
5. Settles to the creator's Gateway balance via Circle on Arc

Human readers pass through normally (the worker only gates AI agents, not browsers).

---

## 1. Integration shape: Cloudflare Worker reverse proxy

```
┌──────────────────────────────────────────────────────────────────┐
│  Ghost blog (origin)                                             │
│  blog.example.com/my-article                                     │
└────────────────────┬─────────────────────────────────────────────┘
                     ▲ proxied (humans pass through, bots get 402)
                     │
┌────────────────────┴─────────────────────────────────────────────┐
│  Cloudflare Worker (cresc-citation-toll)                         │
│                                                                  │
│  1. Is User-Agent a known AI crawler?                            │
│     (GPTBot, ClaudeBot, PerplexityBot, CCBot, etc.)              │
│  2. GET /api/ghost/post-status?site=<id>&slug=<slug>            │
│     → { paywalled: true, pieceId, priceDisplay }                 │
│  3. If paywalled: return 402 + x402 PAYMENT-REQUIRED header     │
│  4. If PAYMENT-SIGNATURE present: forward settle req to Cresc,   │
│     serve content on success                                      │
│  5. If not AI or not paywalled: proxy through to Ghost origin    │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. AI crawler detection

Known bot User-Agents to gate (non-exhaustive, extend as needed):

```
GPTBot, ChatGPT-User, OAI-SearchBot,
ClaudeBot, Claude-Web,
PerplexityBot,
CCBot,
Applebot-Extended,
GoogleOther, Google-Extended,
Bytespider,
FacebookBot
```

Also gate any request with `X-LLM-Client` header (for agent-to-agent calls that self-identify).

Pass through: `Googlebot`, `Bingbot`, standard browsers (SEO traffic = good).

---

## 3. x402 payment flow for LLM agents

The LLM agent (or its operator's middleware) must:

1. Receive the 402 → parse `PAYMENT-REQUIRED` header
2. Have a funded Gateway wallet on Arc Testnet
3. Sign EIP-3009 authorization for the piece price
4. Retry with `PAYMENT-SIGNATURE` header
5. Receive full article HTML

This is identical to the human reader flow — the same x402 spec, same Gateway, same Arc chain.
No changes to `lib/circle/` or the piece API.

---

## 4. Implementation plan (post Ghost-live)

| # | Task | File |
|---|------|------|
| CT1 | Cloudflare Worker scaffold | `workers/cresc-citation-toll/index.ts` |
| CT2 | Bot UA detection list | `workers/cresc-citation-toll/bots.ts` |
| CT3 | post-status check (reuse existing API) | — (calls Cresc `/api/ghost/post-status`) |
| CT4 | 402 response builder | `workers/cresc-citation-toll/x402.ts` |
| CT5 | Payment settle relay (forwards sig to Cresc) | — (calls `/api/piece/[id]` with sig header) |
| CT6 | Origin proxy (passthrough for humans) | — |
| CT7 | Wrangler config + deploy | `workers/cresc-citation-toll/wrangler.toml` |

New env vars (Cloudflare secrets):
```
CRESC_API_URL=https://cresc.app
CRESC_SITE_ID=<creatorId>
```

No changes to the web app or agents service.

---

## 5. Demo story

> "Every time an AI searches the web and grounds an answer in your Ghost article,
> it pays you — automatically, in USDC, on Arc. No subscription. No API key management.
> One Cloudflare Worker, one snippet already installed."

This is RFB-2 (Selling Agent Services via Nanopayments) extended to the AI-to-creator axis.
Demo: run a Perplexity search on a topic covered by a connected Ghost blog → show the
citation settlement appear in the creator dashboard in real time.
