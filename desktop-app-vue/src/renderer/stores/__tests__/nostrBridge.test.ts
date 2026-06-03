/**
 * useNostrBridgeStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: connectedRelays (status === 'connected') / relayCount
 *  - IPC actions (electronAPI.invoke mocked): fetchRelays (populate / error),
 *    addRelay (chains fetchRelays), publishEvent (return / error), fetchEvents
 *    (populate), generateKeyPair (set keyPair), mapDID (pass-through),
 *    publishReaction (NIP-25 pass-through)
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

import { useNostrBridgeStore } from "../nostrBridge";
import type { NostrRelay } from "../nostrBridge";

function relay(id: string, status: string): NostrRelay {
  return {
    id,
    url: `wss://${id}`,
    status,
    last_connected: null,
    event_count: 0,
    read_enabled: true,
    write_enabled: true,
  };
}

describe("useNostrBridgeStore", () => {
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
      const store = useNostrBridgeStore();
      expect(store.relays).toEqual([]);
      expect(store.events).toEqual([]);
      expect(store.keyPair).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("connectedRelays filters status === 'connected'; relayCount counts all", () => {
      const store = useNostrBridgeStore();
      store.relays = [
        relay("a", "connected"),
        relay("b", "disconnected"),
        relay("c", "connected"),
      ];
      expect(store.connectedRelays.map((r) => r.id)).toEqual(["a", "c"]);
      expect(store.relayCount).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // Relay + event actions
  // -------------------------------------------------------------------------

  describe("relay + event actions", () => {
    it("fetchRelays populates on success", async () => {
      const store = useNostrBridgeStore();
      mockInvoke.mockResolvedValue({
        success: true,
        relays: [relay("a", "connected"), relay("b", "disconnected")],
      });
      await store.fetchRelays();
      expect(mockInvoke).toHaveBeenCalledWith("nostr:list-relays");
      expect(store.relays.map((r) => r.id)).toEqual(["a", "b"]);
      expect(store.loading).toBe(false);
    });

    it("fetchRelays records the error on failure", async () => {
      const store = useNostrBridgeStore();
      mockInvoke.mockResolvedValue({ success: false, error: "no svc" });
      await store.fetchRelays();
      expect(store.error).toBe("no svc");
    });

    it("addRelay chains fetchRelays on success", async () => {
      const store = useNostrBridgeStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // add
        .mockResolvedValueOnce({
          success: true,
          relays: [relay("a", "connected")],
        }); // list
      await store.addRelay("wss://relay.example");
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "nostr:add-relay", {
        url: "wss://relay.example",
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "nostr:list-relays");
      expect(store.relays.map((r) => r.id)).toEqual(["a"]);
    });

    it("publishEvent returns the result and records errors", async () => {
      const store = useNostrBridgeStore();
      mockInvoke.mockResolvedValue({ success: true, eventId: "e1" });
      const ok = await store.publishEvent(1, "hello", [["t", "tag"]]);
      expect(mockInvoke).toHaveBeenCalledWith("nostr:publish-event", {
        kind: 1,
        content: "hello",
        tags: [["t", "tag"]],
      });
      expect(ok).toEqual({ success: true, eventId: "e1" });

      mockInvoke.mockResolvedValue({ success: false, error: "rejected" });
      await store.publishEvent(1, "x");
      expect(store.error).toBe("rejected");
    });

    it("fetchEvents populates the event list", async () => {
      const store = useNostrBridgeStore();
      mockInvoke.mockResolvedValue({
        success: true,
        events: [{ id: "e1" }, { id: "e2" }],
      });
      await store.fetchEvents([1], 50);
      expect(mockInvoke).toHaveBeenCalledWith("nostr:get-events", {
        kinds: [1],
        limit: 50,
        since: undefined,
      });
      expect(store.events).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Keys + DID + NIP extensions
  // -------------------------------------------------------------------------

  describe("keys + extensions", () => {
    it("generateKeyPair stores the key pair on success", async () => {
      const store = useNostrBridgeStore();
      const keyPair = {
        npub: "npub1...",
        nsec: "nsec1...",
        publicKeyHex: "ab",
        privateKeyHex: "cd",
      };
      mockInvoke.mockResolvedValue({ success: true, keyPair });
      await store.generateKeyPair();
      expect(mockInvoke).toHaveBeenCalledWith("nostr:generate-keypair");
      expect(store.keyPair).toEqual(keyPair);
    });

    it("mapDID forwards the did + keys", async () => {
      const store = useNostrBridgeStore();
      mockInvoke.mockResolvedValue({ success: true });
      await store.mapDID("did:me", "npub1...", "nsec1...");
      expect(mockInvoke).toHaveBeenCalledWith("nostr:map-did", {
        did: "did:me",
        npub: "npub1...",
        nsec: "nsec1...",
      });
    });

    it("publishReaction passes the NIP-25 result through", async () => {
      const store = useNostrBridgeStore();
      mockInvoke.mockResolvedValue({ success: true, eventId: "r1" });
      const result = await store.publishReaction({
        targetEventId: "e1",
        targetPubkey: "pk",
        content: "+",
      });
      expect(mockInvoke).toHaveBeenCalledWith("nostr:publish-reaction", {
        targetEventId: "e1",
        targetPubkey: "pk",
        content: "+",
      });
      expect(result).toEqual({ success: true, eventId: "r1" });
    });
  });
});
