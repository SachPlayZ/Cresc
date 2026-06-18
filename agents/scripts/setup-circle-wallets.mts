/**
 * scripts/setup-circle-wallets.mts
 * One-time setup for Circle developer-controlled wallets on ARC-TESTNET.
 * Covers all three required steps per the use-developer-controlled-wallets skill:
 *   Step 1 — Generate entity secret (if ENTITY_SECRET not already in env)
 *   Step 2 — Register entity secret ciphertext with Circle
 *   Step 3 — Create wallet set + seller + buyer EOA wallets
 *
 * Usage:
 *   # First run (no entity secret yet):
 *   CIRCLE_API_KEY=<key> npx tsx scripts/setup-circle-wallets.mts
 *
 *   # Subsequent runs (entity secret already registered, wallets already exist):
 *   npx tsx --env-file=.env.local scripts/setup-circle-wallets.mts --wallets-only
 *
 * Security: NEVER commit ENTITY_SECRET or the recovery file to git.
 * Store recovery file outside the repo root (default: ~/.circle/cresc-recovery.json).
 */

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createRequire } from "node:module";

// tsx has an ESM resolution bug with this package's ES bundle — load CJS directly via createRequire.
const _req = createRequire(import.meta.url);
const {
  generateEntitySecret,
  registerEntitySecretCiphertext,
  initiateDeveloperControlledWalletsClient,
} = _req("@circle-fin/developer-controlled-wallets") as typeof import("@circle-fin/developer-controlled-wallets");

// Blockchain.ArcTestnet = "ARC-TESTNET" — inlined because the SDK's ESM bundle doesn't export the enum.
const ARC_TESTNET = "ARC-TESTNET" as const;

const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY;
const EXISTING_SECRET = process.env.ENTITY_SECRET;
const WALLETS_ONLY = process.argv.includes("--wallets-only");

if (!CIRCLE_API_KEY) {
  console.error(
    "❌  CIRCLE_API_KEY must be set.\n" +
      "   Get yours at https://console.circle.com/ → API Keys."
  );
  process.exit(1);
}

async function main() {
  let entitySecret: string;

  if (WALLETS_ONLY) {
    // ── Skip secret steps: wallets-only mode ────────────────────────────────
    if (!EXISTING_SECRET) {
      console.error("❌  --wallets-only requires ENTITY_SECRET in .env.local");
      process.exit(1);
    }
    entitySecret = EXISTING_SECRET;
    console.log("Skipping secret registration (--wallets-only).");
  } else if (EXISTING_SECRET) {
    // ── Secret already registered, just re-register ciphertext ──────────────
    entitySecret = EXISTING_SECRET;
    console.log("ENTITY_SECRET found — re-registering ciphertext with Circle...");
    const recoveryDir = path.join(os.homedir(), ".circle");
    fs.mkdirSync(recoveryDir, { recursive: true });
    await registerEntitySecretCiphertext({
      apiKey: CIRCLE_API_KEY!,
      entitySecret,
      recoveryFileDownloadPath: recoveryDir,
    });
    console.log(`  Recovery file saved to: ${recoveryDir}/`);
  } else {
    // ── Fresh setup: generate + register ────────────────────────────────────
    console.log("Step 1/3 — Generating entity secret...");
    entitySecret = generateEntitySecret();
    console.log(
      "\n🔑  ENTITY_SECRET generated. Add this to .env.local NOW (before proceeding):\n"
    );
    console.log(`ENTITY_SECRET=${entitySecret}`);
    console.log(
      "\n   Store it securely — Circle never holds it. Losing it = losing wallet access."
    );

    console.log("\nStep 2/3 — Registering entity secret ciphertext with Circle...");
    const recoveryDir = path.join(os.homedir(), ".circle");
    const recoveryPath = path.join(recoveryDir, "cresc-recovery.json");
    fs.mkdirSync(recoveryDir, { recursive: true });
    await registerEntitySecretCiphertext({
      apiKey: CIRCLE_API_KEY!,
      entitySecret,
      recoveryFileDownloadPath: recoveryPath,
    });
    console.log(`  Registered. Recovery file saved to: ${recoveryPath}`);
    console.log("  Keep the recovery file OUTSIDE this repo and in secure storage.");
  }

  // ── Step 3: Create wallet set + EOA wallets ──────────────────────────────
  const client = initiateDeveloperControlledWalletsClient({
    apiKey: CIRCLE_API_KEY!,
    entitySecret,
  });

  const stepsLabel = WALLETS_ONLY ? "Step 1/1" : "Step 3/3";
  console.log(`\n${stepsLabel} — Creating Cresc wallet set on Circle...`);
  const wsResp = await client.createWalletSet({ name: "Cresc" });
  const walletSetId = wsResp.data?.walletSet?.id;
  if (!walletSetId) throw new Error("No wallet set ID in response");
  console.log(`  Wallet set: ${walletSetId}`);

  console.log("Creating seller + buyer EOA wallets on ARC-TESTNET...");
  const walletsResp = await client.createWallets({
    accountType: "EOA",
    blockchains: [ARC_TESTNET],
    count: 2,
    walletSetId,
  });

  const [seller, buyer] = walletsResp.data?.wallets ?? [];
  if (!seller || !buyer) throw new Error("Expected 2 wallets in response");

  console.log("\n✅  Wallets created. Add ALL of these to .env.local:\n");
  if (!EXISTING_SECRET) {
    console.log(`ENTITY_SECRET=${entitySecret}`);
  }
  console.log(`CIRCLE_API_KEY=${CIRCLE_API_KEY}`);
  console.log(`CIRCLE_WALLET_SET_ID=${walletSetId}`);
  console.log(`CIRCLE_SELLER_WALLET_ID=${seller.id}`);
  console.log(`CIRCLE_SELLER_WALLET_ADDRESS=${seller.address}`);
  console.log(`CIRCLE_BUYER_WALLET_ID=${buyer.id}`);
  console.log(`CIRCLE_BUYER_WALLET_ADDRESS=${buyer.address}`);
  console.log(`\n# Mirror addresses for raw-key compatibility:`);
  console.log(`SELLER_ADDRESS=${seller.address}`);
  console.log(`BUYER_ADDRESS=${buyer.address}`);
  console.log(
    "\n⚠️  Next steps:"
  );
  console.log(
    "   1. Faucet BUYER wallet: https://faucet.circle.com/ (Arc Testnet → USDC)"
  );
  console.log(
    "   2. Deposit BUYER into Gateway: GatewayClient.deposit('1') (runs once per wallet)"
  );
  console.log(
    "   3. Signing auto-switches to Circle MPC once CIRCLE_API_KEY + ENTITY_SECRET are in .env.local"
  );
}

main().catch((err) => {
  console.error("❌  Setup failed:", err?.message ?? err);
  process.exit(1);
});
