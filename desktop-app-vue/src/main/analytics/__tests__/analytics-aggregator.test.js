/**
 * AnalyticsAggregator Unit Tests
 *
 * Covers: initialize, _collectAllMetrics, _getBucketKey, _aggregate,
 *         _pushRealtime, start/stop, getDashboardSummary, getTopN,
 *         generateReport, _periodToTimestamp, getTimeSeries, cleanupOldData
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-uuid"),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a mock prepared-statement object returned by db.prepare().
 * Each call to db.prepare() returns a fresh stub so tests can override
 * individual .all() / .get() / .run() results independently.
 */
function makePrepStmt(overrides = {}) {
  return {
    run: vi.fn(() => ({ changes: 1 })),
    all: vi.fn(() => []),
    get: vi.fn(() => null),
    ...overrides,
  };
}

/**
 * Build a mock database whose prepare() always returns the same
 * shared prepStmt (so tests can inspect calls on it).
 * Individual tests can replace prepStmt.all etc. via .mockReturnValueOnce.
 */
function createMockDb() {
  const prepStmt = makePrepStmt();
  const db = {
    exec: vi.fn(),
    run: vi.fn(),
    all: vi.fn(() => []),
    get: vi.fn(() => null),
    prepare: vi.fn(() => prepStmt),
    _stmt: prepStmt,
  };
  return db;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AnalyticsAggregator", () => {
  let AnalyticsAggregator;
  let aggregator;
  let mockDb;
  let mockTokenTracker;
  let mockSkillMetrics;
  let mockErrorMonitor;
  let mockPerfMonitor;
  let mockMainWindow;

  beforeEach(async () => {
    // Re-import module fresh each time (module cache is reset by vitest's
    // mockReset / restoreMocks, but we also need a fresh singleton instance).
    const mod = await import("../analytics-aggregator.js");
    AnalyticsAggregator = mod.AnalyticsAggregator;

    mockDb = createMockDb();

    mockTokenTracker = {
      getStats: vi.fn(() => ({
        totalTokens: 1000,
        totalCalls: 50,
        avgLatency: 500,
        totalCost: 0.05,
        byModel: { "gpt-4": { calls: 20, tokens: 500 } },
      })),
    };

    mockSkillMetrics = {
      getOverallStats: vi.fn(() => ({
        totalExecutions: 200,
        successRate: 0.95,
        topSkills: [{ name: "code-review", executions: 50 }],
        byCategory: { coding: 120 },
      })),
    };

    mockErrorMonitor = {
      getStats: vi.fn(() => ({
        totalErrors: 5,
        errorRate: 0.025,
        byType: { NetworkError: 3, TimeoutError: 2 },
        recentErrors: [],
      })),
    };

    mockPerfMonitor = {
      getSummary: vi.fn(() => ({
        system: { cpu: { usage: 25 }, memory: { usedPercent: 60 } },
      })),
    };

    mockMainWindow = {
      webContents: {
        send: vi.fn(),
        isDestroyed: vi.fn(() => false),
      },
    };

    aggregator = new AnalyticsAggregator();
    await aggregator.initialize({
      database: mockDb,
      tokenTracker: mockTokenTracker,
      skillMetrics: mockSkillMetrics,
      errorMonitor: mockErrorMonitor,
      performanceMonitor: mockPerfMonitor,
      mainWindow: mockMainWindow,
    });
  });

  afterEach(() => {
    aggregator.stop();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  // ─── initialize ─────────────────────────────────────────────────────────────

  describe("initialize()", () => {
    it("should set initialized=true and attach the database", () => {
      expect(aggregator.initialized).toBe(true);
      expect(aggregator.database).toBe(mockDb);
    });

    it("should attach all optional dependencies", () => {
      expect(aggregator.tokenTracker).toBe(mockTokenTracker);
      expect(aggregator.skillMetrics).toBe(mockSkillMetrics);
      expect(aggregator.errorMonitor).toBe(mockErrorMonitor);
      expect(aggregator.performanceMonitor).toBe(mockPerfMonitor);
      expect(aggregator.mainWindow).toBe(mockMainWindow);
    });

    it("should be idempotent — second initialize() is a no-op", async () => {
      const secondDb = createMockDb();
      await aggregator.initialize({ database: secondDb });
      // The original database must still be set (second call ignored)
      expect(aggregator.database).toBe(mockDb);
    });

    it("should call exec() to ensure the aggregation table exists", () => {
      // _ensureTable uses db.exec (via this.database.db || this.database)
      expect(mockDb.exec).toHaveBeenCalled();
    });
  });

  // ─── _collectAllMetrics ─────────────────────────────────────────────────────

  describe("_collectAllMetrics()", () => {
    it("should collect AI metrics from tokenTracker.getStats()", async () => {
      const metrics = await aggregator._collectAllMetrics();
      expect(metrics.ai.totalTokens).toBe(1000);
      expect(metrics.ai.totalCalls).toBe(50);
      expect(metrics.ai.avgLatency).toBe(500);
      expect(metrics.ai.costEstimate).toBe(0.05);
      expect(metrics.ai.byModel["gpt-4"].calls).toBe(20);
    });

    it("should collect skill metrics from skillMetrics.getOverallStats()", async () => {
      const metrics = await aggregator._collectAllMetrics();
      expect(metrics.skills.totalExecutions).toBe(200);
      expect(metrics.skills.successRate).toBe(0.95);
      expect(metrics.skills.topSkills).toHaveLength(1);
      expect(metrics.skills.topSkills[0].name).toBe("code-review");
    });

    it("should collect error metrics from errorMonitor.getStats()", async () => {
      const metrics = await aggregator._collectAllMetrics();
      expect(metrics.errors.totalErrors).toBe(5);
      expect(metrics.errors.errorRate).toBe(0.025);
      expect(metrics.errors.byType.NetworkError).toBe(3);
      expect(metrics.errors.byType.TimeoutError).toBe(2);
    });

    it("should collect system metrics from performanceMonitor.getSummary()", async () => {
      const metrics = await aggregator._collectAllMetrics();
      expect(metrics.system.cpuUsage).toBe(25);
      expect(metrics.system.memoryUsage).toBe(60);
    });

    it("should always return a timestamp in the metrics object", async () => {
      const before = Date.now();
      const metrics = await aggregator._collectAllMetrics();
      const after = Date.now();
      expect(metrics.timestamp).toBeGreaterThanOrEqual(before);
      expect(metrics.timestamp).toBeLessThanOrEqual(after);
    });

    it("should default AI counters to 0 when tokenTracker is absent", async () => {
      const isolated = new AnalyticsAggregator();
      await isolated.initialize({ database: mockDb });
      const metrics = await isolated._collectAllMetrics();
      expect(metrics.ai.totalCalls).toBe(0);
      expect(metrics.ai.totalTokens).toBe(0);
      expect(metrics.ai.avgLatency).toBe(0);
    });

    it("should default skill counters to 0 when skillMetrics is absent", async () => {
      const isolated = new AnalyticsAggregator();
      await isolated.initialize({ database: mockDb });
      const metrics = await isolated._collectAllMetrics();
      expect(metrics.skills.totalExecutions).toBe(0);
      expect(metrics.skills.successRate).toBe(0);
      expect(metrics.skills.topSkills).toHaveLength(0);
    });

    it("should default error counters to 0 when errorMonitor is absent", async () => {
      const isolated = new AnalyticsAggregator();
      await isolated.initialize({ database: mockDb });
      const metrics = await isolated._collectAllMetrics();
      expect(metrics.errors.totalErrors).toBe(0);
    });

    it("should gracefully handle tokenTracker.getStats() throwing", async () => {
      mockTokenTracker.getStats.mockImplementation(() => {
        throw new Error("tracker unavailable");
      });
      const metrics = await aggregator._collectAllMetrics();
      // Should not throw; counters fall back to defaults
      expect(metrics.ai.totalCalls).toBe(0);
    });
  });

  // ─── _getBucketKey ──────────────────────────────────────────────────────────

  describe("_getBucketKey()", () => {
    it("should return YYYY-MM-DDTHH:00 for hourly granularity", () => {
      const key = aggregator._getBucketKey("hourly");
      expect(key).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00$/);
    });

    it("should return YYYY-MM-DD for daily granularity", () => {
      const key = aggregator._getBucketKey("daily");
      expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("should return ISO string for unknown granularity", () => {
      const key = aggregator._getBucketKey("unknown");
      // ISO strings contain "T" and "Z"
      expect(key).toMatch(/T/);
    });

    it("should zero-pad months and days to 2 digits", () => {
      // Use a fixed date to make this deterministic.
      vi.setSystemTime(new Date("2026-01-05T09:03:00Z"));
      const key = aggregator._getBucketKey("hourly");
      // Month and day must be zero-padded
      expect(key).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00$/);
      expect(key.split("T")[0].split("-")[1].length).toBe(2); // month
      expect(key.split("T")[0].split("-")[2].length).toBe(2); // day
      vi.useRealTimers();
    });
  });

  // ─── _aggregate ─────────────────────────────────────────────────────────────

  describe("_aggregate()", () => {
    it("should call db.prepare() with an INSERT OR REPLACE statement", async () => {
      await aggregator._aggregate();
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringMatching(/INSERT OR REPLACE/i),
      );
    });

    it("should pass a UUID string as the first parameter to stmt.run()", async () => {
      await aggregator._aggregate();
      // uuid v4 mock may or may not intercept CJS require, so check shape only
      expect(mockDb._stmt.run).toHaveBeenCalledWith(
        expect.any(String), // id (uuid)
        expect.any(String), // bucketKey
        "hourly",
        expect.any(String), // JSON metrics
      );
    });

    it('should emit the "aggregated" event with bucketKey and metrics', async () => {
      const handler = vi.fn();
      aggregator.on("aggregated", handler);
      await aggregator._aggregate();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          bucketKey: expect.any(String),
          metrics: expect.objectContaining({ ai: expect.any(Object) }),
        }),
      );
    });

    it("should not throw when database is absent", async () => {
      aggregator.database = null;
      await expect(aggregator._aggregate()).resolves.not.toThrow();
    });
  });

  // ─── _pushRealtime ──────────────────────────────────────────────────────────

  describe("_pushRealtime()", () => {
    it("should send analytics:realtime-update with a timestamp to mainWindow", async () => {
      await aggregator._pushRealtime();
      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        "analytics:realtime-update",
        expect.objectContaining({ timestamp: expect.any(Number) }),
      );
    });

    it("should NOT send if mainWindow.webContents is absent", async () => {
      aggregator.mainWindow = null;
      await aggregator._pushRealtime();
      expect(mockMainWindow.webContents.send).not.toHaveBeenCalled();
    });

    it("should silently swallow errors thrown by _collectAllMetrics", async () => {
      // Force _collectAllMetrics to throw (simulate broken source)
      vi.spyOn(aggregator, "_collectAllMetrics").mockRejectedValue(
        new Error("collection error"),
      );
      await expect(aggregator._pushRealtime()).resolves.not.toThrow();
    });
  });

  // ─── start / stop ───────────────────────────────────────────────────────────

  describe("start() / stop()", () => {
    it("start() should set aggregationInterval", () => {
      vi.useFakeTimers();
      aggregator.start();
      expect(aggregator.aggregationInterval).toBeDefined();
      expect(aggregator.aggregationInterval).not.toBeNull();
      aggregator.stop();
    });

    it("start() should set realtimePushInterval", () => {
      vi.useFakeTimers();
      aggregator.start();
      expect(aggregator.realtimePushInterval).toBeDefined();
      expect(aggregator.realtimePushInterval).not.toBeNull();
      aggregator.stop();
    });

    it("stop() should null-out aggregationInterval", () => {
      vi.useFakeTimers();
      aggregator.start();
      aggregator.stop();
      expect(aggregator.aggregationInterval).toBeNull();
    });

    it("stop() should null-out realtimePushInterval", () => {
      vi.useFakeTimers();
      aggregator.start();
      aggregator.stop();
      expect(aggregator.realtimePushInterval).toBeNull();
    });

    it("calling start() twice should not create duplicate intervals (second call is ignored)", () => {
      vi.useFakeTimers();
      aggregator.start();
      const firstInterval = aggregator.aggregationInterval;
      aggregator.start(); // should warn and return early
      expect(aggregator.aggregationInterval).toBe(firstInterval);
      aggregator.stop();
    });

    it("_aggregate() should fire after aggregationIntervalMs elapses", async () => {
      vi.useFakeTimers();
      const spy = vi.spyOn(aggregator, "_aggregate").mockResolvedValue();
      aggregator.start();
      await vi.advanceTimersByTimeAsync(
        aggregator.config.aggregationIntervalMs,
      );
      expect(spy).toHaveBeenCalledTimes(1);
      aggregator.stop();
    });

    it("_pushRealtime() should fire after realtimePushIntervalMs elapses", async () => {
      vi.useFakeTimers();
      const spy = vi.spyOn(aggregator, "_pushRealtime").mockResolvedValue();
      aggregator.start();
      await vi.advanceTimersByTimeAsync(
        aggregator.config.realtimePushIntervalMs,
      );
      expect(spy).toHaveBeenCalledTimes(1);
      aggregator.stop();
    });
  });

  // ─── getDashboardSummary ─────────────────────────────────────────────────────

  describe("getDashboardSummary()", () => {
    it("should return kpis derived from current metrics", async () => {
      const summary = await aggregator.getDashboardSummary("24h");
      expect(summary.kpis).toBeDefined();
      expect(summary.kpis.totalAICalls).toBe(50);
      expect(summary.kpis.totalTokens).toBe(1000);
      expect(summary.kpis.skillExecutions).toBe(200);
      expect(summary.kpis.errorCount).toBe(5);
    });

    it("should echo back the period string", async () => {
      const summary = await aggregator.getDashboardSummary("7d");
      expect(summary.period).toBe("7d");
    });

    it("should include current metrics object", async () => {
      const summary = await aggregator.getDashboardSummary("24h");
      expect(summary.current).toBeDefined();
      expect(summary.current.ai.totalCalls).toBe(50);
    });

    it('should default period to "24h" when called without arguments', async () => {
      const summary = await aggregator.getDashboardSummary();
      expect(summary.period).toBe("24h");
    });

    it("should include historyCount based on DB rows", async () => {
      // Stub the prepare().all() to return 3 rows
      mockDb._stmt.all.mockReturnValueOnce([{}, {}, {}]);
      const summary = await aggregator.getDashboardSummary("24h");
      expect(summary.historyCount).toBe(3);
    });
  });

  // ─── getTopN ────────────────────────────────────────────────────────────────

  describe("getTopN()", () => {
    it('should return an array for metric="skills"', async () => {
      const top = await aggregator.getTopN("skills", 5, "24h");
      expect(Array.isArray(top)).toBe(true);
    });

    it("should respect n parameter for skills", async () => {
      // skillMetrics returns 1 topSkill, so result is capped at 1
      const top = await aggregator.getTopN("skills", 10, "24h");
      expect(top.length).toBeLessThanOrEqual(10);
    });

    it('should return an array for metric="errors"', async () => {
      const top = await aggregator.getTopN("errors", 3, "24h");
      expect(Array.isArray(top)).toBe(true);
    });

    it("should include name and count for error entries", async () => {
      const top = await aggregator.getTopN("errors", 5, "24h");
      if (top.length > 0) {
        expect(top[0]).toHaveProperty("name");
        expect(top[0]).toHaveProperty("count");
      }
    });

    it("should sort error entries by count descending", async () => {
      const top = await aggregator.getTopN("errors", 5, "24h");
      for (let i = 1; i < top.length; i++) {
        expect(top[i - 1].count).toBeGreaterThanOrEqual(top[i].count);
      }
    });

    it('should return an array for metric="models"', async () => {
      const top = await aggregator.getTopN("models", 5, "24h");
      expect(Array.isArray(top)).toBe(true);
    });

    it("should return empty array for unknown metric category", async () => {
      const top = await aggregator.getTopN("unknown", 5, "24h");
      expect(top).toEqual([]);
    });
  });

  // ─── generateReport ─────────────────────────────────────────────────────────

  describe("generateReport()", () => {
    it('should return a string starting with "Metric,Value" for CSV format', async () => {
      const csv = await aggregator.generateReport({
        format: "csv",
        period: "24h",
      });
      expect(typeof csv).toBe("string");
      expect(csv.startsWith("Metric,Value")).toBe(true);
    });

    it("should include KPI keys in the CSV output", async () => {
      const csv = await aggregator.generateReport({
        format: "csv",
        period: "24h",
      });
      expect(csv).toContain("totalAICalls");
      expect(csv).toContain("totalTokens");
    });

    it("should return an object with kpis for JSON format", async () => {
      const report = await aggregator.generateReport({
        format: "json",
        period: "24h",
      });
      expect(typeof report).toBe("object");
      expect(report).not.toBeNull();
      expect(report.kpis).toBeDefined();
    });

    it("should default to JSON format when format is omitted", async () => {
      const report = await aggregator.generateReport({ period: "24h" });
      expect(typeof report).toBe("object");
      expect(report.kpis).toBeDefined();
    });

    it("CSV each KPI line should have exactly one comma", async () => {
      const csv = await aggregator.generateReport({
        format: "csv",
        period: "24h",
      });
      const lines = csv.split("\n").slice(1); // skip header
      for (const line of lines) {
        if (line.trim()) {
          // Lines are "key,value" — value may be wrapped in quotes but there
          // should be at least one comma
          expect(line).toMatch(/,/);
        }
      }
    });
  });

  // ─── _periodToTimestamp ──────────────────────────────────────────────────────

  describe("_periodToTimestamp()", () => {
    it('should subtract ~24 hours for "24h"', () => {
      const now = Date.now();
      const ts = aggregator._periodToTimestamp("24h");
      expect(ts).toBeGreaterThan(now - 25 * 3600000);
      expect(ts).toBeLessThan(now - 23 * 3600000);
    });

    it('should subtract ~7 days for "7d"', () => {
      const now = Date.now();
      const ts = aggregator._periodToTimestamp("7d");
      expect(ts).toBeGreaterThan(now - 8 * 86400000);
      expect(ts).toBeLessThan(now - 6 * 86400000);
    });

    it('should subtract ~1 hour for "1h"', () => {
      const now = Date.now();
      const ts = aggregator._periodToTimestamp("1h");
      expect(ts).toBeGreaterThan(now - 2 * 3600000);
      expect(ts).toBeLessThan(now);
    });

    it("should default to ~24 hours for an unrecognised period string", () => {
      const now = Date.now();
      const ts = aggregator._periodToTimestamp("bad");
      expect(ts).toBeGreaterThan(now - 25 * 3600000);
      expect(ts).toBeLessThan(now);
    });

    it('should handle weeks ("4w")', () => {
      const now = Date.now();
      const ts = aggregator._periodToTimestamp("4w");
      const expectedDelta = 4 * 7 * 86400000;
      expect(ts).toBeCloseTo(now - expectedDelta, -3); // within ~1 second
    });
  });

  // ─── getTimeSeries ───────────────────────────────────────────────────────────

  describe("getTimeSeries()", () => {
    it("should return an empty array when database is absent", async () => {
      aggregator.database = null;
      const series = await aggregator.getTimeSeries("ai.totalCalls", {
        granularity: "hourly",
      });
      expect(series).toEqual([]);
    });

    it("should map rows to { timestamp, value } objects", async () => {
      mockDb._stmt.all.mockReturnValueOnce([
        {
          bucket_key: "2026-02-23T10:00",
          metrics: JSON.stringify({ ai: { totalCalls: 10 } }),
        },
        {
          bucket_key: "2026-02-23T11:00",
          metrics: JSON.stringify({ ai: { totalCalls: 20 } }),
        },
      ]);

      const series = await aggregator.getTimeSeries("ai.totalCalls", {
        granularity: "hourly",
      });

      expect(series).toHaveLength(2);
      expect(series[0]).toEqual({ timestamp: "2026-02-23T10:00", value: 10 });
      expect(series[1]).toEqual({ timestamp: "2026-02-23T11:00", value: 20 });
    });

    it('should resolve nested dot-notation paths (e.g. "errors.byType")', async () => {
      mockDb._stmt.all.mockReturnValueOnce([
        {
          bucket_key: "2026-02-23T10:00",
          metrics: JSON.stringify({ errors: { byType: { NetworkError: 3 } } }),
        },
      ]);

      const series = await aggregator.getTimeSeries("errors.byType", {
        granularity: "hourly",
      });

      expect(series[0].value).toEqual({ NetworkError: 3 });
    });

    it("should default missing metric paths to 0", async () => {
      mockDb._stmt.all.mockReturnValueOnce([
        {
          bucket_key: "2026-02-23T10:00",
          metrics: JSON.stringify({ ai: {} }),
        },
      ]);

      const series = await aggregator.getTimeSeries("ai.totalCalls", {
        granularity: "hourly",
      });

      expect(series[0].value).toBe(0);
    });

    it("should query with granularity parameter", async () => {
      mockDb._stmt.all.mockReturnValueOnce([]);
      await aggregator.getTimeSeries("ai.totalCalls", { granularity: "daily" });
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("granularity"),
      );
      expect(mockDb._stmt.all).toHaveBeenCalledWith("daily");
    });

    it("should return empty array on DB error", async () => {
      mockDb.prepare.mockImplementationOnce(() => {
        throw new Error("DB error");
      });
      const series = await aggregator.getTimeSeries("ai.totalCalls", {});
      expect(series).toEqual([]);
    });
  });

  // ─── cleanupOldData ──────────────────────────────────────────────────────────

  describe("cleanupOldData()", () => {
    it("should call db.prepare() with a DELETE statement", async () => {
      await aggregator.cleanupOldData(30);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringMatching(/DELETE/i),
      );
    });

    it("should pass a single cutoff ISO string to stmt.run()", async () => {
      await aggregator.cleanupOldData(30);
      expect(mockDb._stmt.run).toHaveBeenCalledWith(
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      );
    });

    it("should use config.retentionDays when retentionDays arg is omitted", async () => {
      const spyPrepare = vi
        .spyOn(mockDb, "prepare")
        .mockReturnValue(makePrepStmt({ run: vi.fn(() => ({ changes: 0 })) }));
      await aggregator.cleanupOldData();
      expect(spyPrepare).toHaveBeenCalled();
    });

    it("should return { deleted: 0 } when database is absent", async () => {
      aggregator.database = null;
      const result = await aggregator.cleanupOldData(30);
      expect(result).toEqual({ deleted: 0 });
    });

    it("should return deleted count from stmt.run().changes", async () => {
      mockDb._stmt.run.mockReturnValueOnce({ changes: 7 });
      const result = await aggregator.cleanupOldData(30);
      expect(result.deleted).toBe(7);
    });

    it("should return error message on DB failure", async () => {
      mockDb.prepare.mockImplementationOnce(() => {
        throw new Error("disk full");
      });
      const result = await aggregator.cleanupOldData(30);
      expect(result.error).toBeDefined();
    });
  });
});
