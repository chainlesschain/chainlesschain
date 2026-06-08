/**
 * dbPerformanceHelpers — pure helper tests for the V6 Database Performance panel.
 * No DOM / IPC / store; just the formatting + threshold math.
 */

import { describe, it, expect } from "vitest";
import {
  parseHitRate,
  cacheUsagePercent,
  durationColor,
  avgQueryTimeColor,
  hitRateColor,
  slowQueryCountColor,
  truncateSql,
  formatTimestamp,
  suggestionLabel,
} from "../dbPerformanceHelpers";

describe("parseHitRate", () => {
  it('parses "85%" / "85.5 %" / numbers', () => {
    expect(parseHitRate("85%")).toBe(85);
    expect(parseHitRate("85.5 %")).toBeCloseTo(85.5);
    expect(parseHitRate(42)).toBe(42);
    expect(parseHitRate("0%")).toBe(0);
  });
  it("missing / non-numeric / NaN → 0", () => {
    expect(parseHitRate(undefined)).toBe(0);
    expect(parseHitRate(null)).toBe(0);
    expect(parseHitRate("")).toBe(0);
    expect(parseHitRate("n/a")).toBe(0);
    expect(parseHitRate(NaN)).toBe(0);
  });
});

describe("cacheUsagePercent", () => {
  it("computes a bounded integer percentage", () => {
    expect(cacheUsagePercent(50, 100)).toBe(50);
    expect(cacheUsagePercent(1, 3)).toBe(33);
    expect(cacheUsagePercent(200, 100)).toBe(100); // clamped
  });
  it("zero / missing maxSize → 0 (no divide-by-zero)", () => {
    expect(cacheUsagePercent(10, 0)).toBe(0);
    expect(cacheUsagePercent(10, undefined)).toBe(0);
    expect(cacheUsagePercent(undefined, undefined)).toBe(0);
  });
});

describe("threshold colors", () => {
  it("durationColor: green<50, orange<200, red≥200", () => {
    expect(durationColor(10)).toBe("green");
    expect(durationColor(120)).toBe("orange");
    expect(durationColor(500)).toBe("red");
    expect(durationColor(undefined)).toBe("green");
  });
  it("avgQueryTimeColor flips at 50ms", () => {
    expect(avgQueryTimeColor(30)).toBe("#3f8600");
    expect(avgQueryTimeColor(80)).toBe("#cf1322");
  });
  it("hitRateColor: good above 80%", () => {
    expect(hitRateColor("90%")).toBe("#3f8600");
    expect(hitRateColor("50%")).toBe("#cf1322");
    expect(hitRateColor(undefined)).toBe("#cf1322");
  });
  it("slowQueryCountColor: any >0 is bad", () => {
    expect(slowQueryCountColor(0)).toBe("#3f8600");
    expect(slowQueryCountColor(3)).toBe("#cf1322");
  });
});

describe("truncateSql", () => {
  it("truncates with an ellipsis only when longer than len", () => {
    expect(truncateSql("SELECT 1")).toBe("SELECT 1");
    expect(truncateSql("abcdef", 3)).toBe("abc…");
  });
  it("empty / nullish / non-positive len → ''", () => {
    expect(truncateSql(undefined)).toBe("");
    expect(truncateSql(null)).toBe("");
    expect(truncateSql("x", 0)).toBe("");
  });
});

describe("formatTimestamp", () => {
  it("formats a valid timestamp via injected toDate", () => {
    const fixed = new Date("2026-06-08T10:00:00Z");
    expect(formatTimestamp(123, () => fixed)).toBe(fixed.toLocaleString());
  });
  it("missing / invalid → em dash", () => {
    expect(formatTimestamp(undefined)).toBe("—");
    expect(formatTimestamp(null)).toBe("—");
    expect(formatTimestamp("")).toBe("—");
    expect(formatTimestamp("garbage", () => new Date("nope"))).toBe("—");
  });
});

describe("suggestionLabel", () => {
  it("renders table.column with ? fallbacks", () => {
    expect(suggestionLabel({ table: "notes", column: "tag" })).toBe(
      "notes.tag",
    );
    expect(suggestionLabel({})).toBe("?.?");
  });
});
