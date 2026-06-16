/**
 * project-detail-optimizations 测试 — src/renderer/utils/project-detail-optimizations.ts
 *
 * Covers the pure helpers: optimizeFileTreeLoading (priority→depth→alpha sort
 * + batching), debounce, throttle. Heavy sibling modules are mocked so the
 * import is side-effect-free.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/utils/performance-tracker", () => ({
  default: { getAllMetrics: () => ({}), trackOperation: vi.fn() },
}));
vi.mock("@/utils/service-worker-manager", () => ({ default: {} }));
vi.mock("@/utils/editor-pool", () => ({
  createEditorPoolManager: vi.fn(),
  createMonacoEditorFactory: vi.fn(),
}));

import {
  optimizeFileTreeLoading,
  debounce,
  throttle,
} from "@/utils/project-detail-optimizations";

describe("optimizeFileTreeLoading", () => {
  it("returns an empty list for no files", () => {
    expect(optimizeFileTreeLoading([])).toEqual([]);
  });

  it("sorts shallower paths first, then alphabetically", () => {
    const files = [
      { path: "src/a/b/deep.ts" },
      { path: "src/z.ts" },
      { path: "src/a.ts" },
    ];
    const [batch] = optimizeFileTreeLoading(files);
    expect(batch.map((f) => f.path)).toEqual([
      "src/a.ts",
      "src/z.ts",
      "src/a/b/deep.ts",
    ]);
  });

  it("puts priority-path files first regardless of depth", () => {
    const files = [{ path: "src/a.ts" }, { path: "docs/x/y/readme.md" }];
    const [batch] = optimizeFileTreeLoading(files, {
      priorityPaths: ["docs/"],
    });
    expect(batch[0].path).toBe("docs/x/y/readme.md");
  });

  it("splits into batches of batchSize", () => {
    const files = Array.from({ length: 5 }, (_, i) => ({ path: `f${i}.ts` }));
    const batches = optimizeFileTreeLoading(files, { batchSize: 2 });
    expect(batches.map((b) => b.length)).toEqual([2, 2, 1]);
  });

  it("does not mutate the input array", () => {
    const files = [{ path: "b.ts" }, { path: "a.ts" }];
    optimizeFileTreeLoading(files);
    expect(files.map((f) => f.path)).toEqual(["b.ts", "a.ts"]);
  });
});

describe("debounce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("collapses rapid calls into one trailing call", () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d("a");
    d("b");
    d("c");
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("c");
  });

  it("fires again after the delay elapses between calls", () => {
    const fn = vi.fn();
    const d = debounce(fn, 50);
    d();
    vi.advanceTimersByTime(50);
    d();
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("throttle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs immediately then ignores calls within the limit", () => {
    const fn = vi.fn();
    const t = throttle(fn, 100);
    t("a");
    t("b");
    t("c");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("a");
    vi.advanceTimersByTime(100);
    t("d");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("d");
  });
});
