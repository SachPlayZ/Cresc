// keep-in-sync: Cresc/lib/money.ts
// UsdcAmount type + arithmetic helpers. All money is bigint base units, never floats in storage.

export type UsdcAmount = {
  value: bigint;
  decimals: number;
};

export function fromDisplay(amount: string | number, decimals: number): UsdcAmount {
  const raw = typeof amount === 'string' ? amount.replace(/^\$/, '').trim() : amount.toString();
  if (raw === '' || isNaN(Number(raw))) throw new Error(`[money] Invalid amount: "${amount}"`);
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [wholePart, fracPart = ''] = unsigned.split('.');
  const fracPadded = fracPart.padEnd(decimals, '0').slice(0, decimals);
  const magnitude = BigInt(wholePart || '0') * 10n ** BigInt(decimals) + BigInt(fracPadded || '0');
  return { value: negative ? -magnitude : magnitude, decimals };
}

export function toDisplay(amount: UsdcAmount): string {
  const { value, decimals } = amount;
  const factor = 10n ** BigInt(decimals);
  const whole = value / factor;
  const frac = value % factor;
  const fracStr = frac.toString().padStart(decimals, '0');
  const fracTrimmed = fracStr.replace(/0+$/, '') || '0';
  return `$${whole}.${fracTrimmed}`;
}

export function add(a: UsdcAmount, b: UsdcAmount): UsdcAmount {
  assertSameDecimals(a, b, 'add');
  return { value: a.value + b.value, decimals: a.decimals };
}

export function sub(a: UsdcAmount, b: UsdcAmount): UsdcAmount {
  assertSameDecimals(a, b, 'sub');
  if (a.value < b.value) throw new Error(`[money] sub underflow: ${toDisplay(a)} - ${toDisplay(b)}`);
  return { value: a.value - b.value, decimals: a.decimals };
}

export function cmp(a: UsdcAmount, b: UsdcAmount): -1 | 0 | 1 {
  assertSameDecimals(a, b, 'cmp');
  if (a.value < b.value) return -1;
  if (a.value > b.value) return 1;
  return 0;
}

export function clamp(amount: UsdcAmount, min: UsdcAmount, max: UsdcAmount): UsdcAmount {
  assertSameDecimals(amount, min, 'clamp');
  assertSameDecimals(amount, max, 'clamp');
  if (amount.value < min.value) return { value: min.value, decimals: amount.decimals };
  if (amount.value > max.value) return { value: max.value, decimals: amount.decimals };
  return amount;
}

export function fromBaseUnits(value: bigint, decimals: number): UsdcAmount {
  return { value, decimals };
}

export function toBaseUnitsString(amount: UsdcAmount): string {
  return amount.value.toString();
}

export function erc20ToNative(erc20: UsdcAmount): bigint {
  if (erc20.decimals !== 6) throw new Error('[money] erc20ToNative requires 6-decimal ERC-20 amount');
  return erc20.value * 10n ** 12n;
}

export function nativeToErc20(native: bigint): UsdcAmount {
  return { value: native / 10n ** 12n, decimals: 6 };
}

function assertSameDecimals(a: UsdcAmount, b: UsdcAmount, op: string): void {
  if (a.decimals !== b.decimals) {
    throw new Error(`[money] ${op}: decimal mismatch — a=${a.decimals}, b=${b.decimals}`);
  }
}
