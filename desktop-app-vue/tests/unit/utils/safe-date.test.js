/**
 * safe-date 测试 — src/main/utils/safe-date.js
 *
 * new Date(x).toISOString() throws RangeError on an invalid/missing date.
 * safeToISOString must never throw — it returns the fallback so one bad value
 * (e.g. a P2P-shared recording's corrupt sharedAt, or an external-device file's
 * bad last_modified) doesn't break the whole .map.
 */
import { describe, it, expect } from "vitest";

const { safeToISOString } = require("../../../src/main/utils/safe-date.js");

describe("safeToISOString", () => {
  it("formats a valid epoch / Date / ISO string", () => {
    expect(safeToISOString(0)).toBe("1970-01-01T00:00:00.000Z");
    expect(safeToISOString("2026-06-29T00:00:00.000Z")).toBe(
      "2026-06-29T00:00:00.000Z",
    );
    const d = new Date("2026-01-02T03:04:05.000Z");
    expect(safeToISOString(d)).toBe("2026-01-02T03:04:05.000Z");
  });

  it("returns the fallback (default null) for invalid dates, no throw", () => {
    expect(() => safeToISOString(undefined)).not.toThrow();
    expect(safeToISOString(undefined)).toBe(null);
    expect(safeToISOString(NaN)).toBe(null);
    expect(safeToISOString("not a date")).toBe(null);
    expect(safeToISOString({})).toBe(null);
  });

  it("honours a custom fallback", () => {
    expect(safeToISOString("garbage", "")).toBe("");
    expect(safeToISOString(undefined, "unknown")).toBe("unknown");
  });

  it("does not throw on a bad value inside a .map (whole list survives)", () => {
    const rows = [
      { sharedAt: 0 },
      { sharedAt: "broken" },
      { sharedAt: undefined },
    ];
    const mapped = rows.map((r) => ({ at: safeToISOString(r.sharedAt) }));
    expect(mapped).toEqual([
      { at: "1970-01-01T00:00:00.000Z" },
      { at: null },
      { at: null },
    ]);
  });
});
