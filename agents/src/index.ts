// src/index.ts — Cresc EC2 agent service entry point.
// Express HTTP server (not queue-based). Holds the one raw buyer key + Circle entity secret.
// Endpoints: /agent/evaluate-and-pay, /agent/tip, /agent/withdraw, /healthz
// Workers: Watcher (hourly reprice), Audit Agent (pre-Watcher telemetry filter).

import express, { type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createPublicClient, http, defineChain } from 'viem';
import { GatewayClient } from '@circle-fin/x402-batching/client';
import {
  validateAgentConfig,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  BUYER_PRIVATE_KEY,
  ARC_SDK_CHAIN,
  ARC_RPC_URL,
  ARC_CHAIN_ID,
  USDC_ADDRESS,
  PORT,
  GATEWAY_REDEPOSIT_THRESHOLD_USDC,
  GATEWAY_REDEPOSIT_AMOUNT_USDC,
  WATCHER_INTERVAL_MS,
  AUDIT_INTERVAL_MS,
  APP_BASE_URL,
  INTERNAL_HMAC_SECRET,
  GROQ_API_KEY,
  GROQ_BASE_URL,
  isGroqMockMode,
  isPaymentMockMode,
} from './config.js';
import { hmacAuth } from './middleware/hmac.js';
import { evaluateAndPay, type ArticleInput } from './workers/reader-agent.js';
import { startWatcher } from './workers/watcher.js';
import { startAudit } from './workers/audit.js';
import { ensureContentContract, withdrawFromContent, type ContentInput } from './workers/content-contracts.js';

validateAgentConfig();

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const app = express();

// Capture raw body while JSON parsing so HMAC verification and req.body both work.
app.use(express.json({
  verify: (req, _res, buf) => {
    (req as Request & { rawBody?: string }).rawBody = buf.toString('utf8');
  },
}));

const arcTestnetChain = defineChain({
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL || 'https://arc-testnet.drpc.org'] } },
});

const DECIMALS_ABI = [{
  name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }],
}] as const;

// --- Startup assertions (CLAUDE.md §Startup assertions) ---
async function assertStartup(): Promise<void> {
  // 1. SELLER_PRIVATE_KEY must be absent
  if (process.env.SELLER_PRIVATE_KEY) {
    throw new Error('[startup] SELLER_PRIVATE_KEY must NOT be set on EC2 — creator payouts are ContentVault withdrawals (direct or CONTENT_TUNER_PRIVATE_KEY-relayed signed withdrawals), never an app-held raw creator key');
  }
  if (!isPaymentMockMode) {
    if (!BUYER_PRIVATE_KEY) {
      throw new Error('[startup] BUYER_PRIVATE_KEY required in live mode');
    }
    // 2. Chain ID assertion
    const publicClient = createPublicClient({ chain: arcTestnetChain, transport: http(ARC_RPC_URL) });
    const chainId = await publicClient.getChainId();
    if (chainId !== ARC_CHAIN_ID) {
      throw new Error(`[startup] chain id mismatch: expected ${ARC_CHAIN_ID}, got ${chainId}`);
    }
    // 4. USDC decimals assertion
    const decimals = await publicClient.readContract({
      address: USDC_ADDRESS as `0x${string}`,
      abi: DECIMALS_ABI,
      functionName: 'decimals',
    });
    if (decimals !== 6) {
      throw new Error(`[startup] USDC decimals: expected 6, got ${decimals}`);
    }
    console.log('[startup] assertions passed: chainId=5042002, USDC decimals=6');
  }
}

// --- Single shared GatewayClient (one instance = one nonce sequence) ---
let _gatewayClient: InstanceType<typeof GatewayClient> | null = null;

export function getGatewayClient(): InstanceType<typeof GatewayClient> | null {
  if (isPaymentMockMode || !BUYER_PRIVATE_KEY) return null;
  if (!_gatewayClient) {
    _gatewayClient = new GatewayClient({
      chain: ARC_SDK_CHAIN,
      privateKey: BUYER_PRIVATE_KEY as `0x${string}`,
      rpcUrl: ARC_RPC_URL,
    });
  }
  return _gatewayClient;
}

function generateUnlockToken(site: string, slug: string, readerId: string): string {
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const data = `${expiry}:${site}:${slug}:${readerId}`;
  const sig = crypto.createHmac('sha256', INTERNAL_HMAC_SECRET).update(data).digest('hex');
  return `${data}:${sig}`;
}

function verifyGhostSignature(rawBody: string, signatureHeader: string, webhookSecret: string): boolean {
  try {
    const parts = Object.fromEntries(
      signatureHeader.split(',').map((p) => {
        const [k, v] = p.trim().split('=');
        return [k, v];
      })
    );
    const receivedHex = parts.sha256;
    const timestamp = parts.t;
    if (!receivedHex || !timestamp) return false;
    // Ghost signs body + timestamp concatenated (not body alone) — see
    // https://docs.ghost.org/webhooks, X-Ghost-Signature: sha256=<hex>, t=<ms epoch>.
    const expected = crypto
      .createHmac('sha256', Buffer.from(webhookSecret))
      .update(`${rawBody}${timestamp}`)
      .digest();
    const received = Buffer.from(receivedHex, 'hex');
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
  } catch {
    return false;
  }
}

async function upsertContent(input: ContentInput): Promise<Record<string, unknown>> {
  const deployment = await ensureContentContract(db, input);
  const { error } = await db.from('articles').upsert({
    slug: input.slug,
    creator_id: input.creator_id,
    title: input.title,
    excerpt: input.excerpt,
    topics: [],
    base_price_atomic: input.initial_price_atomic ?? 50000,
    current_price_atomic: input.initial_price_atomic ?? 50000,
    ghost_post_id: input.ghost_post_id,
    ghost_instance_url: input.ghost_instance_url,
    content_id: deployment.content_id,
    content_contract: deployment.content_contract,
    metadata_uri: deployment.metadata_uri,
    metadata_hash: deployment.metadata_hash,
    factory_tx: deployment.tx_hash,
    active: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'creator_id,ghost_post_id' });
  if (error) throw error;
  return deployment;
}

// --- Gateway redeposit loop (self-healing, with in-flight guard and retry) ---
let _isRedepositing = false;

async function redeposit(): Promise<void> {
  if (_isRedepositing) return; // prevent concurrent deposits on same EOA
  const client = getGatewayClient();
  if (!client) return;

  _isRedepositing = true;
  try {
    const balances = await client.getBalances();
    const available = balances.gateway?.available ?? 0n;
    const threshold = BigInt(Math.round(parseFloat(GATEWAY_REDEPOSIT_THRESHOLD_USDC) * 1_000_000));

    if (available < threshold) {
      console.log(`[gateway] balance low (${available} atomic), redepositing ${GATEWAY_REDEPOSIT_AMOUNT_USDC} USDC`);

      let lastErr: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await client.deposit(GATEWAY_REDEPOSIT_AMOUNT_USDC);
          lastErr = undefined;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt < 2) {
            const delayMs = 1000 * (attempt + 1);
            console.warn(`[gateway] deposit attempt ${attempt + 1} failed, retrying in ${delayMs}ms:`, err);
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }
      }

      if (lastErr) {
        console.error('[gateway] redeposit failed after 3 attempts:', lastErr);
      }
    }
  } catch (err) {
    console.error('[gateway] redeposit balance check error:', err);
  } finally {
    _isRedepositing = false;
  }
}

// --- In-flight tracker for graceful shutdown ---
let _inFlightCount = 0;
let _shuttingDown = false;

function trackInflight<T>(fn: () => Promise<T>): Promise<T> {
  _inFlightCount++;
  return fn().finally(() => { _inFlightCount--; });
}

// --- Routes ---

// Health check — NOT behind hmacAuth so external monitors (ALB, UptimeRobot) can reach it
app.get('/healthz', async (_req: Request, res: Response) => {
  const client = getGatewayClient();
  let balance = 'mock';
  let lastPayment: string | null = null;
  let groqReachable: boolean | null = null;

  if (client) {
    try {
      const b = await client.getBalances();
      balance = b.gateway?.formattedAvailable ?? '?';
    } catch {
      balance = 'error';
    }
  }

  try {
    const { data } = await db
      .from('payment_events')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    lastPayment = data?.created_at ?? null;
  } catch {
    // no payments yet — fine
  }

  // Groq reachability check
  if (isGroqMockMode) {
    groqReachable = null; // mock mode: N/A
  } else {
    try {
      const r = await fetch(`${GROQ_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
        signal: AbortSignal.timeout(4000),
      });
      groqReachable = r.ok;
    } catch {
      groqReachable = false;
    }
  }

  res.json({ ok: true, balance, lastPayment, groqMockMode: isGroqMockMode, paymentMockMode: isPaymentMockMode, groqReachable });
});

// Main unlock endpoint (HMAC-protected)
app.post('/agent/evaluate-and-pay', hmacAuth, async (req: Request, res: Response) => {
  if (_shuttingDown) {
    res.status(503).json({ decision: 'error', error: 'service shutting down' });
    return;
  }

  const { reader_id, request_id, article } = req.body as {
    reader_id?: string;
    request_id?: string;
    article?: ArticleInput;
  };

  if (!reader_id || !article || !request_id) {
    res.status(400).json({ decision: 'error', error: 'reader_id, request_id, article required' });
    return;
  }

  // Idempotency: check full triple (reader_id, content_contract, request_id).
  // content_contract must be matched case-insensitively — viem returns checksummed
  // (mixed-case) addresses but the DB unique index is on lower(content_contract).
  const { data: existing } = await db
    .from('payment_events')
    .select('id')
    .eq('reader_id', reader_id)
    .ilike('content_contract', article.content_contract ?? '')
    .eq('request_id', request_id)
    .maybeSingle();

  if (existing) {
    res.json({
      decision: 'paid',
      gates: { budget: true, quality: 1, interest: 1, confidence: 100 },
      payment: { tx: '0xalready-paid', amount_atomic: article.price_atomic, settled_at: new Date().toISOString() },
      unlock_token: generateUnlockToken(article.creator_id, article.slug, reader_id),
    });
    return;
  }

  // Track in-flight for graceful shutdown drain
  const result = await trackInflight(() =>
    evaluateAndPay(db, reader_id, request_id, article, getGatewayClient())
  );
  res.status(result.decision === 'error' ? 502 : 200).json(result);
});

app.post('/agent/content/upsert', hmacAuth, async (req: Request, res: Response) => {
  try {
    const input = req.body as Partial<ContentInput>;
    if (!input.creator_id || !input.creator_wallet || !input.slug || !input.ghost_post_id || !input.title) {
      res.status(400).json({ error: 'creator_id, creator_wallet, slug, ghost_post_id, title required' });
      return;
    }
    const deployment = await upsertContent({
      creator_id: input.creator_id,
      creator_wallet: input.creator_wallet,
      slug: input.slug,
      ghost_post_id: input.ghost_post_id,
      title: input.title,
      excerpt: input.excerpt ?? '',
      ghost_instance_url: input.ghost_instance_url ?? null,
      initial_price_atomic: input.initial_price_atomic ?? 50000,
    });
    res.json({ ok: true, deployment });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

app.post('/agent/ghost/webhook', async (req: Request, res: Response) => {
  let siteParam = '';
  try {
    const rawBody = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
    const sigHeader = req.headers['x-ghost-signature'] as string | undefined ?? '';
    siteParam = typeof req.query.site === 'string' ? req.query.site : '';

    if (!siteParam) {
      res.status(400).json({ error: 'site query param required' });
      return;
    }

    const { data: creator } = await db
      .from('creators')
      .select('id, ghost_webhook_secret, ghost_instance_url, eoa_address')
      .eq('id', siteParam)
      .single();

    console.log(`[ghost-webhook] received site=${siteParam} sig="${sigHeader}" bodyLen=${rawBody.length} hasSecret=${!!creator?.ghost_webhook_secret}`);

    if (!creator?.ghost_webhook_secret || !verifyGhostSignature(rawBody, sigHeader, creator.ghost_webhook_secret as string)) {
      console.log(`[ghost-webhook] signature check FAILED for site=${siteParam}`);
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const post = body.post as Record<string, Record<string, unknown>> | undefined;
    const current = post?.current as Record<string, unknown> | undefined;
    const previous = post?.previous as Record<string, unknown> | undefined;
    const ghostPostId = (current?.id ?? previous?.id) as string | undefined;
    console.log(`[ghost-webhook] site=${siteParam} ghostPostId=${ghostPostId} status=${current?.status}`);
    if (!ghostPostId) {
      res.json({ ok: true });
      return;
    }

    const status = current?.status as string | undefined;
    const isDeleted = !current || Object.keys(current).length === 0;
    if (isDeleted || status === 'deleted' || (status && status !== 'published')) {
      await db.from('articles').update({ active: false, updated_at: new Date().toISOString() })
        .eq('creator_id', siteParam)
        .eq('ghost_post_id', ghostPostId);
      res.json({ ok: true });
      return;
    }

    if (!creator.eoa_address) {
      res.status(400).json({ error: 'creator wallet not configured' });
      return;
    }

    const deployment = await upsertContent({
      creator_id: siteParam,
      creator_wallet: creator.eoa_address as string,
      slug: (current?.slug as string | undefined) ?? ghostPostId,
      ghost_post_id: ghostPostId,
      title: (current?.title as string | undefined) ?? '',
      excerpt: (current?.custom_excerpt as string | undefined) ?? (current?.excerpt as string | undefined) ?? '',
      ghost_instance_url: creator.ghost_instance_url as string | null,
      initial_price_atomic: 50000,
    });
    console.log(`[ghost-webhook] upsertContent OK site=${siteParam} contract=${deployment.content_contract}`);

    res.json({ ok: true, deployment });
  } catch (err) {
    console.error(`[ghost-webhook] upsertContent FAILED site=${siteParam}:`, err);
    res.status(502).json({ error: String(err) });
  }
});

// Tip endpoint (HMAC-protected) — budget gate only
app.post('/agent/tip', hmacAuth, async (req: Request, res: Response) => {
  const { reader_id, creator_id, content_contract, amount_atomic } = req.body as {
    reader_id?: string;
    creator_id?: string;
    content_contract?: string;
    amount_atomic?: string;
  };

  if (!reader_id || !creator_id || !content_contract || !amount_atomic) {
    res.status(400).json({ error: 'reader_id, creator_id, content_contract, amount_atomic required' });
    return;
  }
  if (!/^[0-9]+$/.test(amount_atomic) || BigInt(amount_atomic) <= 0n) {
    res.status(400).json({ error: 'amount_atomic must be a positive atomic USDC integer' });
    return;
  }

  // Budget gate: both daily AND session caps (mirrors Gate 1 of evaluate-and-pay)
  const { data: reader } = await db
    .from('readers')
    .select('spent_today_atomic, daily_budget_atomic, spent_session_atomic, session_budget_atomic')
    .eq('user_id', reader_id)
    .single();

  if (reader) {
    const tip = BigInt(amount_atomic);
    const dailyOk   = BigInt(reader.spent_today_atomic)   + tip <= BigInt(reader.daily_budget_atomic);
    const sessionOk = BigInt(reader.spent_session_atomic) + tip <= BigInt(reader.session_budget_atomic);
    if (!dailyOk || !sessionOk) {
      res.json({ decision: 'declined', reason: 'budget_exceeded' });
      return;
    }
  }

  if (isPaymentMockMode || !BUYER_PRIVATE_KEY) {
    res.json({
      decision: 'paid',
      payment: { tx: '0xmock-tip', amount_atomic, settled_at: new Date().toISOString() },
    });
    return;
  }

  const client = getGatewayClient();
  if (!client) {
    res.status(503).json({ error: 'gateway not configured' });
    return;
  }

  if (!APP_BASE_URL) {
    res.status(503).json({ error: 'APP_BASE_URL not configured' });
    return;
  }

  try {
    // x402 payment — PAYMENT-SIGNATURE is attached by GatewayClient.pay(), not HMAC
    const tipUrl = `${APP_BASE_URL}/api/x402/tip/${encodeURIComponent(content_contract)}?amount=${encodeURIComponent(amount_atomic)}&r=${encodeURIComponent(reader_id)}&creator=${encodeURIComponent(creator_id)}`;
    const payResult = await client.pay(tipUrl, { method: 'GET' });

    if (payResult.status !== 200 && payResult.status !== 201) {
      res.status(502).json({ decision: 'error', error: `tip payment returned status ${payResult.status}` });
      return;
    }

    // Record spend (non-fatal)
    try {
      await db.rpc('record_reader_spend', { p_user_id: reader_id, p_amount: amount_atomic });
    } catch (err) {
      console.error('[tip] record_reader_spend failed (budget counters may be stale):', err);
    }

    res.json({
      decision: 'paid',
      payment: {
        tx: payResult.transaction ?? '0x0',
        amount_atomic,
        settled_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    res.status(502).json({ decision: 'error', error: String(err) });
  }
});

app.post('/agent/gateway-mint', hmacAuth, async (req: Request, res: Response) => {
  void req;
  res.status(410).json({ error: 'deprecated: use /agent/withdraw-content' });
});

app.post('/agent/withdraw-content', hmacAuth, async (req: Request, res: Response) => {
  const { creator_id, content_contract, destination_address, amount_atomic, nonce, v, r, s } = req.body as {
    creator_id?: string;
    content_contract?: string;
    destination_address?: string;
    amount_atomic?: string;
    nonce?: string;
    v?: number;
    r?: string;
    s?: string;
  };
  if (!creator_id || !content_contract || !destination_address || !amount_atomic || !nonce || v === undefined || !r || !s) {
    res.status(400).json({ error: 'creator_id, content_contract, destination_address, amount_atomic, nonce, v, r, s required' });
    return;
  }
  if (!/^[0-9]+$/.test(amount_atomic)) {
    res.status(400).json({ error: 'amount_atomic must be a positive atomic USDC integer' });
    return;
  }
  if (!/^[0-9]+$/.test(nonce)) {
    res.status(400).json({ error: 'nonce must be a non-negative integer' });
    return;
  }

  try {
    const { data: article } = await db
      .from('articles')
      .select('slug')
      .eq('creator_id', creator_id)
      .ilike('content_contract', content_contract)
      .eq('active', true)
      .maybeSingle();
    if (!article) {
      res.status(403).json({ error: 'content contract does not belong to creator' });
      return;
    }
    const txHash = await withdrawFromContent(
      content_contract,
      destination_address,
      BigInt(amount_atomic),
      BigInt(nonce),
      { v: Number(v), r: r as `0x${string}`, s: s as `0x${string}` }
    );
    res.json({ txHash: txHash ?? '0xmock-content-withdraw' });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

// --- Daily budget reset (midnight UTC) ---
async function resetDailyBudgets(): Promise<void> {
  try {
    await db.rpc('reset_daily_budgets');
    console.log('[daily-reset] spent_today_atomic cleared for all readers');
  } catch (err) {
    console.error('[daily-reset] failed:', err);
  }
}

function scheduleDailyReset(): void {
  const msUntilMidnightUtc = (): number => {
    const now = new Date();
    const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return midnight.getTime() - now.getTime();
  };

  const scheduleNext = (): void => {
    const delay = msUntilMidnightUtc();
    console.log(`[daily-reset] next reset in ${Math.round(delay / 60000)}min (midnight UTC)`);
    setTimeout(() => {
      resetDailyBudgets().catch(console.error);
      scheduleNext();
    }, delay);
  };

  scheduleNext();
}

// --- Start workers and server ---

assertStartup()
  .then(() => {
    startAudit(db, AUDIT_INTERVAL_MS);
    startWatcher(db, WATCHER_INTERVAL_MS);
    scheduleDailyReset();

    // Gateway redeposit loop (~30s interval, self-healing with retry)
    setInterval(() => redeposit(), 30_000);
    redeposit().catch(console.error);

    const server = app.listen(PORT, () => {
      console.log(`[cresc-agents] listening on :${PORT}`);
      console.log(`[cresc-agents] Groq mock mode: ${isGroqMockMode}`);
      console.log(`[cresc-agents] payment mock mode: ${isPaymentMockMode}`);
    });

    // Graceful shutdown: stop new requests, drain in-flight payments, then exit
    process.on('SIGTERM', () => {
      console.log('[cresc-agents] SIGTERM received — shutting down gracefully');
      _shuttingDown = true;

      const drain = (): void => {
        if (_inFlightCount === 0) {
          server.close(() => {
            console.log('[cresc-agents] server closed');
            process.exit(0);
          });
        } else {
          console.log(`[cresc-agents] waiting for ${_inFlightCount} in-flight payment(s)...`);
          setTimeout(drain, 200);
        }
      };

      drain();
      // Hard timeout — never wait more than 10s
      setTimeout(() => {
        console.warn('[cresc-agents] drain timeout — forcing exit');
        process.exit(0);
      }, 10_000);
    });
  })
  .catch((err) => {
    console.error('[startup] assertion failed — exiting:', err);
    process.exit(1);
  });
