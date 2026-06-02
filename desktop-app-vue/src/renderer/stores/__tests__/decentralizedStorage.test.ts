/**
 * useDecentralizedStorageStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getter: activeDeals (status === 'active')
 *  - IPC actions (electronAPI.invoke mocked): storeToFilecoin / getDealStatus
 *    (pass-through), fetchStorageStats (set storageStats on success), rejection
 *    → { success: false, error } envelope
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

import { useDecentralizedStorageStore } from "../decentralizedStorage";

describe("useDecentralizedStorageStore", () => {
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
      const store = useDecentralizedStorageStore();
      expect(store.deals).toEqual([]);
      expect(store.storageStats).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getter
  // -------------------------------------------------------------------------

  describe("activeDeals", () => {
    it("filters deals with status === 'active'", () => {
      const store = useDecentralizedStorageStore();
      store.deals = [
        { id: "a", status: "active" },
        { id: "b", status: "expired" },
        { id: "c", status: "active" },
      ];
      expect(store.activeDeals.map((d: any) => d.id)).toEqual(["a", "c"]);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("storeToFilecoin forwards params and returns the result", async () => {
      const store = useDecentralizedStorageStore();
      mockInvoke.mockResolvedValue({ success: true, dealId: "d1" });
      const result = await store.storeToFilecoin({ cid: "Qm..." });
      expect(mockInvoke).toHaveBeenCalledWith("dstorage:store-to-filecoin", {
        cid: "Qm...",
      });
      expect(result).toEqual({ success: true, dealId: "d1" });
    });

    it("getDealStatus forwards the deal id", async () => {
      const store = useDecentralizedStorageStore();
      mockInvoke.mockResolvedValue({ success: true, status: "active" });
      const result = await store.getDealStatus("d1");
      expect(mockInvoke).toHaveBeenCalledWith("dstorage:get-deal-status", "d1");
      expect(result.status).toBe("active");
    });

    it("fetchStorageStats stores stats on success", async () => {
      const store = useDecentralizedStorageStore();
      mockInvoke.mockResolvedValue({
        success: true,
        stats: { used: 100, total: 1000 },
      });
      await store.fetchStorageStats();
      expect(mockInvoke).toHaveBeenCalledWith("dstorage:get-storage-stats");
      expect(store.storageStats).toEqual({ used: 100, total: 1000 });
    });

    it("returns a { success: false, error } envelope when IPC rejects", async () => {
      const store = useDecentralizedStorageStore();
      mockInvoke.mockRejectedValue(new Error("offline"));
      const result = await store.fetchStorageStats();
      expect(result).toEqual({ success: false, error: "offline" });
      expect(store.storageStats).toBeNull();
    });
  });
});
