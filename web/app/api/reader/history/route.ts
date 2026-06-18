import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient } from "../../../../lib/db";
import { getReaderBalance, getOrCreateReaderWallet } from "../../../../lib/reader-wallets/index";
import { USDC_ERC20_DECIMALS, isMockMode } from "../../../../lib/config";

function fmt(n: bigint): string {
  return (Number(n) / 10 ** USDC_ERC20_DECIMALS).toFixed(6);
}

export async function GET() {
  if (isMockMode) {
    return NextResponse.json({
      address: "0x9b86FF5733c6F84E3ECF8E3ECF8E3ECF8E3ECF8E",
      spendable: "0.070800",
      deposited: "0.100000",
      spent: "0.029200",
      unlocks: [
        {
          id: "mock-payment-1",
          amount: "8200",
          created_at: new Date(Date.now() - 3600000).toISOString(),
          tx_ref: "0x0022222222222222222222222222222222222222222222222222222222222222",
          arc_explorer_url: "https://testnet.arcscan.app/tx/0x0022",
          pieces: {
            id: "mock-piece-1",
            title: "The Quiet Collapse of Attention",
            kind: "article"
          }
        },
        {
          id: "mock-payment-2",
          amount: "21000",
          created_at: new Date(Date.now() - 7200000).toISOString(),
          tx_ref: "0x0033333333333333333333333333333333333333333333333333333333333333",
          arc_explorer_url: "https://testnet.arcscan.app/tx/0x0033",
          pieces: {
            id: "mock-piece-2",
            title: "Field Notes, Ep. 9",
            kind: "video"
          }
        }
      ],
      tips: [
        {
          id: "mock-payment-3",
          amount: "10000",
          created_at: new Date(Date.now() - 3000000).toISOString(),
          tx_ref: "0x0044444444444444444444444444444444444444444444444444444444444444",
          arc_explorer_url: "https://testnet.arcscan.app/tx/0x0044",
          pieces: {
            id: "mock-piece-1",
            title: "The Quiet Collapse of Attention",
            kind: "article"
          }
        }
      ]
    });
  }

  const cookieStore = await cookies();
  const readerId = cookieStore.get("cresc_reader_id")?.value;

  if (!readerId) {
    return NextResponse.json({ error: "No reader session found" }, { status: 401 });
  }

  try {
    const db = createServerClient();
    // Run getReaderBalance first — it may auto-deposit new on-chain funds and update usdc_deposited.
    const { gatewayAvailable } = await getReaderBalance(readerId);
    // Re-fetch wallet AFTER getReaderBalance so usdc_deposited reflects any new deposit.
    const wallet = await getOrCreateReaderWallet(readerId);

    // Query settled payments for this EOA
    const { data: payments, error: paymentsError } = await db
      .from("payments")
      .select(`
        id,
        amount,
        kind,
        created_at,
        tx_ref,
        arc_explorer_url,
        piece_id,
        pieces (
          id,
          title,
          kind
        )
      `)
      .eq("reader_id", wallet.eoa_address)
      .eq("status", "settled")
      .order("created_at", { ascending: false });

    if (paymentsError) throw paymentsError;

    const unlocks = (payments ?? []).filter((p: any) => p.kind === "unlock");
    const tips = (payments ?? []).filter((p: any) => p.kind === "tip");

    return NextResponse.json({
      address: wallet.eoa_address,
      spendable: fmt(gatewayAvailable),
      deposited: fmt(BigInt(wallet.usdc_deposited || "0")),
      spent: fmt(BigInt(wallet.usdc_spent || "0")),
      unlocks,
      tips
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
