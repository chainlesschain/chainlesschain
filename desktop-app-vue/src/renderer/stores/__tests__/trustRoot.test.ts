/**
 * useTrustRootStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - IPC actions (electronAPI.invoke mocked): fetchStatus (set status / error),
 *    verifyChain (forward deviceId), syncKeys (pass-through), bindFingerprint
 *    (forward {deviceId, fingerprint}), fetchBootStatus (set bootStatus)
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

import { useTrustRootStore } from "../trustRoot";

describe("useTrustRootStore", () => {
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
      const store = useTrustRootStore();
      expect(store.status).toBeNull();
      expect(store.bootStatus).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("fetchStatus stores the status on success", async () => {
      const store = useTrustRootStore();
      mockInvoke.mockResolvedValue({
        success: true,
        status: { rootOk: true },
      });
      await store.fetchStatus();
      expect(mockInvoke).toHaveBeenCalledWith("trust-root:get-status");
      expect(store.status).toEqual({ rootOk: true });
      expect(store.loading).toBe(false);
    });

    it("fetchStatus records the error envelope on rejection", async () => {
      const store = useTrustRootStore();
      mockInvoke.mockRejectedValue(new Error("hsm down"));
      const result = await store.fetchStatus();
      expect(result).toEqual({ success: false, error: "hsm down" });
      expect(store.error).toBe("hsm down");
      expect(store.loading).toBe(false);
    });

    it("verifyChain forwards the device id", async () => {
      const store = useTrustRootStore();
      mockInvoke.mockResolvedValue({ success: true, valid: true });
      const result = await store.verifyChain("dev-1");
      expect(mockInvoke).toHaveBeenCalledWith(
        "trust-root:verify-chain",
        "dev-1",
      );
      expect(result).toEqual({ success: true, valid: true });
    });

    it("syncKeys passes params through", async () => {
      const store = useTrustRootStore();
      mockInvoke.mockResolvedValue({ success: true, synced: 2 });
      const result = await store.syncKeys({ peer: "node" });
      expect(mockInvoke).toHaveBeenCalledWith("trust-root:sync-keys", {
        peer: "node",
      });
      expect(result).toEqual({ success: true, synced: 2 });
    });

    it("bindFingerprint forwards deviceId + fingerprint", async () => {
      const store = useTrustRootStore();
      mockInvoke.mockResolvedValue({ success: true });
      await store.bindFingerprint("dev-1", "fp-abc");
      expect(mockInvoke).toHaveBeenCalledWith("trust-root:bind-fingerprint", {
        deviceId: "dev-1",
        fingerprint: "fp-abc",
      });
    });

    it("fetchBootStatus stores the boot status on success", async () => {
      const store = useTrustRootStore();
      mockInvoke.mockResolvedValue({
        success: true,
        bootStatus: { verified: true },
      });
      await store.fetchBootStatus();
      expect(mockInvoke).toHaveBeenCalledWith("trust-root:get-boot-status");
      expect(store.bootStatus).toEqual({ verified: true });
    });
  });
});
