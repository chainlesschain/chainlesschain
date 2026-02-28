import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-stress-uuid-001"),
}));

let mockRunStmt, mockAllStmt, mockGetStmt, mockDb;
let FederationStressTester, getFederationStressTester, TEST_STATUS;

beforeEach(async () => {
  mockRunStmt = { run: vi.fn() };
  mockAllStmt = { all: vi.fn(() => []) };
  mockGetStmt = { get: vi.fn(() => null) };
  mockDb = {
    exec: vi.fn(),
    prepare: vi.fn((sql) => {
      if (sql.includes("INSERT") || sql.includes("UPDATE")) {
        return mockRunStmt;
      }
      if (sql.includes("SELECT") && sql.includes("WHERE run_id")) {
        return mockGetStmt;
      }
      if (sql.includes("SELECT")) {
        return mockAllStmt;
      }
      return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
    }),
  };

  const mod =
    await import("../../../src/main/ai-engine/cowork/federation-stress-tester.js");
  FederationStressTester = mod.FederationStressTester;
  getFederationStressTester = mod.getFederationStressTester;
  TEST_STATUS = mod.TEST_STATUS;
});

describe("Constants", () => {
  it("should define TEST_STATUS", () => {
    expect(TEST_STATUS.PENDING).toBe("pending");
    expect(TEST_STATUS.RUNNING).toBe("running");
    expect(TEST_STATUS.COMPLETE).toBe("complete");
    expect(TEST_STATUS.STOPPED).toBe("stopped");
  });
});

describe("FederationStressTester", () => {
  let tester;

  beforeEach(() => {
    tester = new FederationStressTester({ db: mockDb });
  });

  describe("constructor", () => {
    it("should initialize with default values", () => {
      expect(tester.initialized).toBe(false);
      expect(tester._runs).toBeInstanceOf(Map);
      expect(tester._activeRun).toBeNull();
      expect(tester._maxNodeCount).toBe(100);
    });
  });

  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      await tester.initialize();
      expect(tester.initialized).toBe(true);
    });
  });

  describe("_ensureTables()", () => {
    it("should create tables", () => {
      tester._ensureTables();
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS stress_test_runs");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS stress_test_results");
    });
  });

  describe("startTest()", () => {
    it("should start a test with defaults", async () => {
      const { run, result } = await tester.startTest();
      expect(run.status).toBe("complete");
      expect(run.node_count).toBe(10);
      expect(result.total_tasks).toBeGreaterThan(0);
    });

    it("should throw if test already running", async () => {
      tester._activeRun = "existing";
      await expect(tester.startTest()).rejects.toThrow("already running");
    });

    it("should throw if node count exceeds max", async () => {
      await expect(tester.startTest({ nodeCount: 200 })).rejects.toThrow(
        "exceeds maximum",
      );
    });

    it("should accept custom parameters", async () => {
      const { run } = await tester.startTest({
        name: "custom",
        nodeCount: 50,
        concurrentTasks: 10,
      });
      expect(run.name).toBe("custom");
      expect(run.node_count).toBe(50);
    });
  });

  describe("stopTest()", () => {
    it("should throw if no active test", async () => {
      await expect(tester.stopTest()).rejects.toThrow("No active stress test");
    });
  });

  describe("getRuns()", () => {
    it("should return runs from in-memory", async () => {
      const m = new FederationStressTester(null);
      m._runs.set("r1", { id: "r1" });
      const runs = await m.getRuns();
      expect(runs).toHaveLength(1);
    });
  });

  describe("getResults()", () => {
    it("should throw if runId is missing", async () => {
      await expect(tester.getResults()).rejects.toThrow("Run ID is required");
    });

    it("should return results from memory", async () => {
      tester._results.set("r1", { id: "res1", run_id: "r1" });
      const result = await tester.getResults("r1");
      expect(result.run_id).toBe("r1");
    });
  });

  describe("close()", () => {
    it("should reset state", async () => {
      tester._runs.set("r1", {});
      await tester.close();
      expect(tester._runs.size).toBe(0);
      expect(tester.initialized).toBe(false);
    });
  });

  describe("getFederationStressTester singleton", () => {
    it("should return an instance", () => {
      const instance = getFederationStressTester();
      expect(instance).toBeInstanceOf(FederationStressTester);
    });
  });
});
