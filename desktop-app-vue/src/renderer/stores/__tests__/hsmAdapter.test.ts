/**
 * useHsmAdapterStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getter: connectedAdapters (status === 'connected')
 *  - IPC actions (electronAPI.invoke mocked): fetchAdapters (populate),
 *    connectDevice (chains fetchAdapters), executeOperation (pass-through),
 *    fetchComplianceStatus (set status), rejection → { success: false, error }
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

import { useHsmAdapterStore } from "../hsmAdapter";

describe("useHsmAdapterStore", () => {
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
      const store = useHsmAdapterStore();
      expect(store.adapters).toEqual([]);
      expect(store.complianceStatus).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getter
  // -------------------------------------------------------------------------

  describe("connectedAdapters", () => {
    it("filters adapters with status === 'connected'", () => {
      const store = useHsmAdapterStore();
      store.adapters = [
        { id: "a", status: "connected" },
        { id: "b", status: "offline" },
        { id: "c", status: "connected" },
      ];
      expect(store.connectedAdapters.map((a: any) => a.id)).toEqual(["a", "c"]);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("fetchAdapters populates on success", async () => {
      const store = useHsmAdapterStore();
      mockInvoke.mockResolvedValue({
        success: true,
        adapters: [{ id: "a" }, { id: "b" }],
      });
      await store.fetchAdapters({ vendor: "thales" });
      expect(mockInvoke).toHaveBeenCalledWith("hsm:list-adapters", {
        vendor: "thales",
      });
      expect(store.adapters).toHaveLength(2);
      expect(store.loading).toBe(false);
    });

    it("connectDevice chains fetchAdapters on success", async () => {
      const store = useHsmAdapterStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // connect
        .mockResolvedValueOnce({ success: true, adapters: [{ id: "a" }] }); // list
      await store.connectDevice({ slot: 0 });
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "hsm:connect-device", {
        slot: 0,
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "hsm:list-adapters",
        undefined,
      );
      expect(store.adapters).toHaveLength(1);
    });

    it("executeOperation passes the result through", async () => {
      const store = useHsmAdapterStore();
      mockInvoke.mockResolvedValue({ success: true, output: "ok" });
      const result = await store.executeOperation({ op: "sign" });
      expect(mockInvoke).toHaveBeenCalledWith("hsm:execute-operation", {
        op: "sign",
      });
      expect(result).toEqual({ success: true, output: "ok" });
    });

    it("fetchComplianceStatus stores the status on success", async () => {
      const store = useHsmAdapterStore();
      mockInvoke.mockResolvedValue({
        success: true,
        status: { fips: true },
      });
      await store.fetchComplianceStatus();
      expect(mockInvoke).toHaveBeenCalledWith("hsm:get-compliance-status");
      expect(store.complianceStatus).toEqual({ fips: true });
    });

    it("returns a { success: false, error } envelope when IPC rejects", async () => {
      const store = useHsmAdapterStore();
      mockInvoke.mockRejectedValue(new Error("no device"));
      const result = await store.fetchAdapters();
      expect(result).toEqual({ success: false, error: "no device" });
      expect(store.adapters).toEqual([]);
      expect(store.loading).toBe(false);
    });
  });
});
