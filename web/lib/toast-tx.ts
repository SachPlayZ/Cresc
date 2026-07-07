// lib/toast-tx.ts — shared "Transaction Confirmed" toast for the three client-side
// transaction flows (unlock payment, tip, creator withdraw). Fired only where a live
// browser session is actually watching — the Watcher's autonomous price-tune txs have
// no browser present and instead show up in the dashboard's price-history list.

import { toast } from "sonner";
import { fromBaseUnits, toDisplay } from "./money";

// Duplicated from lib/config.ts (not imported) — that module throws at import time if
// server-only secrets like INTERNAL_HMAC_SECRET are missing from process.env, which is
// always true in a browser bundle. This is a client-side helper, so it must never pull
// in lib/config.ts, even transitively — these two values are public constants anyway.
const ARC_EXPLORER_BASE = "https://testnet.arcscan.app" as const;
const USDC_ERC20_DECIMALS = 6 as const;

export function showTxConfirmedToast(amountAtomic: string | bigint, txHash: string) {
  const display = toDisplay(fromBaseUnits(BigInt(amountAtomic), USDC_ERC20_DECIMALS));
  toast.success("Transaction Confirmed", {
    description: `${display} settled on Arc`,
    action: {
      label: "View on ArcScan",
      onClick: () => window.open(`${ARC_EXPLORER_BASE}/tx/${txHash}`, "_blank", "noopener,noreferrer"),
    },
  });
}
