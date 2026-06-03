/**
 * quality-gate.test.js — Path B-2 tests
 *
 * Tests for QualityGate checker registry, scoring, and built-in factories.
 */

import { describe, test, expect, vi } from "vitest";

const {
  QualityGate,
  CHECK_RESULT,
  AGGREGATE,
  validateChecker,
  aggregateScore,
  createProtagonistChecker,
  createDurationChecker,
  createThresholdChecker,
  createLintPassChecker,
} = require("../lib/quality-gate.js");

// ── validateChecker ───────────────────────────────────────────────

describe("validateChecker", () => {
  test("rejects non-object", () => {
    expect(validateChecker(null).valid).toBe(false);
    expect(validateChecker("string").valid).toBe(false);
  });

  test("rejects missing name", () => {
    expect(validateChecker({ fn: () => {} }).valid).toBe(false);
  });

  test("rejects missing fn", () => {
    expect(validateChecker({ name: "x" }).valid).toBe(false);
  });

  test("rejects negative weight", () => {
    expect(validateChecker({ name: "x", fn: () => {}, weight: -1 }).valid).toBe(false);
  });

  test("accepts valid checker", () => {
    expect(validateChecker({ name: "x", fn: () => {} }).valid).toBe(true);
  });
});

// ── aggregateScore ────────────────────────────────────────────────

describe("aggregateScore", () => {
  test("weighted-mean default", () => {
    const checks = [
      { score: 0.8, weight: 0.6, status: "pass" },
      { score: 0.5, weight: 0.4, status: "pass" },
    ];
    const result = aggregateScore(checks);
    expect(result).toBeCloseTo(0.68, 2);
  });

  test("min strategy", () => {
    const checks = [
      { score: 0.9, weight: 1, status: "pass" },
      { score: 0.3, weight: 1, status: "fail" },
    ];
    expect(aggregateScore(checks, AGGREGATE.MIN)).toBeCloseTo(0.3, 2);
  });

  test("all-pass strategy — all pass", () => {
    const checks = [
      { pass: true, score: 0.8, weight: 1, status: "pass" },
      { pass: true, score: 0.6, weight: 1, status: "pass" },
    ];
    expect(aggregateScore(checks, AGGREGATE.ALL_PASS)).toBe(1);
  });

  test("all-pass strategy — one fails", () => {
    const checks = [
      { pass: true, score: 0.8, weight: 1, status: "pass" },
      { pass: false, score: 0.3, weight: 1, status: "fail" },
    ];
    expect(aggregateScore(checks, AGGREGATE.ALL_PASS)).toBe(0);
  });

  test("skips entries with SKIP status", () => {
    const checks = [
      { score: 0.8, weight: 1, status: "pass" },
      { score: 0, weight: 1, status: CHECK_RESULT.SKIP },
    ];
    expect(aggregateScore(checks)).toBeCloseTo(0.8, 2);
  });

  test("empty checks returns 1", () => {
    expect(aggregateScore([])).toBe(1);
  });
});

// ── QualityGate ───────────────────────────────────────────────────

describe("QualityGate", () => {
  test("constructor defaults", () => {
    const gate = new QualityGate();
    expect(gate.threshold).toBe(0.6);
    expect(gate.aggregate).toBe("weighted-mean");
    expect(gate.size).toBe(0);
  });

  test("constructor rejects invalid aggregate", () => {
    expect(() => new QualityGate({ aggregate: "bogus" })).toThrow("invalid aggregate");
  });

  test("register and list", () => {
    const gate = new QualityGate();
    gate.register({ name: "check1", fn: async () => ({ pass: true, score: 1 }), weight: 2, tags: ["a"] });
    expect(gate.size).toBe(1);
    const list = gate.list();
    expect(list[0].name).toBe("check1");
    expect(list[0].weight).toBe(2);
    expect(list[0].tags).toEqual(["a"]);
    // fn should not be in serialized output
    expect(list[0].fn).toBeUndefined();
  });

  test("register rejects invalid checker", () => {
    const gate = new QualityGate();
    expect(() => gate.register({ name: "" })).toThrow();
  });

  test("unregister removes checker", () => {
    const gate = new QualityGate();
    gate.register({ name: "x", fn: async () => ({ pass: true, score: 1 }) });
    expect(gate.unregister("x")).toBe(true);
    expect(gate.size).toBe(0);
    expect(gate.unregister("x")).toBe(false);
  });

  test("threshold setter validates range", () => {
    const gate = new QualityGate();
    expect(() => { gate.threshold = 1.5; }).toThrow("[0, 1]");
    expect(() => { gate.threshold = -0.1; }).toThrow("[0, 1]");
    gate.threshold = 0.8;
    expect(gate.threshold).toBe(0.8);
  });

  test("check with passing result", async () => {
    const gate = new QualityGate({ threshold: 0.5 });
    gate.register({ name: "c1", fn: async () => ({ pass: true, score: 0.9 }) });
    const result = await gate.check({ data: "test" });
    expect(result.pass).toBe(true);
    expect(result.score).toBeCloseTo(0.9, 2);
    expect(result.checks).toHaveLength(1);
    expect(result.threshold).toBe(0.5);
  });

  test("check with failing result", async () => {
    const gate = new QualityGate({ threshold: 0.8 });
    gate.register({ name: "c1", fn: async () => ({ pass: false, score: 0.3 }) });
    const result = await gate.check({});
    expect(result.pass).toBe(false);
    expect(result.score).toBeCloseTo(0.3, 2);
  });

  test("check handles checker errors gracefully", async () => {
    const gate = new QualityGate({ threshold: 0.5 });
    gate.register({
      name: "boom",
      fn: async () => { throw new Error("kaboom"); },
    });
    const result = await gate.check({});
    expect(result.pass).toBe(false);
    expect(result.checks[0].reason).toContain("kaboom");
    expect(result.checks[0].status).toBe("fail");
  });

  test("check with only filter", async () => {
    const gate = new QualityGate();
    gate.register({ name: "a", fn: async () => ({ pass: true, score: 1 }) });
    gate.register({ name: "b", fn: async () => ({ pass: false, score: 0 }) });
    const result = await gate.check({}, {}, { only: ["a"] });
    expect(result.checks).toHaveLength(1);
    expect(result.pass).toBe(true);
  });

  test("check with tags filter", async () => {
    const gate = new QualityGate();
    gate.register({ name: "a", fn: async () => ({ pass: true, score: 1 }), tags: ["video"] });
    gate.register({ name: "b", fn: async () => ({ pass: false, score: 0 }), tags: ["code"] });
    const result = await gate.check({}, {}, { tags: ["video"] });
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].name).toBe("a");
  });

  test("onCheck telemetry callback fires", async () => {
    const checkResults = [];
    const gate = new QualityGate({ onCheck: (c) => checkResults.push(c) });
    gate.register({ name: "c1", fn: async () => ({ pass: true, score: 0.7 }) });
    await gate.check({});
    expect(checkResults).toHaveLength(1);
    expect(checkResults[0].name).toBe("c1");
  });

  test("score clamped to [0, 1]", async () => {
    const gate = new QualityGate();
    gate.register({ name: "c1", fn: async () => ({ pass: true, score: 5.0 }) });
    const result = await gate.check({});
    expect(result.checks[0].score).toBe(1);
  });

  test("no checkers → pass", async () => {
    const gate = new QualityGate();
    const result = await gate.check({});
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
  });
});

// ── Built-in checker factories ────────────────────────────────────

describe("createProtagonistChecker", () => {
  test("passes when ratio above threshold", async () => {
    const checker = createProtagonistChecker({ minRatio: 0.3 });
    expect(checker.name).toBe("vision-protagonist");
    expect(checker.tags).toContain("video");
    const result = await checker.fn({ protagonist_ratio: 0.7 });
    expect(result.pass).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  test("fails when ratio below threshold", async () => {
    const checker = createProtagonistChecker({ minRatio: 0.5 });
    const result = await checker.fn({ protagonist_ratio: 0.2 });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("0.20");
  });

  test("handles missing protagonist_ratio", async () => {
    const checker = createProtagonistChecker();
    const result = await checker.fn({});
    expect(result.pass).toBe(false);
  });
});

describe("createDurationChecker", () => {
  test("passes within tolerance", async () => {
    const checker = createDurationChecker({ tolerance: 0.3 });
    expect(checker.name).toBe("duration-accuracy");
    const result = await checker.fn({ target_duration: 5, total_duration: 5.5 });
    expect(result.pass).toBe(true);
  });

  test("fails outside tolerance", async () => {
    const checker = createDurationChecker({ tolerance: 0.1 });
    const result = await checker.fn({ target_duration: 5, total_duration: 8 });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("deviates");
  });

  test("zero target always passes", async () => {
    const checker = createDurationChecker();
    const result = await checker.fn({ target_duration: 0, total_duration: 10 });
    expect(result.pass).toBe(true);
  });
});

describe("createThresholdChecker", () => {
  test("passes when value meets threshold", async () => {
    const checker = createThresholdChecker({
      name: "aesthetic",
      field: "aesthetic_score",
      minValue: 0.6,
      tags: ["video"],
    });
    const result = await checker.fn({ aesthetic_score: 0.8 });
    expect(result.pass).toBe(true);
  });

  test("fails when value below threshold", async () => {
    const checker = createThresholdChecker({
      field: "aesthetic_score",
      minValue: 0.7,
    });
    const result = await checker.fn({ aesthetic_score: 0.4 });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("aesthetic_score");
  });
});

// ── createLintPassChecker ────────────────────────────────────────

describe("createLintPassChecker", () => {
  test("passes when errorCount is 0", async () => {
    const checker = createLintPassChecker();
    expect(checker.name).toBe("lint-pass");
    expect(checker.tags).toContain("code");
    const result = await checker.fn({ errorCount: 0, totalCount: 50 });
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
  });

  test("fails when errorCount exceeds maxErrors", async () => {
    const checker = createLintPassChecker({ maxErrors: 0 });
    const result = await checker.fn({ errorCount: 3, totalCount: 50 });
    expect(result.pass).toBe(false);
    expect(result.score).toBeCloseTo(0.94, 2);
    expect(result.reason).toContain("3 errors");
  });

  test("passes when errorCount within maxErrors tolerance", async () => {
    const checker = createLintPassChecker({ maxErrors: 5 });
    const result = await checker.fn({ errorCount: 3, totalCount: 100 });
    expect(result.pass).toBe(true);
    expect(result.score).toBeCloseTo(0.97, 2);
  });

  test("handles missing errorCount", async () => {
    const checker = createLintPassChecker();
    const result = await checker.fn({});
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("missing errorCount");
  });

  test("supports custom field names", async () => {
    const checker = createLintPassChecker({
      errorsField: "failures",
      totalField: "tests",
      name: "test-pass",
      tags: ["ci"],
    });
    expect(checker.name).toBe("test-pass");
    expect(checker.tags).toEqual(["ci"]);
    const result = await checker.fn({ failures: 0, tests: 200 });
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
  });

  test("score reflects pass rate", async () => {
    const checker = createLintPassChecker({ maxErrors: 10 });
    const result = await checker.fn({ errorCount: 10, totalCount: 100 });
    expect(result.pass).toBe(true);
    expect(result.score).toBeCloseTo(0.9, 2);
  });
});
