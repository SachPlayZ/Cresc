// keep-in-sync: Cresc/lib/llm/index.ts
import Groq from 'groq-sdk';
import { isMockMode, LLM_API_KEY, LLM_MODEL } from '../config.js';

let _client: Groq | null = null;

function getClient(): Groq {
  if (!_client) {
    _client = new Groq({ apiKey: LLM_API_KEY });
  }
  return _client;
}

export type CompleteOptions = {
  json?: boolean;
  systemPrompt?: string;
  maxTokens?: number;
};

const MOCK_PRICE_DECISION = JSON.stringify({
  kind: 'price',
  oldPrice: 0.01, newPrice: 0.009, reserve: 0.001, objective: 'MAX_REVENUE',
  signalsCited: ['views_1h:stable', 'dwell_median:180s', 'bounce:thin'],
  reasoning:
    'Views stable but dwell trending down slightly. Nudging price down 10% to broaden reach. ' +
    'Holding rather than cutting aggressively — bounce rate is low.',
  confidence: 0.78,
});

const MOCK_TIP_DECISION = JSON.stringify({
  kind: 'tip',
  suggestedTip: 0.005, viewPricePaid: 0.01,
  signalsCited: ['completion_pct:94', 'active_dwell:340s', 'revisit_count:1', 'scroll:end-to-end'],
  reasoning:
    'Reader completed 94% in focused session, revisited once. Genuine engagement. Suggesting 50% of view price.',
  confidence: 0.83,
});

const MOCK_TIP_SKIP = JSON.stringify({
  kind: 'tip_skip',
  signalsCited: ['completion_pct:18', 'active_dwell:12s', 'bounce:immediate'],
  reasoning: 'Bounced after 12s, 18% completion. No evidence of value received.',
  confidence: 0.95,
});

export async function complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
  const { json = false, systemPrompt, maxTokens = 1024 } = opts;

  if (isMockMode) {
    if (!json) return 'Mock mode: set LLM_API_KEY in .env.local for real agents.';
    const lower = prompt.toLowerCase();
    if (lower.includes('tip') && lower.includes('skip')) return MOCK_TIP_SKIP;
    if (lower.includes('tip')) return MOCK_TIP_DECISION;
    return MOCK_PRICE_DECISION;
  }

  const messages: Groq.Chat.ChatCompletionMessageParam[] = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  // Use streaming to collect the response chunk by chunk
  const stream = await getClient().chat.completions.create({
    model: LLM_MODEL,
    messages,
    max_tokens: maxTokens,
    stream: true,
    ...(json ? { response_format: { type: 'json_object' } } : {}),
  });

  let content = '';
  for await (const chunk of stream) {
    content += chunk.choices[0]?.delta?.content ?? '';
  }

  if (!content) throw new Error('[llm] Empty response from Groq API');
  return content;
}
