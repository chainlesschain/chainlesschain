/**
 * BenchmarkManager Unit Tests
 *
 * Covers:
 * - Constructor and default state
 * - initialize() with database table creation
 * - runBenchmark() with mock LLM manager
 * - getResults() retrieval
 * - getRunStatus() retrieval
 * - getReport() generation
 * - listRuns() pagination and filtering
 * - cancelRun() behaviour
 * - deleteRun() with cascade
 * - runComparison() multi-model
 * - Event emission during benchmarks
 * - Error handling paths
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
  v4: (() => {
    let counter = 0;
    return vi.fn(() => `test-uuid-${++counter}`);
  })(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePrepStmt(overrides = {}) {
  return {
    run: vi.fn(() => ({ changes: 1 })),
    all: vi.fn(() => []),
    get: vi.fn(() => null),
    ...overrides,
  };
}

function createMockDb() {
  const stmts = [];
  const db = {
    exec: vi.fn(),
    prepare: vi.fn(() => {
      const stmt = makePrepStmt();
      stmts.push(stmt);
      return stmt;
    }),
    _stmts: stmts,
  };
  return db;
}

function createMockLlmManager(responseOverride = {}) {
  return {
    chatWithMessages: vi.fn(async () => ({
      text: "mock response",
      tokens: 10,
      usage: { total_tokens: 10 },
      ...responseOverride,
    })),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("BenchmarkManager", () => {
  let BenchmarkManager;
  let RUN_STATUS;
  let manager;
  let mockDb;
  let mockLlm;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset uuid counter by re-importing
    const mod = await import("../benchmark-manager.js");
    BenchmarkManager = mod.BenchmarkManager;
    RUN_STATUS = mod.RUN_STATUS;

    mockDb = createMockDb();
    mockLlm = createMockLlmManager();

    manager = new BenchmarkManager({ database: mockDb, llmManager: mockLlm });
  });

  afterEach(() => {
    manager.removeAllListeners();
  });

  // ----------------------------------------------------------------
  // Constructor
  // ----------------------------------------------------------------

  describe("constructor", () => {
    it("creates instance with provided database and llmManager", () => {
      expect(manager.database).toBe(mockDb);
      expect(manager.llmManager).toBe(mockLlm);
      expect(manager.activeRuns).toBeInstanceOf(Map);
      expect(manager.activeRuns.size).toBe(0);
      expect(manager.initialized).toBe(false);
    });

    it("creates instance with defaults when no options provided", () => {
      const m = new BenchmarkManager();
      expect(m.database).toBeNull();
      expect(m.llmManager).toBeNull();
    });
  });

  // ----------------------------------------------------------------
  // initialize()
  // ----------------------------------------------------------------

  describe("initialize()", () => {
    it("calls exec to create tables", async () => {
      await manager.initialize();
      expect(mockDb.exec).toHaveBeenCalledTimes(1);
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS benchmark_runs");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS benchmark_results");
      expect(manager.initialized).toBe(true);
    });

    it("accepts a database override parameter", async () => {
      const otherDb = createMockDb();
      await manager.initialize(otherDb);
      expect(manager.database).toBe(otherDb);
      expect(otherDb.exec).toHaveBeenCalledTimes(1);
    });

    it("handles missing database gracefully", async () => {
      const m = new BenchmarkManager();
      await m.initialize();
      expect(m.initialized).toBe(true);
    });

    it("throws if exec fails", async () => {
      mockDb.exec.mockImplementation(() => {
        throw new Error("SQL error");
      });
      await expect(manager.initialize()).rejects.toThrow("SQL error");
    });
  });

  // ----------------------------------------------------------------
  // runBenchmark()
  // ----------------------------------------------------------------

  describe("runBenchmark()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("runs benchmark against latency-basic suite and returns summary", async () => {
      const result = await manager.runBenchmark("latency-basic", {
        provider: "ollama",
        model: "qwen2:7b",
      });

      expect(result).toBeDefined();
      expect(result.suiteId).toBe("latency-basic");
      expect(result.model).toBe("qwen2:7b");
      expect(result.provider).toBe("ollama");
      expect(result.status).toBe("completed");
      // latency-basic has 10 prompts * 3 iterations = 30 total
      expect(result.totalPrompts).toBe(30);
      expect(result.completedPrompts).toBe(30);
      expect(result.summary).toBeDefined();
    });

    it("calls llmManager.chatWithMessages for each prompt/iteration", async () => {
      await manager.runBenchmark("reasoning", {
        provider: "openai",
        model: "gpt-4",
      });

      // reasoning suite has 5 prompts * 1 iteration = 5 calls
      expect(mockLlm.chatWithMessages).toHaveBeenCalledTimes(5);
    });

    it("stores run and result records in database", async () => {
      await manager.runBenchmark("reasoning", {
        provider: "openai",
        model: "gpt-4",
      });

      // Should have called prepare multiple times:
      // 1 INSERT run + 1 UPDATE status + (5 results * (INSERT + UPDATE progress)) + 1 final UPDATE
      expect(mockDb.prepare).toHaveBeenCalled();
      const prepareCalls = mockDb.prepare.mock.calls.map((c) => c[0]);
      const insertRunCalls = prepareCalls.filter((s) => s.includes("INSERT INTO benchmark_runs"));
      const insertResultCalls = prepareCalls.filter((s) => s.includes("INSERT INTO benchmark_results"));
      expect(insertRunCalls.length).toBeGreaterThanOrEqual(1);
      expect(insertResultCalls.length).toBe(5);
    });

    it("emits benchmark:progress events", async () => {
      const progressEvents = [];
      manager.on("benchmark:progress", (data) => progressEvents.push(data));

      await manager.runBenchmark("reasoning", {
        provider: "openai",
        model: "gpt-4",
      });

      expect(progressEvents.length).toBe(5);
      expect(progressEvents[0].completed).toBe(1);
      expect(progressEvents[0].total).toBe(5);
      expect(progressEvents[4].completed).toBe(5);
    });

    it("throws if suite does not exist", async () => {
      await expect(
        manager.runBenchmark("nonexistent", { provider: "a", model: "b" })
      ).rejects.toThrow("Benchmark suite not found: nonexistent");
    });

    it("throws if modelConfig is invalid", async () => {
      await expect(
        manager.runBenchmark("reasoning", { provider: "a" })
      ).rejects.toThrow("modelConfig must include provider and model");

      await expect(
        manager.runBenchmark("reasoning", null)
      ).rejects.toThrow("modelConfig must include provider and model");
    });

    it("handles LLM errors gracefully and continues", async () => {
      let callCount = 0;
      mockLlm.chatWithMessages.mockImplementation(async () => {
        callCount++;
        if (callCount === 2) {
          throw new Error("LLM timeout");
        }
        return { text: "ok", tokens: 5 };
      });

      const result = await manager.runBenchmark("reasoning", {
        provider: "openai",
        model: "gpt-4",
      });

      // All 5 prompts should still complete (one with error)
      expect(result.completedPrompts).toBe(5);
      expect(result.status).toBe("completed");
    });

    it("removes run from activeRuns after completion", async () => {
      expect(manager.activeRuns.size).toBe(0);
      const promise = manager.runBenchmark("reasoning", {
        provider: "a",
        model: "b",
      });
      // During execution, there should be an active run
      expect(manager.activeRuns.size).toBe(1);
      await promise;
      expect(manager.activeRuns.size).toBe(0);
    });
  });

  // ----------------------------------------------------------------
  // getResults()
  // ----------------------------------------------------------------

  describe("getResults()", () => {
    it("returns parsed results from database", () => {
      const mockRows = [
        {
          id: "r1",
          run_id: "run1",
          prompt_index: 0,
          input_text: "test",
          output_text: "response",
          expected_text: "expected",
          metrics: JSON.stringify({ latency_ms: 100, bleu: 0.85 }),
          iteration: 1,
          latency_ms: 100,
          tokens_used: 10,
          created_at: 1000,
        },
      ];

      mockDb.prepare.mockReturnValueOnce({
        all: vi.fn(() => mockRows),
      });

      const results = manager.getResults("run1");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("r1");
      expect(results[0].runId).toBe("run1");
      expect(results[0].metrics.bleu).toBe(0.85);
      expect(results[0].latencyMs).toBe(100);
    });

    it("returns empty array when no database", () => {
      manager.database = null;
      expect(manager.getResults("any")).toEqual([]);
    });

    it("handles null metrics gracefully", () => {
      mockDb.prepare.mockReturnValueOnce({
        all: vi.fn(() => [
          {
            id: "r1",
            run_id: "run1",
            prompt_index: 0,
            input_text: "test",
            output_text: null,
            expected_text: null,
            metrics: null,
            iteration: 1,
            latency_ms: 0,
            tokens_used: 0,
            created_at: 1000,
          },
        ]),
      });

      const results = manager.getResults("run1");
      expect(results[0].metrics).toEqual({});
    });
  });

  // ----------------------------------------------------------------
  // getRunStatus()
  // ----------------------------------------------------------------

  describe("getRunStatus()", () => {
    it("returns status object for existing run", () => {
      mockDb.prepare.mockReturnValueOnce({
        get: vi.fn(() => ({
          id: "run1",
          suite_id: "reasoning",
          model_provider: "openai",
          model_name: "gpt-4",
          status: "completed",
          total_prompts: 5,
          completed_prompts: 5,
          started_at: 1000,
          completed_at: 2000,
          created_at: 900,
        })),
      });

      const status = manager.getRunStatus("run1");
      expect(status).toBeDefined();
      expect(status.id).toBe("run1");
      expect(status.status).toBe("completed");
      expect(status.progress).toBe(1);
      expect(status.isActive).toBe(false);
    });

    it("returns null for non-existent run", () => {
      mockDb.prepare.mockReturnValueOnce({
        get: vi.fn(() => null),
      });

      expect(manager.getRunStatus("nonexistent")).toBeNull();
    });

    it("returns null when no database", () => {
      manager.database = null;
      expect(manager.getRunStatus("any")).toBeNull();
    });
  });

  // ----------------------------------------------------------------
  // listRuns()
  // ----------------------------------------------------------------

  describe("listRuns()", () => {
    it("returns paginated run list", () => {
      const countStmt = { get: vi.fn(() => ({ total: 2 })) };
      const listStmt = {
        all: vi.fn(() => [
          {
            id: "run1",
            suite_id: "reasoning",
            model_provider: "openai",
            model_name: "gpt-4",
            status: "completed",
            total_prompts: 5,
            completed_prompts: 5,
            summary: JSON.stringify({ latency: { mean: 100 } }),
            started_at: 1000,
            completed_at: 2000,
            created_at: 900,
          },
          {
            id: "run2",
            suite_id: "latency-basic",
            model_provider: "ollama",
            model_name: "qwen2:7b",
            status: "running",
            total_prompts: 30,
            completed_prompts: 10,
            summary: null,
            started_at: 3000,
            completed_at: null,
            created_at: 2900,
          },
        ]),
      };

      mockDb.prepare
        .mockReturnValueOnce(countStmt)
        .mockReturnValueOnce(listStmt);

      const result = manager.listRuns({ limit: 10, offset: 0 });
      expect(result.total).toBe(2);
      expect(result.runs).toHaveLength(2);
      expect(result.runs[0].id).toBe("run1");
      expect(result.runs[0].summary).toEqual({ latency: { mean: 100 } });
      expect(result.runs[1].summary).toBeNull();
    });

    it("returns empty result when no database", () => {
      manager.database = null;
      const result = manager.listRuns();
      expect(result).toEqual({ runs: [], total: 0 });
    });

    it("applies filters for suiteId, status, and modelName", () => {
      const countStmt = { get: vi.fn(() => ({ total: 0 })) };
      const listStmt = { all: vi.fn(() => []) };
      mockDb.prepare
        .mockReturnValueOnce(countStmt)
        .mockReturnValueOnce(listStmt);

      manager.listRuns({ suiteId: "reasoning", status: "completed", modelName: "gpt-4" });

      const countSql = mockDb.prepare.mock.calls[0][0];
      expect(countSql).toContain("suite_id = ?");
      expect(countSql).toContain("status = ?");
      expect(countSql).toContain("model_name = ?");
    });

    it("uses default limit and offset", () => {
      const countStmt = { get: vi.fn(() => ({ total: 0 })) };
      const listStmt = { all: vi.fn(() => []) };
      mockDb.prepare
        .mockReturnValueOnce(countStmt)
        .mockReturnValueOnce(listStmt);

      manager.listRuns();

      // The list query should pass limit=20 and offset=0
      expect(listStmt.all).toHaveBeenCalledWith(20, 0);
    });
  });

  // ----------------------------------------------------------------
  // cancelRun()
  // ----------------------------------------------------------------

  describe("cancelRun()", () => {
    it("returns true and sets cancelled flag for active run", () => {
      manager.activeRuns.set("run1", { cancelled: false });
      const result = manager.cancelRun("run1");
      expect(result).toBe(true);
      expect(manager.activeRuns.get("run1").cancelled).toBe(true);
    });

    it("returns false for non-active run", () => {
      const result = manager.cancelRun("nonexistent");
      expect(result).toBe(false);
    });

    it("cancellation is respected during runBenchmark", async () => {
      await manager.initialize();

      let callCount = 0;
      mockLlm.chatWithMessages.mockImplementation(async () => {
        callCount++;
        if (callCount === 2) {
          // Cancel after 2nd prompt
          for (const [, state] of manager.activeRuns) {
            state.cancelled = true;
          }
        }
        return { text: "ok", tokens: 5 };
      });

      const result = await manager.runBenchmark("reasoning", {
        provider: "openai",
        model: "gpt-4",
      });

      expect(result.status).toBe("cancelled");
      // Should have completed fewer than total prompts
      expect(result.completedPrompts).toBeLessThan(5);
    });
  });

  // ----------------------------------------------------------------
  // deleteRun()
  // ----------------------------------------------------------------

  describe("deleteRun()", () => {
    it("deletes results and run from database", () => {
      const deleteResultsStmt = { run: vi.fn(() => ({ changes: 3 })) };
      const deleteRunStmt = { run: vi.fn(() => ({ changes: 1 })) };
      mockDb.prepare
        .mockReturnValueOnce(deleteResultsStmt)
        .mockReturnValueOnce(deleteRunStmt);

      const result = manager.deleteRun("run1");
      expect(result).toBe(true);
      expect(deleteResultsStmt.run).toHaveBeenCalledWith("run1");
      expect(deleteRunStmt.run).toHaveBeenCalledWith("run1");
    });

    it("returns false when run does not exist", () => {
      const deleteResultsStmt = { run: vi.fn(() => ({ changes: 0 })) };
      const deleteRunStmt = { run: vi.fn(() => ({ changes: 0 })) };
      mockDb.prepare
        .mockReturnValueOnce(deleteResultsStmt)
        .mockReturnValueOnce(deleteRunStmt);

      const result = manager.deleteRun("nonexistent");
      expect(result).toBe(false);
    });

    it("returns false when no database", () => {
      manager.database = null;
      expect(manager.deleteRun("any")).toBe(false);
    });

    it("throws when trying to delete active run", () => {
      manager.activeRuns.set("run1", { cancelled: false });
      expect(() => manager.deleteRun("run1")).toThrow(
        "Cannot delete an active benchmark run"
      );
    });
  });

  // ----------------------------------------------------------------
  // getReport()
  // ----------------------------------------------------------------

  describe("getReport()", () => {
    it("returns null for non-existent run", () => {
      mockDb.prepare.mockReturnValueOnce({
        get: vi.fn(() => null),
      });

      expect(manager.getReport("nonexistent")).toBeNull();
    });

    it("returns null when no database", () => {
      manager.database = null;
      expect(manager.getReport("any")).toBeNull();
    });

    it("generates full report with metrics", () => {
      const runRow = {
        id: "run1",
        suite_id: "reasoning",
        model_provider: "openai",
        model_name: "gpt-4",
        status: "completed",
        total_prompts: 5,
        completed_prompts: 5,
        config: JSON.stringify({ provider: "openai", model: "gpt-4" }),
        summary: JSON.stringify({ totalTimeMs: 1000 }),
        started_at: 1000,
        completed_at: 2000,
        created_at: 900,
      };

      const resultRows = [
        {
          id: "r1",
          run_id: "run1",
          prompt_index: 0,
          input_text: "test1",
          output_text: "response1",
          expected_text: "$0.05",
          metrics: JSON.stringify({ latency_ms: 200, bleu: 0.5, rougeL: 0.6 }),
          iteration: 1,
          latency_ms: 200,
          tokens_used: 10,
          created_at: 1100,
        },
        {
          id: "r2",
          run_id: "run1",
          prompt_index: 1,
          input_text: "test2",
          output_text: "response2",
          expected_text: null,
          metrics: JSON.stringify({ latency_ms: 300 }),
          iteration: 1,
          latency_ms: 300,
          tokens_used: 15,
          created_at: 1200,
        },
      ];

      // getReport calls prepare for: run query, results query
      mockDb.prepare
        .mockReturnValueOnce({ get: vi.fn(() => runRow) })
        .mockReturnValueOnce({ all: vi.fn(() => resultRows) });

      const report = manager.getReport("run1");
      expect(report).toBeDefined();
      expect(report.runId).toBe("run1");
      expect(report.modelName).toBe("gpt-4");
      expect(report.metrics).toBeDefined();
      expect(report.metrics.latency).toBeDefined();
      expect(report.metrics.latency.min).toBe(200);
      expect(report.metrics.latency.max).toBe(300);
      expect(report.metrics.totalTokens).toBe(25);
      expect(report.metrics.avgBleu).toBe(0.5);
      expect(report.metrics.overallScore).toBeGreaterThan(0);
      expect(report.results).toHaveLength(2);
    });
  });

  // ----------------------------------------------------------------
  // runComparison()
  // ----------------------------------------------------------------

  describe("runComparison()", () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it("throws if fewer than 2 model configs", async () => {
      await expect(
        manager.runComparison("reasoning", [{ provider: "a", model: "b" }])
      ).rejects.toThrow("at least 2 model configurations");
    });

    it("throws if suite not found", async () => {
      await expect(
        manager.runComparison("nonexistent", [
          { provider: "a", model: "b" },
          { provider: "c", model: "d" },
        ])
      ).rejects.toThrow("Benchmark suite not found");
    });

    it("runs benchmark for each model config and returns comparison", async () => {
      const result = await manager.runComparison("reasoning", [
        { provider: "openai", model: "gpt-4" },
        { provider: "ollama", model: "qwen2:7b" },
      ]);

      expect(result.suiteId).toBe("reasoning");
      expect(result.suiteName).toBe("Reasoning Ability");
      expect(result.comparedModels).toEqual(["openai/gpt-4", "ollama/qwen2:7b"]);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].status).toBe("completed");
      expect(result.results[1].status).toBe("completed");
      // 5 prompts per model * 2 models = 10 calls
      expect(mockLlm.chatWithMessages).toHaveBeenCalledTimes(10);
    });

    it("handles individual model failures in comparison", async () => {
      let callCount = 0;
      mockLlm.chatWithMessages.mockImplementation(async () => {
        callCount++;
        if (callCount > 5) {
          throw new Error("Model unavailable");
        }
        return { text: "ok", tokens: 5 };
      });

      // The second model will fail on all prompts (errors are caught per-prompt though)
      const result = await manager.runComparison("reasoning", [
        { provider: "openai", model: "gpt-4" },
        { provider: "offline", model: "broken" },
      ]);

      expect(result.results).toHaveLength(2);
      // First should succeed, second should still complete (with error results)
      expect(result.results[0].status).toBe("completed");
      expect(result.results[1].status).toBe("completed");
    });
  });

  // ----------------------------------------------------------------
  // RUN_STATUS constants
  // ----------------------------------------------------------------

  describe("RUN_STATUS", () => {
    it("exports all expected status values", () => {
      expect(RUN_STATUS.PENDING).toBe("pending");
      expect(RUN_STATUS.RUNNING).toBe("running");
      expect(RUN_STATUS.COMPLETED).toBe("completed");
      expect(RUN_STATUS.FAILED).toBe("failed");
      expect(RUN_STATUS.CANCELLED).toBe("cancelled");
    });
  });
});
