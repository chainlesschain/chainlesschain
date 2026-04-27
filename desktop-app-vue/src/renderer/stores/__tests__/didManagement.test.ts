/**
 * useDIDManagementStore — Pinia store unit tests (Phase 2 page port)
 *
 * Covers:
 *  - Initial state defaults
 *  - loadAll() success populates identities + currentDid
 *  - loadAll() get-current-identity failure leaves currentDid null
 *  - loadAll() top-level failure captures error
 *  - defaultIdentity computed: currentDid wins, else isDefault, else first
 *  - loadPublishStatus() per-identity invocation and result map
 *  - loadPublishStatus() per-identity failure falls back to false
 *  - loadPublishStatus() empty list resets to {}
 *  - setDefault() success triggers reload
 *  - deleteIdentity() success triggers reload + returns true
 *  - deleteIdentity() failure captures error + returns false
 *  - clearError()
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useDIDManagementStore } from "../didManagement";

describe("useDIDManagementStore (Phase 2)", () => {
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    invoke = vi.fn();
    (window as unknown as { electronAPI: unknown }).electronAPI = { invoke };
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it("initial state is empty with sensible defaults", () => {
    const store = useDIDManagementStore();
    expect(store.identities).toEqual([]);
    expect(store.currentDid).toBeNull();
    expect(store.publishStatus).toEqual({});
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
    expect(store.hasLoaded).toBe(false);
    expect(store.defaultIdentity).toBeNull();
  });

  it("loadAll() populates identities and currentDid on success", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "did:get-all-identities") {
        return Promise.resolve([
          { did: "did:cc:alice", displayName: "Alice" },
          { did: "did:cc:bob", displayName: "Bob" },
        ]);
      }
      if (channel === "did:get-current-identity") {
        return Promise.resolve({ did: "did:cc:bob", displayName: "Bob" });
      }
      return Promise.resolve(null);
    });

    const store = useDIDManagementStore();
    await store.loadAll();

    expect(store.identities).toHaveLength(2);
    expect(store.currentDid).toBe("did:cc:bob");
    expect(store.hasLoaded).toBe(true);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  it("loadAll() leaves currentDid null when get-current-identity throws", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "did:get-all-identities") {
        return Promise.resolve([{ did: "did:cc:alice" }]);
      }
      if (channel === "did:get-current-identity") {
        return Promise.reject(new Error("no default set"));
      }
      return Promise.resolve(null);
    });

    const store = useDIDManagementStore();
    await store.loadAll();

    expect(store.identities).toHaveLength(1);
    expect(store.currentDid).toBeNull();
    expect(store.hasLoaded).toBe(true);
    expect(store.error).toBeNull();
  });

  it("loadAll() captures top-level error", async () => {
    invoke.mockRejectedValueOnce(new Error("ipc down"));
    const store = useDIDManagementStore();
    await store.loadAll();
    expect(store.error).toBe("ipc down");
    expect(store.hasLoaded).toBe(false);
    expect(store.loading).toBe(false);
  });

  it("defaultIdentity prefers currentDid over isDefault flag", () => {
    const store = useDIDManagementStore();
    store.$patch({
      identities: [{ did: "did:cc:a", isDefault: true }, { did: "did:cc:b" }],
      currentDid: "did:cc:b",
    });
    expect(store.defaultIdentity?.did).toBe("did:cc:b");
  });

  it("defaultIdentity falls back to isDefault when currentDid is null", () => {
    const store = useDIDManagementStore();
    store.$patch({
      identities: [{ did: "did:cc:a" }, { did: "did:cc:b", isDefault: true }],
      currentDid: null,
    });
    expect(store.defaultIdentity?.did).toBe("did:cc:b");
  });

  it("defaultIdentity falls back to first identity when none flagged", () => {
    const store = useDIDManagementStore();
    store.$patch({
      identities: [{ did: "did:cc:a" }, { did: "did:cc:b" }],
      currentDid: null,
    });
    expect(store.defaultIdentity?.did).toBe("did:cc:a");
  });

  it("loadPublishStatus() invokes per-identity and writes status map", async () => {
    invoke.mockImplementation((channel: string, did?: string) => {
      if (channel === "did:is-published-to-dht") {
        return Promise.resolve(did === "did:cc:a");
      }
      return Promise.resolve(null);
    });

    const store = useDIDManagementStore();
    store.$patch({
      identities: [{ did: "did:cc:a" }, { did: "did:cc:b" }],
    });
    await store.loadPublishStatus();

    expect(invoke).toHaveBeenCalledWith("did:is-published-to-dht", "did:cc:a");
    expect(invoke).toHaveBeenCalledWith("did:is-published-to-dht", "did:cc:b");
    expect(store.publishStatus).toEqual({
      "did:cc:a": true,
      "did:cc:b": false,
    });
  });

  it("loadPublishStatus() falls back to false when an IPC throws", async () => {
    invoke.mockImplementation((channel: string, did?: string) => {
      if (channel === "did:is-published-to-dht") {
        if (did === "did:cc:a") {
          return Promise.reject(new Error("dht offline"));
        }
        return Promise.resolve(true);
      }
      return Promise.resolve(null);
    });

    const store = useDIDManagementStore();
    store.$patch({
      identities: [{ did: "did:cc:a" }, { did: "did:cc:b" }],
    });
    await store.loadPublishStatus();

    expect(store.publishStatus["did:cc:a"]).toBe(false);
    expect(store.publishStatus["did:cc:b"]).toBe(true);
  });

  it("loadPublishStatus() resets to {} when identity list is empty", async () => {
    const store = useDIDManagementStore();
    store.$patch({ publishStatus: { stale: true } });
    await store.loadPublishStatus();
    expect(store.publishStatus).toEqual({});
    expect(invoke).not.toHaveBeenCalled();
  });

  it("setDefault() invokes IPC and triggers loadAll", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "did:set-default-identity") {
        return Promise.resolve(true);
      }
      if (channel === "did:get-all-identities") {
        return Promise.resolve([{ did: "did:cc:a" }]);
      }
      if (channel === "did:get-current-identity") {
        return Promise.resolve({ did: "did:cc:a" });
      }
      return Promise.resolve(null);
    });

    const store = useDIDManagementStore();
    await store.setDefault("did:cc:a");

    expect(invoke).toHaveBeenCalledWith("did:set-default-identity", "did:cc:a");
    expect(invoke).toHaveBeenCalledWith("did:get-all-identities");
    expect(store.currentDid).toBe("did:cc:a");
  });

  it("deleteIdentity() returns true on success and reloads", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "did:delete-identity") {
        return Promise.resolve(true);
      }
      if (channel === "did:get-all-identities") {
        return Promise.resolve([]);
      }
      if (channel === "did:get-current-identity") {
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });

    const store = useDIDManagementStore();
    const ok = await store.deleteIdentity("did:cc:gone");

    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("did:delete-identity", "did:cc:gone");
    expect(store.identities).toEqual([]);
  });

  it("deleteIdentity() returns false and captures error on failure", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "did:delete-identity") {
        return Promise.reject(new Error("locked"));
      }
      return Promise.resolve(null);
    });

    const store = useDIDManagementStore();
    const ok = await store.deleteIdentity("did:cc:locked");

    expect(ok).toBe(false);
    expect(store.error).toBe("locked");
  });

  it("clearError() resets error to null", () => {
    const store = useDIDManagementStore();
    store.$patch({ error: "boom" });
    store.clearError();
    expect(store.error).toBeNull();
  });
});
