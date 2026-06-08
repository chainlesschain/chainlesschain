/**
 * llmPerformanceHelpers — pure helper tests for the V6 LLM Performance panel.
 * No DOM / IPC / store; just the money / token / budget formatting + thresholds.
 */

import { describe, it, expect } from "vitest";
import {
  dateRangeFromDays,
  budgetPercent,
  budgetColor,
  budgetStatus,
  formatUsd,
  formatCny,
  formatTokens,
  asPercent,
  hitRateColor,
  alertLevelColor,
  breakdownLabel,
} from "../llmPerformanceHelpers";

describe("dateRangeFromDays", () => {
  it("builds an epoch-ms window ending at now", () => {
    const now = 1_000_000_000_000;
    expect(dateRangeFromDays(7, now)).toEqual({
      startDate: now - 7 * 86_400_000,
      endDate: now,
    });
  });
  it("falls back to 7 days for non-positive input", () => {
    const now = 5_000;
    expect(dateRangeFromDays(0, now).startDate).toBe(now - 7 * 86_400_000);
    expect(dateRangeFromDays(-3, now).startDate).toBe(now - 7 * 86_400_000);
  });
});

describe("budgetPercent", () => {
  it("computes a clamped percentage", () => {
    expect(budgetPercent(50, 100)).toBe(50);
    expect(budgetPercent(150, 100)).toBe(100); // clamped
  });
  it("zero / missing limit → 0 (no divide-by-zero)", () => {
    expect(budgetPercent(10, 0)).toBe(0);
    expect(budgetPercent(10, undefined)).toBe(0);
  });
});

describe("budgetColor / budgetStatus", () => {
  it("colors against warning(80)/critical(95)", () => {
    expect(budgetColor(10)).toBe("#3f8600");
    expect(budgetColor(85)).toBe("#fa8c16");
    expect(budgetColor(96)).toBe("#cf1322");
  });
  it("maps to ant progress status", () => {
    expect(budgetStatus(10)).toBe("success");
    expect(budgetStatus(85)).toBe("normal");
    expect(budgetStatus(99)).toBe("exception");
  });
});

describe("money / token formatting", () => {
  it("formatUsd / formatCny", () => {
    expect(formatUsd(1.23456)).toBe("$1.2346");
    expect(formatUsd(undefined)).toBe("$0.0000");
    expect(formatCny(9.1)).toBe("¥9.10");
  });
  it("formatTokens compacts k / M", () => {
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(3_400_000)).toBe("3.4M");
    expect(formatTokens(undefined)).toBe("0");
  });
});

describe("asPercent / hitRateColor", () => {
  it("treats ≤1 as a fraction, else already-percent", () => {
    expect(asPercent(0.85)).toBe(85);
    expect(asPercent(85)).toBe(85);
    expect(asPercent(0)).toBe(0);
    expect(asPercent(undefined)).toBe(0);
  });
  it("colors hit rate (good≥50, ok≥30)", () => {
    expect(hitRateColor(0.6)).toBe("#3f8600");
    expect(hitRateColor(0.35)).toBe("#fa8c16");
    expect(hitRateColor(0.1)).toBe("#cf1322");
  });
});

describe("alertLevelColor", () => {
  it("maps severities to tag colors", () => {
    expect(alertLevelColor("critical")).toBe("red");
    expect(alertLevelColor("WARNING")).toBe("orange");
    expect(alertLevelColor("info")).toBe("blue");
    expect(alertLevelColor(undefined)).toBe("default");
  });
});

describe("breakdownLabel", () => {
  it("prefers name, then model, then provider", () => {
    expect(breakdownLabel({ name: "gpt-4o" })).toBe("gpt-4o");
    expect(breakdownLabel({ model: "claude" })).toBe("claude");
    expect(breakdownLabel({ provider: "anthropic" })).toBe("anthropic");
    expect(breakdownLabel({})).toBe("未知");
  });
});
