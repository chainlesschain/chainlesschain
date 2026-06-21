/**
 * numericOption — validated numeric CLI-option parsing (no silent NaN).
 */
import { describe, it, expect } from "vitest";
import { numericOption } from "../../src/lib/cli-numeric.js";

describe("numericOption", () => {
  it("parses a valid integer/float", () => {
    expect(numericOption("42", { integer: true })).toBe(42);
    expect(numericOption("3.5")).toBe(3.5);
    expect(numericOption("50", { integer: true, min: 1, fallback: 10 })).toBe(
      50,
    );
  });

  it("falls back on invalid/missing input when a fallback is given", () => {
    expect(numericOption("abc", { integer: true, fallback: 50 })).toBe(50);
    expect(numericOption(undefined, { fallback: 50 })).toBe(50);
    expect(numericOption("", { fallback: 7 })).toBe(7);
    expect(numericOption("12abc-not-a-clean-number", { fallback: 9 })).not.toBe(
      NaN,
    );
  });

  it("throws on invalid/missing input when NO fallback is given", () => {
    expect(() => numericOption("abc", { name: "--voting-period" })).toThrow(
      /--voting-period must be a number/,
    );
    expect(() => numericOption(undefined, { name: "--x" })).toThrow(
      /--x is required/,
    );
  });

  it("enforces min/max (throw without fallback, fall back with one)", () => {
    expect(() => numericOption("0", { name: "--limit", min: 1 })).toThrow(
      /--limit must be >= 1/,
    );
    expect(() => numericOption("9", { name: "--p", max: 5 })).toThrow(
      /--p must be <= 5/,
    );
    expect(numericOption("0", { min: 1, fallback: 50 })).toBe(50);
  });

  it("never returns NaN (the whole point)", () => {
    for (const bad of ["abc", "", undefined, null, "NaN", "{}"]) {
      const v = numericOption(bad, { integer: true, fallback: 20 });
      expect(Number.isNaN(v)).toBe(false);
    }
  });
});
