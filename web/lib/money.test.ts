/**
 * lib/money.test.ts — unit tests for UsdcAmount helpers.
 * M0: verify no float corruption, arithmetic correctness, fromDisplay edge cases.
 * Run with: npx tsx --test lib/money.test.ts  (Node 22 built-in test runner)
 *
 * Invariants from CLAUDE.md §7.4: all USDC math uses bigint base units; never floats.
 */

import { strict as assert } from "assert";
import { test, describe } from "node:test";
import {
  fromDisplay,
  toDisplay,
  add,
  sub,
  cmp,
  clamp,
  fromBaseUnits,
  toBaseUnitsString,
  type UsdcAmount,
} from "./money";

const DEC = 6; // USDC ERC-20 decimals (always read from contract; 6 for Arc USDC)

describe("fromDisplay", () => {
  test("parses dollar string $0.001 (minimum price) without float corruption", () => {
    const amt = fromDisplay("$0.001", DEC);
    // $0.001 = 1000 base units (6 decimals), never 999 or 1001
    assert.equal(amt.value, 1000n);
    assert.equal(amt.decimals, DEC);
  });

  test("parses $0.01", () => {
    const amt = fromDisplay("$0.01", DEC);
    assert.equal(amt.value, 10000n);
  });

  test("parses $0.1 (ceiling)", () => {
    const amt = fromDisplay("$0.1", DEC);
    assert.equal(amt.value, 100000n);
  });

  test("parses string without dollar sign", () => {
    const amt = fromDisplay("0.05", DEC);
    assert.equal(amt.value, 50000n);
  });

  test("parses number input", () => {
    const amt = fromDisplay(0.001, DEC);
    assert.equal(amt.value, 1000n);
  });

  test("parses whole dollar amount", () => {
    const amt = fromDisplay("1", DEC);
    assert.equal(amt.value, 1_000_000n);
  });

  test("parses $0.000001 (Gateway minimum = 1 base unit)", () => {
    const amt = fromDisplay("$0.000001", DEC);
    assert.equal(amt.value, 1n);
  });

  test("truncates excess fractional digits (no rounding error)", () => {
    // $0.0000019 with 6 decimals → truncates to 1 base unit, not 2
    const amt = fromDisplay("0.0000019", DEC);
    assert.equal(amt.value, 1n);
  });

  test("throws on invalid input", () => {
    assert.throws(() => fromDisplay("not-a-number", DEC));
  });
});

describe("toDisplay", () => {
  test("formats 1000n (6 dec) as $0.001", () => {
    const s = toDisplay({ value: 1000n, decimals: DEC });
    assert.equal(s, "$0.001");
  });

  test("formats 10000n (6 dec) as $0.01", () => {
    const s = toDisplay({ value: 10000n, decimals: DEC });
    assert.equal(s, "$0.01");
  });

  test("formats 1_000_000n as $1.0", () => {
    const s = toDisplay({ value: 1_000_000n, decimals: DEC });
    assert.equal(s, "$1.0");
  });

  test("round-trips: fromDisplay → toDisplay preserves value", () => {
    const inputs = ["$0.001", "$0.01", "$0.05", "$0.1"];
    for (const input of inputs) {
      const amt = fromDisplay(input, DEC);
      const displayed = toDisplay(amt);
      // Re-parse the displayed value and compare base units
      const reparsed = fromDisplay(displayed, DEC);
      assert.equal(reparsed.value, amt.value, `round-trip failed for ${input}`);
    }
  });
});

describe("add", () => {
  test("adds two amounts correctly", () => {
    const a = fromDisplay("$0.001", DEC);
    const b = fromDisplay("$0.009", DEC);
    const result = add(a, b);
    assert.equal(result.value, fromDisplay("$0.01", DEC).value);
  });

  test("throws on decimal mismatch", () => {
    const a: UsdcAmount = { value: 1000n, decimals: 6 };
    const b: UsdcAmount = { value: 1000n, decimals: 18 };
    assert.throws(() => add(a, b), /decimal mismatch/);
  });
});

describe("sub", () => {
  test("subtracts correctly", () => {
    const a = fromDisplay("$0.01", DEC);
    const b = fromDisplay("$0.001", DEC);
    const result = sub(a, b);
    assert.equal(result.value, fromDisplay("$0.009", DEC).value);
  });

  test("throws on underflow", () => {
    const a = fromDisplay("$0.001", DEC);
    const b = fromDisplay("$0.01", DEC);
    assert.throws(() => sub(a, b), /underflow/);
  });
});

describe("cmp", () => {
  test("returns -1 when a < b", () => {
    assert.equal(cmp(fromDisplay("$0.001", DEC), fromDisplay("$0.01", DEC)), -1);
  });
  test("returns 0 when a === b", () => {
    assert.equal(cmp(fromDisplay("$0.01", DEC), fromDisplay("$0.01", DEC)), 0);
  });
  test("returns 1 when a > b", () => {
    assert.equal(cmp(fromDisplay("$0.1", DEC), fromDisplay("$0.01", DEC)), 1);
  });
});

describe("clamp", () => {
  test("clamps below min to min", () => {
    const min = fromDisplay("$0.001", DEC);
    const max = fromDisplay("$0.1", DEC);
    const val = { value: 0n, decimals: DEC };
    assert.equal(clamp(val, min, max).value, min.value);
  });

  test("clamps above max to max", () => {
    const min = fromDisplay("$0.001", DEC);
    const max = fromDisplay("$0.1", DEC);
    const val = fromDisplay("$0.5", DEC);
    assert.equal(clamp(val, min, max).value, max.value);
  });

  test("passes through in-range value unchanged", () => {
    const min = fromDisplay("$0.001", DEC);
    const max = fromDisplay("$0.1", DEC);
    const val = fromDisplay("$0.05", DEC);
    assert.equal(clamp(val, min, max).value, val.value);
  });
});

describe("fromBaseUnits / toBaseUnitsString", () => {
  test("fromBaseUnits wraps correctly", () => {
    const amt = fromBaseUnits(10000n, DEC);
    assert.equal(amt.value, 10000n);
    assert.equal(amt.decimals, DEC);
  });

  test("toBaseUnitsString returns decimal string for SDK", () => {
    const amt = fromDisplay("$0.01", DEC);
    assert.equal(toBaseUnitsString(amt), "10000");
  });
});

describe("invariant: no float corruption at sub-cent amounts", () => {
  test("$0.001 stored as exact 1000n, not 999n or 1001n", () => {
    // This is the key invariant: float 0.001 in JS = 0.001000...0001 (imprecise)
    // Our bigint path must never produce a corrupted value.
    const floatBait = 0.001; // would corrupt if we did Math.round(floatBait * 1e6)
    const amt = fromDisplay(floatBait, DEC);
    assert.equal(amt.value, 1000n, "float input must not corrupt base unit value");
  });

  test("chained arithmetic stays exact", () => {
    // 10 × $0.001 = $0.01 exactly, no drift
    let sum: UsdcAmount = { value: 0n, decimals: DEC };
    const penny = fromDisplay("$0.001", DEC);
    for (let i = 0; i < 10; i++) {
      sum = add(sum, penny);
    }
    assert.equal(sum.value, fromDisplay("$0.01", DEC).value);
  });
});
