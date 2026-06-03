/**
 * useSiemStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: activeTargets (status === 'active') / totalExported
 *    (stats?.totalExported || 0)
 *  - IPC actions (electronAPI.invoke mocked): fetchTargets (populate / error),
 *    addTarget (chains fetchTargets), exportLogs (chains fetchStats), fetchStats
 *    (set stats)
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

import { useSiemStore } from "../siem";
import type { SIEMTarget } from "../siem";

function target(id: string, status: string): SIEMTarget {
  return {
    id,
    target_type: "splunk",
    target_url: "https://siem",
    format: "json",
    exported_count: 0,
    last_export_at: null,
    status,
    created_at: 1700000000000,
  };
}

describe("useSiemStore", () => {
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
      const store = useSiemStore();
      expect(store.targets).toEqual([]);
      expect(store.stats).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("activeTargets filters status === 'active'", () => {
      const store = useSiemStore();
      store.targets = [
        target("a", "active"),
        target("b", "disabled"),
        target("c", "active"),
      ];
      expect(store.activeTargets.map((t) => t.id)).toEqual(["a", "c"]);
    });

    it("totalExported reads stats, defaulting to 0", () => {
      const store = useSiemStore();
      expect(store.totalExported).toBe(0);
      store.stats = { targets: [], totalExported: 42 };
      expect(store.totalExported).toBe(42);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("fetchTargets populates on success", async () => {
      const store = useSiemStore();
      mockInvoke.mockResolvedValue({
        success: true,
        targets: [target("a", "active"), target("b", "disabled")],
      });
      await store.fetchTargets();
      expect(mockInvoke).toHaveBeenCalledWith("siem:list-targets");
      expect(store.targets.map((t) => t.id)).toEqual(["a", "b"]);
      expect(store.loading).toBe(false);
    });

    it("fetchTargets records the error on failure", async () => {
      const store = useSiemStore();
      mockInvoke.mockResolvedValue({ success: false, error: "no svc" });
      await store.fetchTargets();
      expect(store.error).toBe("no svc");
    });

    it("addTarget chains fetchTargets on success", async () => {
      const store = useSiemStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // add
        .mockResolvedValueOnce({
          success: true,
          targets: [target("n", "active")],
        }); // list
      await store.addTarget("splunk", "https://x", "json", { token: "t" });
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "siem:add-target", {
        type: "splunk",
        url: "https://x",
        format: "json",
        config: { token: "t" },
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "siem:list-targets");
      expect(store.targets.map((t) => t.id)).toEqual(["n"]);
    });

    it("exportLogs chains fetchStats on success", async () => {
      const store = useSiemStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, exported: 5 }) // export
        .mockResolvedValueOnce({
          success: true,
          stats: { targets: [], totalExported: 5 },
        }); // stats
      await store.exportLogs("t1", 100);
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "siem:export-logs", {
        targetId: "t1",
        limit: 100,
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "siem:get-stats");
      expect(store.stats?.totalExported).toBe(5);
    });

    it("fetchStats stores stats on success", async () => {
      const store = useSiemStore();
      mockInvoke.mockResolvedValue({
        success: true,
        stats: { targets: [], totalExported: 9 },
      });
      await store.fetchStats();
      expect(mockInvoke).toHaveBeenCalledWith("siem:get-stats");
      expect(store.stats?.totalExported).toBe(9);
    });
  });
});
