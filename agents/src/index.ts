// src/index.ts — Cresc EC2 agent service entry point.
// Express HTTP server (not queue-based). Holds the one raw buyer key + Circle entity secret.
// Endpoints: /agent/evaluate-and-pay, /agent/tip, /agent/withdraw, /healthz
// Workers: Watcher (hourly reprice), Audit Agent (pre-Watcher telemetry filter).

import express, { type Request, type Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { createPublicClient, http } from 'viem';
import { defineChain } from 'viem';
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
  isMockMode,
} from './config.js';
import { captureRawBody, hmacAuth } from './middleware/hmac.js';
import { evaluateAndPay, type ArticleInput } from './workers/reader-agent.js';
import { executeWithdraw } from './workers/withdraw.js';
import { startWatcher } from './workers/watcher.js';
import { startAudit } from './workers/audit.js';

validateAgentConfig();

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const app = express();

// Capture raw body before JSON parse (required for HMAC verification)
app.use(captureRawBody);
app.use(express.json());

const arcTestnetChain = defineChain({
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls: { default: { http: [ARC_RPC_URL || 'https://arc-testnet.drpc.org'] } },
});

const DECIMALS_ABI = [{
  name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }],
}] as const;

// --- Startup assertions (CLAUDE.md §Startup assertions) ---
async function assertStartup(): Promise<void> {
  // 1. SELLER_PRIVATE_KEY must be absent
  if (process.env.SELLER_PRIVATE_KEY) {
    throw new Error('[startup] SELLER_PRIVATE_KEY must NOT be set on EC2 — creator = Circle wallet, no raw key');
  }
  if (!isMockMode) {
    if (!BUYER_PRIVATE_KEY) {
      throw new Error('[startup] BUYER_PRIVATE_KEY required in live mode');
    }
    // 2. Chain ID assertion
    const publicClient = createPublicClient({ chain: arcTestnetChain, transport: http(ARC_RPC_URL) });
    const chainId = await publicClient.getChainId();
    if (chainId !== ARC_CHAIN_ID) {
      throw new Error(`[startup] chain id mismatch: expected ${ARC_CHAIN_ID}, got ${chainId}`);
    }
    // 3. USDC decimals assertion
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

// --- Gateway redeposit loop ---
let gatewayClient: InstanceType<typeof GatewayClient> | null = null;

function getGatewayClient(): InstanceType<typeof GatewayClient> | null {
  if (isMockMode || !BUYER_PRIVATE_KEY) return null;
  if (!gatewayClient) {
    gatewayClient = new GatewayClient({
      chain: ARC_SDK_CHAIN,
      privateKey: BUYER_PRIVATE_KEY as `0x${string}`,
      rpcUrl: ARC_RPC_URL,
    });
  }
  return gatewayClient;
}

async function redeposit(): Promise<void> {
  const client = getGatewayClient();
  if (!client) return;
  try {
    const balances = await client.getBalances();
    const available = balances.gateway?.available ?? 0n;
    const threshold = BigInt(Math.round(parseFloat(GATEWAY_REDEPOSIT_THRESHOLD_USDC) * 1_000_000));
    if (available < threshold) {
      console.log(`[gateway] balance low (${available}), redepositing ${GATEWAY_REDEPOSIT_AMOUNT_USDC} USDC`);
      await client.deposit(GATEWAY_REDEPOSIT_AMOUNT_USDC);
    }
  } catch (err) {
    console.error('[gateway] redeposit error:', err);
  }
}

// --- Routes ---

// Health check (HMAC-protected — same auth as other internal endpoints)
app.get('/healthz', hmacAuth, async (_req: Request, res: Response) => {
  const client = getGatewayClient();
  let balance = 'mock';
  let lastPayment: string | null = null;

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
    // ok
  }

  res.json({ ok: true, balance, lastPayment, mockMode: isMockMode });
});

// Main unlock endpoint (HMAC-protected)
app.post('/agent/evaluate-and-pay', hmacAuth, async (req: Request, res: Response) => {
  const { reader_id, request_id, article } = req.body as {
    reader_id?: string;
    request_id?: string;
    article?: ArticleInput;
  };

  if (!reader_id || !article || !request_id) {
    res.status(400).json({ decision: 'error', error: 'reader_id, request_id, article required' });
    return;
  }

  // Idempotency: check full triple (reader_id, article_slug, request_id)
  const { data: existing } = await db
    .from('payment_events')
    .select('id')
    .eq('reader_id', reader_id)
    .eq('article_slug', article.slug)
    .eq('request_id', request_id)
    .single();

  if (existing) {
    res.json({
      decision: 'paid',
      gates: { budget: true, quality: 1, interest: 1, confidence: 100 },
      payment: { tx: '0xalready-paid', amount_atomic: article.price_atomic, settled_at: new Date().toISOString() },
      unlock_token: `idempotent-${request_id}`,
    });
    return;
  }

  const result = await evaluateAndPay(db, reader_id, request_id, article);
  res.status(result.decision === 'error' ? 502 : 200).json(result);
});

// Tip endpoint (HMAC-protected)
app.post('/agent/tip', hmacAuth, async (req: Request, res: Response) => {
  const { reader_id, creator_id, amount_atomic } = req.body as {
    reader_id?: string;
    creator_id?: string;
    amount_atomic?: string;
  };

  if (!reader_id || !creator_id || !amount_atomic) {
    res.status(400).json({ error: 'reader_id, creator_id, amount_atomic required' });
    return;
  }

  // Budget gate only (tip does not run LLM gates)
  const { data: reader } = await db
    .from('readers')
    .select('spent_today_atomic, daily_budget_atomic')
    .eq('user_id', reader_id)
    .single();

  if (reader) {
    const ok = BigInt(reader.spent_today_atomic) + BigInt(amount_atomic) <= BigInt(reader.daily_budget_atomic);
    if (!ok) {
      res.json({ decision: 'declined', reason: 'budget_exceeded' });
      return;
    }
  }

  if (isMockMode || !BUYER_PRIVATE_KEY) {
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
    const tipUrl = `${APP_BASE_URL}/api/x402/tip/${encodeURIComponent(creator_id)}?amount=${encodeURIComponent(amount_atomic)}&r=${encodeURIComponent(reader_id)}`;
    const payResult = await client.pay(tipUrl, { method: 'GET' });

    if (payResult.status !== 200 && payResult.status !== 201) {
      res.status(502).json({ decision: 'error', error: `tip payment returned status ${payResult.status}` });
      return;
    }

    // Record spend
    try { await db.rpc('record_reader_spend', { p_user_id: reader_id, p_amount: amount_atomic }); } catch { /* non-fatal */ }

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

// Withdraw endpoint — Circle SDK burn intent (HMAC-protected)
app.post('/agent/withdraw', hmacAuth, async (req: Request, res: Response) => {
  const { creator_id, amount_atomic, destination_chain, destination_address } = req.body as {
    creator_id?: string;
    amount_atomic?: string;
    destination_chain?: string;
    destination_address?: string;
  };

  if (!creator_id || !amount_atomic || !destination_chain || !destination_address) {
    res.status(400).json({ error: 'creator_id, amount_atomic, destination_chain, destination_address required' });
    return;
  }

  // Look up creator Circle wallet
  const { data: creator } = await db
    .from('creators')
    .select('circle_wallet_id, eoa_address')
    .eq('id', creator_id)
    .single();

  if (!creator?.circle_wallet_id) {
    res.status(400).json({ error: 'creator has no circle_wallet_id' });
    return;
  }

  // Record withdrawal attempt
  const { data: withdrawal } = await db
    .from('withdrawals')
    .insert({
      creator_id,
      amount_atomic: parseInt(amount_atomic),
      destination_chain,
      destination_address,
      status: 'submitted',
    })
    .select('id')
    .single();

  try {
    const txHash = await executeWithdraw({
      walletId: creator.circle_wallet_id as string,
      walletAddress: creator.eoa_address as string,
      destinationAddress: destination_address,
      destinationChain: destination_chain,
      amountAtomic: BigInt(amount_atomic),
    });

    await db.from('withdrawals').update({ status: 'confirmed', tx_hash: txHash })
      .eq('id', withdrawal?.id);

    res.json({ status: 'confirmed', withdrawal_id: withdrawal?.id ?? null, tx_hash: txHash });
  } catch (err) {
    await db.from('withdrawals').update({ status: 'failed' }).eq('id', withdrawal?.id);
    res.status(502).json({ decision: 'error', error: String(err) });
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

    // Gateway redeposit loop (every 30s)
    setInterval(() => redeposit(), 30_000);
    redeposit().catch(console.error);

    const server = app.listen(PORT, () => {
      console.log(`[cresc-agents] listening on :${PORT}`);
      console.log(`[cresc-agents] mock mode: ${isMockMode}`);
    });

    // Graceful shutdown: stop accepting new requests, let in-flight payments settle
    process.on('SIGTERM', () => {
      console.log('[cresc-agents] SIGTERM received — shutting down gracefully');
      server.close(() => {
        console.log('[cresc-agents] server closed');
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 10_000);
    });
  })
  .catch((err) => {
    console.error('[startup] assertion failed — exiting:', err);
    process.exit(1);
  });

