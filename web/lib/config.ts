/**
 * lib/config.ts — typed, validated environment config for Cresc.
 * M0: reads all env vars from CLAUDE.md §5; throws on missing required vars (unless mock mode).
 * isMockMode = !GROQ_API_KEY — agents run deterministic canned Groq-shaped responses when true.
 */

// Arc Testnet constants (CLAUDE.md §4.1–4.2 ground truth — do NOT re-derive)
export const ARC_CHAIN_ID = 5042002 as const;
export const ARC_CAIP2 = "eip155:5042002" as const;
export const ARC_SDK_CHAIN = "arcTestnet" as const;
export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
export const EURC_ADDRESS = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as const;
// GatewayWallet = verifyingContract in EIP-3009 domain (CLAUDE.md §4.2, domain 26, VERIFIED)
export const GATEWAY_WALLET_ADDRESS = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as const;
export const GATEWAY_MINTER_ADDRESS = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B" as const;
export const GATEWAY_FACILITATOR_URL = "https://gateway-api-testnet.circle.com" as const;
export const ARC_EXPLORER_BASE = "https://testnet.arcscan.app" as const;

// USDC ERC-20 decimals on Arc (§4.2: 6 for ERC-20 interface, NOT 18 native gas)
// Always read decimals() from contract at runtime; this is the known value for validation only.
export const USDC_ERC20_DECIMALS = 6 as const;

// --- Runtime env loading ---

function getEnv(key: string): string | undefined {
  return process.env[key];
}

function parseNumber(key: string, fallback: number): number {
  const raw = getEnv(key);
  if (!raw) return fallback;
  const n = parseFloat(raw);
  if (isNaN(n)) throw new Error(`[config] ${key} must be a number, got: "${raw}"`);
  return n;
}

// --- Mock mode detection (no Groq API key = deterministic gate/audit stubs) ---
export const GROQ_API_KEY: string = getEnv("GROQ_API_KEY") ?? "";
export const isMockMode: boolean = !GROQ_API_KEY;

// --- Supabase (always required) ---
export const SUPABASE_URL: string = (() => {
  const val = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  if (!val) {
    // In mock/dev mode without Supabase, return empty string — DB calls will fail gracefully.
    // Assumption: Supabase is optional in pure mock mode; validated in M1.
    return "";
  }
  return val;
})();

export const SUPABASE_ANON_KEY: string = getEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ?? "";
export const SUPABASE_SERVICE_ROLE_KEY: string = getEnv("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// --- Arc / Circle (server-side only — never NEXT_PUBLIC_) ---
export const ARC_RPC_URL: string = getEnv("ARC_RPC_URL") ?? "";
// SELLER_PRIVATE_KEY must NEVER exist on Vercel — creator/seller = Circle UCW wallet (no app-held raw key).
// BUYER_PRIVATE_KEY lives ONLY on EC2 — never import it in web code.
// Vercel only needs BatchFacilitatorClient (keyless) for settlement.

// --- Circle API key (used for UCW backend client; legacy DCW fields remain for old paths only) ---
export const CIRCLE_API_KEY: string = getEnv("CIRCLE_API_KEY") ?? "";
// Legacy DCW fields — kept for wallets.ts backward compat; not used for creator wallets.
export const ENTITY_SECRET: string = getEnv("ENTITY_SECRET") ?? "";
export const CIRCLE_WALLET_SET_ID: string = getEnv("CIRCLE_WALLET_SET_ID") ?? "";
export const CIRCLE_BUYER_WALLET_ID: string = getEnv("CIRCLE_BUYER_WALLET_ID") ?? "";
export const CIRCLE_BUYER_WALLET_ADDRESS: string = getEnv("CIRCLE_BUYER_WALLET_ADDRESS") ?? "";
export const CIRCLE_SELLER_WALLET_ID: string = getEnv("CIRCLE_SELLER_WALLET_ID") ?? "";
export const CIRCLE_SELLER_WALLET_ADDRESS: string = getEnv("CIRCLE_SELLER_WALLET_ADDRESS") ?? "";

// --- Circle user-controlled wallets (UCW) — creator wallet system ---
// NEXT_PUBLIC_ so the frontend W3S SDK can initialize without a server round-trip.
export const CIRCLE_UCW_APP_ID: string = getEnv("NEXT_PUBLIC_CIRCLE_APP_ID") ?? "";
export const CIRCLE_GOOGLE_CLIENT_ID: string = getEnv("NEXT_PUBLIC_CIRCLE_GOOGLE_CLIENT_ID") ?? "";

// --- Groq via OpenAI-compatible API ---
export const GROQ_BASE_URL: string =
  getEnv("GROQ_BASE_URL") ?? "https://api.groq.com/openai/v1";
export const GROQ_MODEL: string =
  getEnv("GROQ_MODEL") ?? "llama-3.3-70b-versatile";
// --- App pricing config ---
export const PRICE_CEILING: number = parseNumber("PRICE_CEILING", 0.1);
export const PRICE_FLOOR_MIN: number = parseNumber("PRICE_FLOOR_MIN", 0.001);
export const SWEEP_INTERVAL_MINUTES: number = parseNumber("SWEEP_INTERVAL_MINUTES", 15);
export const HEARTBEAT_INTERVAL_SECONDS: number = parseNumber("HEARTBEAT_INTERVAL_SECONDS", 5);
export const SESSION_END_TIMEOUT_SECONDS: number = parseNumber("SESSION_END_TIMEOUT_SECONDS", 25);

// Sanity invariants (CLAUDE.md §7.1)
if (PRICE_CEILING > 0.1) {
  throw new Error("[config] PRICE_CEILING must be <= 0.1 (USDC)");
}
if (PRICE_FLOOR_MIN < 0.000001) {
  throw new Error("[config] PRICE_FLOOR_MIN must be >= $0.000001 (Gateway minimum)");
}
if (PRICE_FLOOR_MIN >= PRICE_CEILING) {
  throw new Error("[config] PRICE_FLOOR_MIN must be < PRICE_CEILING");
}

/**
 * validateServerConfig — call this in server-only code paths (API routes, agents).
 * Throws if critical server-side vars are missing AND we're not in mock mode.
 */
export function validateServerConfig(): void {
  if (!isMockMode) {
    if (!GROQ_API_KEY) throw new Error("[config] GROQ_API_KEY required for Groq agent calls");
  }
  // Payment config is required when payment routes are active (M3/M4).
  // M0 stubs these — validated in M3.
}

/**
 * validatePaymentConfig — call from Circle adapter before any payment operation.
 * Vercel only needs ARC_RPC_URL (for public client reads) and Circle wallet config.
 * Raw keys (BUYER_PRIVATE_KEY) live on EC2 only.
 */
export function validatePaymentConfig(): void {
  if (!isCircleWalletMode && !ARC_RPC_URL) {
    throw new Error("[config] Either ARC_RPC_URL or CIRCLE_API_KEY+ENTITY_SECRET required for payments");
  }
}

// Derived flag: Circle wallet mode active when both keys present
export const isCircleWalletMode: boolean = !!(
  getEnv("CIRCLE_API_KEY") && (getEnv("ENTITY_SECRET") || getEnv("CIRCLE_ENTITY_SECRET"))
);

// --- Reader wallet encryption (raw EOA path) ---
export const READER_KEY_SECRET: string = getEnv("READER_KEY_SECRET") ?? "";

// --- Internal Vercel↔EC2 HMAC auth (CLAUDE.md §Vercel↔EC2 boundary) ---
export const INTERNAL_HMAC_SECRET: string = getEnv("INTERNAL_HMAC_SECRET") ?? "";
export const EC2_AGENT_BASE_URL: string = getEnv("EC2_AGENT_BASE_URL") ?? "";

// --- Ghost key encryption (AES-256-GCM, 32-byte hex key) ---
export const GHOST_KEY_ENCRYPTION_SECRET: string = getEnv("GHOST_KEY_ENCRYPTION_SECRET") ?? "";

// --- Ghost webhook (Vercel-side verification) ---
export const GHOST_WEBHOOK_SECRET: string = getEnv("GHOST_WEBHOOK_SECRET") ?? "";

// INTERNAL_HMAC_SECRET assertion — skipped at Next.js build time (NEXT_PHASE env var).
// Throws at runtime so misconfigured deployments fail fast on first request.
if (
  !INTERNAL_HMAC_SECRET &&
  process.env.NEXT_PHASE !== 'phase-production-build' &&
  process.env.NEXT_PHASE !== 'phase-export'
) {
  throw new Error(
    "[config] INTERNAL_HMAC_SECRET required. " +
    "Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\" " +
    "Add to .env.local on BOTH web and agents."
  );
}

// --- Reader Agent gate thresholds (EC2 env vars; listed here for reference) ---
// QUALITY_MIN, INTEREST_MIN, CONFIDENCE_MIN — see EC2 config.ts

// Frozen chain config object for convenience
export const chainConfig = {
  chainId: ARC_CHAIN_ID,
  caip2: ARC_CAIP2,
  sdkChain: ARC_SDK_CHAIN,
  usdcAddress: USDC_ADDRESS,
  eurcAddress: EURC_ADDRESS,
  gatewayWalletAddress: GATEWAY_WALLET_ADDRESS,
  gatewayMinterAddress: GATEWAY_MINTER_ADDRESS,
  gatewayFacilitatorUrl: GATEWAY_FACILITATOR_URL,
  explorerBase: ARC_EXPLORER_BASE,
  rpcUrl: ARC_RPC_URL,
} as const;
