// keep-in-sync: Cresc/web/lib/config.ts
// EC2 variant: reads all from process.env; holds the one raw buyer key.

export const ARC_CHAIN_ID = 5042002 as const;
export const ARC_CAIP2 = 'eip155:5042002' as const;
export const ARC_SDK_CHAIN = 'arcTestnet' as const;
export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const;
export const GATEWAY_WALLET_ADDRESS = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9' as const;
export const GATEWAY_MINTER_ADDRESS = '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B' as const;
export const GATEWAY_FACILITATOR_URL = 'https://gateway-api-testnet.circle.com' as const;
export const ARC_EXPLORER_BASE = 'https://testnet.arcscan.app' as const;
export const USDC_ERC20_DECIMALS = 6 as const;
export const CONTENT_FACTORY_ADDRESS: string = getEnv('CONTENT_FACTORY_ADDRESS') ?? '';
export const CONTENT_TUNER_PRIVATE_KEY: string = getEnv('CONTENT_TUNER_PRIVATE_KEY') ?? '';
export const CONTENT_TUNER_ADDRESS: string = getEnv('CONTENT_TUNER_ADDRESS') ?? '';

function getEnv(key: string): string | undefined {
  return process.env[key];
}

function requireEnv(key: string): string {
  const val = getEnv(key);
  if (!val) throw new Error(`[config] Missing required env var: ${key}`);
  return val;
}

function parseNumber(key: string, fallback: number): number {
  const raw = getEnv(key);
  if (!raw) return fallback;
  const n = parseFloat(raw);
  if (isNaN(n)) throw new Error(`[config] ${key} must be a number, got: "${raw}"`);
  return n;
}

export const SUPABASE_URL: string = getEnv('SUPABASE_URL') ?? getEnv('NEXT_PUBLIC_SUPABASE_URL') ?? '';
export const SUPABASE_SERVICE_ROLE_KEY: string = getEnv('SUPABASE_SERVICE_ROLE_KEY') ?? '';

export const ARC_RPC_URL: string = getEnv('ARC_RPC_URL') ?? '';

// Raw operator keys live only on EC2. SELLER_PRIVATE_KEY stays empty (creator has no app-held raw key).
export const BUYER_PRIVATE_KEY: string = getEnv('BUYER_PRIVATE_KEY') ?? '';
export const isPaymentMockMode: boolean = !ARC_RPC_URL || !BUYER_PRIVATE_KEY;

// Groq via OpenAI-compatible API.
export const GROQ_API_KEY: string = getEnv('GROQ_API_KEY') ?? '';
export const GROQ_BASE_URL: string =
  getEnv('GROQ_BASE_URL') ?? 'https://api.groq.com/openai/v1';
export const GROQ_MODEL: string =
  getEnv('GROQ_MODEL') ?? 'llama-3.3-70b-versatile';
export const isGroqMockMode: boolean = !GROQ_API_KEY;

// Pinata (IPFS pinning for price-tune reasoning) — optional; pinning is skipped
// (reason_cid stays null) if unset, same graceful-degradation pattern as Groq/payment
// mock mode. Get a JWT from https://app.pinata.cloud/developers/api-keys.
export const PINATA_JWT: string = getEnv('PINATA_JWT') ?? '';

// Internal HMAC (Vercel↔EC2)
export const INTERNAL_HMAC_SECRET: string = getEnv('INTERNAL_HMAC_SECRET') ?? '';

// Base URL of the Vercel app (needed to construct tip x402 URLs from EC2)
export const APP_BASE_URL: string = getEnv('APP_BASE_URL') ?? getEnv('NEXT_PUBLIC_APP_URL') ?? '';

// HTTP server
export const PORT: number = parseNumber('PORT', 4000);

// Reader Agent gate thresholds
export const QUALITY_MIN: number = parseNumber('QUALITY_MIN', 0.3);
export const INTEREST_MIN: number = parseNumber('INTEREST_MIN', 0.3);
export const CONFIDENCE_MIN: number = parseNumber('CONFIDENCE_MIN', 30);

// Watcher tuning
export const PRICE_MIN_ATOMIC: number = parseNumber('PRICE_MIN_ATOMIC', 10_000);   // $0.01
export const PRICE_MAX_ATOMIC: number = parseNumber('PRICE_MAX_ATOMIC', 1_000_000); // $1.00
export const W_VIEWS: number = parseNumber('W_VIEWS', 0.4);
export const W_DWELL: number = parseNumber('W_DWELL', 0.4);
export const W_TIPS: number  = parseNumber('W_TIPS',  0.2);
export const PRICE_MAX_HOURLY_MOVE_PCT: number = parseNumber('PRICE_MAX_HOURLY_MOVE_PCT', 0.05);

export const WATCHER_INTERVAL_MS: number = parseNumber('WATCHER_INTERVAL_MINUTES', 60) * 60 * 1000;
export const AUDIT_INTERVAL_MS: number   = parseNumber('AUDIT_INTERVAL_MINUTES', 55) * 60 * 1000;

// Gateway redeposit
export const GATEWAY_REDEPOSIT_THRESHOLD_USDC = '0.5';
export const GATEWAY_REDEPOSIT_AMOUNT_USDC = '5';

export function validateAgentConfig(): void {
  if (!SUPABASE_URL) throw new Error('[config] Missing SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('[config] Missing SUPABASE_SERVICE_ROLE_KEY');
  if (!INTERNAL_HMAC_SECRET) throw new Error('[config] Missing INTERNAL_HMAC_SECRET');
  if (!APP_BASE_URL) throw new Error('[config] Missing APP_BASE_URL (Vercel URL for tip x402 endpoint)');
  if (isGroqMockMode) {
    console.warn('[config] GROQ_API_KEY not set — Groq gate scores use deterministic stubs');
  }
  if (!PINATA_JWT) {
    console.warn('[config] PINATA_JWT not set — price-tune reasoning will not be pinned to IPFS');
  }
  if (isPaymentMockMode) {
    console.warn('[config] ARC_RPC_URL or BUYER_PRIVATE_KEY missing — payment path returns deterministic stubs');
  } else {
    requireEnv('ARC_RPC_URL');
    requireEnv('BUYER_PRIVATE_KEY');
    requireEnv('CONTENT_FACTORY_ADDRESS');
    requireEnv('CONTENT_TUNER_PRIVATE_KEY');
  }
  if (isPaymentMockMode && (!CONTENT_FACTORY_ADDRESS || !CONTENT_TUNER_PRIVATE_KEY)) {
    console.warn('[config] payment mock mode — content contract txs use deterministic mock addresses');
  }
}
