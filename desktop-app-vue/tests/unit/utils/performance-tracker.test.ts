/**
 * performance-tracker 测试 — src/renderer/utils/performance-tracker.ts
 *
 * Singleton metrics tracker. performance.now is mocked to a constant so
 * durations (now - startTime) are deterministic; clear() isolates each test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import tracker, { percentile } from "@/utils/performance-tracker";

let nowSpy: any;
beforeEach(() => {
  tracker.clear();
  nowSpy = vi.spyOn(performance, "now").mockReturnValue(1000);
});
afterEach(() => nowSpy.mockRestore());

describe("percentile — nearest-rank", () => {
  // 1..100 ascending; value === rank, so the asserted value IS the k-th smallest.
  const hundred = Array.from({ length: 100 }, (_, i) => i + 1);

  it("P99 over 100 samples is the 99th smallest, NOT the maximum", () => {
    // Old `sorted[Math.floor(100 * 0.99)]` returned sorted[99] === 100 (the max).
    expect(percentile(hundred, 0.99)).toBe(99);
    expect(percentile(hundred, 0.95)).toBe(95);
    expect(percentile(hundred, 0.5)).toBe(50);
  });

  it("clamps fraction extremes and never reads past the end", () => {
    expect(percentile(hundred, 1)).toBe(100); // P100 = max, no out-of-bounds
    expect(percentile(hundred, 0)).toBe(1); // P0 = min
  });

  it("empty array returns 0; single element returns that element", () => {
    expect(percentile([], 0.95)).toBe(0);
    expect(percentile([42], 0.99)).toBe(42);
  });

  it("matches the existing p50 expectation for a 3-element set", () => {
    expect(percentile([100, 200, 500], 0.5)).toBe(200); // ceil(0.5*3)=2 -> index 1
  });
});

describe("performance-tracker — file operations", () => {
  it("records durations and computes stats", () => {
    expect(tracker.trackFileOperation("read", "a", 900)).toBe(100); // 1000-900
    tracker.trackFileOperation("read", "b", 800); // 200
    tracker.trackFileOperation("read", "c", 500); // 500
    const stats = tracker.getFileOperationStats();
    expect(stats.total).toBe(3);
    expect(stats.minTime).toBe(100);
    expect(stats.maxTime).toBe(500);
    expect(stats.avgTime).toBe(267); // round(800/3)
    expect(stats.p50).toBe(200);
  });

  it("empty stats are all zero", () => {
    expect(tracker.getFileOperationStats()).toMatchObject({
      total: 0,
      avgTime: 0,
      p95: 0,
    });
  });
});

describe("performance-tracker — ai responses + network", () => {
  it("AI stats include totalTokens", () => {
    tracker.trackAiResponse("m", 100, 900); // 100ms, 100 tokens
    tracker.trackAiResponse("m", 50, 800); // 200ms, 50 tokens
    const s = tracker.getAiResponseStats();
    expect(s.total).toBe(2);
    expect(s.totalTokens).toBe(150);
    expect(s.minTime).toBe(100);
  });

  it("network stats split successful/failed", () => {
    tracker.trackNetworkRequest("/a", "GET", 900, true);
    tracker.trackNetworkRequest("/b", "POST", 900, false);
    tracker.trackNetworkRequest("/c", "GET", 900, true);
    const s = tracker.getNetworkStats();
    expect(s).toMatchObject({ total: 3, successful: 2, failed: 1 });
  });
});

describe("performance-tracker — cache", () => {
  it("hit rate is 0 with no activity and rounds otherwise", () => {
    expect(tracker.getCacheHitRate()).toBe(0);
    tracker.trackCacheHit();
    tracker.trackCacheHit();
    tracker.trackCacheHit();
    tracker.trackCacheMiss();
    expect(tracker.getCacheHitRate()).toBe(75); // 3/4
  });
});

describe("performance-tracker — listeners + measure + getAllMetrics", () => {
  it("addListener fires on track and the unsubscribe stops it", () => {
    const listener = vi.fn();
    const off = tracker.addListener(listener);
    tracker.trackFileOperation("read", "a", 900);
    expect(listener).toHaveBeenCalledWith(
      "fileOperation",
      expect.objectContaining({ file: "a" }),
    );
    listener.mockClear();
    off();
    tracker.trackFileOperation("read", "b", 900);
    expect(listener).not.toHaveBeenCalled();
  });

  it("measure returns the fn result and rethrows on error", async () => {
    await expect(tracker.measure("ok", async () => 42)).resolves.toBe(42);
    await expect(
      tracker.measure("bad", async () => {
        throw new Error("x");
      }),
    ).rejects.toThrow("x");
  });

  it("getAllMetrics aggregates every category", () => {
    tracker.trackCacheHit();
    tracker.trackFileOperation("read", "a", 900);
    const all = tracker.getAllMetrics();
    expect(all.fileOperations.total).toBe(1);
    expect(all.cache.hits).toBe(1);
    expect(all).toHaveProperty("aiResponses");
    expect(all).toHaveProperty("network");
  });

  it("clear resets everything", () => {
    tracker.trackFileOperation("read", "a", 900);
    tracker.trackCacheHit();
    tracker.clear();
    expect(tracker.getFileOperationStats().total).toBe(0);
    expect(tracker.getCacheHitRate()).toBe(0);
  });
});
