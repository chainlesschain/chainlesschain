/**
 * memoryBankHelpers — pure-function unit tests
 *
 * Covers:
 *  - truncate: empty/undef → ""; len <= 0 → ""; long → cut + "...", short → unchanged
 *  - successRatePercent: 0/0 → 0, rounds, ignores NaN inputs (Number coerce)
 *  - formatBytes: walks units, "0 B" for 0/negative/NaN/Infinity
 *  - formatMemDate: MM-DD HH:MM zh-CN, "-" for missing/NaN
 *  - classificationColor: 5 known + default + case-insensitive
 *  - recommendationColor: 4 known + default + case-insensitive
 *  - formatPreferenceValue: object → JSON, primitive → toString, null → ""
 *  - totalPatternsCount: sums sub-arrays, treats undef as 0
 */

import { describe, it, expect } from "vitest";
import {
  classificationColor,
  formatBytes,
  formatMemDate,
  formatPreferenceValue,
  recommendationColor,
  successRatePercent,
  totalPatternsCount,
  truncate,
} from "../memoryBankHelpers";

describe("truncate", () => {
  it("returns '' for empty / null / undefined / non-positive len", () => {
    expect(truncate("", 10)).toBe("");
    expect(truncate(null, 10)).toBe("");
    expect(truncate(undefined, 10)).toBe("");
    expect(truncate("hello", 0)).toBe("");
    expect(truncate("hello", -1)).toBe("");
  });

  it("returns input unchanged when shorter than len", () => {
    expect(truncate("hi", 10)).toBe("hi");
    expect(truncate("exact10!!!", 10)).toBe("exact10!!!");
  });

  it("cuts and appends '...' when longer than len", () => {
    expect(truncate("0123456789ABC", 10)).toBe("0123456789...");
  });
});

describe("successRatePercent", () => {
  it("returns 0 for empty/zero counts", () => {
    expect(successRatePercent({})).toBe(0);
    expect(successRatePercent({ success_count: 0, failure_count: 0 })).toBe(0);
  });

  it("rounds to nearest integer", () => {
    expect(successRatePercent({ success_count: 2, failure_count: 1 })).toBe(67);
    expect(successRatePercent({ success_count: 1, failure_count: 2 })).toBe(33);
    expect(successRatePercent({ success_count: 7, failure_count: 3 })).toBe(70);
  });

  it("coerces non-numeric inputs to 0", () => {
    expect(
      successRatePercent({
        success_count: "3" as unknown as number,
        failure_count: 1,
      }),
    ).toBe(75);
    expect(
      successRatePercent({
        success_count: NaN as unknown as number,
        failure_count: 5,
      }),
    ).toBe(0);
  });
});

describe("formatBytes", () => {
  it("returns '0 B' for falsy/negative/NaN/Infinity", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(undefined)).toBe("0 B");
    expect(formatBytes(null)).toBe("0 B");
    expect(formatBytes(-100)).toBe("0 B");
    expect(formatBytes(NaN)).toBe("0 B");
    expect(formatBytes(Infinity)).toBe("0 B");
  });

  it("displays bytes without decimals, larger units with one decimal", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10.0 MB");
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe("2.5 GB");
  });

  it("walks units up to TB", () => {
    expect(formatBytes(1024 * 1024 * 1024 * 1024)).toMatch(/TB$/);
  });
});

describe("formatMemDate", () => {
  it("returns '-' for missing / NaN inputs", () => {
    expect(formatMemDate(undefined)).toBe("-");
    expect(formatMemDate(null)).toBe("-");
    expect(formatMemDate("")).toBe("-");
    expect(formatMemDate("not-a-date")).toBe("-");
    expect(formatMemDate(NaN)).toBe("-");
  });

  it("formats valid timestamps as MM-DD HH:MM", () => {
    const t = new Date("2026-04-28T08:30:00Z").getTime();
    const result = formatMemDate(t);
    // Locale-dependent exact formatting; just check pattern shape
    expect(result).toMatch(/\d{2}\W\d{2}\W?\W?\d{2}\W\d{2}/);
    expect(result).not.toBe("-");
  });

  it("accepts ISO string and number forms", () => {
    expect(formatMemDate("2026-04-28T00:00:00Z")).not.toBe("-");
    expect(formatMemDate(Date.now())).not.toBe("-");
  });
});

describe("classificationColor", () => {
  it("maps 5 known classifications", () => {
    expect(classificationColor("DATABASE")).toBe("orange");
    expect(classificationColor("NETWORK")).toBe("blue");
    expect(classificationColor("FILESYSTEM")).toBe("green");
    expect(classificationColor("VALIDATION")).toBe("purple");
    expect(classificationColor("AUTHENTICATION")).toBe("red");
  });

  it("returns 'default' for unknown / missing / mixed-case", () => {
    expect(classificationColor("WEIRD")).toBe("default");
    expect(classificationColor(undefined)).toBe("default");
    expect(classificationColor(null)).toBe("default");
    expect(classificationColor("")).toBe("default");
  });

  it("is case-insensitive", () => {
    expect(classificationColor("database")).toBe("orange");
    expect(classificationColor("Network")).toBe("blue");
  });
});

describe("recommendationColor", () => {
  it("maps 4 known types", () => {
    expect(recommendationColor("performance")).toBe("#1890ff");
    expect(recommendationColor("cost")).toBe("#52c41a");
    expect(recommendationColor("usage")).toBe("#faad14");
    expect(recommendationColor("error")).toBe("#f5222d");
  });

  it("returns gray for unknown / missing", () => {
    expect(recommendationColor("other")).toBe("#8c8c8c");
    expect(recommendationColor(undefined)).toBe("#8c8c8c");
    expect(recommendationColor(null)).toBe("#8c8c8c");
  });

  it("is case-insensitive", () => {
    expect(recommendationColor("PERFORMANCE")).toBe("#1890ff");
    expect(recommendationColor("Cost")).toBe("#52c41a");
  });
});

describe("formatPreferenceValue", () => {
  it("returns '' for null / undefined", () => {
    expect(formatPreferenceValue(null)).toBe("");
    expect(formatPreferenceValue(undefined)).toBe("");
  });

  it("stringifies primitives", () => {
    expect(formatPreferenceValue("hello")).toBe("hello");
    expect(formatPreferenceValue(42)).toBe("42");
    expect(formatPreferenceValue(true)).toBe("true");
  });

  it("JSON-stringifies objects / arrays", () => {
    expect(formatPreferenceValue({ a: 1 })).toBe('{"a":1}');
    expect(formatPreferenceValue([1, 2, 3])).toBe("[1,2,3]");
  });

  it("survives unserializable cycles with a placeholder", () => {
    const cycle: Record<string, unknown> = { a: 1 };
    cycle.self = cycle;
    expect(formatPreferenceValue(cycle)).toBe("[unserializable]");
  });
});

describe("totalPatternsCount", () => {
  it("sums all four sub-arrays", () => {
    expect(
      totalPatternsCount({
        promptPatterns: [1, 2],
        errorFixPatterns: [1],
        codeSnippets: [1, 2, 3],
        workflowPatterns: [],
      }),
    ).toBe(6);
  });

  it("treats missing fields as 0", () => {
    expect(totalPatternsCount({})).toBe(0);
    expect(totalPatternsCount({ promptPatterns: [1] })).toBe(1);
  });
});
