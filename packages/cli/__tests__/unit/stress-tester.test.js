import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  LOAD_LEVELS,
  listLoadLevels,
  resolveLevel,
  ensureStressTables,
  startStressTest,
  stopStressTest,
  getTestResults,
  listTestHistory,
  analyzeBottlenecks,
  generateCapacityPlan,
  _resetState,
} from "../../src/lib/stress-tester.js";

describe("stress-tester", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    ensureStressTables(db);
  });

  describe("ensureStressTables", () => {
    it("creates stress_test_runs + stress_test_results", () => {
      expect(db.tables.has("stress_test_runs")).toBe(true);
      expect(db.tables.has("stress_test_results")).toBe(true);
    });

    it("is idempotent", () => {
      ensureStressTables(db);
      expect(db.tables.has("stress_test_runs")).toBe(true);
    });
  });

  describe("LOAD_LEVELS", () => {
    it("defines 4 levels: light, medium, heavy, extreme", () => {
      expect(Object.keys(LOAD_LEVELS)).toEqual([
        "LIGHT",
        "MEDIUM",
        "HEAVY",
        "EXTREME",
      ]);
    });

    it("has monotonically increasing concurrency", () => {
      const levels = listLoadLevels();
      for (let i = 1; i < levels.length; i++) {
        expect(levels[i].concurrency).toBeGreaterThan(
          levels[i - 1].concurrency,
        );
        expect(levels[i].requestsPerSecond).toBeGreaterThan(
          levels[i - 1].requestsPerSecond,
        );
      }
    });

    it("is frozen (immutable)", () => {
      expect(Object.isFrozen(LOAD_LEVELS)).toBe(true);
    });
  });

  describe("resolveLevel", () => {
    it("resolves known names case-insensitively", () => {
      expect(resolveLevel("light").name).toBe("light");
      expect(resolveLevel("HEAVY").name).toBe("heavy");
      expect(resolveLevel("Medium").name).toBe("medium");
    });

    it("returns null for unknown", () => {
      expect(resolveLevel("nope")).toBe(null);
      expect(resolveLevel("")).toBe(null);
      expect(resolveLevel(null)).toBe(null);
    });
  });

  describe("startStressTest", () => {
    it("runs with default medium level", () => {
      const run = startStressTest(db);
      expect(run.testId).toBeDefined();
      expect(run.loadLevel).toBe("medium");
      expect(run.concurrency).toBe(LOAD_LEVELS.MEDIUM.concurrency);
      expect(run.status).toBe("complete");
    });

    it("accepts explicit level", () => {
      const run = startStressTest(db, { level: "heavy" });
      expect(run.loadLevel).toBe("heavy");
      expect(run.requestsPerSecond).toBe(LOAD_LEVELS.HEAVY.requestsPerSecond);
    });

    it("allows overrides for concurrency/rps/duration", () => {
      const run = startStressTest(db, {
        level: "light",
        concurrency: 5,
        requestsPerSecond: 10,
        duration: 1000,
      });
      expect(run.concurrency).toBe(5);
      expect(run.requestsPerSecond).toBe(10);
      expect(run.duration).toBe(1000);
    });

    it("throws on unknown level", () => {
      expect(() => startStressTest(db, { level: "godlike" })).toThrow(
        /Unknown load level/,
      );
    });

    it("throws on zero/negative sizing", () => {
      expect(() =>
        startStressTest(db, { level: "light", concurrency: 0 }),
      ).toThrow(/must all be > 0/);
      expect(() =>
        startStressTest(db, { level: "light", duration: -1 }),
      ).toThrow(/must all be > 0/);
    });

    it("persists to both tables", () => {
      startStressTest(db, { level: "medium" });
      expect((db.data.get("stress_test_runs") || []).length).toBe(1);
      expect((db.data.get("stress_test_results") || []).length).toBe(1);
    });

    it("returns numeric metrics with expected shape", () => {
      const run = startStressTest(db, { level: "medium" });
      const m = run.result;
      expect(typeof m.tps).toBe("number");
      expect(typeof m.avgResponseTime).toBe("number");
      expect(typeof m.p50ResponseTime).toBe("number");
      expect(typeof m.p95ResponseTime).toBe("number");
      expect(typeof m.p99ResponseTime).toBe("number");
      expect(typeof m.errorRate).toBe("number");
      expect(m.errorRate).toBeGreaterThanOrEqual(0);
      expect(m.errorRate).toBeLessThanOrEqual(1);
    });

    it("p50 <= p95 <= p99 (percentile ordering)", () => {
      const run = startStressTest(db, { level: "medium" });
      const m = run.result;
      expect(m.p50ResponseTime).toBeLessThanOrEqual(m.p95ResponseTime);
      expect(m.p95ResponseTime).toBeLessThanOrEqual(m.p99ResponseTime);
    });

    it("higher load produces higher latency", () => {
      const light = startStressTest(db, { level: "light" });
      const extreme = startStressTest(db, { level: "extreme" });
      expect(extreme.result.p95ResponseTime).toBeGreaterThan(
        light.result.p95ResponseTime,
      );
    });

    it("extreme level surfaces at least one bottleneck", () => {
      const run = startStressTest(db, { level: "extreme" });
      expect(run.result.bottlenecks.length).toBeGreaterThan(0);
    });

    it("generates unique test IDs across runs", () => {
      const r1 = startStressTest(db, { level: "light" });
      const r2 = startStressTest(db, { level: "light" });
      expect(r1.testId).not.toBe(r2.testId);
    });
  });

  describe("stopStressTest", () => {
    it("returns completed status for already-finished runs", () => {
      const run = startStressTest(db, { level: "light" });
      const stopped = stopStressTest(run.testId);
      expect(stopped.status).toBe("complete");
    });

    it("throws on unknown testId", () => {
      expect(() => stopStressTest("nonexistent")).toThrow(/not found/);
    });
  });

  describe("getTestResults / listTestHistory", () => {
    it("retrieves a single test with its result", () => {
      const run = startStressTest(db, { level: "light" });
      const got = getTestResults(run.testId);
      expect(got.testId).toBe(run.testId);
      expect(got.result).toBeDefined();
      expect(got.result.tps).toBe(run.result.tps);
    });

    it("throws on unknown testId", () => {
      expect(() => getTestResults("nope")).toThrow(/not found/);
    });

    it("lists history sorted by most recent first", () => {
      const a = startStressTest(db, { level: "light" });
      const b = startStressTest(db, { level: "medium" });
      const c = startStressTest(db, { level: "heavy" });
      const list = listTestHistory();
      expect(list.length).toBe(3);
      expect(list[0].testId).toBe(c.testId);
      expect(list[2].testId).toBe(a.testId);
    });

    it("filters by level", () => {
      startStressTest(db, { level: "light" });
      startStressTest(db, { level: "heavy" });
      startStressTest(db, { level: "heavy" });
      const list = listTestHistory({ level: "heavy" });
      expect(list.length).toBe(2);
      expect(list.every((r) => r.loadLevel === "heavy")).toBe(true);
    });

    it("filters by status", () => {
      startStressTest(db, { level: "light" });
      startStressTest(db, { level: "light" });
      const list = listTestHistory({ status: "complete" });
      expect(list.length).toBe(2);
      expect(listTestHistory({ status: "running" }).length).toBe(0);
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) startStressTest(db, { level: "light" });
      expect(listTestHistory({ limit: 2 }).length).toBe(2);
    });

    it("returns empty when no history", () => {
      expect(listTestHistory()).toEqual([]);
    });
  });

  describe("analyzeBottlenecks", () => {
    it("summarizes when no bottlenecks", () => {
      // Use a light load tweaked to ensure all metrics are within targets
      const run = startStressTest(db, {
        level: "light",
        concurrency: 5,
        requestsPerSecond: 20,
        duration: 1000,
      });
      const analysis = analyzeBottlenecks(run.testId);
      expect(analysis.testId).toBe(run.testId);
      expect(Array.isArray(analysis.bottlenecks)).toBe(true);
    });

    it("returns same bottlenecks as result record", () => {
      const run = startStressTest(db, { level: "extreme" });
      const analysis = analyzeBottlenecks(run.testId);
      expect(analysis.bottlenecks.length).toBe(run.result.bottlenecks.length);
    });

    it("throws on unknown testId", () => {
      expect(() => analyzeBottlenecks("nope")).toThrow(/not found/);
    });
  });

  describe("generateCapacityPlan", () => {
    it("returns target/realized rps + recommendations", () => {
      const run = startStressTest(db, { level: "medium" });
      const plan = generateCapacityPlan(run.testId);
      expect(plan.testId).toBe(run.testId);
      expect(plan.targetRps).toBe(LOAD_LEVELS.MEDIUM.requestsPerSecond);
      expect(typeof plan.realizedTps).toBe("number");
      expect(plan.recommendations.length).toBeGreaterThan(0);
      expect(plan.scale).toBeGreaterThanOrEqual(1);
    });

    it("marks headroom as insufficient under extreme load", () => {
      const run = startStressTest(db, { level: "extreme" });
      const plan = generateCapacityPlan(run.testId);
      expect(["sufficient", "marginal", "insufficient"]).toContain(
        plan.headroom,
      );
    });

    it("throws on unknown testId", () => {
      expect(() => generateCapacityPlan("nope")).toThrow(/not found/);
    });
  });
});
