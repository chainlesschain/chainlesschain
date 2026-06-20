import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * IntentFusion 单元测试 — 覆盖此前无测试的纯逻辑部分：
 * 缓存键生成、LRU 缓存（命中/未命中/淘汰）、性能统计（含除零守卫）、
 * LLM 响应解析（纯 JSON / markdown 包裹 / canFuse / 默认值 / 异常）。
 */

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// `../database` pulls in heavy native deps; the class only uses it via
// setDatabase(), so an inert stub is enough for these pure-logic tests.
vi.mock("../../../src/main/database", () => ({
  default: class {},
  DatabaseManager: class {},
}));

let IntentFusion;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import("../../../src/main/ai-engine/intent-fusion.js");
  IntentFusion = mod.default || mod;
});

describe("IntentFusion._generateCacheKey", () => {
  it("uses intent type, joined by |", () => {
    const f = new IntentFusion();
    expect(f._generateCacheKey([{ type: "read" }, { type: "write" }])).toBe(
      "read|write",
    );
  });

  it("appends filePath / quality params when present", () => {
    const f = new IntentFusion();
    expect(
      f._generateCacheKey([{ type: "edit", params: { filePath: "/a.js" } }]),
    ).toBe("edit:/a.js");
    expect(
      f._generateCacheKey([{ type: "img", params: { quality: 90 } }]),
    ).toBe("img:q90");
  });
});

describe("IntentFusion LRU cache", () => {
  it("returns null on miss and the stored value on hit", () => {
    const f = new IntentFusion();
    const intents = [{ type: "read" }];
    expect(f._checkCache(intents)).toBeNull();
    const result = { fused: true };
    f._addToCache(intents, result);
    expect(f._checkCache(intents)).toBe(result);
  });

  it("evicts the oldest entry when cacheMaxSize is exceeded", () => {
    const f = new IntentFusion({ cacheMaxSize: 2 });
    f._addToCache([{ type: "a" }], { v: 1 });
    f._addToCache([{ type: "b" }], { v: 2 });
    f._addToCache([{ type: "c" }], { v: 3 }); // evicts "a"

    expect(f.fusionCache.size).toBe(2);
    expect(f._checkCache([{ type: "a" }])).toBeNull();
    expect(f._checkCache([{ type: "b" }])).toEqual({ v: 2 });
    expect(f._checkCache([{ type: "c" }])).toEqual({ v: 3 });
  });

  it("a cache hit moves the entry to most-recently-used", () => {
    const f = new IntentFusion({ cacheMaxSize: 2 });
    f._addToCache([{ type: "a" }], { v: 1 });
    f._addToCache([{ type: "b" }], { v: 2 });
    // Touch "a" so it becomes most-recent; inserting "c" should now evict "b".
    expect(f._checkCache([{ type: "a" }])).toEqual({ v: 1 });
    f._addToCache([{ type: "c" }], { v: 3 });

    expect(f._checkCache([{ type: "a" }])).toEqual({ v: 1 });
    expect(f._checkCache([{ type: "b" }])).toBeNull();
  });

  it("clearCache empties the cache and resets counters", () => {
    const f = new IntentFusion();
    f._addToCache([{ type: "a" }], { v: 1 });
    f.cacheHits = 5;
    f.cacheMisses = 3;
    f.clearCache();
    expect(f.fusionCache.size).toBe(0);
    expect(f.cacheHits).toBe(0);
    expect(f.cacheMisses).toBe(0);
  });
});

describe("IntentFusion performance stats", () => {
  it("guards against divide-by-zero with no fusions/cache activity", () => {
    const f = new IntentFusion();
    const stats = f.getPerformanceStats();
    expect(stats.averageTime).toBe(0);
    expect(stats.cacheHitRate).toBe(0);
    expect(stats.cacheSize).toBe(0);
  });

  it("computes averageTime and cacheHitRate", () => {
    const f = new IntentFusion();
    f.performanceStats.totalFusions = 4;
    f.performanceStats.totalTime = 200;
    f.performanceStats.cacheHits = 3;
    f.performanceStats.cacheMisses = 1;
    const stats = f.getPerformanceStats();
    expect(stats.averageTime).toBe(50);
    expect(stats.cacheHitRate).toBe(0.75);
  });

  it("resetPerformanceStats zeroes everything", () => {
    const f = new IntentFusion();
    f.performanceStats.totalFusions = 9;
    f.cacheHits = 2;
    f.resetPerformanceStats();
    expect(f.performanceStats.totalFusions).toBe(0);
    expect(f.performanceStats.cacheHits).toBe(0);
    expect(f.cacheHits).toBe(0);
  });
});

describe("IntentFusion._parseLLMFusionResponse", () => {
  it("parses plain JSON and applies defaults", () => {
    const f = new IntentFusion();
    const r = f._parseLLMFusionResponse(
      JSON.stringify({ canFuse: true, fusedIntent: { type: "x" } }),
    );
    expect(r.canFuse).toBe(true);
    expect(r.fusedIntent).toEqual({ type: "x" });
    expect(r.consumedCount).toBe(2); // default
    expect(r.confidence).toBe(0.7); // default
  });

  it("parses JSON wrapped in a markdown code fence", () => {
    const f = new IntentFusion();
    const r = f._parseLLMFusionResponse(
      '```json\n{"canFuse": true, "consumedCount": 3, "confidence": 0.9}\n```',
    );
    expect(r.consumedCount).toBe(3);
    expect(r.confidence).toBe(0.9);
  });

  it("returns null when canFuse is false", () => {
    const f = new IntentFusion();
    expect(f._parseLLMFusionResponse('{"canFuse": false}')).toBeNull();
  });

  it("returns null for malformed responses", () => {
    const f = new IntentFusion();
    expect(f._parseLLMFusionResponse("not json at all")).toBeNull();
    expect(f._parseLLMFusionResponse("{ broken json")).toBeNull();
  });
});
