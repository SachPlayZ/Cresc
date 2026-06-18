// keep-in-sync: Cresc/lib/config.ts
// Agent-service variant: no NEXT_PUBLIC_* vars; reads all from process.env directly.

export const ARC_CHAIN_ID = 5042002 as const;
export const ARC_CAIP2 = 'eip155:5042002' as const;
export const ARC_SDK_CHAIN = 'arcTestnet' as const;
export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const;
export const GATEWAY_WALLET_ADDRESS = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9' as const;
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

export const SUPABASE_URL: string = getEnv('SUPABASE_URL') ?? '';
export const SUPABASE_SERVICE_ROLE_KEY: string = getEnv('SUPABASE_SERVICE_ROLE_KEY') ?? '';

export const ARC_RPC_URL: string = getEnv('ARC_RPC_URL') ?? '';
export const SELLER_ADDRESS: string = getEnv('SELLER_ADDRESS') ?? '';
export const SELLER_PRIVATE_KEY: string = getEnv('SELLER_PRIVATE_KEY') ?? '';

export const LLM_API_KEY: string = getEnv('LLM_API_KEY') ?? '';
export const LLM_BASE_URL: string = getEnv('LLM_BASE_URL') ?? 'https://api.groq.com/openai/v1';
export const LLM_MODEL: string = getEnv('LLM_MODEL') ?? 'llama-3.3-70b-versatile';

export const PRICE_CEILING: number = parseNumber('PRICE_CEILING', 0.1);
export const PRICE_FLOOR_MIN: number = parseNumber('PRICE_FLOOR_MIN', 0.001);
export const SWEEP_INTERVAL_MINUTES: number = parseNumber('SWEEP_INTERVAL_MINUTES', 15);
export const SESSION_END_TIMEOUT_SECONDS: number = parseNumber('SESSION_END_TIMEOUT_SECONDS', 25);

if (PRICE_CEILING > 0.1) throw new Error('[config] PRICE_CEILING must be <= 0.1');
if (PRICE_FLOOR_MIN < 0.000001) throw new Error('[config] PRICE_FLOOR_MIN must be >= $0.000001');
if (PRICE_FLOOR_MIN >= PRICE_CEILING) throw new Error('[config] PRICE_FLOOR_MIN must be < PRICE_CEILING');

export function validateAgentConfig(): void {
  requireEnv('SUPABASE_URL');
  requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!isMockMode) {
    requireEnv('LLM_API_KEY');
  }
}
