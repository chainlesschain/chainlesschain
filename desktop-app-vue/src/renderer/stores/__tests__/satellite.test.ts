/**
 * useSatelliteStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - IPC actions (electronAPI.invoke mocked): sendMessage (pass-through),
 *    fetchMessages (populate), syncSignatures (pass-through), emergencyRevoke
 *    (forward keyId), fetchRecoveryStatus (set recoveryStatus), rejection
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

import { useSatelliteStore } from "../satellite";

describe("useSatelliteStore", () => {
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
      const store = useSatelliteStore();
      expect(store.messages).toEqual([]);
      expect(store.recoveryStatus).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("sendMessage forwards params and returns the result", async () => {
      const store = useSatelliteStore();
      mockInvoke.mockResolvedValue({ success: true, messageId: "m1" });
      const result = await store.sendMessage({ to: "node", body: "hi" });
      expect(mockInvoke).toHaveBeenCalledWith("satellite:send-message", {
        to: "node",
        body: "hi",
      });
      expect(result).toEqual({ success: true, messageId: "m1" });
    });

    it("fetchMessages populates the list on success", async () => {
      const store = useSatelliteStore();
      mockInvoke.mockResolvedValue({
        success: true,
        messages: [{ id: "a" }, { id: "b" }],
      });
      await store.fetchMessages({ since: 0 });
      expect(mockInvoke).toHaveBeenCalledWith("satellite:get-messages", {
        since: 0,
      });
      expect(store.messages).toHaveLength(2);
      expect(store.loading).toBe(false);
    });

    it("syncSignatures passes the result through", async () => {
      const store = useSatelliteStore();
      mockInvoke.mockResolvedValue({ success: true, synced: 3 });
      const result = await store.syncSignatures();
      expect(mockInvoke).toHaveBeenCalledWith("satellite:sync-signatures");
      expect(result).toEqual({ success: true, synced: 3 });
    });

    it("emergencyRevoke forwards the key id", async () => {
      const store = useSatelliteStore();
      mockInvoke.mockResolvedValue({ success: true });
      await store.emergencyRevoke("key-1");
      expect(mockInvoke).toHaveBeenCalledWith(
        "satellite:emergency-revoke",
        "key-1",
      );
    });

    it("fetchRecoveryStatus stores the status on success", async () => {
      const store = useSatelliteStore();
      mockInvoke.mockResolvedValue({
        success: true,
        status: { phase: "ready" },
      });
      await store.fetchRecoveryStatus();
      expect(mockInvoke).toHaveBeenCalledWith("satellite:get-recovery-status");
      expect(store.recoveryStatus).toEqual({ phase: "ready" });
    });

    it("returns a { success: false, error } envelope when IPC rejects", async () => {
      const store = useSatelliteStore();
      mockInvoke.mockRejectedValue(new Error("no link"));
      const result = await store.fetchMessages();
      expect(result).toEqual({ success: false, error: "no link" });
      expect(store.messages).toEqual([]);
      expect(store.loading).toBe(false);
    });
  });
});
