import { describe, it, expect } from "vitest";
import { parseNumberOption } from "../../src/lib/parse-number-option.js";

describe("parseNumberOption", () => {
  it("parses integer and float strings", () => {
    expect(parseNumberOption("5", "--n")).toBe(5);
    expect(parseNumberOption("1.5", "--weight")).toBe(1.5);
    expect(parseNumberOption("-3", "--delta")).toBe(-3);
    expect(parseNumberOption("0", "--n")).toBe(0);
  });

  it("passes through an already-numeric value", () => {
    expect(parseNumberOption(42, "--n")).toBe(42);
  });

  it("returns the fallback for empty input", () => {
    expect(parseNumberOption(undefined, "--n")).toBeUndefined();
    expect(parseNumberOption(null, "--n")).toBeUndefined();
    expect(parseNumberOption("", "--n")).toBeUndefined();
    expect(parseNumberOption(undefined, "--weight", 1)).toBe(1);
  });

  it("does NOT use the fallback when a value is present", () => {
    expect(parseNumberOption("2", "--weight", 1)).toBe(2);
  });

  it("throws a friendly error for non-numeric input", () => {
    expect(() => parseNumberOption("abc", "--weight")).toThrow(
      /Invalid number for --weight: "abc"/,
    );
  });

  it("rejects partially-numeric garbage that parseFloat would silently accept", () => {
    // parseFloat("5abc") === 5; Number("5abc") === NaN → we reject it.
    expect(() => parseNumberOption("5abc", "--amount")).toThrow(
      /Invalid number for --amount/,
    );
  });

  it("rejects NaN and Infinity", () => {
    expect(() => parseNumberOption("NaN", "--n")).toThrow(/Invalid number/);
    expect(() => parseNumberOption("Infinity", "--n")).toThrow(
      /Invalid number/,
    );
  });
});
