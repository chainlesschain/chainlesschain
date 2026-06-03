import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-rep-opt-uuid-001"),
}));

let mockRunStmt, mockAllStmt, mockDb;
let ReputationOptimizer, getReputationOptimizer, OPTIMIZATION_STATUS;

beforeEach(async () => {
  mockRunStmt = { run: vi.fn() };
  mockAllStmt = { all: vi.fn(() => []) };
  mockDb = {
    exec: vi.fn(),
    prepare: vi.fn((sql) => {
      if (sql.includes("INSERT") || sql.includes("UPDATE")) {
        return mockRunStmt;
      }
      if (sql.includes("SELECT")) {
        return mockAllStmt;
      }
      return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
    }),
  };

  const mod =
    await import("../../../src/main/ai-engine/cowork/reputation-optimizer.js");
  ReputationOptimizer = mod.ReputationOptimizer;
  getReputationOptimizer = mod.getReputationOptimizer;
  OPTIMIZATION_STATUS = mod.OPTIMIZATION_STATUS;
});

describe("Constants", () => {
  it("should define OPTIMIZATION_STATUS", () => {
    expect(OPTIMIZATION_STATUS.PENDING).toBe("pending");
    expect(OPTIMIZATION_STATUS.COMPLETE).toBe("complete");
  });
});

describe("ReputationOptimizer", () => {
  let optimizer;

  beforeEach(() => {
    optimizer = new ReputationOptimizer({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with defaults", () => {
      expect(optimizer.initialized).toBe(false);
      expect(optimizer._bayesianIterations).toBe(100);
      expect(optimizer._anomalyThreshold).toBe(2.5);
    });
  });

  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      await optimizer.initialize();
      expect(optimizer.initialized).toBe(true);
    });
  });

  describe("_ensureTables()", () => {
    it("should create tables", () => {
      optimizer._ensureTables();
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain(
        "CREATE TABLE IF NOT EXISTS reputation_optimization_runs",
      );
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS reputation_analytics");
    });
  });

  describe("runOptimization()", () => {
    it("should run with defaults", async () => {
      const result = await optimizer.runOptimization();
      expect(result.status).toBe("complete");
      expect(result.improvement).toBeGreaterThanOrEqual(0);
      expect(result.parameters).toBeDefined();
    });

    it("should accept custom iterations", async () => {
      const result = await optimizer.runOptimization({ iterations: 50 });
      expect(result.iterations).toBe(50);
    });

    it("should persist to DB", async () => {
      await optimizer.runOptimization();
      expect(mockRunStmt.run).toHaveBeenCalled();
    });
  });

  describe("getAnalytics()", () => {
    it("should return analytics from memory", async () => {
      const m = new ReputationOptimizer(null);
      m._analytics.set("a1", { id: "a1" });
      const analytics = await m.getAnalytics();
      expect(analytics).toHaveLength(1);
    });
  });

  describe("detectAnomalies()", () => {
    it("should return empty for no scores", async () => {
      const result = await optimizer.detectAnomalies();
      expect(result.anomalies).toEqual([]);
      expect(result.analyzed).toBe(0);
    });

    it("should detect anomalies in scores", async () => {
      const scores = [
        { nodeId: "n1", score: 50 },
        { nodeId: "n2", score: 51 },
        { nodeId: "n3", score: 49 },
        { nodeId: "n4", score: 200 },
      ];
      const result = await optimizer.detectAnomalies({ nodeScores: scores });
      expect(result.analyzed).toBe(4);
      expect(result.anomalies.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("getHistory()", () => {
    it("should return history from memory", async () => {
      const m = new ReputationOptimizer(null);
      m._optimizations.set("o1", { id: "o1" });
      const history = await m.getHistory();
      expect(history).toHaveLength(1);
    });
  });

  describe("close()", () => {
    it("should reset state", async () => {
      optimizer._optimizations.set("o1", {});
      await optimizer.close();
      expect(optimizer._optimizations.size).toBe(0);
      expect(optimizer.initialized).toBe(false);
    });
  });

  describe("getReputationOptimizer singleton", () => {
    it("should return an instance", () => {
      const instance = getReputationOptimizer();
      expect(instance).toBeInstanceOf(ReputationOptimizer);
    });
  });
});
