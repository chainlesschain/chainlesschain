/**
 * useReputationOptimizerStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: bestImprovement (Math.max of improvement, 0 when empty) /
 *    anomalyCount (analytics with anomaly_detected)
 *  - IPC actions (electronAPI.invoke mocked): runOptimization (set latest +
 *    chains fetchHistory), fetchAnalytics (populate), detectAnomalies (chains
 *    fetchAnalytics), fetchHistory (populate)
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

import { useReputationOptimizerStore } from "../reputationOptimizer";

describe("useReputationOptimizerStore", () => {
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
      const store = useReputationOptimizerStore();
      expect(store.history).toEqual([]);
      expect(store.analytics).toEqual([]);
      expect(store.latestOptimization).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("bestImprovement is 0 when empty and the max otherwise", () => {
      const store = useReputationOptimizerStore();
      expect(store.bestImprovement).toBe(0);
      store.history = [
        { improvement: 0.2 },
        { improvement: 0.5 },
        { improvement: 0.1 },
      ];
      expect(store.bestImprovement).toBe(0.5);
    });

    it("anomalyCount counts analytics with anomaly_detected", () => {
      const store = useReputationOptimizerStore();
      store.analytics = [
        { anomaly_detected: true },
        { anomaly_detected: false },
        { anomaly_detected: true },
      ];
      expect(store.anomalyCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("runOptimization stores the result and chains fetchHistory", async () => {
      const store = useReputationOptimizerStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, result: { score: 9 } }) // run
        .mockResolvedValueOnce({
          success: true,
          history: [{ improvement: 0.3 }],
        }); // history
      await store.runOptimization({ iterations: 50 });
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "reputation-optimizer:run-optimization",
        { iterations: 50 },
      );
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "reputation-optimizer:get-history",
        undefined,
      );
      expect(store.latestOptimization).toEqual({ score: 9 });
      expect(store.history).toHaveLength(1);
      expect(store.loading).toBe(false);
    });

    it("runOptimization records the error on failure", async () => {
      const store = useReputationOptimizerStore();
      mockInvoke.mockResolvedValue({ success: false, error: "no svc" });
      await store.runOptimization();
      expect(store.error).toBe("no svc");
      expect(store.latestOptimization).toBeNull();
    });

    it("fetchAnalytics populates analytics", async () => {
      const store = useReputationOptimizerStore();
      mockInvoke.mockResolvedValue({
        success: true,
        analytics: [{ anomaly_detected: true }],
      });
      await store.fetchAnalytics({ nodeId: "n1" });
      expect(mockInvoke).toHaveBeenCalledWith(
        "reputation-optimizer:get-analytics",
        { nodeId: "n1" },
      );
      expect(store.analytics).toHaveLength(1);
    });

    it("detectAnomalies chains fetchAnalytics on success", async () => {
      const store = useReputationOptimizerStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, anomalies: 1 }) // detect
        .mockResolvedValueOnce({
          success: true,
          analytics: [{ anomaly_detected: true }],
        }); // analytics
      await store.detectAnomalies({ nodeScores: [] });
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "reputation-optimizer:detect-anomalies",
        { nodeScores: [] },
      );
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "reputation-optimizer:get-analytics",
        undefined,
      );
      expect(store.analytics).toHaveLength(1);
    });

    it("fetchHistory populates the history", async () => {
      const store = useReputationOptimizerStore();
      mockInvoke.mockResolvedValue({
        success: true,
        history: [{ improvement: 0.1 }, { improvement: 0.4 }],
      });
      await store.fetchHistory({ limit: 10 });
      expect(mockInvoke).toHaveBeenCalledWith(
        "reputation-optimizer:get-history",
        { limit: 10 },
      );
      expect(store.history).toHaveLength(2);
    });
  });
});
