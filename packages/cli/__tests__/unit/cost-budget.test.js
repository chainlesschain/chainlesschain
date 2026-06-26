/**
 * Unit tests for the CostBudget spend cap (src/lib/cost-budget.js).
 * Pure — drives the budget with synthetic token-usage records.
 */
import { describe, it, expect } from "vitest";
import { CostBudget, parseBudgetUsd } from "../../src/lib/cost-budget.js";

describe("parseBudgetUsd", () => {
  it("returns null for unset", () => {
    expect(parseBudgetUsd(null)).toBeNull();
    expect(parseBudgetUsd(undefined)).toBeNull();
    expect(parseBudgetUsd("")).toBeNull();
  });
  it("parses positive numbers", () => {
    expect(parseBudgetUsd("0.5")).toBe(0.5);
    expect(parseBudgetUsd(2)).toBe(2);
  });
  it("rejects zero / negative / non-numeric", () => {
    expect(() => parseBudgetUsd("0")).toThrow(/Invalid --max-budget-usd/);
    expect(() => parseBudgetUsd("-1")).toThrow();
    expect(() => parseBudgetUsd("abc")).toThrow();
  });
});

describe("CostBudget", () => {
  it("disabled when no limit", () => {
    const b = new CostBudget({});
    expect(b.enabled()).toBe(false);
    expect(b.exceeded()).toBe(false);
    expect(b.remaining()).toBe(Infinity);
  });

  it("accumulates priced cost and trips at the cap", () => {
    // anthropic opus = $5 / 1M input (Opus tier dropped to $5/$25). 1M input = $5.
    const b = new CostBudget({ limitUsd: 3 });
    expect(b.exceeded()).toBe(false);
    b.add({
      provider: "anthropic",
      model: "claude-opus",
      usage: { input_tokens: 1_000_000, output_tokens: 0 },
    });
    expect(b.spentUsd).toBeCloseTo(5, 5);
    expect(b.exceeded()).toBe(true);
    expect(b.remaining()).toBe(0);
  });

  it("stays under the cap below the threshold", () => {
    const b = new CostBudget({ limitUsd: 10 });
    b.add({
      provider: "anthropic",
      model: "claude-haiku", // $1 / 1M input
      usage: { input_tokens: 1_000_000, output_tokens: 0 },
    });
    expect(b.spentUsd).toBeCloseTo(1, 5);
    expect(b.exceeded()).toBe(false);
    expect(b.remaining()).toBeCloseTo(9, 5);
  });

  it("a non-finite cost (bad token count) does not poison spentUsd / disable the cap", () => {
    const b = new CostBudget({ limitUsd: 1 });
    // A buggy provider usage event with a non-numeric token count makes
    // estimateCost return totalCost=NaN. spentUsd must stay finite — otherwise
    // `NaN >= limit` is always false and the hard cap is silently disabled.
    const est = b.add({
      provider: "anthropic",
      model: "haiku",
      usage: { input_tokens: "5x" },
    });
    expect(est.matched).toBe(true);
    expect(Number.isNaN(est.totalCost)).toBe(true);
    expect(Number.isFinite(b.spentUsd)).toBe(true);
    expect(b.spentUsd).toBe(0); // the bad record was treated as unpriced
    expect(b.priced).toBe(false);

    // A subsequent real charge still registers and still trips the cap.
    b.add({
      provider: "anthropic",
      model: "haiku",
      usage: { input_tokens: 2_000_000 }, // 2M × $1/1M = $2 > $1 cap
    });
    expect(b.spentUsd).toBeCloseTo(2, 5);
    expect(b.exceeded()).toBe(true);
  });

  it("free/local providers never trip the cap and warn once", () => {
    const b = new CostBudget({ limitUsd: 1 });
    b.add({
      provider: "ollama",
      model: "qwen2.5:7b",
      usage: { input_tokens: 5_000_000, output_tokens: 5_000_000 },
    });
    expect(b.spentUsd).toBe(0);
    expect(b.exceeded()).toBe(false);
    expect(b.shouldWarnInactive()).toBe(true);
    expect(b.shouldWarnInactive()).toBe(false); // only once
  });

  it("unpriced models never trip the cap and warn once", () => {
    const b = new CostBudget({ limitUsd: 1 });
    b.add({
      provider: "mysteryco",
      model: "x-1",
      usage: { input_tokens: 1_000_000, output_tokens: 0 },
    });
    expect(b.spentUsd).toBe(0);
    expect(b.exceeded()).toBe(false);
    expect(b.shouldWarnInactive()).toBe(true);
  });

  it("does not warn once a priced record is seen", () => {
    const b = new CostBudget({ limitUsd: 100 });
    b.add({
      provider: "anthropic",
      model: "claude-sonnet",
      usage: { input_tokens: 1000, output_tokens: 1000 },
    });
    expect(b.priced).toBe(true);
    expect(b.shouldWarnInactive()).toBe(false);
  });

  it("honors a custom price table", () => {
    const table = { acme: [{ match: "big", in: 1000, out: 1000 }] };
    const b = new CostBudget({ limitUsd: 0.5, table });
    b.add({
      provider: "acme",
      model: "big-1",
      usage: { input_tokens: 1_000_000, output_tokens: 0 },
    }); // $1000
    expect(b.exceeded()).toBe(true);
  });

  it("counts prompt-cache tokens toward the cap (creation at ~125% of input)", () => {
    // anthropic opus input = $5/1M. Cache creation bills at 125% → 1M cache
    // creation tokens ≈ $6.25; without counting cache the cap would never trip.
    const b = new CostBudget({ limitUsd: 5 });
    b.add({
      provider: "anthropic",
      model: "claude-opus",
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 1_000_000,
      },
    });
    expect(b.spentUsd).toBeCloseTo(6.25, 4);
    expect(b.exceeded()).toBe(true);
  });

  it("counts cache-read tokens (Anthropic ~10% of input)", () => {
    const b = new CostBudget({ limitUsd: 100 });
    b.add({
      provider: "anthropic",
      model: "claude-opus", // $5/1M input → cache read ≈ $0.50/1M
      usage: { input_tokens: 0, cache_read_input_tokens: 1_000_000 },
    });
    expect(b.spentUsd).toBeCloseTo(0.5, 4);
    expect(b.priced).toBe(true);
  });
});
