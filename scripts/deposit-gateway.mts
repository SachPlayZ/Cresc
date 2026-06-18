/**
 * scripts/deposit-gateway.mts
 * Deposits USDC from the Circle-managed buyer wallet into Circle Gateway.
 * Uses Circle's createTransaction API (contract execution) — no raw private key needed.
 *
 * Flow:
 *   1. USDC.approve(GatewayWallet, amount)
 *   2. GatewayWallet.deposit(USDC, amount)
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/deposit-gateway.mts
 *   npx tsx --env-file=.env.local scripts/deposit-gateway.mts --amount 5
 */

import { createRequire } from "node:module";

const _req = createRequire(import.meta.url);
const { initiateDeveloperControlledWalletsClient } = _req(
  "@circle-fin/developer-controlled-wallets"
) as typeof import("@circle-fin/developer-controlled-wallets");

const CIRCLE_API_KEY         = process.env.CIRCLE_API_KEY!;
const ENTITY_SECRET          = process.env.ENTITY_SECRET!;
const CIRCLE_BUYER_WALLET_ID = process.env.CIRCLE_BUYER_WALLET_ID!;
const USDC_ADDRESS           = process.env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000";
const GATEWAY_WALLET_ADDRESS = process.env.GATEWAY_WALLET_ADDRESS ?? "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";

if (!CIRCLE_API_KEY || !ENTITY_SECRET || !CIRCLE_BUYER_WALLET_ID) {
  console.error("❌  Need CIRCLE_API_KEY, ENTITY_SECRET, CIRCLE_BUYER_WALLET_ID in .env.local");
  process.exit(1);
}

const amountArg = (() => {
  const idx = process.argv.indexOf("--amount");
  if (idx !== -1) return process.argv[idx + 1];
  const eq = process.argv.find(a => a.startsWith("--amount="));
  if (eq) return eq.split("=")[1];
  return "2";
})();

const amountUsdc = parseFloat(amountArg);
if (isNaN(amountUsdc) || amountUsdc <= 0) {
  console.error(`❌  Invalid amount: ${amountArg}`);
  process.exit(1);
}

// 6-decimal base units (USDC ERC-20 on Arc)
const amountBaseUnits = BigInt(Math.round(amountUsdc * 1_000_000)).toString();

const TERMINAL = new Set(["COMPLETE", "FAILED", "DENIED", "CANCELLED"]);
const EXPLORER = "https://testnet.arcscan.app/tx";

async function pollTx(client: ReturnType<typeof initiateDeveloperControlledWalletsClient>, txId: string, label: string): Promise<string> {
  process.stdout.write(`  Waiting for ${label}`);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const resp = await client.getTransaction({ id: txId });
    const tx = resp.data?.transaction;
    if (tx?.state && TERMINAL.has(tx.state)) {
      process.stdout.write("\n");
      if (tx.state === "COMPLETE") return tx.txHash ?? txId;
      throw new Error(`${label} ended in state: ${tx.state} — ${JSON.stringify(tx)}`);
    }
    process.stdout.write(".");
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error(`${label} timed out after 60s`);
}

async function main() {
  const client = initiateDeveloperControlledWalletsClient({
    apiKey: CIRCLE_API_KEY,
    entitySecret: ENTITY_SECRET,
  });

  console.log(`Depositing ${amountUsdc} USDC into Circle Gateway...`);
  console.log(`  Wallet ID: ${CIRCLE_BUYER_WALLET_ID}`);
  console.log(`  Amount:    ${amountUsdc} USDC (${amountBaseUnits} base units)`);

  // Step 1: approve GatewayWallet to spend USDC
  console.log("\nStep 1/2 — Approving GatewayWallet to spend USDC...");
  const approveResp = await client.createContractExecutionTransaction({
    walletId: CIRCLE_BUYER_WALLET_ID,
    contractAddress: USDC_ADDRESS,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: [GATEWAY_WALLET_ADDRESS, amountBaseUnits],
    idempotencyKey: crypto.randomUUID(),
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });

  const approveTxId = (approveResp as any).data?.id ?? (approveResp as any).id;
  if (!approveTxId) throw new Error("No transaction ID for approve");
  const approveTxHash = await pollTx(client, approveTxId, "approve");
  console.log(`  ✅ Approved: ${EXPLORER}/${approveTxHash}`);

  // Step 2: deposit USDC into GatewayWallet
  console.log("\nStep 2/2 — Depositing into GatewayWallet...");
  const depositResp = await client.createContractExecutionTransaction({
    walletId: CIRCLE_BUYER_WALLET_ID,
    contractAddress: GATEWAY_WALLET_ADDRESS,
    abiFunctionSignature: "deposit(address,uint256)",
    abiParameters: [USDC_ADDRESS, amountBaseUnits],
    idempotencyKey: crypto.randomUUID(),
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });

  const depositTxId = (depositResp as any).data?.id ?? (depositResp as any).id;
  if (!depositTxId) throw new Error("No transaction ID for deposit");
  const depositTxHash = await pollTx(client, depositTxId, "deposit");
  console.log(`  ✅ Deposited: ${EXPLORER}/${depositTxHash}`);

  console.log(`\n✅  Done! ${amountUsdc} USDC is now in Gateway.`);
  console.log("   Buyer can now unlock x402 content.");
}

main().catch(err => {
  console.error("\n❌  Failed:", err?.message ?? err);
  process.exit(1);
});
