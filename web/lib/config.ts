/**
 * lib/config.ts — typed, validated environment config for Cresc.
 * M0: reads all env vars from CLAUDE.md §5; throws on missing required vars (unless mock mode).
 */

// Arc Testnet constants (CLAUDE.md §4.1–4.2 ground truth — do NOT re-derive)
export const ARC_CHAIN_ID = 5042002 as const;
export const ARC_CAIP2 = "eip155:5042002" as const;
export const ARC_SDK_CHAIN = "arcTestnet" as const;
export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
// GatewayWallet = verifyingContract in EIP-3009 domain (CLAUDE.md §4.2, domain 26, VERIFIED)
export const GATEWAY_WALLET_ADDRESS = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as const;
export const GATEWAY_MINTER_ADDRESS = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B" as const;
export const GATEWAY_FACILITATOR_URL = "https://gateway-api-testnet.circle.com" as const;
export const ARC_EXPLORER_BASE = "https://testnet.arcscan.app" as const;
export const CONTENT_FACTORY_ADDRESS: string = getEnv("CONTENT_FACTORY_ADDRESS") ?? "";

// USDC ERC-20 decimals on Arc (§4.2: 6 for ERC-20 interface, NOT 18 native gas)
// Always read decimals() from contract at runtime; this is the known value for validation only.
export const USDC_ERC20_DECIMALS = 6 as const;

// --- Runtime env loading ---

function getEnv(key: string): string | undefined {
  return process.env[key];
}

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
// BUYER_PRIVATE_KEY and CONTENT_TUNER_PRIVATE_KEY live ONLY on EC2 — never import them in web code.
// Vercel only needs BatchFacilitatorClient (keyless) for settlement.

// --- Circle API key (used for UCW backend client) ---
export const CIRCLE_API_KEY: string = getEnv("CIRCLE_API_KEY") ?? "";

// --- Circle user-controlled wallets (UCW) — creator wallet system ---
// NEXT_PUBLIC_ so the frontend W3S SDK can initialize without a server round-trip.
export const CIRCLE_UCW_APP_ID: string = getEnv("NEXT_PUBLIC_CIRCLE_APP_ID") ?? "";
export const CIRCLE_GOOGLE_CLIENT_ID: string = getEnv("NEXT_PUBLIC_CIRCLE_GOOGLE_CLIENT_ID") ?? "";

// Derived flag: Circle wallet mode active when both keys present
export const isCircleWalletMode: boolean = !!(
  getEnv("CIRCLE_API_KEY") && (getEnv("ENTITY_SECRET") || getEnv("CIRCLE_ENTITY_SECRET"))
);

// --- Internal Vercel↔EC2 HMAC auth (CLAUDE.md §Vercel↔EC2 boundary) ---
export const INTERNAL_HMAC_SECRET: string = getEnv("INTERNAL_HMAC_SECRET") ?? "";
export const EC2_AGENT_BASE_URL: string = getEnv("EC2_AGENT_BASE_URL") ?? "";

// --- Ghost key encryption (AES-256-GCM, 32-byte hex key) ---
export const GHOST_KEY_ENCRYPTION_SECRET: string = getEnv("GHOST_KEY_ENCRYPTION_SECRET") ?? "";

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
  gatewayWalletAddress: GATEWAY_WALLET_ADDRESS,
  gatewayMinterAddress: GATEWAY_MINTER_ADDRESS,
  gatewayFacilitatorUrl: GATEWAY_FACILITATOR_URL,
  contentFactoryAddress: CONTENT_FACTORY_ADDRESS,
  explorerBase: ARC_EXPLORER_BASE,
  rpcUrl: ARC_RPC_URL,
} as const;
