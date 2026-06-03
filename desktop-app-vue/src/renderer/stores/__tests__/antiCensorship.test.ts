/**
 * useAntiCensorshipStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - IPC actions (electronAPI.invoke mocked): startTor (set torStatus),
 *    fetchTorStatus (set torStatus), enableDomainFronting (pass-through),
 *    startMesh (pass-through), fetchConnectivityReport (set connectivityReport)
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

import { useAntiCensorshipStore } from "../antiCensorship";

describe("useAntiCensorshipStore", () => {
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
      const store = useAntiCensorshipStore();
      expect(store.torStatus).toBeNull();
      expect(store.connectivityReport).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("startTor stores the tor status on success", async () => {
      const store = useAntiCensorshipStore();
      mockInvoke.mockResolvedValue({
        success: true,
        status: { bootstrapped: true },
      });
      await store.startTor();
      expect(mockInvoke).toHaveBeenCalledWith("anti-censorship:start-tor");
      expect(store.torStatus).toEqual({ bootstrapped: true });
      expect(store.loading).toBe(false);
    });

    it("fetchTorStatus stores the tor status on success", async () => {
      const store = useAntiCensorshipStore();
      mockInvoke.mockResolvedValue({
        success: true,
        status: { circuits: 3 },
      });
      await store.fetchTorStatus();
      expect(mockInvoke).toHaveBeenCalledWith("anti-censorship:get-tor-status");
      expect(store.torStatus).toEqual({ circuits: 3 });
    });

    it("enableDomainFronting passes params + result through", async () => {
      const store = useAntiCensorshipStore();
      mockInvoke.mockResolvedValue({ success: true, fronted: true });
      const result = await store.enableDomainFronting({ host: "cdn" });
      expect(mockInvoke).toHaveBeenCalledWith(
        "anti-censorship:enable-domain-fronting",
        { host: "cdn" },
      );
      expect(result).toEqual({ success: true, fronted: true });
    });

    it("startMesh passes the result through", async () => {
      const store = useAntiCensorshipStore();
      mockInvoke.mockResolvedValue({ success: true, meshId: "m1" });
      const result = await store.startMesh();
      expect(mockInvoke).toHaveBeenCalledWith("anti-censorship:start-mesh");
      expect(result).toEqual({ success: true, meshId: "m1" });
    });

    it("fetchConnectivityReport stores the report on success", async () => {
      const store = useAntiCensorshipStore();
      mockInvoke.mockResolvedValue({
        success: true,
        report: { reachable: true },
      });
      await store.fetchConnectivityReport();
      expect(mockInvoke).toHaveBeenCalledWith(
        "anti-censorship:get-connectivity-report",
      );
      expect(store.connectivityReport).toEqual({ reachable: true });
    });

    it("returns a { success: false, error } envelope when IPC rejects", async () => {
      const store = useAntiCensorshipStore();
      mockInvoke.mockRejectedValue(new Error("blocked"));
      const result = await store.startTor();
      expect(result).toEqual({ success: false, error: "blocked" });
      expect(store.torStatus).toBeNull();
      expect(store.loading).toBe(false);
    });
  });
});
