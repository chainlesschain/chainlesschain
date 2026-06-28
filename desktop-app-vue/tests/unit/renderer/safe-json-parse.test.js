/**
 * Tests for the renderer safeJsonParse helper (utils/loose-json.ts).
 * Used by stores/composables that .map DB/IPC rows — one corrupt value must
 * fall back instead of throwing out of the .map and blanking the whole list.
 */
import { describe, it, expect } from "vitest";
import { safeJsonParse } from "../../../src/renderer/utils/loose-json.ts";

describe("safeJsonParse", () => {
  it("parses a valid JSON string", () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
    expect(safeJsonParse("[1,2,3]", [])).toEqual([1, 2, 3]);
  });

  it("returns the fallback for null / undefined / empty string", () => {
    expect(safeJsonParse(null, [])).toEqual([]);
    expect(safeJsonParse(undefined, {})).toEqual({});
    expect(safeJsonParse("", { x: 1 })).toEqual({ x: 1 });
  });

  it("returns the fallback for a corrupt non-empty string (no throw)", () => {
    expect(safeJsonParse("{not json", [])).toEqual([]);
    expect(safeJsonParse("oops}", { d: 1 })).toEqual({ d: 1 });
  });

  it("passes through an already-parsed (non-string) value", () => {
    const obj = { already: "parsed" };
    expect(safeJsonParse(obj, {})).toBe(obj);
    const arr = [1, 2];
    expect(safeJsonParse(arr, [])).toBe(arr);
  });

  it("does not throw on a corrupt row inside a .map (whole list survives)", () => {
    const rows = [
      { permissions: '["read"]' },
      { permissions: "{corrupt" },
      { permissions: null },
    ];
    const mapped = rows.map((r) => ({
      permissions: safeJsonParse(r.permissions, []),
    }));
    expect(mapped).toEqual([
      { permissions: ["read"] },
      { permissions: [] },
      { permissions: [] },
    ]);
  });
});
