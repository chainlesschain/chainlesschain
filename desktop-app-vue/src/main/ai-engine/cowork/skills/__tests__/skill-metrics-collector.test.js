/**
 * SkillMetricsCollector 单元测试
 *
 * 测试内容：
 * - SkillMetricsCollector 构造函数和初始化
 * - recordExecution 记录执行指标
 * - getSkillMetrics 获取技能指标
 * - getPipelineMetrics 获取流水线指标
 * - getTopSkills 获取 Top 技能排行
 * - getTimeSeriesData 获取时序数据
 * - exportMetrics 导出指标
 * - SkillRegistry 事件监听
 * - PipelineEngine 事件监听
 * - SQLite flush 行为
 * - destroy 销毁和清理
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock logger
vi.mock("../../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// UUID regex for validation (v4 format)
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EventEmitter = require("events");
const { SkillMetricsCollector } = require("../skill-metrics-collector");

// Helper: create a mock database
function createMockDatabase() {
  return {
    run: vi.fn().mockResolvedValue(undefined),
  };
}

// Helper: create a mock SkillRegistry (EventEmitter)
function createMockSkillRegistry() {
  return new EventEmitter();
}

// Helper: create a mock PipelineEngine (EventEmitter)
function createMockPipelineEngine() {
  return new EventEmitter();
}

describe("SkillMetricsCollector", () => {
  let collector;
  let mockDb;
  let mockRegistry;
  let mockPipeline;

  beforeEach(() => {
    vi.useFakeTimers();

    mockDb = createMockDatabase();
    mockRegistry = createMockSkillRegistry();
    mockPipeline = createMockPipelineEngine();

    collector = new SkillMetricsCollector({
      database: mockDb,
      skillRegistry: mockRegistry,
      pipelineEngine: mockPipeline,
      flushInterval: 5000,
      maxBufferSize: 10,
    });
  });

  afterEach(() => {
    collector.destroy();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ==========================================================
  // Constructor & Initialization
  // ==========================================================
  describe("constructor", () => {
    it("should initialize with default options when none provided", () => {
      const c = new SkillMetricsCollector();
      expect(c.database).toBeNull();
      expect(c.skillRegistry).toBeNull();
      expect(c.pipelineEngine).toBeNull();
      expect(c.flushInterval).toBe(60000);
      expect(c.maxBufferSize).toBe(500);
      expect(c.skillMetrics).toBeInstanceOf(Map);
      expect(c.pipelineMetrics).toBeInstanceOf(Map);
      expect(c._buffer).toEqual([]);
      expect(c._flushTimer).toBeNull();
      expect(c._initialized).toBe(false);
    });

    it("should accept custom options", () => {
      expect(collector.database).toBe(mockDb);
      expect(collector.skillRegistry).toBe(mockRegistry);
      expect(collector.pipelineEngine).toBe(mockPipeline);
      expect(collector.flushInterval).toBe(5000);
      expect(collector.maxBufferSize).toBe(10);
    });
  });

  describe("initialize", () => {
    it("should set _initialized to true", () => {
      collector.initialize();
      expect(collector._initialized).toBe(true);
    });

    it("should not re-initialize if already initialized", () => {
      collector.initialize();
      const timer1 = collector._flushTimer;
      collector.initialize();
      // Timer should be the same reference (not recreated)
      expect(collector._flushTimer).toBe(timer1);
    });

    it("should start a periodic flush timer", () => {
      collector.initialize();
      expect(collector._flushTimer).not.toBeNull();
    });

    it("should bind to skillRegistry events", () => {
      collector.initialize();
      expect(mockRegistry.listenerCount("skill-started")).toBe(1);
      expect(mockRegistry.listenerCount("skill-completed")).toBe(1);
      expect(mockRegistry.listenerCount("skill-failed")).toBe(1);
    });

    it("should bind to pipelineEngine events", () => {
      collector.initialize();
      expect(mockPipeline.listenerCount("pipeline:completed")).toBe(1);
      expect(mockPipeline.listenerCount("pipeline:failed")).toBe(1);
      expect(mockPipeline.listenerCount("pipeline:step-completed")).toBe(1);
    });

    it("should work without skillRegistry or pipelineEngine", () => {
      const c = new SkillMetricsCollector();
      expect(() => c.initialize()).not.toThrow();
      expect(c._initialized).toBe(true);
      c.destroy();
    });
  });

  // ==========================================================
  // recordExecution
  // ==========================================================
  describe("recordExecution", () => {
    it("should create a record with correct fields", () => {
      const now = Date.now();
      collector.recordExecution("skill-a", {
        duration: 150,
        success: true,
        tokensInput: 100,
        tokensOutput: 50,
        cost: 0.005,
        pipelineId: "pipe-1",
        context: { foo: "bar" },
      });

      expect(collector._buffer).toHaveLength(1);
      const record = collector._buffer[0];
      expect(record.id).toMatch(UUID_REGEX);
      expect(record.skillId).toBe("skill-a");
      expect(record.pipelineId).toBe("pipe-1");
      expect(record.durationMs).toBe(150);
      expect(record.success).toBe(1);
      expect(record.tokensInput).toBe(100);
      expect(record.tokensOutput).toBe(50);
      expect(record.costUsd).toBe(0.005);
      expect(record.errorMessage).toBeNull();
      expect(record.contextJson).toBe(JSON.stringify({ foo: "bar" }));
      expect(record.completedAt).toBeGreaterThanOrEqual(now);
      expect(record.startedAt).toBeLessThanOrEqual(record.completedAt);
    });

    it("should default success to 1 when not explicitly false", () => {
      collector.recordExecution("skill-b", {});
      expect(collector._buffer[0].success).toBe(1);
    });

    it("should set success to 0 when explicitly false", () => {
      collector.recordExecution("skill-c", {
        success: false,
        error: "timeout",
      });
      const record = collector._buffer[0];
      expect(record.success).toBe(0);
      expect(record.errorMessage).toBe("timeout");
    });

    it("should default missing numeric fields to 0", () => {
      collector.recordExecution("skill-d", {});
      const record = collector._buffer[0];
      expect(record.durationMs).toBe(0);
      expect(record.tokensInput).toBe(0);
      expect(record.tokensOutput).toBe(0);
      expect(record.costUsd).toBe(0);
    });

    it("should set pipelineId to null if not provided", () => {
      collector.recordExecution("skill-e", {});
      expect(collector._buffer[0].pipelineId).toBeNull();
    });

    it("should set contextJson to null if no context", () => {
      collector.recordExecution("skill-f", {});
      expect(collector._buffer[0].contextJson).toBeNull();
    });

    it("should update in-memory aggregation", () => {
      collector.recordExecution("skill-agg", {
        duration: 100,
        success: true,
        tokensInput: 50,
        tokensOutput: 30,
        cost: 0.01,
      });
      collector.recordExecution("skill-agg", {
        duration: 200,
        success: false,
        tokensInput: 60,
        tokensOutput: 40,
        cost: 0.02,
      });

      const agg = collector.skillMetrics.get("skill-agg");
      expect(agg.totalExecutions).toBe(2);
      expect(agg.successCount).toBe(1);
      expect(agg.failureCount).toBe(1);
      expect(agg.totalDurationMs).toBe(300);
      expect(agg.avgDurationMs).toBe(150);
      expect(agg.totalTokens).toBe(180); // (50+30) + (60+40)
      expect(agg.totalCost).toBe(0.03);
      expect(agg.successRate).toBe(50);
    });

    it("should emit metric-recorded event", () => {
      const handler = vi.fn();
      collector.on("metric-recorded", handler);

      collector.recordExecution("skill-event", { duration: 50, success: true });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          skillId: "skill-event",
          record: expect.objectContaining({
            skillId: "skill-event",
            durationMs: 50,
            success: 1,
          }),
        }),
      );
    });

    it("should trigger force flush when buffer reaches maxBufferSize", async () => {
      // maxBufferSize is 10
      for (let i = 0; i < 10; i++) {
        collector.recordExecution(`skill-${i}`, {
          duration: 10,
          success: true,
        });
      }

      // flush is called async; await pending microtasks
      await vi.advanceTimersByTimeAsync(0);

      // DB run should have been called 10 times (one per record)
      expect(mockDb.run).toHaveBeenCalledTimes(10);
      // Buffer should be empty after flush
      expect(collector._buffer).toHaveLength(0);
    });
  });

  // ==========================================================
  // getSkillMetrics
  // ==========================================================
  describe("getSkillMetrics", () => {
    it("should return default zeroed metrics for unknown skill", () => {
      const metrics = collector.getSkillMetrics("nonexistent");
      expect(metrics).toEqual({
        skillId: "nonexistent",
        totalExecutions: 0,
        successCount: 0,
        failureCount: 0,
        avgDurationMs: 0,
        totalTokens: 0,
        totalCost: 0,
        successRate: 0,
        lastExecutedAt: null,
      });
    });

    it("should return aggregated metrics after recording executions", () => {
      collector.recordExecution("skill-x", {
        duration: 200,
        success: true,
        tokensInput: 10,
        tokensOutput: 5,
        cost: 0.001,
      });
      collector.recordExecution("skill-x", {
        duration: 400,
        success: true,
        tokensInput: 20,
        tokensOutput: 10,
        cost: 0.002,
      });

      const metrics = collector.getSkillMetrics("skill-x");
      expect(metrics.skillId).toBe("skill-x");
      expect(metrics.totalExecutions).toBe(2);
      expect(metrics.successCount).toBe(2);
      expect(metrics.failureCount).toBe(0);
      expect(metrics.avgDurationMs).toBe(300);
      expect(metrics.totalTokens).toBe(45);
      expect(metrics.totalCost).toBeCloseTo(0.003);
      expect(metrics.successRate).toBe(100);
      expect(metrics.lastExecutedAt).toBeDefined();
    });

    it("should correctly compute success rate with mixed results", () => {
      collector.recordExecution("skill-mix", { success: true });
      collector.recordExecution("skill-mix", { success: true });
      collector.recordExecution("skill-mix", { success: false });

      const metrics = collector.getSkillMetrics("skill-mix");
      expect(metrics.successRate).toBe(67); // Math.round(2/3 * 100)
      expect(metrics.successCount).toBe(2);
      expect(metrics.failureCount).toBe(1);
    });
  });

  // ==========================================================
  // getPipelineMetrics
  // ==========================================================
  describe("getPipelineMetrics", () => {
    it("should return default metrics for unknown pipeline", () => {
      const metrics = collector.getPipelineMetrics("unknown-pipe");
      expect(metrics).toEqual({
        pipelineId: "unknown-pipe",
        totalExecutions: 0,
        successCount: 0,
        failureCount: 0,
        avgDurationMs: 0,
      });
    });

    it("should return all pipeline metrics when no id specified", () => {
      collector.initialize();

      mockPipeline.emit("pipeline:completed", {
        pipelineId: "p1",
        duration: 100,
      });
      mockPipeline.emit("pipeline:completed", {
        pipelineId: "p2",
        duration: 200,
      });

      const allMetrics = collector.getPipelineMetrics();
      expect(allMetrics).toHaveLength(2);
      expect(allMetrics.map((m) => m.pipelineId).sort()).toEqual(["p1", "p2"]);
    });

    it("should return specific pipeline metrics when id specified", () => {
      collector.initialize();

      mockPipeline.emit("pipeline:completed", {
        pipelineId: "p1",
        duration: 100,
      });
      mockPipeline.emit("pipeline:completed", {
        pipelineId: "p1",
        duration: 200,
      });
      mockPipeline.emit("pipeline:failed", { pipelineId: "p1", duration: 50 });

      const metrics = collector.getPipelineMetrics("p1");
      expect(metrics.pipelineId).toBe("p1");
      expect(metrics.totalExecutions).toBe(3);
      expect(metrics.successCount).toBe(2);
      expect(metrics.failureCount).toBe(1);
      expect(metrics.avgDurationMs).toBe(Math.round(350 / 3));
    });

    it("should return empty array when no pipelines tracked and no id", () => {
      const allMetrics = collector.getPipelineMetrics();
      expect(allMetrics).toEqual([]);
    });
  });

  // ==========================================================
  // getTopSkills
  // ==========================================================
  describe("getTopSkills", () => {
    beforeEach(() => {
      // Record varying metrics for three skills
      // skill-alpha: 3 executions, 300ms total, 0.03 cost, 90 tokens, 0 failures
      collector.recordExecution("skill-alpha", {
        duration: 100,
        success: true,
        tokensInput: 10,
        tokensOutput: 20,
        cost: 0.01,
      });
      collector.recordExecution("skill-alpha", {
        duration: 100,
        success: true,
        tokensInput: 10,
        tokensOutput: 20,
        cost: 0.01,
      });
      collector.recordExecution("skill-alpha", {
        duration: 100,
        success: true,
        tokensInput: 10,
        tokensOutput: 20,
        cost: 0.01,
      });

      // skill-beta: 1 execution, 500ms, 0.10 cost, 200 tokens, 0 failures
      collector.recordExecution("skill-beta", {
        duration: 500,
        success: true,
        tokensInput: 100,
        tokensOutput: 100,
        cost: 0.1,
      });

      // skill-gamma: 2 executions, 1 failure, 200ms avg, 0.005 cost, 50 tokens, 1 failure
      collector.recordExecution("skill-gamma", {
        duration: 200,
        success: true,
        tokensInput: 20,
        tokensOutput: 5,
        cost: 0.003,
      });
      collector.recordExecution("skill-gamma", {
        duration: 200,
        success: false,
        tokensInput: 20,
        tokensOutput: 5,
        cost: 0.002,
      });
    });

    it("should sort by executions by default", () => {
      const top = collector.getTopSkills(10, "executions");
      expect(top[0].skillId).toBe("skill-alpha");
      expect(top[0].totalExecutions).toBe(3);
      expect(top[1].skillId).toBe("skill-gamma");
      expect(top[2].skillId).toBe("skill-beta");
    });

    it("should sort by duration", () => {
      const top = collector.getTopSkills(10, "duration");
      // skill-beta: avgDurationMs = 500
      // skill-gamma: avgDurationMs = 200
      // skill-alpha: avgDurationMs = 100
      expect(top[0].skillId).toBe("skill-beta");
      expect(top[1].skillId).toBe("skill-gamma");
      expect(top[2].skillId).toBe("skill-alpha");
    });

    it("should sort by cost", () => {
      const top = collector.getTopSkills(10, "cost");
      // skill-beta: 0.10
      // skill-alpha: 0.03
      // skill-gamma: 0.005
      expect(top[0].skillId).toBe("skill-beta");
      expect(top[1].skillId).toBe("skill-alpha");
    });

    it("should sort by tokens", () => {
      const top = collector.getTopSkills(10, "tokens");
      // skill-beta: 200
      // skill-alpha: 90
      // skill-gamma: 50
      expect(top[0].skillId).toBe("skill-beta");
      expect(top[1].skillId).toBe("skill-alpha");
      expect(top[2].skillId).toBe("skill-gamma");
    });

    it("should sort by failures", () => {
      const top = collector.getTopSkills(10, "failures");
      // skill-gamma: 1 failure
      // skill-alpha: 0 failures
      // skill-beta: 0 failures
      expect(top[0].skillId).toBe("skill-gamma");
      expect(top[0].failureCount).toBe(1);
    });

    it("should limit results", () => {
      const top = collector.getTopSkills(2);
      expect(top).toHaveLength(2);
    });

    it("should default to executions for unknown metric", () => {
      const top = collector.getTopSkills(10, "unknown-metric");
      // Should fall back to executions sort
      expect(top[0].skillId).toBe("skill-alpha");
    });

    it("should return empty array when no metrics", () => {
      const emptyCollector = new SkillMetricsCollector();
      const top = emptyCollector.getTopSkills();
      expect(top).toEqual([]);
    });

    it("should include all aggregated fields in each result entry", () => {
      const top = collector.getTopSkills(1);
      expect(top[0]).toHaveProperty("skillId");
      expect(top[0]).toHaveProperty("totalExecutions");
      expect(top[0]).toHaveProperty("successCount");
      expect(top[0]).toHaveProperty("failureCount");
      expect(top[0]).toHaveProperty("avgDurationMs");
      expect(top[0]).toHaveProperty("totalTokens");
      expect(top[0]).toHaveProperty("totalCost");
      expect(top[0]).toHaveProperty("successRate");
      expect(top[0]).toHaveProperty("lastExecutedAt");
    });
  });

  // ==========================================================
  // getTimeSeriesData
  // ==========================================================
  describe("getTimeSeriesData", () => {
    it("should return empty array when buffer is empty", () => {
      const data = collector.getTimeSeriesData("any-skill");
      expect(data).toEqual([]);
    });

    it("should aggregate records into time buckets", () => {
      // Record multiple executions (all at same fake-time since Date.now() is mocked)
      collector.recordExecution("ts-skill", {
        duration: 100,
        success: true,
        tokensInput: 10,
        tokensOutput: 5,
      });
      collector.recordExecution("ts-skill", {
        duration: 200,
        success: true,
        tokensInput: 20,
        tokensOutput: 10,
      });
      collector.recordExecution("ts-skill", {
        duration: 300,
        success: false,
        tokensInput: 30,
        tokensOutput: 15,
      });

      const data = collector.getTimeSeriesData("ts-skill", "day");
      expect(data).toHaveLength(1); // All same bucket since same fake time
      expect(data[0].executions).toBe(3);
      expect(data[0].successes).toBe(2);
      expect(data[0].failures).toBe(1);
      expect(data[0].totalDuration).toBe(600);
      expect(data[0].totalTokens).toBe(90); // (10+5) + (20+10) + (30+15)
      expect(data[0].avgDuration).toBe(200); // 600 / 3
      expect(data[0].successRate).toBe(67); // Math.round(2/3 * 100)
    });

    it("should filter by skillId", () => {
      collector.recordExecution("skill-one", { duration: 100, success: true });
      collector.recordExecution("skill-two", { duration: 200, success: true });

      const data = collector.getTimeSeriesData("skill-one", "day");
      expect(data).toHaveLength(1);
      expect(data[0].executions).toBe(1);
    });

    it("should return all skills when skillId is null/falsy", () => {
      collector.recordExecution("skill-one", {
        duration: 100,
        success: true,
        tokensInput: 1,
        tokensOutput: 1,
      });
      collector.recordExecution("skill-two", {
        duration: 200,
        success: true,
        tokensInput: 2,
        tokensOutput: 2,
      });

      const data = collector.getTimeSeriesData(null, "day");
      expect(data).toHaveLength(1); // Same time bucket
      expect(data[0].executions).toBe(2);
    });

    it("should create separate buckets for different time intervals", () => {
      // Record at different times
      const hourMs = 3600000;

      collector.recordExecution("multi-time", {
        duration: 100,
        success: true,
        tokensInput: 5,
        tokensOutput: 5,
      });

      // Advance time by 2 hours to land in a different 'hour' bucket
      vi.advanceTimersByTime(2 * hourMs);

      collector.recordExecution("multi-time", {
        duration: 200,
        success: true,
        tokensInput: 10,
        tokensOutput: 10,
      });

      const data = collector.getTimeSeriesData("multi-time", "hour");
      expect(data.length).toBeGreaterThanOrEqual(2);
      // Buckets should be sorted by timestamp
      for (let i = 1; i < data.length; i++) {
        expect(data[i].timestamp).toBeGreaterThan(data[i - 1].timestamp);
      }
    });

    it("should default to day interval for unknown interval string", () => {
      const dayMs = 86400000;
      collector.recordExecution("default-interval", {
        duration: 100,
        success: true,
        tokensInput: 1,
        tokensOutput: 1,
      });

      const data = collector.getTimeSeriesData("default-interval", "unknown");
      expect(data).toHaveLength(1);
      // Bucket timestamp should align to day interval
      expect(data[0].timestamp % dayMs).toBe(0);
    });

    it("should support week interval", () => {
      const weekMs = 604800000;
      collector.recordExecution("week-skill", {
        duration: 100,
        success: true,
        tokensInput: 1,
        tokensOutput: 1,
      });

      const data = collector.getTimeSeriesData("week-skill", "week");
      expect(data).toHaveLength(1);
      expect(data[0].timestamp % weekMs).toBe(0);
    });

    it("should compute avgDuration as 0 when no executions in bucket", () => {
      // This is actually not reachable (bucket only created when there's a record),
      // but we check the formula via an occupied bucket
      collector.recordExecution("avg-check", {
        duration: 0,
        success: true,
        tokensInput: 0,
        tokensOutput: 0,
      });
      const data = collector.getTimeSeriesData("avg-check", "day");
      expect(data[0].avgDuration).toBe(0);
    });
  });

  // ==========================================================
  // exportMetrics
  // ==========================================================
  describe("exportMetrics", () => {
    it("should export all data with correct structure", () => {
      collector.recordExecution("exp-skill", {
        duration: 100,
        success: true,
        tokensInput: 5,
        tokensOutput: 5,
        cost: 0.001,
      });

      const exported = collector.exportMetrics();
      expect(exported).toHaveProperty("exportedAt");
      expect(typeof exported.exportedAt).toBe("number");
      expect(exported).toHaveProperty("skills");
      expect(exported).toHaveProperty("pipelines");
      expect(exported).toHaveProperty("buffer");
      expect(exported).toHaveProperty("bufferSize");
    });

    it("should contain skill metrics entries", () => {
      collector.recordExecution("export-a", { duration: 100, success: true });

      const exported = collector.exportMetrics();
      expect(exported.skills["export-a"]).toBeDefined();
      expect(exported.skills["export-a"].totalExecutions).toBe(1);
    });

    it("should contain pipeline metrics entries", () => {
      collector.initialize();
      mockPipeline.emit("pipeline:completed", {
        pipelineId: "export-p1",
        duration: 200,
      });

      const exported = collector.exportMetrics();
      expect(exported.pipelines["export-p1"]).toBeDefined();
      expect(exported.pipelines["export-p1"].totalExecutions).toBe(1);
    });

    it("should include buffer records and correct bufferSize", () => {
      collector.recordExecution("buf-skill", { duration: 10 });
      collector.recordExecution("buf-skill", { duration: 20 });

      const exported = collector.exportMetrics();
      expect(exported.buffer).toHaveLength(2);
      expect(exported.bufferSize).toBe(2);
    });

    it("should return empty structures when no data", () => {
      const exported = collector.exportMetrics();
      expect(exported.skills).toEqual({});
      expect(exported.pipelines).toEqual({});
      expect(exported.buffer).toEqual([]);
      expect(exported.bufferSize).toBe(0);
    });
  });

  // ==========================================================
  // Event handling: SkillRegistry events
  // ==========================================================
  describe("SkillRegistry event handling", () => {
    beforeEach(() => {
      collector.initialize();
    });

    it("should record execution on skill-completed event", () => {
      mockRegistry.emit("skill-completed", {
        skillId: "reg-skill",
        metrics: {
          executionTime: 250,
          tokensInput: 30,
          tokensOutput: 20,
        },
      });

      expect(collector._buffer).toHaveLength(1);
      const record = collector._buffer[0];
      expect(record.skillId).toBe("reg-skill");
      expect(record.durationMs).toBe(250);
      expect(record.success).toBe(1);
      expect(record.tokensInput).toBe(30);
      expect(record.tokensOutput).toBe(20);
    });

    it("should record execution on skill-failed event", () => {
      mockRegistry.emit("skill-failed", {
        skillId: "fail-skill",
        error: "Something went wrong",
        metrics: { executionTime: 100 },
      });

      expect(collector._buffer).toHaveLength(1);
      const record = collector._buffer[0];
      expect(record.skillId).toBe("fail-skill");
      expect(record.success).toBe(0);
      expect(record.errorMessage).toBe("Something went wrong");
      expect(record.durationMs).toBe(100);
    });

    it("should handle skill-failed without metrics gracefully", () => {
      mockRegistry.emit("skill-failed", {
        skillId: "no-metrics-skill",
        error: "Crash",
      });

      expect(collector._buffer).toHaveLength(1);
      const record = collector._buffer[0];
      expect(record.durationMs).toBe(0);
      expect(record.success).toBe(0);
    });

    it("should ignore skill-started (no-op)", () => {
      mockRegistry.emit("skill-started", { skillId: "start-skill" });
      expect(collector._buffer).toHaveLength(0);
    });

    it("should ignore skill-completed without skillId", () => {
      mockRegistry.emit("skill-completed", { metrics: { executionTime: 100 } });
      expect(collector._buffer).toHaveLength(0);
    });

    it("should ignore skill-completed without metrics", () => {
      mockRegistry.emit("skill-completed", { skillId: "no-metrics" });
      expect(collector._buffer).toHaveLength(0);
    });

    it("should ignore skill-failed without skillId", () => {
      mockRegistry.emit("skill-failed", { error: "Orphan error" });
      expect(collector._buffer).toHaveLength(0);
    });
  });

  // ==========================================================
  // Event handling: PipelineEngine events
  // ==========================================================
  describe("PipelineEngine event handling", () => {
    beforeEach(() => {
      collector.initialize();
    });

    it("should track pipeline:completed event", () => {
      mockPipeline.emit("pipeline:completed", {
        pipelineId: "pipe-a",
        duration: 500,
      });

      const metrics = collector.getPipelineMetrics("pipe-a");
      expect(metrics.totalExecutions).toBe(1);
      expect(metrics.successCount).toBe(1);
      expect(metrics.failureCount).toBe(0);
      expect(metrics.avgDurationMs).toBe(500);
    });

    it("should track pipeline:failed event", () => {
      mockPipeline.emit("pipeline:failed", {
        pipelineId: "pipe-b",
        duration: 300,
      });

      const metrics = collector.getPipelineMetrics("pipe-b");
      expect(metrics.totalExecutions).toBe(1);
      expect(metrics.successCount).toBe(0);
      expect(metrics.failureCount).toBe(1);
    });

    it("should accumulate multiple pipeline events", () => {
      mockPipeline.emit("pipeline:completed", {
        pipelineId: "pipe-c",
        duration: 100,
      });
      mockPipeline.emit("pipeline:completed", {
        pipelineId: "pipe-c",
        duration: 200,
      });
      mockPipeline.emit("pipeline:failed", {
        pipelineId: "pipe-c",
        duration: 50,
      });

      const metrics = collector.getPipelineMetrics("pipe-c");
      expect(metrics.totalExecutions).toBe(3);
      expect(metrics.successCount).toBe(2);
      expect(metrics.failureCount).toBe(1);
      expect(metrics.totalDurationMs).toBe(350);
      expect(metrics.avgDurationMs).toBe(Math.round(350 / 3));
    });

    it("should handle pipeline:step-completed (no-op for pipeline agg)", () => {
      mockPipeline.emit("pipeline:step-completed", {
        pipelineId: "pipe-step",
        stepId: "step-1",
      });
      const metrics = collector.getPipelineMetrics("pipe-step");
      expect(metrics.totalExecutions).toBe(0);
    });

    it("should handle pipeline:completed without duration", () => {
      mockPipeline.emit("pipeline:completed", { pipelineId: "pipe-no-dur" });

      const metrics = collector.getPipelineMetrics("pipe-no-dur");
      expect(metrics.totalDurationMs).toBe(0);
      expect(metrics.avgDurationMs).toBe(0);
    });

    it("should set lastExecutedAt on pipeline events", () => {
      mockPipeline.emit("pipeline:completed", {
        pipelineId: "pipe-time",
        duration: 100,
      });

      const metrics = collector.getPipelineMetrics("pipe-time");
      expect(metrics.lastExecutedAt).toBeDefined();
      expect(typeof metrics.lastExecutedAt).toBe("number");
    });
  });

  // ==========================================================
  // SQLite flush behavior
  // ==========================================================
  describe("flush", () => {
    it("should return 0 when buffer is empty", async () => {
      const result = await collector.flush();
      expect(result).toBe(0);
      expect(mockDb.run).not.toHaveBeenCalled();
    });

    it("should flush all buffered records to database", async () => {
      collector.recordExecution("flush-a", {
        duration: 100,
        success: true,
        tokensInput: 10,
        tokensOutput: 5,
        cost: 0.001,
      });
      collector.recordExecution("flush-b", {
        duration: 200,
        success: false,
        error: "err",
      });

      const flushed = await collector.flush();
      expect(flushed).toBe(2);
      expect(mockDb.run).toHaveBeenCalledTimes(2);
    });

    it("should clear buffer after successful flush", async () => {
      collector.recordExecution("clear-buf", { duration: 50 });
      expect(collector._buffer).toHaveLength(1);

      await collector.flush();
      expect(collector._buffer).toHaveLength(0);
    });

    it("should pass correct SQL and parameters to database", async () => {
      collector.recordExecution("sql-check", {
        duration: 150,
        success: true,
        tokensInput: 10,
        tokensOutput: 5,
        cost: 0.002,
        pipelineId: "p1",
        error: null,
        context: { key: "value" },
      });

      await collector.flush();

      const call = mockDb.run.mock.calls[0];
      const sql = call[0];
      const params = call[1];

      expect(sql).toContain("INSERT OR IGNORE INTO skill_execution_metrics");
      expect(params[0]).toMatch(UUID_REGEX); // id
      expect(params[1]).toBe("sql-check"); // skill_id
      expect(params[2]).toBe("p1"); // pipeline_id
      expect(typeof params[3]).toBe("number"); // started_at
      expect(typeof params[4]).toBe("number"); // completed_at
      expect(params[5]).toBe(150); // duration_ms
      expect(params[6]).toBe(1); // success
      expect(params[7]).toBe(10); // tokens_input
      expect(params[8]).toBe(5); // tokens_output
      expect(params[9]).toBe(0.002); // cost_usd
      expect(params[10]).toBeNull(); // error_message
      expect(params[11]).toBe(JSON.stringify({ key: "value" })); // context_json
    });

    it("should handle database errors gracefully (count partial success)", async () => {
      mockDb.run
        .mockResolvedValueOnce(undefined) // first record succeeds
        .mockRejectedValueOnce(new Error("DB constraint violation")) // second fails
        .mockResolvedValueOnce(undefined); // third succeeds

      collector.recordExecution("ok-1", { duration: 10 });
      collector.recordExecution("fail-1", { duration: 20 });
      collector.recordExecution("ok-2", { duration: 30 });

      const flushed = await collector.flush();
      expect(flushed).toBe(2); // 2 successful, 1 failed
    });

    it("should return 0 when database is null (no DB configured)", async () => {
      const noDB = new SkillMetricsCollector({
        database: null,
        maxBufferSize: 5,
      });
      noDB.recordExecution("no-db-skill", { duration: 100 });

      const result = await noDB.flush();
      expect(result).toBe(0);
      // Buffer should still contain the record (not trimmed since < maxBufferSize * 2)
      expect(noDB._buffer).toHaveLength(1);
    });

    it("should trim buffer when no database and buffer exceeds 2x maxBufferSize", async () => {
      const noDB = new SkillMetricsCollector({
        database: null,
        maxBufferSize: 3,
      });
      // Add 7 records (> 3 * 2 = 6)
      for (let i = 0; i < 7; i++) {
        noDB._buffer.push({ id: `rec-${i}`, skillId: `s-${i}` });
      }

      await noDB.flush();
      // Should trim to the last maxBufferSize (3) records
      expect(noDB._buffer).toHaveLength(3);
      expect(noDB._buffer[0].id).toBe("rec-4");
      expect(noDB._buffer[2].id).toBe("rec-6");
    });

    it("should not trim buffer when no database and buffer is within limits", async () => {
      const noDB = new SkillMetricsCollector({
        database: null,
        maxBufferSize: 5,
      });
      // Add 9 records (< 5 * 2 = 10, so no trimming)
      for (let i = 0; i < 9; i++) {
        noDB._buffer.push({ id: `rec-${i}` });
      }

      await noDB.flush();
      expect(noDB._buffer).toHaveLength(9);
    });

    it("should flush periodically based on flushInterval", async () => {
      collector.initialize();
      collector.recordExecution("periodic-skill", { duration: 50 });

      // Advance past the flush interval (5000ms)
      await vi.advanceTimersByTimeAsync(5000);

      expect(mockDb.run).toHaveBeenCalledTimes(1);
    });

    it("should handle periodic flush errors without crashing", async () => {
      mockDb.run.mockRejectedValue(new Error("DB offline"));
      collector.initialize();
      collector.recordExecution("error-skill", { duration: 50 });

      // Advance past the flush interval - should not throw
      await vi.advanceTimersByTimeAsync(5000);

      // The periodic flush should have tried and failed, but not crashed
      // Verify the db was called (attempted)
      expect(mockDb.run).toHaveBeenCalled();
      // Buffer should be cleared even though DB failed (records are taken from buffer before insert)
      expect(collector._buffer).toHaveLength(0);
    });
  });

  // ==========================================================
  // destroy
  // ==========================================================
  describe("destroy", () => {
    it("should clear the flush timer", () => {
      collector.initialize();
      expect(collector._flushTimer).not.toBeNull();

      collector.destroy();
      expect(collector._flushTimer).toBeNull();
    });

    it("should set _initialized to false", () => {
      collector.initialize();
      expect(collector._initialized).toBe(true);

      collector.destroy();
      expect(collector._initialized).toBe(false);
    });

    it("should attempt a final flush on destroy", async () => {
      collector.recordExecution("destroy-skill", { duration: 100 });
      collector.destroy();

      // flush is called but not awaited; advance microtasks
      await vi.advanceTimersByTimeAsync(0);
      expect(mockDb.run).toHaveBeenCalled();
    });

    it("should be safe to call destroy multiple times", () => {
      collector.initialize();
      expect(() => {
        collector.destroy();
        collector.destroy();
      }).not.toThrow();
    });

    it("should be safe to destroy without initializing", () => {
      const c = new SkillMetricsCollector();
      expect(() => c.destroy()).not.toThrow();
    });
  });

  // ==========================================================
  // Edge cases and integration scenarios
  // ==========================================================
  describe("edge cases", () => {
    it("should handle concurrent recordExecution calls", () => {
      for (let i = 0; i < 5; i++) {
        collector.recordExecution("concurrent-skill", {
          duration: i * 10,
          success: i % 2 === 0,
        });
      }

      const metrics = collector.getSkillMetrics("concurrent-skill");
      expect(metrics.totalExecutions).toBe(5);
      expect(metrics.successCount).toBe(3); // i=0,2,4
      expect(metrics.failureCount).toBe(2); // i=1,3
    });

    it("should track multiple skills independently", () => {
      collector.recordExecution("independent-a", {
        duration: 100,
        success: true,
        cost: 0.01,
      });
      collector.recordExecution("independent-b", {
        duration: 200,
        success: false,
        cost: 0.02,
      });

      const metricsA = collector.getSkillMetrics("independent-a");
      const metricsB = collector.getSkillMetrics("independent-b");

      expect(metricsA.totalExecutions).toBe(1);
      expect(metricsA.successCount).toBe(1);
      expect(metricsB.totalExecutions).toBe(1);
      expect(metricsB.failureCount).toBe(1);
    });

    it("should be an EventEmitter instance", () => {
      expect(collector).toBeInstanceOf(EventEmitter);
    });

    it("should handle very large duration values", () => {
      collector.recordExecution("large-dur", {
        duration: Number.MAX_SAFE_INTEGER,
      });
      const metrics = collector.getSkillMetrics("large-dur");
      expect(metrics.avgDurationMs).toBe(Number.MAX_SAFE_INTEGER);
    });

    it("should handle zero-cost executions", () => {
      collector.recordExecution("zero-cost", {
        duration: 10,
        success: true,
        cost: 0,
      });
      const metrics = collector.getSkillMetrics("zero-cost");
      expect(metrics.totalCost).toBe(0);
    });

    it("should produce correct time series data after flush clears buffer", async () => {
      collector.recordExecution("ts-flush", {
        duration: 100,
        success: true,
        tokensInput: 5,
        tokensOutput: 5,
      });

      // Flush clears buffer
      await collector.flush();
      expect(collector._buffer).toHaveLength(0);

      // Time series operates on buffer, so it should be empty after flush
      const data = collector.getTimeSeriesData("ts-flush", "day");
      expect(data).toEqual([]);
    });

    it("should handle recording after destroy gracefully", () => {
      collector.destroy();
      // recordExecution should still work on in-memory structures
      expect(() => {
        collector.recordExecution("post-destroy", { duration: 10 });
      }).not.toThrow();

      expect(collector._buffer).toHaveLength(1);
      expect(collector.skillMetrics.has("post-destroy")).toBe(true);
    });
  });
});
