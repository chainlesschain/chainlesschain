/**
 * useDbPerformanceStore — Pinia store unit tests (V5→V6 DB performance port).
 *
 * Covers initial state, the three loaders (success + IPC-reply guards),
 * refreshAll fan-out (one channel failing must not block the others), and the
 * shared _mutate action runner (success / backend-error / thrown / IPC-absent).
 *
 * Store reads window.electronAPI.invoke lazily via getInvoke(), so we stub
 * window.electronAPI per-test rather than vi.mock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { useDbPerformanceStore } from "../dbPerformance";

const mockInvoke = vi.fn();

describe("useDbPerformanceStore", () => {
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
    it("starts with empty stats / lists", () => {
      const store = useDbPerformanceStore();
      expect(store.slowQueries).toEqual([]);
      expect(store.indexSuggestions).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.stats.totalQueries).toBe(0);
      expect(store.stats.cache?.hitRate).toBe("0%");
    });
  });

  describe("loaders", () => {
    it("loadStats sets stats from {success,data}", async () => {
      mockInvoke.mockResolvedValueOnce({
        success: true,
        data: { totalQueries: 42, avgQueryTime: 12, slowQueries: 2 },
      });
      const store = useDbPerformanceStore();
      await store.loadStats();
      expect(mockInvoke).toHaveBeenCalledWith("db-performance:get-stats");
      expect(store.stats.totalQueries).toBe(42);
    });

    it("loadStats ignores an unsuccessful / dataless reply", async () => {
      mockInvoke.mockResolvedValueOnce({ success: false });
      const store = useDbPerformanceStore();
      await store.loadStats();
      expect(store.stats.totalQueries).toBe(0); // unchanged
    });

    it("loadSlowQueries passes the limit and stores an array", async () => {
      mockInvoke.mockResolvedValueOnce({
        success: true,
        data: [{ sql: "SELECT 1", duration: 120 }],
      });
      const store = useDbPerformanceStore();
      await store.loadSlowQueries(20);
      expect(mockInvoke).toHaveBeenCalledWith(
        "db-performance:get-slow-queries",
        20,
      );
      expect(store.slowQueries).toHaveLength(1);
    });

    it("loadSlowQueries ignores a non-array data payload", async () => {
      mockInvoke.mockResolvedValueOnce({ success: true, data: "nope" });
      const store = useDbPerformanceStore();
      await store.loadSlowQueries();
      expect(store.slowQueries).toEqual([]);
    });

    it("loadIndexSuggestions stores an array", async () => {
      mockInvoke.mockResolvedValueOnce({
        success: true,
        data: [{ table: "notes", column: "tag", reason: "frequent filter" }],
      });
      const store = useDbPerformanceStore();
      await store.loadIndexSuggestions();
      expect(store.indexSuggestions[0].table).toBe("notes");
    });

    it("a thrown invoke is swallowed and recorded in lastError", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("ipc boom"));
      const store = useDbPerformanceStore();
      await store.loadStats();
      expect(store.lastError).toBe("ipc boom");
      expect(store.stats.totalQueries).toBe(0);
    });
  });

  describe("refreshAll", () => {
    it("one failing channel does not block the others (allSettled)", async () => {
      mockInvoke
        .mockResolvedValueOnce({ success: true, data: { totalQueries: 7 } }) // stats
        .mockRejectedValueOnce(new Error("slow boom")) // slow queries throws
        .mockResolvedValueOnce({
          success: true,
          data: [{ table: "t", column: "c" }],
        }); // suggestions
      const store = useDbPerformanceStore();
      await store.refreshAll();
      expect(store.stats.totalQueries).toBe(7);
      expect(store.indexSuggestions).toHaveLength(1);
      expect(store.loading).toBe(false);
    });
  });

  describe("_mutate actions", () => {
    it("resetStats returns {success:true} on a successful reply", async () => {
      mockInvoke.mockResolvedValueOnce({ success: true });
      const store = useDbPerformanceStore();
      expect(await store.resetStats()).toEqual({ success: true });
      expect(mockInvoke).toHaveBeenCalledWith("db-performance:reset-stats");
    });

    it("clearCache surfaces a backend error", async () => {
      mockInvoke.mockResolvedValueOnce({ success: false, error: "locked" });
      const store = useDbPerformanceStore();
      expect(await store.clearCache()).toEqual({
        success: false,
        error: "locked",
      });
    });

    it("optimize returns a normalized error when invoke throws", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("kaboom"));
      const store = useDbPerformanceStore();
      expect(await store.optimize()).toEqual({
        success: false,
        error: "kaboom",
      });
    });

    it("applyIndexSuggestion forwards the suggestion arg", async () => {
      mockInvoke.mockResolvedValueOnce({ success: true });
      const store = useDbPerformanceStore();
      const s = { table: "notes", column: "tag" };
      await store.applyIndexSuggestion(s);
      expect(mockInvoke).toHaveBeenCalledWith(
        "db-performance:apply-index-suggestion",
        s,
      );
    });

    it("actions fail closed with 'IPC 不可用' when electronAPI is absent", async () => {
      delete (window as any).electronAPI;
      const store = useDbPerformanceStore();
      expect(await store.optimize()).toEqual({
        success: false,
        error: "IPC 不可用",
      });
    });
  });
});
