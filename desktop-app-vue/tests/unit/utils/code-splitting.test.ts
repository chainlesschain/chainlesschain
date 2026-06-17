/**
 * code-splitting 测试 — src/renderer/utils/code-splitting.ts
 *
 * Deterministic surface: getBundleSizeReport (reads window.__BUNDLE_SIZE_TRACKER__)
 * and the ProgressiveLoader priority queue (load + dedup + clear). The
 * lazyLoad/smartLoad Vue helpers and DEV-gated trackBundleSize are out of scope.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { getBundleSizeReport, ProgressiveLoader } from "@/utils/code-splitting";

const flush = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  delete (window as any).__BUNDLE_SIZE_TRACKER__;
});

describe("code-splitting — getBundleSizeReport", () => {
  it("returns an empty report when nothing is tracked", () => {
    expect(getBundleSizeReport()).toEqual({
      chunks: {},
      total: 0,
      totalKB: "0",
      totalMB: "0",
    });
  });

  it("aggregates tracked chunk sizes", () => {
    (window as any).__BUNDLE_SIZE_TRACKER__ = { a: 1024, b: 2048 };
    const r = getBundleSizeReport();
    expect(r.total).toBe(3072);
    expect(r.totalKB).toBe("3.00");
    expect(r.chunks).toEqual({ a: 1024, b: 2048 });
  });
});

describe("code-splitting — ProgressiveLoader", () => {
  it("processes queued loaders", async () => {
    const loader = new ProgressiveLoader();
    const a = vi.fn().mockResolvedValue({});
    const b = vi.fn().mockResolvedValue({});
    loader.add(a, "high", "chunk-a");
    loader.add(b, "low", "chunk-b");
    await flush();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("skips a chunk that is already loaded (dedup by chunkName)", async () => {
    const loader = new ProgressiveLoader();
    const first = vi.fn().mockResolvedValue({});
    const second = vi.fn().mockResolvedValue({});
    loader.add(first, "normal", "dup");
    loader.add(second, "normal", "dup"); // same chunkName → skipped after first loads
    await flush();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("continues past a failing loader without throwing", async () => {
    const loader = new ProgressiveLoader();
    const bad = vi.fn().mockRejectedValue(new Error("nope"));
    const good = vi.fn().mockResolvedValue({});
    loader.add(bad, "high", "bad");
    loader.add(good, "low", "good");
    await flush();
    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();
  });

  it("clear empties the queue", async () => {
    const loader = new ProgressiveLoader();
    const fn = vi.fn().mockResolvedValue({});
    loader.add(fn, "normal", "x");
    loader.clear();
    expect(() => loader.clear()).not.toThrow();
  });
});
