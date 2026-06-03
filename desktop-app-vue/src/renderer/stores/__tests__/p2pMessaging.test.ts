/**
 * useP2PMessagingStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: isOnline (nodeInfo !== null) / peerCount (peers.length)
 *  - IPC actions (window.electronAPI.invoke mocked): loadAll (3-channel fan-out,
 *    Array.isArray peer guard, nullish node/nat, hasLoaded flag, error path),
 *    clearError
 *
 * NB: setup-style store reading window.electronAPI lazily via api() inside
 * loadAll, so we stub window.electronAPI per-test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useP2PMessagingStore } from "../p2pMessaging";

const mockInvoke = vi.fn();

describe("useP2PMessagingStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue(null);
    (window as any).electronAPI = { invoke: mockInvoke };
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as any).electronAPI;
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty and not loaded", () => {
      const store = useP2PMessagingStore();
      expect(store.nodeInfo).toBeNull();
      expect(store.peers).toEqual([]);
      expect(store.natInfo).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
      expect(store.hasLoaded).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("isOnline reflects nodeInfo presence", () => {
      const store = useP2PMessagingStore();
      expect(store.isOnline).toBe(false);
      store.nodeInfo = { peerId: "p1" };
      expect(store.isOnline).toBe(true);
    });

    it("peerCount mirrors the peers length", () => {
      const store = useP2PMessagingStore();
      store.peers = [{ peerId: "a" }, { peerId: "b" }];
      expect(store.peerCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // loadAll
  // -------------------------------------------------------------------------

  describe("loadAll", () => {
    it("fans out across the three get-* channels and populates state", async () => {
      const store = useP2PMessagingStore();
      mockInvoke.mockImplementation((channel: string) => {
        if (channel === "p2p:get-node-info")
          return Promise.resolve({ peerId: "me" });
        if (channel === "p2p:get-peers")
          return Promise.resolve([{ peerId: "a" }, { peerId: "b" }]);
        if (channel === "p2p:get-nat-info")
          return Promise.resolve({ type: "cone", reachable: true });
        return Promise.resolve(null);
      });
      await store.loadAll();
      expect(mockInvoke).toHaveBeenCalledWith("p2p:get-node-info");
      expect(mockInvoke).toHaveBeenCalledWith("p2p:get-peers");
      expect(mockInvoke).toHaveBeenCalledWith("p2p:get-nat-info");
      expect(store.nodeInfo).toEqual({ peerId: "me" });
      expect(store.peers).toHaveLength(2);
      expect(store.natInfo).toEqual({ type: "cone", reachable: true });
      expect(store.hasLoaded).toBe(true);
      expect(store.loading).toBe(false);
    });

    it("coerces a non-array peer result to [] and null node/nat", async () => {
      const store = useP2PMessagingStore();
      mockInvoke.mockResolvedValue(null); // every channel returns null
      await store.loadAll();
      expect(store.nodeInfo).toBeNull();
      expect(store.peers).toEqual([]);
      expect(store.natInfo).toBeNull();
      expect(store.hasLoaded).toBe(true);
    });

    it("records the error and clears loading when a call rejects", async () => {
      const store = useP2PMessagingStore();
      mockInvoke.mockRejectedValue(new Error("p2p down"));
      await store.loadAll();
      expect(store.error).toBe("p2p down");
      expect(store.loading).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // clearError
  // -------------------------------------------------------------------------

  describe("clearError", () => {
    it("resets the error", () => {
      const store = useP2PMessagingStore();
      store.error = "x";
      store.clearError();
      expect(store.error).toBeNull();
    });
  });
});
