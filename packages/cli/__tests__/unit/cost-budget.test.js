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
});
