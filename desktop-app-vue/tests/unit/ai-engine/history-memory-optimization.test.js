import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * HistoryMemoryOptimization 单元测试 — 覆盖此前无测试的纯逻辑：
 * 缓存键 / TTL 过期 / 容量淘汰 / 按 taskType 失效、记忆与数据库行聚合、
 * 预测准确率累计、统计输出。
 */

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

let HistoryMemoryOptimization;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod =
    await import("../../../src/main/ai-engine/history-memory-optimization.js");
  HistoryMemoryOptimization = mod.HistoryMemoryOptimization;
});

describe("cache", () => {
  it("_getCacheKey combines taskType and serialized context", () => {
    const h = new HistoryMemoryOptimization();
    expect(h._getCacheKey("build", { a: 1 })).toBe('build:{"a":1}');
  });

  it("miss returns null, hit returns stored data", () => {
    const h = new HistoryMemoryOptimization();
    expect(h._getFromCache("k")).toBeNull();
    h._addToCache("k", { v: 1 });
    expect(h._getFromCache("k")).toEqual({ v: 1 });
  });

  it("expired entries are dropped on read (TTL)", () => {
    const h = new HistoryMemoryOptimization();
    h._addToCache("k", { v: 1 });
    // Force the stored entry to be older than cacheTTL.
    h.memoryCache.get("k").timestamp = Date.now() - (h.cacheTTL + 1000);
    expect(h._getFromCache("k")).toBeNull();
    expect(h.memoryCache.has("k")).toBe(false);
  });

  it("evicts the oldest entry at capacity", () => {
    const h = new HistoryMemoryOptimization();
    h.cacheMaxSize = 2;
    h._addToCache("a", { v: 1 });
    h._addToCache("b", { v: 2 });
    h._addToCache("c", { v: 3 }); // evicts "a"
    expect(h.memoryCache.size).toBe(2);
    expect(h._getFromCache("a")).toBeNull();
    expect(h._getFromCache("c")).toEqual({ v: 3 });
  });

  it("_invalidateCache removes only keys for the given taskType", () => {
    const h = new HistoryMemoryOptimization();
    h._addToCache("build:{}", { v: 1 });
    h._addToCache('build:{"x":1}', { v: 2 });
    h._addToCache("deploy:{}", { v: 3 });
    h._invalidateCache("build");
    expect(h._getFromCache("build:{}")).toBeNull();
    expect(h._getFromCache('build:{"x":1}')).toBeNull();
    expect(h._getFromCache("deploy:{}")).toEqual({ v: 3 });
  });
});

describe("aggregation", () => {
  it("_aggregateMemories computes success rate, dedups patterns, skips malformed", () => {
    const h = new HistoryMemoryOptimization();
    const out = h._aggregateMemories([
      { content: { success: true, pattern: "p1" } },
      { content: JSON.stringify({ success: false, pattern: "p1" }) }, // string content
      { content: { success: true, pattern: "p2" } },
      { content: "not-json" }, // skipped
    ]);
    expect(out.sampleCount).toBe(3);
    expect(out.successRate).toBeCloseTo(2 / 3);
    expect(out.patterns.sort()).toEqual(["p1", "p2"]);
  });

  it("_aggregateMemories returns 0.5 success rate for no usable samples", () => {
    const h = new HistoryMemoryOptimization();
    const out = h._aggregateMemories([{ content: "bad" }, { content: {} }]);
    expect(out.sampleCount).toBe(0);
    expect(out.successRate).toBe(0.5);
  });

  it("_aggregateDbRows computes success rate from JSON rows", () => {
    const h = new HistoryMemoryOptimization();
    const out = h._aggregateDbRows([
      { content: JSON.stringify({ success: true }) },
      { content: JSON.stringify({ success: true }) },
      { content: JSON.stringify({ success: false }) },
      { content: "broken" }, // skipped
    ]);
    expect(out.sampleCount).toBe(3);
    expect(out.successRate).toBeCloseTo(2 / 3);
  });
});

describe("prediction accuracy + stats", () => {
  it("updatePredictionAccuracy counts correct predictions only", () => {
    const h = new HistoryMemoryOptimization();
    h.updatePredictionAccuracy({ probability: 0.8 }, true); // predict true == true ✓
    h.updatePredictionAccuracy({ probability: 0.3 }, false); // predict false == false ✓
    h.updatePredictionAccuracy({ probability: 0.9 }, false); // predict true != false ✗
    expect(h.stats.accuratePredictions).toBe(2);
  });

  it("getStats returns N/A accuracy with no predictions, else a percentage", () => {
    const h = new HistoryMemoryOptimization();
    expect(h.getStats().predictionAccuracy).toBe("N/A");
    h.stats.totalPredictions = 4;
    h.stats.accuratePredictions = 3;
    expect(h.getStats().predictionAccuracy).toBe("75.0%");
    expect(h.getStats().hasDatabase).toBe(false);
  });
});
