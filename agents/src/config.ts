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

export const isMockMode: boolean = !getEnv('LLM_API_KEY');

export const SUPABASE_URL: string = getEnv('SUPABASE_URL') ?? getEnv('NEXT_PUBLIC_SUPABASE_URL') ?? '';
export const SUPABASE_SERVICE_ROLE_KEY: string = getEnv('SUPABASE_SERVICE_ROLE_KEY') ?? '';

export const ARC_RPC_URL: string = getEnv('ARC_RPC_URL') ?? '';

// The ONE raw key in the system. Lives only on EC2. SELLER_PRIVATE_KEY stays empty (Circle wallet).
export const BUYER_PRIVATE_KEY: string = getEnv('BUYER_PRIVATE_KEY') ?? '';

// Circle developer-controlled wallets (creator payouts)
export const CIRCLE_API_KEY: string = getEnv('CIRCLE_API_KEY') ?? '';
export const CIRCLE_ENTITY_SECRET: string = getEnv('CIRCLE_ENTITY_SECRET') ?? getEnv('ENTITY_SECRET') ?? '';
export const CIRCLE_WALLET_SET_ID: string = getEnv('CIRCLE_WALLET_SET_ID') ?? '';

// LLM — Groq via OpenAI-compatible API
export const LLM_API_KEY: string = getEnv('LLM_API_KEY') ?? '';
export const LLM_BASE_URL: string = getEnv('LLM_BASE_URL') ?? 'https://api.groq.com/openai/v1';
export const LLM_MODEL: string = getEnv('LLM_MODEL') ?? 'llama-3.3-70b-versatile';

// Internal HMAC (Vercel↔EC2)
export const INTERNAL_HMAC_SECRET: string = getEnv('INTERNAL_HMAC_SECRET') ?? '';

// Base URL of the Vercel app (needed to construct tip x402 URLs from EC2)
export const APP_BASE_URL: string = getEnv('APP_BASE_URL') ?? getEnv('NEXT_PUBLIC_APP_URL') ?? '';

// HTTP server
export const PORT: number = parseNumber('PORT', 4000);

// Reader Agent gate thresholds
export const QUALITY_MIN: number = parseNumber('QUALITY_MIN', 0.5);
export const INTEREST_MIN: number = parseNumber('INTEREST_MIN', 0.5);
export const CONFIDENCE_MIN: number = parseNumber('CONFIDENCE_MIN', 80);

// Watcher tuning
export const PRICE_MIN_ATOMIC: number = parseNumber('PRICE_MIN_ATOMIC', 10_000);   // $0.01
export const PRICE_MAX_ATOMIC: number = parseNumber('PRICE_MAX_ATOMIC', 1_000_000); // $1.00
export const W_VIEWS: number = parseNumber('W_VIEWS', 0.4);
export const W_DWELL: number = parseNumber('W_DWELL', 0.4);
export const W_TIPS: number  = parseNumber('W_TIPS',  0.2);

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
  if (isMockMode) {
    console.warn('[config] LLM_API_KEY not set — mock mode active (deterministic stubs)');
    return;
  }
  requireEnv('LLM_API_KEY');
  requireEnv('ARC_RPC_URL');
  requireEnv('BUYER_PRIVATE_KEY');
}
