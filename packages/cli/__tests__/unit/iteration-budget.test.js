/**
 * Unit tests for IterationBudget — shared, configurable iteration limit.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  IterationBudget,
  WarningLevel,
  DEFAULT_ITERATION_BUDGET,
  BUDGET_WARNING_THRESHOLD,
  BUDGET_WRAPPING_UP_THRESHOLD,
} from "../../src/lib/iteration-budget.js";

describe("IterationBudget", () => {
  const originalEnv = process.env.CC_ITERATION_BUDGET;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CC_ITERATION_BUDGET;
    } else {
      process.env.CC_ITERATION_BUDGET = originalEnv;
    }
  });

  // ── Creation ─────────────────────────────────────────────────────────

  describe("creation", () => {
    it("uses default limit of 50", () => {
      delete process.env.CC_ITERATION_BUDGET;
      const budget = new IterationBudget();
      expect(budget.limit).toBe(DEFAULT_ITERATION_BUDGET);
      expect(budget.limit).toBe(50);
    });

    it("accepts custom limit via options", () => {
      const budget = new IterationBudget({ limit: 90 });
      expect(budget.limit).toBe(90);
    });

    it("resolves limit from CC_ITERATION_BUDGET env var", () => {
      process.env.CC_ITERATION_BUDGET = "100";
      const budget = new IterationBudget();
      expect(budget.limit).toBe(100);
    });

    it("ignores invalid env var values", () => {
      process.env.CC_ITERATION_BUDGET = "not-a-number";
      const budget = new IterationBudget();
      expect(budget.limit).toBe(DEFAULT_ITERATION_BUDGET);
    });

    it("ignores zero and negative env var values", () => {
      process.env.CC_ITERATION_BUDGET = "0";
      const budget = new IterationBudget();
      expect(budget.limit).toBe(DEFAULT_ITERATION_BUDGET);

      process.env.CC_ITERATION_BUDGET = "-5";
      const budget2 = new IterationBudget();
      expect(budget2.limit).toBe(DEFAULT_ITERATION_BUDGET);
    });

    it("stores owner if provided", () => {
      const budget = new IterationBudget({ owner: "session-123" });
      expect(budget._owner).toBe("session-123");
    });
  });

  // ── consume / remaining / percentage ─────────────────────────────────

  describe("consume, remaining, percentage", () => {
    it("starts with 0 consumed", () => {
      const budget = new IterationBudget({ limit: 10 });
      expect(budget.consumed).toBe(0);
      expect(budget.remaining()).toBe(10);
      expect(budget.percentage()).toBe(0);
    });

    it("consume increments consumed and decrements remaining", () => {
      const budget = new IterationBudget({ limit: 10 });
      budget.consume();
      expect(budget.consumed).toBe(1);
      expect(budget.remaining()).toBe(9);
      expect(budget.percentage()).toBeCloseTo(0.1);
    });

    it("consume returns the current warning level", () => {
      const budget = new IterationBudget({ limit: 10 });
      // 1-6 → NONE
      for (let i = 0; i < 6; i++) {
        expect(budget.consume()).toBe(WarningLevel.NONE);
      }
      // 7 → WARNING (70%)
      expect(budget.consume()).toBe(WarningLevel.WARNING);
      // 8 → WARNING
      expect(budget.consume()).toBe(WarningLevel.WARNING);
      // 9 → WRAPPING_UP (90%)
      expect(budget.consume()).toBe(WarningLevel.WRAPPING_UP);
      // 10 → EXHAUSTED (100%)
      expect(budget.consume()).toBe(WarningLevel.EXHAUSTED);
    });

    it("remaining never goes below 0", () => {
      const budget = new IterationBudget({ limit: 2 });
      budget.consume();
      budget.consume();
      budget.consume(); // over-consume
      expect(budget.remaining()).toBe(0);
    });

    it("percentage can exceed 1.0 when over-consumed", () => {
      const budget = new IterationBudget({ limit: 2 });
      budget.consume();
      budget.consume();
      budget.consume();
      expect(budget.percentage()).toBe(1.5);
    });
  });

  // ── Warning levels ───────────────────────────────────────────────────

  describe("warning levels", () => {
    it("returns NONE below 70%", () => {
      const budget = new IterationBudget({ limit: 100 });
      for (let i = 0; i < 69; i++) budget.consume();
      expect(budget.warningLevel()).toBe(WarningLevel.NONE);
    });

    it("returns WARNING at exactly 70%", () => {
      const budget = new IterationBudget({ limit: 100 });
      for (let i = 0; i < 70; i++) budget.consume();
      expect(budget.warningLevel()).toBe(WarningLevel.WARNING);
    });

    it("returns WRAPPING_UP at 90%", () => {
      const budget = new IterationBudget({ limit: 100 });
      for (let i = 0; i < 90; i++) budget.consume();
      expect(budget.warningLevel()).toBe(WarningLevel.WRAPPING_UP);
    });

    it("returns EXHAUSTED at 100%", () => {
      const budget = new IterationBudget({ limit: 100 });
      for (let i = 0; i < 100; i++) budget.consume();
      expect(budget.warningLevel()).toBe(WarningLevel.EXHAUSTED);
    });

    it("returns EXHAUSTED above 100%", () => {
      const budget = new IterationBudget({ limit: 10 });
      for (let i = 0; i < 15; i++) budget.consume();
      expect(budget.warningLevel()).toBe(WarningLevel.EXHAUSTED);
    });
  });

  // ── isExhausted / hasRemaining ───────────────────────────────────────

  describe("isExhausted / hasRemaining", () => {
    it("hasRemaining is true when budget available", () => {
      const budget = new IterationBudget({ limit: 5 });
      expect(budget.hasRemaining()).toBe(true);
      expect(budget.isExhausted()).toBe(false);
    });

    it("isExhausted is true when budget consumed", () => {
      const budget = new IterationBudget({ limit: 2 });
      budget.consume();
      budget.consume();
      expect(budget.isExhausted()).toBe(true);
      expect(budget.hasRemaining()).toBe(false);
    });
  });

  // ── Warning dedup ────────────────────────────────────────────────────

  describe("warning dedup", () => {
    it("records and checks warnings by level", () => {
      const budget = new IterationBudget({ limit: 10 });
      expect(budget.hasWarned(WarningLevel.WARNING)).toBe(false);

      budget.recordWarning(WarningLevel.WARNING);
      expect(budget.hasWarned(WarningLevel.WARNING)).toBe(true);
      expect(budget.hasWarned(WarningLevel.WRAPPING_UP)).toBe(false);
    });
  });

  // ── Shared budget (parent + child) ───────────────────────────────────

  describe("shared budget across agents", () => {
    it("parent and child consume from the same instance", () => {
      const shared = new IterationBudget({ limit: 20 });

      // Parent consumes 5
      for (let i = 0; i < 5; i++) shared.consume();
      expect(shared.consumed).toBe(5);

      // Child receives same instance, consumes 10
      const childRef = shared; // simulates passing via options
      for (let i = 0; i < 10; i++) childRef.consume();
      expect(shared.consumed).toBe(15);
      expect(shared.remaining()).toBe(5);
    });

    it("child exhaustion prevents further parent iterations", () => {
      const shared = new IterationBudget({ limit: 10 });

      // Child consumes all
      for (let i = 0; i < 10; i++) shared.consume();
      expect(shared.isExhausted()).toBe(true);
      expect(shared.hasRemaining()).toBe(false);
    });
  });

  // ── Summary / warning messages ───────────────────────────────────────

  describe("toSummary", () => {
    it("produces human-readable summary", () => {
      const budget = new IterationBudget({ limit: 50 });
      for (let i = 0; i < 25; i++) budget.consume();
      const summary = budget.toSummary();
      expect(summary).toContain("25/50");
      expect(summary).toContain("50%");
      expect(summary).toContain("25 iterations remaining");
    });
  });

  describe("toWarningMessage", () => {
    it("returns null when no warning needed", () => {
      const budget = new IterationBudget({ limit: 100 });
      expect(budget.toWarningMessage()).toBeNull();
    });

    it("returns warning message at 70%", () => {
      const budget = new IterationBudget({ limit: 10 });
      for (let i = 0; i < 7; i++) budget.consume();
      const msg = budget.toWarningMessage();
      expect(msg).toContain("Budget Warning");
      expect(msg).toContain("3 iterations remaining");
    });

    it("returns critical message at 90%", () => {
      const budget = new IterationBudget({ limit: 10 });
      for (let i = 0; i < 9; i++) budget.consume();
      const msg = budget.toWarningMessage();
      expect(msg).toContain("Budget Critical");
      expect(msg).toContain("1 iterations remaining");
    });

    it("returns exhausted message at 100%", () => {
      const budget = new IterationBudget({ limit: 10 });
      for (let i = 0; i < 10; i++) budget.consume();
      const msg = budget.toWarningMessage();
      expect(msg).toContain("Budget Exhausted");
    });
  });

  // ── Constants exported ───────────────────────────────────────────────

  describe("exports", () => {
    it("exports threshold constants", () => {
      expect(BUDGET_WARNING_THRESHOLD).toBe(0.7);
      expect(BUDGET_WRAPPING_UP_THRESHOLD).toBe(0.9);
      expect(DEFAULT_ITERATION_BUDGET).toBe(50);
    });

    it("exports WarningLevel enum", () => {
      expect(WarningLevel.NONE).toBe("none");
      expect(WarningLevel.WARNING).toBe("warning");
      expect(WarningLevel.WRAPPING_UP).toBe("wrapping-up");
      expect(WarningLevel.EXHAUSTED).toBe("exhausted");
    });
  });

  // ── Edge-case coverage (Hermes parity) ───────────────────────────

  describe("percentage() edge cases", () => {
    it("returns 1 when _limit is 0", () => {
      // Directly set _limit to 0 to test the guard
      const budget = new IterationBudget({ limit: 1 });
      budget._limit = 0;
      expect(budget.percentage()).toBe(1);
    });
  });

  describe("resolveLimit() static", () => {
    it("can be called directly without constructor", () => {
      delete process.env.CC_ITERATION_BUDGET;
      expect(IterationBudget.resolveLimit()).toBe(DEFAULT_ITERATION_BUDGET);
    });

    it("returns env value when set", () => {
      process.env.CC_ITERATION_BUDGET = "77";
      expect(IterationBudget.resolveLimit()).toBe(77);
    });
  });

  describe("budget with limit=1", () => {
    it("consume once → exhausted immediately", () => {
      const budget = new IterationBudget({ limit: 1 });
      expect(budget.consume()).toBe(WarningLevel.EXHAUSTED);
      expect(budget.isExhausted()).toBe(true);
      expect(budget.remaining()).toBe(0);
    });

    it("warning level skips straight to exhausted (no WARNING phase)", () => {
      const budget = new IterationBudget({ limit: 1 });
      // Before consume: 0% → NONE
      expect(budget.warningLevel()).toBe(WarningLevel.NONE);
      // After 1 consume: 100% → EXHAUSTED (never passes through WARNING)
      budget.consume();
      expect(budget.warningLevel()).toBe(WarningLevel.EXHAUSTED);
    });
  });

  describe("recordWarning structure", () => {
    it("stores at-count in _warnings array", () => {
      const budget = new IterationBudget({ limit: 20 });
      for (let i = 0; i < 15; i++) budget.consume();
      budget.recordWarning(WarningLevel.WARNING);
      expect(budget._warnings).toHaveLength(1);
      expect(budget._warnings[0]).toEqual({
        level: WarningLevel.WARNING,
        at: 15,
      });
    });

    it("multiple recordWarning at same level — hasWarned still returns true", () => {
      const budget = new IterationBudget({ limit: 10 });
      budget.recordWarning(WarningLevel.WARNING);
      budget.recordWarning(WarningLevel.WARNING);
      expect(budget._warnings).toHaveLength(2);
      expect(budget.hasWarned(WarningLevel.WARNING)).toBe(true);
    });
  });

  describe("constructor with empty options", () => {
    it("has null owner when options is empty object", () => {
      const budget = new IterationBudget({});
      expect(budget._owner).toBeNull();
      expect(budget.limit).toBe(DEFAULT_ITERATION_BUDGET);
    });
  });

  describe("very large limit", () => {
    it("handles limit of 1000000 without issues", () => {
      const budget = new IterationBudget({ limit: 1000000 });
      expect(budget.limit).toBe(1000000);
      expect(budget.remaining()).toBe(1000000);
      budget.consume();
      expect(budget.remaining()).toBe(999999);
      expect(budget.percentage()).toBeCloseTo(0.000001);
      expect(budget.warningLevel()).toBe(WarningLevel.NONE);
    });
  });

  describe("toSummary when exhausted", () => {
    it("shows 100%+ and 0 remaining when over-consumed", () => {
      const budget = new IterationBudget({ limit: 5 });
      for (let i = 0; i < 7; i++) budget.consume();
      const summary = budget.toSummary();
      expect(summary).toContain("7/5");
      expect(summary).toContain("140%");
      expect(summary).toContain("0 iterations remaining");
    });
  });
});
