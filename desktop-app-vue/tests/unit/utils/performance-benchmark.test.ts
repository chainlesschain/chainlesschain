/**
 * performance-benchmark 测试 — src/renderer/utils/performance-benchmark.ts
 *
 * The PerformanceBenchmark singleton (via getPerformanceBenchmark) is seeded
 * with enableAutoTracking:false so no FPS/memory timers run. Covers mark/measure
 * (jsdom performance API), the empty-state getters, score range, report shape,
 * and the module-level mark/measure helper delegation. logger mocked.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  getPerformanceBenchmark,
  mark as markHelper,
  measure as measureHelper,
  generateReport as generateReportHelper,
} from "@/utils/performance-benchmark";

let bench: ReturnType<typeof getPerformanceBenchmark>;
beforeAll(() => {
  bench = getPerformanceBenchmark({ enableAutoTracking: false });
});
afterAll(() => {
  bench.stop();
});

describe("performance-benchmark — mark/measure", () => {
  it("measure returns a numeric duration between two marks", () => {
    bench.mark("start-a");
    bench.mark("end-a");
    const d = bench.measure("span-a", "start-a", "end-a");
    expect(typeof d).toBe("number");
    expect(d).toBeGreaterThanOrEqual(0);
  });

  it("measure returns null for missing marks", () => {
    expect(bench.measure("span-x", "nope-1", "nope-2")).toBeNull();
  });

  it("module-level mark/measure helpers delegate to the singleton", () => {
    markHelper("h1");
    markHelper("h2");
    expect(typeof measureHelper("hspan", "h1", "h2")).toBe("number");
  });
});

describe("performance-benchmark — getters", () => {
  it("getAverageFPS is 0 and getCurrentMemory is null without samples", () => {
    expect(bench.getAverageFPS()).toBe(0);
    expect(bench.getCurrentMemory()).toBeNull();
  });

  it("getPerformanceScore returns a number within 0..100", () => {
    const score = bench.getPerformanceScore();
    expect(typeof score).toBe("number");
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe("performance-benchmark — report", () => {
  it("generateReport returns a timestamped, scored report", () => {
    const report = generateReportHelper();
    expect(typeof report.score).toBe("number");
    expect(typeof report.timestamp).toBe("string");
    expect(report).toHaveProperty("fps");
    expect(report).toHaveProperty("pageLoad");
  });
});
