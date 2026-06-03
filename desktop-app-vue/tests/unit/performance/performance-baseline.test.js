import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-baseline-uuid-001"),
}));

let mockRunStmt, mockAllStmt, mockGetStmt, mockDb;
let PerformanceBaseline, getPerformanceBaseline, BASELINE_STATUS, METRIC_TYPES;

beforeEach(async () => {
  mockRunStmt = { run: vi.fn() };
  mockAllStmt = { all: vi.fn(() => []) };
  mockGetStmt = { get: vi.fn(() => null) };
  mockDb = {
    exec: vi.fn(),
    prepare: vi.fn((sql) => {
      if (
        sql.includes("INSERT") ||
        sql.includes("UPDATE") ||
        sql.includes("DELETE")
      ) {
        return mockRunStmt;
      }
      if (sql.includes("SELECT")) {
        return mockAllStmt;
      }
      return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
    }),
  };

  const mod =
    await import("../../../src/main/performance/performance-baseline.js");
  PerformanceBaseline = mod.PerformanceBaseline;
  getPerformanceBaseline = mod.getPerformanceBaseline;
  BASELINE_STATUS = mod.BASELINE_STATUS;
  METRIC_TYPES = mod.METRIC_TYPES;
});

describe("Constants", () => {
  it("should define BASELINE_STATUS", () => {
    expect(BASELINE_STATUS.COLLECTING).toBe("collecting");
    expect(BASELINE_STATUS.COMPLETE).toBe("complete");
    expect(BASELINE_STATUS.FAILED).toBe("failed");
  });

  it("should define METRIC_TYPES", () => {
    expect(METRIC_TYPES.IPC_LATENCY).toBe("ipc_latency");
    expect(METRIC_TYPES.MEMORY).toBe("memory");
    expect(METRIC_TYPES.DB_QUERY).toBe("db_query");
  });
});

describe("PerformanceBaseline", () => {
  let manager;

  beforeEach(() => {
    manager = new PerformanceBaseline({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with default values", () => {
      expect(manager.initialized).toBe(false);
      expect(manager._baselines).toBeInstanceOf(Map);
      expect(manager._samples).toEqual([]);
      expect(manager._maxSamples).toBe(1000);
    });
  });

  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      await manager.initialize();
      expect(manager.initialized).toBe(true);
    });

    it("should load baselines from DB", async () => {
      mockAllStmt.all.mockReturnValueOnce([
        { id: "b1", name: "test", metrics: "{}", environment: "{}" },
      ]);
      await manager.initialize();
      expect(manager._baselines.size).toBe(1);
    });
  });

  describe("_ensureTables()", () => {
    it("should create performance tables", () => {
      manager._ensureTables();
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS performance_baselines");
    });

    it("should not throw if database is null", () => {
      const m = new PerformanceBaseline(null);
      expect(() => m._ensureTables()).not.toThrow();
    });
  });

  describe("collectBaseline()", () => {
    it("should throw if name is missing", async () => {
      await expect(manager.collectBaseline({})).rejects.toThrow(
        "Baseline name is required",
      );
    });

    it("should collect baseline with metrics", async () => {
      const baseline = await manager.collectBaseline({ name: "test-baseline" });
      expect(baseline.name).toBe("test-baseline");
      expect(baseline.status).toBe("complete");
      expect(baseline.metrics).toBeDefined();
      expect(baseline.metrics.ipc).toBeDefined();
      expect(baseline.metrics.memory).toBeDefined();
    });

    it("should persist to DB", async () => {
      await manager.collectBaseline({ name: "test" });
      expect(mockRunStmt.run).toHaveBeenCalled();
    });
  });

  describe("recordSample()", () => {
    it("should add sample", () => {
      manager.recordSample("ipc_latency", 50);
      expect(manager._samples).toHaveLength(1);
      expect(manager._samples[0].type).toBe("ipc_latency");
    });

    it("should trim samples beyond max", () => {
      manager._maxSamples = 2;
      manager.recordSample("ipc_latency", 10);
      manager.recordSample("ipc_latency", 20);
      manager.recordSample("ipc_latency", 30);
      expect(manager._samples).toHaveLength(2);
    });
  });

  describe("compareBaseline()", () => {
    it("should throw if baselineId is missing", async () => {
      await expect(manager.compareBaseline({})).rejects.toThrow(
        "Baseline ID is required",
      );
    });

    it("should throw if baseline not found", async () => {
      await expect(
        manager.compareBaseline({ baselineId: "nonexistent" }),
      ).rejects.toThrow("Baseline not found");
    });

    it("should compare two baselines", async () => {
      manager._baselines.set("b1", {
        id: "b1",
        name: "old",
        created_at: 1000,
        metrics: {
          ipc: { p50: 10, p95: 20, p99: 30, count: 5 },
          memory: { rss: 100, heapUsed: 50, heapTotal: 80, external: 10 },
          db: { p50: 5, p95: 10, count: 3 },
          cpu: { user: 100, system: 50 },
        },
      });
      manager._baselines.set("b2", {
        id: "b2",
        name: "new",
        created_at: 2000,
        metrics: {
          ipc: { p50: 12, p95: 22, p99: 35, count: 5 },
          memory: { rss: 110, heapUsed: 55, heapTotal: 85, external: 12 },
          db: { p50: 6, p95: 11, count: 3 },
          cpu: { user: 110, system: 55 },
        },
      });
      const result = await manager.compareBaseline({ baselineId: "b1" });
      expect(result.baselineId).toBe("b1");
      expect(result.currentId).toBe("b2");
      expect(result.hasRegressions).toBeDefined();
    });
  });

  describe("getBaselines()", () => {
    it("should return baselines from in-memory", async () => {
      const m = new PerformanceBaseline(null);
      m._baselines.set("b1", { id: "b1", created_at: 1000 });
      const baselines = await m.getBaselines();
      expect(baselines).toHaveLength(1);
    });
  });

  describe("_percentile()", () => {
    it("should return 0 for empty array", () => {
      expect(manager._percentile([], 50)).toBe(0);
    });

    it("should calculate percentile", () => {
      expect(manager._percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    });
  });

  describe("close()", () => {
    it("should reset state", async () => {
      manager._baselines.set("b1", {});
      await manager.close();
      expect(manager._baselines.size).toBe(0);
      expect(manager.initialized).toBe(false);
    });
  });

  describe("getPerformanceBaseline singleton", () => {
    it("should return an instance", () => {
      const instance = getPerformanceBaseline();
      expect(instance).toBeInstanceOf(PerformanceBaseline);
    });
  });
});
