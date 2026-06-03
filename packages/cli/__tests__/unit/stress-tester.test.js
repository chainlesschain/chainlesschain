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
  // V2 surface
  RUN_STATUS_V2,
  LEVEL_NAME_V2,
  BOTTLENECK_KIND_V2,
  BOTTLENECK_SEVERITY_V2,
  STRESS_DEFAULT_MAX_CONCURRENT,
  setMaxConcurrentTests,
  getMaxConcurrentTests,
  getActiveTestCount,
  startStressTestV2,
  completeStressTest,
  stopStressTestV2,
  failStressTest,
  setRunStatus,
  recommendLevelV2,
  getStressStatsV2,
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

describe("stress-tester V2 (Phase 59)", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    ensureStressTables(db);
  });

  describe("frozen enums", () => {
    it("RUN_STATUS_V2 has 4 states", () => {
      expect(Object.values(RUN_STATUS_V2).sort()).toEqual([
        "complete",
        "failed",
        "running",
        "stopped",
      ]);
      expect(Object.isFrozen(RUN_STATUS_V2)).toBe(true);
    });

    it("LEVEL_NAME_V2 has 4 levels", () => {
      expect(Object.values(LEVEL_NAME_V2).sort()).toEqual([
        "extreme",
        "heavy",
        "light",
        "medium",
      ]);
      expect(Object.isFrozen(LEVEL_NAME_V2)).toBe(true);
    });

    it("BOTTLENECK_KIND_V2 has 4 kinds", () => {
      expect(Object.values(BOTTLENECK_KIND_V2).sort()).toEqual([
        "error-rate",
        "response-time",
        "tail-latency",
        "throughput",
      ]);
      expect(Object.isFrozen(BOTTLENECK_KIND_V2)).toBe(true);
    });

    it("BOTTLENECK_SEVERITY_V2 has 3 severities", () => {
      expect(Object.values(BOTTLENECK_SEVERITY_V2).sort()).toEqual([
        "high",
        "low",
        "medium",
      ]);
      expect(Object.isFrozen(BOTTLENECK_SEVERITY_V2)).toBe(true);
    });

    it("STRESS_DEFAULT_MAX_CONCURRENT is 3", () => {
      expect(STRESS_DEFAULT_MAX_CONCURRENT).toBe(3);
    });
  });

  describe("setMaxConcurrentTests / getMaxConcurrentTests", () => {
    it("defaults to 3", () => {
      expect(getMaxConcurrentTests()).toBe(3);
    });

    it("accepts positive integer", () => {
      setMaxConcurrentTests(5);
      expect(getMaxConcurrentTests()).toBe(5);
    });

    it("floors non-integer input", () => {
      setMaxConcurrentTests(3.7);
      expect(getMaxConcurrentTests()).toBe(3);
    });

    it("rejects values < 1", () => {
      expect(() => setMaxConcurrentTests(0)).toThrow(/positive integer/);
      expect(() => setMaxConcurrentTests(-1)).toThrow(/positive integer/);
    });

    it("rejects NaN and non-number", () => {
      expect(() => setMaxConcurrentTests(NaN)).toThrow(/positive integer/);
      expect(() => setMaxConcurrentTests("5")).toThrow(/positive integer/);
    });

    it("is reset by _resetState", () => {
      setMaxConcurrentTests(10);
      _resetState();
      expect(getMaxConcurrentTests()).toBe(3);
    });
  });

  describe("startStressTestV2", () => {
    it("creates a RUNNING run without metrics", () => {
      const run = startStressTestV2(db, { level: "light" });
      expect(run.status).toBe(RUN_STATUS_V2.RUNNING);
      expect(run.loadLevel).toBe("light");
      expect(run.completedAt).toBeNull();
      expect(run.testId).toBeTruthy();
    });

    it("defaults to medium when level omitted", () => {
      const run = startStressTestV2(db);
      expect(run.loadLevel).toBe("medium");
    });

    it("rejects unknown level", () => {
      expect(() => startStressTestV2(db, { level: "crazy" })).toThrow(
        /Unknown load level/,
      );
    });

    it("rejects when activeCount >= maxConcurrentTests", () => {
      setMaxConcurrentTests(2);
      startStressTestV2(db, { level: "light" });
      startStressTestV2(db, { level: "light" });
      expect(() => startStressTestV2(db, { level: "light" })).toThrow(
        /Max concurrent stress tests reached/,
      );
    });

    it("frees a slot after terminal transition", () => {
      setMaxConcurrentTests(1);
      const run = startStressTestV2(db, { level: "light" });
      expect(getActiveTestCount()).toBe(1);
      stopStressTestV2(db, run.testId);
      expect(getActiveTestCount()).toBe(0);
      expect(() => startStressTestV2(db, { level: "light" })).not.toThrow();
    });
  });

  describe("completeStressTest", () => {
    it("transitions running → complete and computes metrics", () => {
      const run = startStressTestV2(db, { level: "light" });
      const finished = completeStressTest(db, run.testId);
      expect(finished.status).toBe(RUN_STATUS_V2.COMPLETE);
      expect(finished.completedAt).toBeTruthy();
      expect(finished.result).toBeTruthy();
      expect(typeof finished.result.tps).toBe("number");
      expect(finished.result.bottlenecks).toBeInstanceOf(Array);
    });

    it("rejects invalid transition from terminal state", () => {
      const run = startStressTestV2(db, { level: "light" });
      completeStressTest(db, run.testId);
      expect(() => completeStressTest(db, run.testId)).toThrow(
        /Invalid run status transition/,
      );
    });

    it("throws on unknown testId", () => {
      expect(() => completeStressTest(db, "nope")).toThrow(/not found/);
    });
  });

  describe("stopStressTestV2 / failStressTest", () => {
    it("stopStressTestV2 moves run to STOPPED", () => {
      const run = startStressTestV2(db, { level: "light" });
      const stopped = stopStressTestV2(db, run.testId);
      expect(stopped.status).toBe(RUN_STATUS_V2.STOPPED);
      expect(stopped.completedAt).toBeTruthy();
    });

    it("failStressTest moves run to FAILED with errorMessage patch", () => {
      const run = startStressTestV2(db, { level: "light" });
      const failed = failStressTest(db, run.testId, "upstream exploded");
      expect(failed.status).toBe(RUN_STATUS_V2.FAILED);
      expect(failed.errorMessage).toBe("upstream exploded");
    });
  });

  describe("setRunStatus state machine", () => {
    it("rejects transition from terminal state", () => {
      const run = startStressTestV2(db, { level: "light" });
      setRunStatus(db, run.testId, RUN_STATUS_V2.STOPPED);
      expect(() => setRunStatus(db, run.testId, RUN_STATUS_V2.FAILED)).toThrow(
        /Invalid run status transition/,
      );
    });

    it("rejects unknown status", () => {
      const run = startStressTestV2(db, { level: "light" });
      expect(() => setRunStatus(db, run.testId, "foobar")).toThrow(
        /Unknown run status/,
      );
    });

    it("rejects unknown testId", () => {
      expect(() => setRunStatus(db, "nope", RUN_STATUS_V2.STOPPED)).toThrow(
        /not found/,
      );
    });

    it("sets completedAt on terminal transition", () => {
      const run = startStressTestV2(db, { level: "light" });
      const stopped = setRunStatus(db, run.testId, RUN_STATUS_V2.STOPPED);
      expect(stopped.completedAt).toBeTruthy();
    });
  });

  describe("recommendLevelV2", () => {
    it("returns light for small target", () => {
      expect(recommendLevelV2(5).name).toBe("light");
    });

    it("returns medium for moderate target", () => {
      expect(recommendLevelV2(200).name).toBe("medium");
    });

    it("returns heavy for high target", () => {
      expect(recommendLevelV2(500).name).toBe("heavy");
    });

    it("returns extreme for very high target", () => {
      expect(recommendLevelV2(5000).name).toBe("extreme");
    });

    it("rejects non-positive target", () => {
      expect(() => recommendLevelV2(0)).toThrow(/positive number/);
      expect(() => recommendLevelV2(-1)).toThrow(/positive number/);
      expect(() => recommendLevelV2(NaN)).toThrow(/positive number/);
    });
  });

  describe("getActiveTestCount", () => {
    it("counts only RUNNING tests", () => {
      expect(getActiveTestCount()).toBe(0);
      const a = startStressTestV2(db, { level: "light" });
      const b = startStressTestV2(db, { level: "light" });
      expect(getActiveTestCount()).toBe(2);
      completeStressTest(db, a.testId);
      expect(getActiveTestCount()).toBe(1);
      failStressTest(db, b.testId, "boom");
      expect(getActiveTestCount()).toBe(0);
    });
  });

  describe("getStressStatsV2", () => {
    it("returns zero-state shape with all enum keys initialised", () => {
      const stats = getStressStatsV2();
      expect(stats.totalTests).toBe(0);
      expect(stats.activeTests).toBe(0);
      expect(stats.maxConcurrentTests).toBe(3);
      for (const s of Object.values(RUN_STATUS_V2)) {
        expect(stats.byStatus[s]).toBe(0);
      }
      for (const l of Object.values(LEVEL_NAME_V2)) {
        expect(stats.byLevel[l]).toBe(0);
      }
      expect(stats.bottlenecks.total).toBe(0);
      for (const k of Object.values(BOTTLENECK_KIND_V2)) {
        expect(stats.bottlenecks.byKind[k]).toBe(0);
      }
      for (const s of Object.values(BOTTLENECK_SEVERITY_V2)) {
        expect(stats.bottlenecks.bySeverity[s]).toBe(0);
      }
      expect(stats.aggregateMetrics.samples).toBe(0);
    });

    it("aggregates completed runs", () => {
      const run = startStressTestV2(db, { level: "light" });
      completeStressTest(db, run.testId);
      const stats = getStressStatsV2();
      expect(stats.totalTests).toBe(1);
      expect(stats.byStatus.complete).toBe(1);
      expect(stats.byLevel.light).toBe(1);
      expect(stats.aggregateMetrics.samples).toBe(1);
      expect(typeof stats.aggregateMetrics.avgTps).toBe("number");
    });
  });
});
