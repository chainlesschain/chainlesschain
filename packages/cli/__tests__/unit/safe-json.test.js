/**
 * safe-json — JSON.parse that returns a fallback instead of throwing, so one
 * corrupt DB cell can't crash a whole list `.map()`/loop.
 */
import { describe, it, expect } from "vitest";
import { safeJsonParse } from "../../src/lib/safe-json.js";

describe("safeJsonParse", () => {
  it("parses valid JSON", () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
    expect(safeJsonParse("[1,2,3]")).toEqual([1, 2, 3]);
    expect(safeJsonParse('"hi"')).toBe("hi");
  });

  it("returns the fallback for null / undefined / empty", () => {
    expect(safeJsonParse(null, [])).toEqual([]);
    expect(safeJsonParse(undefined, {})).toEqual({});
    expect(safeJsonParse("", "x")).toBe("x");
    expect(safeJsonParse(null)).toBeNull(); // default fallback
  });

  it("returns the fallback for malformed JSON instead of throwing", () => {
    expect(safeJsonParse("{not valid", [])).toEqual([]);
    expect(safeJsonParse("[1,2,", null)).toBeNull();
    expect(safeJsonParse("undefined", "fb")).toBe("fb");
  });

  it("maps a literal JSON null to the fallback (not null)", () => {
    expect(safeJsonParse("null", [])).toEqual([]);
  });
});
