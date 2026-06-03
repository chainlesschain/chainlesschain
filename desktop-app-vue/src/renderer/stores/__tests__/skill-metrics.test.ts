/**
 * useSkillMetricsStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: sortedBySuccessRate / sortedByUsage / sortedByCost (sorted
 *    copies, original untouched)
 *  - IPC actions (window.electronAPI.invoke mocked): loadSkillMetrics (upsert by
 *    skillId), loadPipelineMetrics (Array.isArray normalize), loadTopSkills
 *    (populate), loadTimeSeries (populate)
 *
 * NB: setup-style store reading window.electronAPI?.invoke lazily inside each
 * action, so we stub window.electronAPI per-test. The metric interfaces are not
 * exported, so fixtures are loosely typed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useSkillMetricsStore } from "../skill-metrics";

const mockInvoke = vi.fn();

function metric(
  skillId: string,
  overrides: Record<string, any> = {},
): any {
  return {
    skillId,
    totalExecutions: 0,
    successCount: 0,
    failureCount: 0,
    avgDurationMs: 0,
    totalTokens: 0,
    totalCost: 0,
    successRate: 0,
    lastExecutedAt: null,
    ...overrides,
  };
}

describe("useSkillMetricsStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue({ success: true, data: [] });
    (window as any).electronAPI = { invoke: mockInvoke };
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as any).electronAPI;
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty with a 'day' time range", () => {
      const store = useSkillMetricsStore();
      expect(store.skillMetrics).toEqual([]);
      expect(store.pipelineMetrics).toEqual([]);
      expect(store.topSkills).toEqual([]);
      expect(store.timeSeriesData).toEqual([]);
      expect(store.timeRange).toBe("day");
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("sortedBySuccessRate sorts descending without mutating the source", () => {
      const store = useSkillMetricsStore();
      store.skillMetrics = [
        metric("a", { successRate: 0.5 }),
        metric("b", { successRate: 0.9 }),
        metric("c", { successRate: 0.7 }),
      ];
      expect(store.sortedBySuccessRate.map((m) => m.skillId)).toEqual([
        "b",
        "c",
        "a",
      ]);
      // original order preserved
      expect(store.skillMetrics.map((m) => m.skillId)).toEqual([
        "a",
        "b",
        "c",
      ]);
    });

    it("sortedByUsage + sortedByCost sort by their respective fields", () => {
      const store = useSkillMetricsStore();
      store.skillMetrics = [
        metric("a", { totalExecutions: 10, totalCost: 1 }),
        metric("b", { totalExecutions: 30, totalCost: 0.5 }),
        metric("c", { totalExecutions: 20, totalCost: 2 }),
      ];
      expect(store.sortedByUsage.map((m) => m.skillId)).toEqual([
        "b",
        "c",
        "a",
      ]);
      expect(store.sortedByCost.map((m) => m.skillId)).toEqual([
        "c",
        "a",
        "b",
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("loadSkillMetrics upserts the metric for a given skillId", async () => {
      const store = useSkillMetricsStore();
      // first load: append
      mockInvoke.mockResolvedValue({
        success: true,
        data: metric("s1", { totalExecutions: 5 }),
      });
      await store.loadSkillMetrics("s1");
      expect(mockInvoke).toHaveBeenCalledWith("skills:get-metrics", {
        skillId: "s1",
        timeRange: null,
      });
      expect(store.skillMetrics.map((m) => m.skillId)).toEqual(["s1"]);
      // second load same id: replace in place
      mockInvoke.mockResolvedValue({
        success: true,
        data: metric("s1", { totalExecutions: 9 }),
      });
      await store.loadSkillMetrics("s1");
      expect(store.skillMetrics).toHaveLength(1);
      expect(store.skillMetrics[0].totalExecutions).toBe(9);
      expect(store.loading).toBe(false);
    });

    it("loadPipelineMetrics wraps a single-object result into an array", async () => {
      const store = useSkillMetricsStore();
      mockInvoke.mockResolvedValue({
        success: true,
        data: { pipelineId: "p1", totalExecutions: 3 },
      });
      await store.loadPipelineMetrics("p1");
      expect(mockInvoke).toHaveBeenCalledWith(
        "skills:get-pipeline-metrics",
        "p1",
      );
      expect(store.pipelineMetrics).toHaveLength(1);
      expect(store.pipelineMetrics[0].pipelineId).toBe("p1");
    });

    it("loadPipelineMetrics keeps an array result as-is", async () => {
      const store = useSkillMetricsStore();
      mockInvoke.mockResolvedValue({
        success: true,
        data: [{ pipelineId: "p1" }, { pipelineId: "p2" }],
      });
      await store.loadPipelineMetrics();
      expect(store.pipelineMetrics).toHaveLength(2);
    });

    it("loadTopSkills + loadTimeSeries populate their slices", async () => {
      const store = useSkillMetricsStore();
      mockInvoke.mockResolvedValueOnce({
        success: true,
        data: [metric("a"), metric("b")],
      });
      await store.loadTopSkills(5, "cost");
      expect(mockInvoke).toHaveBeenCalledWith("skills:get-top-skills", {
        limit: 5,
        metric: "cost",
      });
      expect(store.topSkills).toHaveLength(2);

      mockInvoke.mockResolvedValueOnce({
        success: true,
        data: [{ timestamp: 1, executions: 2 }],
      });
      await store.loadTimeSeries("s1", "hour");
      expect(mockInvoke).toHaveBeenCalledWith("skills:get-time-series", {
        skillId: "s1",
        interval: "hour",
      });
      expect(store.timeSeriesData).toHaveLength(1);
    });
  });
});
