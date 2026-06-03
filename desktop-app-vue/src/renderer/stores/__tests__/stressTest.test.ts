/**
 * useStressTestStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: completedRuns (status === 'complete') / latestRun (runs[0])
 *  - IPC actions (electronAPI.invoke mocked): startTest (set currentResult +
 *    chains fetchRuns / error), stopTest (chains fetchRuns), fetchRuns (populate),
 *    fetchResults (set currentResult)
 *
 * NB: store captures `electronAPI` at MODULE LOAD
 * (`const electronAPI = window.electronAPI || window.electron?.ipcRenderer`),
 * so window.electronAPI must exist BEFORE import — set in vi.hoisted, and never
 * delete it here (only reset the mock fn between tests).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const { mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  (globalThis as any).window = (globalThis as any).window || {};
  (globalThis as any).window.electronAPI = { invoke: mockInvoke };
  return { mockInvoke };
});

import { useStressTestStore } from "../stressTest";

describe("useStressTestStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty", () => {
      const store = useStressTestStore();
      expect(store.runs).toEqual([]);
      expect(store.currentResult).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("completedRuns filters status === 'complete'; latestRun is runs[0]", () => {
      const store = useStressTestStore();
      store.runs = [
        { id: "r1", status: "running" },
        { id: "r2", status: "complete" },
        { id: "r3", status: "complete" },
      ];
      expect(store.completedRuns.map((r: any) => r.id)).toEqual(["r2", "r3"]);
      expect(store.latestRun?.id).toBe("r1");
    });

    it("latestRun is null when there are no runs", () => {
      const store = useStressTestStore();
      expect(store.latestRun).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("startTest stores the result and chains fetchRuns", async () => {
      const store = useStressTestStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, result: { runId: "r1" } }) // start
        .mockResolvedValueOnce({
          success: true,
          runs: [{ id: "r1", status: "running" }],
        }); // get-runs
      await store.startTest({ nodeCount: 5, durationMs: 1000 });
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "stress-test:start", {
        nodeCount: 5,
        durationMs: 1000,
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "stress-test:get-runs",
        undefined,
      );
      expect(store.currentResult).toEqual({ runId: "r1" });
      expect(store.runs).toHaveLength(1);
      expect(store.loading).toBe(false);
    });

    it("startTest records the error on failure", async () => {
      const store = useStressTestStore();
      mockInvoke.mockResolvedValue({ success: false, error: "busy" });
      await store.startTest();
      expect(store.error).toBe("busy");
      expect(store.currentResult).toBeNull();
    });

    it("stopTest chains fetchRuns on success", async () => {
      const store = useStressTestStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // stop
        .mockResolvedValueOnce({
          success: true,
          runs: [{ id: "r1", status: "complete" }],
        }); // get-runs
      await store.stopTest();
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "stress-test:stop");
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "stress-test:get-runs",
        undefined,
      );
      expect(store.runs[0].status).toBe("complete");
    });

    it("fetchRuns populates the run list", async () => {
      const store = useStressTestStore();
      mockInvoke.mockResolvedValue({
        success: true,
        runs: [{ id: "r1" }, { id: "r2" }],
      });
      await store.fetchRuns({ limit: 10 });
      expect(mockInvoke).toHaveBeenCalledWith("stress-test:get-runs", {
        limit: 10,
      });
      expect(store.runs).toHaveLength(2);
    });

    it("fetchResults stores the run results", async () => {
      const store = useStressTestStore();
      mockInvoke.mockResolvedValue({
        success: true,
        results: { p99: 120 },
      });
      await store.fetchResults("r1");
      expect(mockInvoke).toHaveBeenCalledWith("stress-test:get-results", "r1");
      expect(store.currentResult).toEqual({ p99: 120 });
    });
  });
});
