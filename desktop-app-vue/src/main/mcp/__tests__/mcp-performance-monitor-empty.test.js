/**
 * MCPPerformanceMonitor.getSummary — empty-metrics guards
 *
 * Regression: minTime/maxTime used Math.min/max(...arr) on possibly-empty
 * arrays. Math.min(...[]) === Infinity and Math.max(...[]) === -Infinity (the
 * `|| [0]` fallback didn't help — [] is truthy), so a summary requested before
 * any sample was recorded reported "Infinity ms". _min/_max now guard length 0.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const MCPPerformanceMonitor = require("../mcp-performance-monitor.js");

describe("MCPPerformanceMonitor empty-metrics guards", () => {
  it("getSummary returns finite 0 (not Infinity) min/max time with no samples", () => {
    const mon = new MCPPerformanceMonitor();
    const summary = mon.getSummary();
    expect(Number.isFinite(summary.connections.minTime)).toBe(true);
    expect(Number.isFinite(summary.connections.maxTime)).toBe(true);
    expect(summary.connections.minTime).toBe(0);
    expect(summary.connections.maxTime).toBe(0);
  });

  it("_min/_max return 0 for empty arrays and the real value otherwise", () => {
    const mon = new MCPPerformanceMonitor();
    expect(mon._min([])).toBe(0);
    expect(mon._max([])).toBe(0);
    expect(mon._min([3, 1, 2])).toBe(1);
    expect(mon._max([3, 1, 2])).toBe(3);
  });
});
