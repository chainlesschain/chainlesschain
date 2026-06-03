/**
 * useProtocolFusionStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - IPC actions (electronAPI.invoke mocked): fetchFeed (populate), sendMessage
 *    (pass-through), mapIdentity (pass-through), fetchIdentityMap (3-way array
 *    normalization: array / single-object→wrapped / null→[]), fetchProtocolStatus
 *    (set status)
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

import { useProtocolFusionStore } from "../protocolFusion";

describe("useProtocolFusionStore", () => {
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
      const store = useProtocolFusionStore();
      expect(store.feed).toEqual([]);
      expect(store.identityMap).toEqual([]);
      expect(store.protocolStatus).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("fetchFeed populates on success", async () => {
      const store = useProtocolFusionStore();
      mockInvoke.mockResolvedValue({
        success: true,
        feed: [{ id: "m1" }, { id: "m2" }],
      });
      await store.fetchFeed({ protocol: "matrix" });
      expect(mockInvoke).toHaveBeenCalledWith(
        "protocol-fusion:get-unified-feed",
        { protocol: "matrix" },
      );
      expect(store.feed).toHaveLength(2);
      expect(store.loading).toBe(false);
    });

    it("sendMessage + mapIdentity pass results through", async () => {
      const store = useProtocolFusionStore();
      mockInvoke.mockResolvedValueOnce({ success: true, messageId: "x" });
      expect(await store.sendMessage({ to: "@a" })).toEqual({
        success: true,
        messageId: "x",
      });
      expect(mockInvoke).toHaveBeenLastCalledWith(
        "protocol-fusion:send-message",
        { to: "@a" },
      );

      mockInvoke.mockResolvedValueOnce({ success: true, mapped: true });
      expect(await store.mapIdentity({ did: "did:me" })).toEqual({
        success: true,
        mapped: true,
      });
      expect(mockInvoke).toHaveBeenLastCalledWith(
        "protocol-fusion:map-identity",
        { did: "did:me" },
      );
    });

    it("fetchIdentityMap keeps an array result as-is", async () => {
      const store = useProtocolFusionStore();
      mockInvoke.mockResolvedValue({
        success: true,
        map: [{ id: "a" }, { id: "b" }],
      });
      await store.fetchIdentityMap("did:me");
      expect(mockInvoke).toHaveBeenCalledWith(
        "protocol-fusion:get-identity-map",
        "did:me",
      );
      expect(store.identityMap).toHaveLength(2);
    });

    it("fetchIdentityMap wraps a single-object map into an array", async () => {
      const store = useProtocolFusionStore();
      mockInvoke.mockResolvedValue({ success: true, map: { id: "solo" } });
      await store.fetchIdentityMap();
      expect(store.identityMap).toEqual([{ id: "solo" }]);
    });

    it("fetchIdentityMap normalizes a null map to []", async () => {
      const store = useProtocolFusionStore();
      mockInvoke.mockResolvedValue({ success: true, map: null });
      await store.fetchIdentityMap();
      expect(store.identityMap).toEqual([]);
    });

    it("fetchProtocolStatus stores the status on success", async () => {
      const store = useProtocolFusionStore();
      mockInvoke.mockResolvedValue({
        success: true,
        status: { matrix: "up", nostr: "down" },
      });
      await store.fetchProtocolStatus();
      expect(mockInvoke).toHaveBeenCalledWith(
        "protocol-fusion:get-protocol-status",
      );
      expect(store.protocolStatus).toEqual({ matrix: "up", nostr: "down" });
    });
  });
});
