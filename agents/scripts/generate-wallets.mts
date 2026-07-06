/**
 * scripts/generate-wallets.mts — generate EOA operator wallets for Cresc testnet.
 *
 * Usage: npm run generate-wallets
 *
 * IMPORTANT: EOA wallets ONLY — Gateway nanopayments require ecrecover-compatible
 * EIP-3009 signatures. Smart-contract-account (SCA) wallets are NOT supported (CLAUDE.md §4.3).
 *
 * Output: addresses + private keys → copy to .env.local (NEVER commit .env.local).
 * Fund with testnet USDC at: https://faucet.circle.com/ (select Arc Testnet, choose USDC)
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

function generateWallet(label: string) {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return { label, address: account.address, privateKey };
}

const buyer = generateWallet("BUYER (reader agent — signs x402 payments)");
const tuner = generateWallet("CONTENT TUNER (agent operator — deploys/tunes/withdraws vaults)");

console.log("\n==========================================================");
console.log("  Cresc — EOA Wallet Generator (Arc Testnet)");
console.log("==========================================================");
console.log("  WARNING: COPY THESE TO .env.local — NEVER commit them!\n");

for (const wallet of [buyer, tuner]) {
  console.log(`--- ${wallet.label} ---`);
  console.log(`  Address:     ${wallet.address}`);
  console.log(`  Private key: ${wallet.privateKey}`);
  console.log();
}

console.log("--- Paste into .env.local ---");
console.log(`BUYER_ADDRESS=${buyer.address}`);
console.log(`BUYER_PRIVATE_KEY=${buyer.privateKey}`);
console.log(`CONTENT_TUNER_ADDRESS=${tuner.address}`);
console.log(`CONTENT_TUNER_PRIVATE_KEY=${tuner.privateKey}`);
console.log();
console.log("--- Next steps ---");
console.log("1. Copy the block above into .env.local");
console.log("2. Fund BUYER with testnet USDC: https://faucet.circle.com/");
console.log("3. Fund CONTENT_TUNER with enough USDC for Arc gas.");
console.log("4. BUYER must deposit USDC into Gateway once:");
console.log("   npx tsx --env-file=.env.local scripts/deposit-gateway.mts --amount 5");
console.log("5. Verify on: https://testnet.arcscan.app");
console.log("==========================================================\n");
