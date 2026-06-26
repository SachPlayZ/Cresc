/**
 * lib/money.ts — UsdcAmount type + arithmetic helpers.
 * M0: All money is bigint base units. NEVER floats in storage.
 * Decimals always passed in — never hardcoded (CLAUDE.md §4.2, §7.4, §8).
 *
 * USDC ERC-20 on Arc Testnet: 6 decimals (read decimals() from contract at runtime).
 * This module is chain-agnostic — callers supply decimals.
 */

export type UsdcAmount = {
  /** Base units as bigint (e.g. 10000n = $0.01 with 6 decimals). */
  value: bigint;
  /** Number of decimal places from the ERC-20 contract's decimals(). */
  decimals: number;
};

/**
 * fromDisplay — convert a human-readable dollar string or number to UsdcAmount.
 * Supports: "$0.01", "0.01", 0.01, 0.001
 * Precision is preserved via string arithmetic — no float storage.
 *
 * @param amount - Dollar string ("$0.01") or number (0.01).
 * @param decimals - From contract decimals() (e.g. 6 for USDC ERC-20 on Arc).
 */
export function fromDisplay(amount: string | number, decimals: number): UsdcAmount {
  // Strip leading "$" and trim whitespace
  const raw = typeof amount === "string"
    ? amount.replace(/^\$/, "").trim()
    : amount.toString();

  if (raw === "" || isNaN(Number(raw))) {
    throw new Error(`[money] Invalid amount: "${amount}"`);
  }

  // Split on decimal point to avoid float imprecision
  const [wholePart, fracPart = ""] = raw.split(".");

  // Pad or truncate fractional part to `decimals` digits
  const fracPadded = fracPart.padEnd(decimals, "0").slice(0, decimals);

  const baseUnits = BigInt(wholePart) * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");

  return { value: baseUnits, decimals };
}

/**
 * toDisplay — convert UsdcAmount to human-readable string "$X.XXXXXX".
 * No floats — pure bigint / string arithmetic.
 */
export function toDisplay(amount: UsdcAmount): string {
  const { value, decimals } = amount;
  const factor = 10n ** BigInt(decimals);
  const whole = value / factor;
  const frac = value % factor;

  // Pad fractional part with leading zeros to `decimals` digits
  const fracStr = frac.toString().padStart(decimals, "0");

  // Trim trailing zeros for display (e.g. "010000" → "01")
  const fracTrimmed = fracStr.replace(/0+$/, "") || "0";

  return `$${whole}.${fracTrimmed}`;
}

/**
 * add — sum two UsdcAmounts. Decimals must match.
 */
export function add(a: UsdcAmount, b: UsdcAmount): UsdcAmount {
  assertSameDecimals(a, b, "add");
  return { value: a.value + b.value, decimals: a.decimals };
}

/**
 * sub — subtract b from a. Throws if result would be negative.
 */
export function sub(a: UsdcAmount, b: UsdcAmount): UsdcAmount {
  assertSameDecimals(a, b, "sub");
  if (a.value < b.value) {
    throw new Error(
      `[money] sub underflow: ${toDisplay(a)} - ${toDisplay(b)} < 0`
    );
  }
  return { value: a.value - b.value, decimals: a.decimals };
}

/**
 * cmp — compare two UsdcAmounts.
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b.
 */
export function cmp(a: UsdcAmount, b: UsdcAmount): -1 | 0 | 1 {
  assertSameDecimals(a, b, "cmp");
  if (a.value < b.value) return -1;
  if (a.value > b.value) return 1;
  return 0;
}

/**
 * clamp — clamp amount to [min, max] (both inclusive). Decimals must match.
 * Used for envelope enforcement (CLAUDE.md §7.1).
 */
export function clamp(amount: UsdcAmount, min: UsdcAmount, max: UsdcAmount): UsdcAmount {
  assertSameDecimals(amount, min, "clamp");
  assertSameDecimals(amount, max, "clamp");
  if (amount.value < min.value) return { value: min.value, decimals: amount.decimals };
  if (amount.value > max.value) return { value: max.value, decimals: amount.decimals };
  return amount;
}

/**
 * fromBaseUnits — wrap a raw bigint (already in base units) with decimals metadata.
 * Use when receiving amounts from the Gateway SDK (which returns bigints).
 */
export function fromBaseUnits(value: bigint, decimals: number): UsdcAmount {
  return { value, decimals };
}

/**
 * toBaseUnitsString — return the base-unit value as a decimal string.
 * Required by the Circle SDK which expects amount as string (e.g. "10000" for $0.01).
 */
export function toBaseUnitsString(amount: UsdcAmount): string {
  return amount.value.toString();
}

/**
 * erc20ToNative — convert ERC-20 6-decimal amount to native 18-decimal bigint.
 * Conversion: native = erc20 × 10^12. Used for gas accounting only.
 */
export function erc20ToNative(erc20: UsdcAmount): bigint {
  if (erc20.decimals !== 6) throw new Error('[money] erc20ToNative requires 6-decimal ERC-20 amount');
  return erc20.value * 10n ** 12n;
}

/**
 * nativeToErc20 — convert native 18-decimal bigint to ERC-20 6-decimal UsdcAmount.
 * Conversion: erc20 = native / 10^12. Truncates (no rounding) — use for display only.
 */
export function nativeToErc20(native: bigint): UsdcAmount {
  return { value: native / 10n ** 12n, decimals: 6 };
}

// --- internal ---

function assertSameDecimals(a: UsdcAmount, b: UsdcAmount, op: string): void {
  if (a.decimals !== b.decimals) {
    throw new Error(
      `[money] ${op}: decimal mismatch — a.decimals=${a.decimals}, b.decimals=${b.decimals}. ` +
        `Always read decimals() from contract before arithmetic.`
    );
  }
}
