/**
 * lib/llm/index.ts — provider-agnostic LLM adapter.
 * M0: OpenAI SDK pointed at LLM_BASE_URL (Groq or any OpenAI-compatible endpoint).
 * isMockMode (no LLM_API_KEY) → deterministic canned response, never hits API.
 * Swapping providers = config change only (LLM_BASE_URL + LLM_MODEL).
 */

import OpenAI from "openai";
import { isMockMode, LLM_API_KEY, LLM_BASE_URL, LLM_MODEL } from "../config";

// Lazy-init client (not created in mock mode)
let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      apiKey: LLM_API_KEY,
      baseURL: LLM_BASE_URL,
    });
  }
  return _client;
}

export type CompleteOptions = {
  /** If true, instructs the model to return JSON. */
  json?: boolean;
  /** Optional system prompt prefix. */
  systemPrompt?: string;
  /** Max tokens (default: 1024). */
  maxTokens?: number;
};

// --- Mock mode canned responses ---
// Mirror the reference repo pattern: plausible output, same shape as real agent calls.
// These pass through the same envelope clamp and produce the same output shape.

const MOCK_PRICE_DECISION = JSON.stringify({
  kind: "price",
  oldPrice: 0.01,
  newPrice: 0.009,
  reserve: 0.001,
  objective: "MAX_REVENUE",
  signalsCited: ["views_1h:stable", "dwell_median:180s", "bounce:thin"],
  reasoning:
    "Views are stable but dwell is trending down slightly, suggesting the piece may be " +
    "approaching saturation for its current audience. Nudging price down 10% to broaden reach " +
    "while staying well above reserve. Holding rather than cutting aggressively because " +
    "bounce rate is low — readers who arrive are engaging.",
  confidence: 0.78,
});

const MOCK_TIP_DECISION = JSON.stringify({
  kind: "tip",
  suggestedTip: 0.005,
  viewPricePaid: 0.01,
  signalsCited: [
    "completion_pct:94",
    "active_dwell:340s",
    "revisit_count:1",
    "scroll:end-to-end",
  ],
  reasoning:
    "Reader completed 94% of a long-form piece in a single focused session and revisited once. " +
    "Pace and scroll pattern suggest genuine engagement, not a skim. Suggesting 50% of view price.",
  confidence: 0.83,
});

const MOCK_TIP_SKIP = JSON.stringify({
  kind: "tip_skip",
  signalsCited: ["completion_pct:18", "active_dwell:12s", "bounce:immediate"],
  reasoning:
    "Reader bounced after 12 seconds with 18% completion. No evidence of value received. " +
    "Prompting a tip would be inappropriate.",
  confidence: 0.95,
});

/**
 * complete — single entry point for all agent LLM calls.
 *
 * @param prompt - The full prompt (caller assembles context + instruction).
 * @param opts   - Options: json mode, system prompt override, max tokens.
 * @returns      - Raw string response (JSON string if opts.json).
 */
export async function complete(
  prompt: string,
  opts: CompleteOptions = {}
): Promise<string> {
  const { json = false, systemPrompt, maxTokens = 1024 } = opts;

  // --- Mock mode: deterministic, no API call ---
  if (isMockMode) {
    return getMockResponse(prompt, json);
  }

  // --- Real LLM call (OpenAI-compatible, Groq endpoint) ---
  const client = getClient();

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }

  messages.push({ role: "user", content: prompt });

  const response = await client.chat.completions.create({
    model: LLM_MODEL,
    messages,
    max_tokens: maxTokens,
    ...(json ? { response_format: { type: "json_object" } } : {}),
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("[llm] Empty response from LLM API");
  }

  return content;
}

/**
 * getMockResponse — returns a deterministic canned response based on prompt keywords.
 * Mirrors the reference repo scripted fallback pattern.
 */
function getMockResponse(prompt: string, json: boolean): string {
  const lower = prompt.toLowerCase();

  if (!json) {
    return "Mock mode: LLM_API_KEY not set. Set it in .env.local to enable real agent calls.";
  }

  // Routing by prompt keyword (agents call with different prompts)
  if (lower.includes("tip") && lower.includes("skip")) {
    return MOCK_TIP_SKIP;
  }
  if (lower.includes("tip")) {
    return MOCK_TIP_DECISION;
  }
  // Default to pricing decision
  return MOCK_PRICE_DECISION;
}
