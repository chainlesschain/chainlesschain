/**
 * content-visibility 测试 — src/renderer/utils/content-visibility.ts
 *
 * RenderBudgetManager (rAF-driven priority render queue) + the applyContent-
 * Visibility / isContentVisibilitySupported / getContentVisibilityStats
 * helpers. Fake timers drive requestAnimationFrame; logger mocked.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  RenderBudgetManager,
  applyContentVisibility,
  isContentVisibilitySupported,
  getContentVisibilityStats,
} from "@/utils/content-visibility";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("content-visibility — RenderBudgetManager", () => {
  it("schedules and runs queued render tasks via rAF", async () => {
    vi.useFakeTimers();
    try {
      const m = new RenderBudgetManager();
      const fn = vi.fn();
      m.schedule(fn, "high");
      expect(m.getStatus().queueLength).toBe(1); // queued, rAF not yet fired
      await vi.advanceTimersByTimeAsync(50);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(m.getStatus().queueLength).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drains every task across frames even with a small per-frame budget", async () => {
    vi.useFakeTimers();
    try {
      const m = new RenderBudgetManager({ maxRendersPerFrame: 2 });
      const fns = Array.from({ length: 5 }, () => vi.fn());
      fns.forEach((f) => m.schedule(f));
      await vi.advanceTimersByTimeAsync(200);
      fns.forEach((f) => expect(f).toHaveBeenCalledTimes(1));
      expect(m.getStatus().queueLength).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clear empties the queue", () => {
    const m = new RenderBudgetManager();
    m.schedule(vi.fn());
    m.clear();
    expect(m.getStatus().queueLength).toBe(0);
    expect(m.getStatus().rendering).toBe(false);
  });
});

describe("content-visibility — helpers", () => {
  it("applyContentVisibility is a no-op on null and sets styles on an element", () => {
    expect(() => applyContentVisibility(null)).not.toThrow();
    const el = document.createElement("div");
    applyContentVisibility(el, { height: 300, auto: true });
    // jsdom may not reflect content-visibility, but contain-intrinsic-size is stored
    expect(el.style.containIntrinsicSize).toBe("auto 300px");
  });

  it("isContentVisibilitySupported returns a boolean", () => {
    expect(typeof isContentVisibilitySupported()).toBe("boolean");
  });

  it("getContentVisibilityStats counts styled elements + reports queue status", () => {
    const a = document.createElement("div");
    a.setAttribute("style", "content-visibility: auto");
    document.body.appendChild(a);
    const stats = getContentVisibilityStats();
    expect(stats.total).toBeGreaterThanOrEqual(1);
    expect(typeof stats.supported).toBe("boolean");
    expect(stats.renderBudgetQueue).toHaveProperty("queueLength");
  });
});
