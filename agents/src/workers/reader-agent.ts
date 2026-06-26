// src/workers/reader-agent.ts — EC2 Reader Agent: 4 gates + x402 pay.
// Gate 1 (Budget): deterministic, no LLM. Short-circuit on fail.
// Gates 2-4 (Quality/Interest/Confidence): one Groq call.
// Pay: GatewayClient.pay() with shared buyer EOA key.

import { GatewayClient } from '@circle-fin/x402-batching/client';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ARC_SDK_CHAIN,
  ARC_RPC_URL,
  BUYER_PRIVATE_KEY,
  LLM_API_KEY,
  LLM_BASE_URL,
  LLM_MODEL,
  QUALITY_MIN,
  INTEREST_MIN,
  CONFIDENCE_MIN,
  isMockMode,
} from '../config.js';

export type ArticleInput = {
  slug: string;
  unlock_url: string;
  price_atomic: string;   // atomic bigint string
  creator_wallet: string;
  title: string;
  excerpt: string;
  topics: string[];
};

export type ReaderAgentResult =
  | { decision: 'paid'; gates: Gates; payment: PaymentInfo; unlock_token: string }
  | { decision: 'declined'; gates: Partial<Gates>; reason: string }
  | { decision: 'error'; error: string };

type Gates = { budget: boolean; quality: number; interest: number; confidence: number };
type PaymentInfo = { tx: string; amount_atomic: string; settled_at: string };

type LLMGates = { quality: number; interest: number; confidence: number; reason: string };

async function callLLM(article: ArticleInput, readerHistory: string): Promise<LLMGates> {
  if (isMockMode || !LLM_API_KEY) {
    return { quality: 0.7, interest: 0.7, confidence: 85, reason: 'mock mode stub' };
  }

  const prompt = `You are a Reader Agent deciding whether to pay for an article on behalf of a reader.

Article:
- Title: "${article.title}"
- Excerpt: "${article.excerpt.slice(0, 500)}"
- Topics: ${JSON.stringify(article.topics)}
- Price: $${(parseInt(article.price_atomic) / 1_000_000).toFixed(4)} USDC

Reader history (recent topics + avg dwell):
${readerHistory || 'No history yet.'}

Evaluate strictly as JSON with no prose:
{
  "quality": <0.0-1.0, content quality/depth for the price>,
  "interest": <0.0-1.0, alignment with reader history>,
  "confidence": <0-100, combined certainty reader will find value>,
  "reason": "<one short clause>"
}`;

  const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LLM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 256,
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`[reader-agent] LLM call failed: ${res.status} ${txt.slice(0, 200)}`);
  }

  const json = await res.json() as { choices: { message: { content: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? '{}';
  return JSON.parse(content) as LLMGates;
}

async function getReaderHistory(db: SupabaseClient, readerId: string): Promise<string> {
  try {
    const { data } = await db
      .from('telemetry')
      .select('article_id, dwell_ms, articles(topics)')
      .eq('reader_id', readerId)
      .eq('event_type', 'view')
      .order('ts', { ascending: false })
      .limit(20);

    if (!data || data.length === 0) return '';

    const avgDwell = data.reduce((s, r) => s + (r.dwell_ms as number), 0) / data.length;

    const topicCounts: Record<string, number> = {};
    for (const row of data) {
      const topics = (row.articles as { topics?: string[] } | null)?.topics ?? [];
      for (const t of topics) topicCounts[t] = (topicCounts[t] ?? 0) + 1;
    }
    const topTopics = Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([t]) => t);

    const topicsStr = topTopics.length > 0 ? topTopics.join(', ') : 'unknown';
    return `Viewed ${data.length} articles recently. Top topics: ${topicsStr}. Avg dwell: ${Math.round(avgDwell / 1000)}s.`;
  } catch {
    return '';
  }
}

let gatewayClient: InstanceType<typeof GatewayClient> | null = null;

function getGatewayClient(): InstanceType<typeof GatewayClient> {
  if (!gatewayClient) {
    if (!BUYER_PRIVATE_KEY) throw new Error('[reader-agent] BUYER_PRIVATE_KEY not set');
    gatewayClient = new GatewayClient({
      chain: ARC_SDK_CHAIN,
      privateKey: BUYER_PRIVATE_KEY as `0x${string}`,
      rpcUrl: ARC_RPC_URL,
    });
  }
  return gatewayClient;
}

export async function evaluateAndPay(
  db: SupabaseClient,
  readerId: string,
  requestId: string,
  article: ArticleInput
): Promise<ReaderAgentResult> {
  const priceAtomic = BigInt(article.price_atomic);

  // --- Gate 1: Budget (deterministic, no LLM) ---
  // Auto-provision reader row if missing (default $5/day, $1/session)
  await db.from('readers').upsert({
    user_id: readerId,
    daily_budget_atomic: '5000000',
    session_budget_atomic: '1000000',
    spent_today_atomic: '0',
    spent_session_atomic: '0',
    session_reset_at: new Date().toISOString(),
  }, { onConflict: 'user_id', ignoreDuplicates: true });

  const { data: reader, error: rErr } = await db
    .from('readers')
    .select('daily_budget_atomic, session_budget_atomic, spent_today_atomic, spent_session_atomic')
    .eq('user_id', readerId)
    .single();

  if (rErr) {
    return { decision: 'error', error: `DB error: ${rErr.message}` };
  }

  if (reader) {
    const dailyOk  = BigInt(reader.spent_today_atomic)   + priceAtomic <= BigInt(reader.daily_budget_atomic);
    const sessionOk = BigInt(reader.spent_session_atomic) + priceAtomic <= BigInt(reader.session_budget_atomic);
    if (!dailyOk || !sessionOk) {
      return {
        decision: 'declined',
        gates: { budget: false },
        reason: 'budget_exceeded',
      };
    }
  }

  // --- Gates 2-4: Quality / Interest / Confidence (one LLM call) ---
  const history = await getReaderHistory(db, readerId);
  let llmGates: LLMGates;
  try {
    llmGates = await callLLM(article, history);
  } catch (err) {
    return { decision: 'error', error: String(err) };
  }

  const gates: Gates = {
    budget: true,
    quality: llmGates.quality,
    interest: llmGates.interest,
    confidence: llmGates.confidence,
  };

  if (
    llmGates.quality   < QUALITY_MIN   ||
    llmGates.interest  < INTEREST_MIN  ||
    llmGates.confidence < CONFIDENCE_MIN
  ) {
    return {
      decision: 'declined',
      gates,
      reason: `below_threshold: quality=${llmGates.quality} interest=${llmGates.interest} confidence=${llmGates.confidence}`,
    };
  }

  // --- Pay via GatewayClient ---
  if (isMockMode || !BUYER_PRIVATE_KEY) {
    // Mock path: skip real payment
    return {
      decision: 'paid',
      gates,
      payment: { tx: '0xmock', amount_atomic: article.price_atomic, settled_at: new Date().toISOString() },
      unlock_token: `mock-token-${requestId}`,
    };
  }

  const client = getGatewayClient();
  let payResult: Awaited<ReturnType<typeof client.pay>>;
  try {
    payResult = await client.pay(article.unlock_url, { method: 'GET' });
  } catch (err) {
    return { decision: 'error', error: `GatewayClient.pay failed: ${String(err)}` };
  }

  if (payResult.status !== 200 && payResult.status !== 201) {
    return { decision: 'error', error: `Gateway pay returned status ${payResult.status}` };
  }

  // Update reader spend
  try {
    await db.rpc('record_reader_spend', {
      p_user_id: readerId,
      p_amount: article.price_atomic,
    });
  } catch {
    // non-fatal
  }

  const responseBody = payResult.data as { unlock_token?: string } | null;
  const unlockToken = responseBody?.unlock_token ?? '';
  if (!unlockToken) {
    return { decision: 'error', error: 'x402 route returned no unlock_token' };
  }

  return {
    decision: 'paid',
    gates,
    payment: {
      tx: payResult.transaction ?? '0x0',
      amount_atomic: article.price_atomic,
      settled_at: new Date().toISOString(),
    },
    unlock_token: unlockToken,
  };
}
