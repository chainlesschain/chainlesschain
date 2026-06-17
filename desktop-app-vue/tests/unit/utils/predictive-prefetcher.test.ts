/**
 * predictive-prefetcher 测试 — src/renderer/utils/predictive-prefetcher.ts
 *
 * The class is exported directly, so each test builds a fresh instance. Fake
 * timers keep the fire-and-forget prefetch (scheduled by recordAccess) from
 * ever running real I/O; the IndexedDB cache + perf tracker deps are mocked.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/utils/indexeddb-cache", () => ({
  fileCacheManager: {
    getFile: vi.fn().mockResolvedValue(null),
    cacheFile: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("@/utils/performance-tracker", () => ({
  default: { trackFileOperation: vi.fn(() => 0) },
}));

import { PredictivePrefetcher } from "@/utils/predictive-prefetcher";

let p: PredictivePrefetcher;
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  p = new PredictivePrefetcher({
    minConfidence: 0.2,
    maxPredictions: 5,
    prefetchDelay: 500,
    historySize: 100,
  });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("predictive-prefetcher — sequence prediction", () => {
  it("learns A→B and predicts B from A with high confidence", () => {
    p.recordAccess("/dir/a.ts");
    p.recordAccess("/dir/b.ts");
    const preds = p.predictNextFiles("/dir/a.ts");
    expect(preds.length).toBeGreaterThan(0);
    expect(preds[0].path).toBe("/dir/b.ts");
    expect(preds[0].reason).toBe("sequence");
    expect(preds[0].confidence).toBeCloseTo(1);
  });

  it("a fresh prefetcher with no history predicts nothing", () => {
    const fresh = new PredictivePrefetcher();
    expect(fresh.predictNextFiles("/x")).toEqual([]);
  });
});

describe("predictive-prefetcher — stats + prefetch accessors", () => {
  it("getStats reflects history/sequence/relationship sizes", () => {
    p.recordAccess("/dir/a.ts");
    p.recordAccess("/dir/b.ts");
    expect(p.getStats()).toMatchObject({
      historySize: 2,
      sequences: 1,
      relationships: 2,
      hitRate: 0,
    });
  });

  it("getPrefetched counts a miss and isPrefetched is false for unknown paths", () => {
    expect(p.getPrefetched("/nope")).toBeNull();
    expect(p.isPrefetched("/nope")).toBe(false);
    expect(p.getStats().misses).toBe(1);
  });
});

describe("predictive-prefetcher — export + clears", () => {
  it("exportPatterns surfaces the learned sequence + relationships", () => {
    p.recordAccess("/dir/a.ts");
    p.recordAccess("/dir/b.ts");
    const ex = p.exportPatterns();
    expect(ex.sequences[0]).toMatchObject({ path: "/dir/a.ts" });
    expect(ex.sequences[0].sequences[0]).toMatchObject({
      nextPath: "/dir/b.ts",
      count: 1,
    });
    expect(ex.relationships.length).toBeGreaterThan(0);
    expect(Array.isArray(ex.hourlyPatterns)).toBe(true);
  });

  it("clearHistory and clearPrefetchCache reset the tracked state", () => {
    p.recordAccess("/dir/a.ts");
    p.recordAccess("/dir/b.ts");
    p.clearHistory();
    expect(p.getStats()).toMatchObject({
      historySize: 0,
      sequences: 0,
      relationships: 0,
    });
    p.clearPrefetchCache();
    expect(p.getStats().queueLength).toBe(0);
    expect(p.getStats().prefetchedFiles).toBe(0);
  });
});
