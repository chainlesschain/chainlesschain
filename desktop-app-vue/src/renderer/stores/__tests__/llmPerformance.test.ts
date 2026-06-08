/**
 * useLlmPerformanceStore — Pinia store unit tests (V5→V6 LLM performance port).
 *
 * Verifies the loader/action shape asymmetry: `llm:get-*` loaders return data
 * DIRECTLY (truthy-guarded), action channels return {success,...}. Plus
 * refreshAll fan-out, clearCache/dismissAlert reload side-effects, and the
 * IPC-absent fail-safe.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { useLlmPerformanceStore } from "../llmPerformance";

const mockInvoke = vi.fn();
const RANGE = { startDate: 1000, endDate: 2000 };

describe("useLlmPerformanceStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
    (window as any).electronAPI = { invoke: mockInvoke };
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as any).electronAPI;
  });

  describe("initial state", () => {
    it("starts with empty stats / budget / lists", () => {
      const store = useLlmPerformanceStore();
      expect(store.stats.totalCalls).toBe(0);
      expect(store.budget.warningThreshold).toBe(80);
      expect(store.costBreakdown).toEqual({ byProvider: [], byModel: [] });
      expect(store.alertHistory).toEqual([]);
      expect(store.loading).toBe(false);
    });
  });

  describe("loaders (direct return)", () => {
    it("loadStats assigns the payload directly + forwards the range", async () => {
      mockInvoke.mockResolvedValueOnce({ totalCalls: 12, totalCostUsd: 0.5 });
      const store = useLlmPerformanceStore();
      await store.loadStats(RANGE);
      expect(mockInvoke).toHaveBeenCalledWith("llm:get-usage-stats", RANGE);
      expect(store.stats.totalCalls).toBe(12);
    });

    it("loadStats keeps prior state on a falsy reply", async () => {
      mockInvoke.mockResolvedValueOnce(null);
      const store = useLlmPerformanceStore();
      await store.loadStats(RANGE);
      expect(store.stats.totalCalls).toBe(0);
    });

    it("loadCostBreakdown guards non-array provider/model fields", async () => {
      mockInvoke.mockResolvedValueOnce({ byProvider: [{ name: "a" }] });
      const store = useLlmPerformanceStore();
      await store.loadCostBreakdown(RANGE);
      expect(store.costBreakdown.byProvider).toHaveLength(1);
      expect(store.costBreakdown.byModel).toEqual([]); // missing → []
    });

    it("loadAlertHistory only accepts an array", async () => {
      mockInvoke.mockResolvedValueOnce("nope");
      const store = useLlmPerformanceStore();
      await store.loadAlertHistory();
      expect(store.alertHistory).toEqual([]);
    });

    it("a thrown loader is swallowed into lastError", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("ipc down"));
      const store = useLlmPerformanceStore();
      await store.loadBudget();
      expect(store.lastError).toBe("ipc down");
    });
  });

  describe("refreshAll", () => {
    it("one failing channel does not block the others (allSettled)", async () => {
      mockInvoke
        .mockResolvedValueOnce({ totalCalls: 9 }) // stats
        .mockRejectedValueOnce(new Error("breakdown boom")) // cost breakdown
        .mockResolvedValueOnce({ totalEntries: 3 }) // cache
        .mockResolvedValueOnce({ dailyLimit: 5 }) // budget
        .mockResolvedValueOnce([{ id: "a1" }]); // alerts
      const store = useLlmPerformanceStore();
      await store.refreshAll(RANGE);
      expect(store.stats.totalCalls).toBe(9);
      expect(store.cacheStats.totalEntries).toBe(3);
      expect(store.budget.dailyLimit).toBe(5);
      expect(store.alertHistory).toHaveLength(1);
      expect(store.loading).toBe(false);
    });
  });

  describe("actions ({success} wrapper)", () => {
    it("clearCache returns clearedCount and reloads cache stats", async () => {
      mockInvoke
        .mockResolvedValueOnce({ success: true, clearedCount: 4 }) // clear-cache
        .mockResolvedValueOnce({ totalEntries: 1 }); // reload get-cache-stats
      const store = useLlmPerformanceStore();
      const r = await store.clearCache();
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "llm:clear-cache", {
        expiredOnly: true,
      });
      expect(r).toEqual({ success: true, clearedCount: 4 });
      expect(store.cacheStats.totalEntries).toBe(1);
    });

    it("dismissAlert forwards the id and reloads history on success", async () => {
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // dismiss
        .mockResolvedValueOnce([]); // reload alerts
      const store = useLlmPerformanceStore();
      await store.dismissAlert("alert-7");
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "llm:dismiss-alert",
        "alert-7",
      );
    });

    it("surfaces a backend error and does not reload", async () => {
      mockInvoke.mockResolvedValueOnce({ success: false, error: "nope" });
      const store = useLlmPerformanceStore();
      const r = await store.clearAlertHistory();
      expect(r).toEqual({ success: false, error: "nope" });
      expect(mockInvoke).toHaveBeenCalledTimes(1); // no reload
    });

    it("fails closed with 'IPC 不可用' when electronAPI is absent", async () => {
      delete (window as any).electronAPI;
      const store = useLlmPerformanceStore();
      expect(await store.exportCostReport({})).toEqual({
        success: false,
        error: "IPC 不可用",
      });
    });
  });
});
