/**
 * scripts/generate-wallets.mts — generate two EOA wallets for Cresc (seller + buyer).
 * M0: Mirrors the circlefin/arc-nanopayments reference repo pattern.
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

const seller = generateWallet("SELLER (creator/platform — receives payments)");
const buyer = generateWallet("BUYER (reader/agent — sends payments)");

console.log("\n==========================================================");
console.log("  Cresc — EOA Wallet Generator (Arc Testnet)");
console.log("==========================================================");
console.log("  WARNING: COPY THESE TO .env.local — NEVER commit them!\n");

for (const wallet of [seller, buyer]) {
  console.log(`--- ${wallet.label} ---`);
  console.log(`  Address:     ${wallet.address}`);
  console.log(`  Private key: ${wallet.privateKey}`);
  console.log();
}

console.log("--- Paste into .env.local ---");
console.log(`SELLER_ADDRESS=${seller.address}`);
console.log(`SELLER_PRIVATE_KEY=${seller.privateKey}`);
console.log(`BUYER_ADDRESS=${buyer.address}`);
console.log(`BUYER_PRIVATE_KEY=${buyer.privateKey}`);
console.log();
console.log("--- Next steps ---");
console.log("1. Copy the block above into .env.local");
console.log("2. Fund SELLER with testnet USDC: https://faucet.circle.com/");
console.log("   (Select 'Arc Testnet', choose USDC, ~10 USDC/request)");
console.log("3. Fund BUYER with testnet USDC (same faucet)");
console.log("4. BUYER must deposit USDC into Gateway once (one-time onchain tx)");
console.log("   → Handled by lib/circle (M3): client.deposit('1')");
console.log("5. Verify on: https://testnet.arcscan.app");
console.log("==========================================================\n");
