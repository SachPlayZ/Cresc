import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getReaderBalance, getSpendableBalance } from "../../../../lib/reader-wallets/index";
import { USDC_ERC20_DECIMALS } from "../../../../lib/config";

function fmt(n: bigint): string {
  return (Number(n) / 10 ** USDC_ERC20_DECIMALS).toFixed(6);
}

export async function GET() {
  const cookieStore = await cookies();
  const readerId = cookieStore.get("cresc_reader_id")?.value;

  if (!readerId) {
    return NextResponse.json({ error: "No reader session" }, { status: 401 });
  }

  try {
    const [{ onChain, gatewayAvailable, gatewayFunded }, spendable] = await Promise.all([
      getReaderBalance(readerId),
      getSpendableBalance(readerId),
    ]);

    return NextResponse.json({
      onChain: fmt(onChain),
      gatewayAvailable: fmt(gatewayAvailable),
      gatewayFunded,
      spendable: fmt(spendable),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
