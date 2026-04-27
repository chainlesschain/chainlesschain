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

  // ---- Phase 3: creation wizard ---------------------------------------------

  it("openCreateForm() resets pending state and enters form step", () => {
    const store = useDIDManagementStore();
    store.$patch({
      pendingMnemonic: "stale words",
      pendingDid: "did:cc:stale",
      mnemonicCopied: true,
      creationError: "old",
    });
    store.openCreateForm();
    expect(store.creationFlow).toBe("form");
    expect(store.pendingMnemonic).toBeNull();
    expect(store.pendingDid).toBeNull();
    expect(store.mnemonicCopied).toBe(false);
    expect(store.creationError).toBeNull();
  });

  it("closeCreateForm() goes back to idle from form", () => {
    const store = useDIDManagementStore();
    store.openCreateForm();
    store.closeCreateForm();
    expect(store.creationFlow).toBe("idle");
  });

  it("closeCreateForm() refuses to interrupt a submitting flow", () => {
    const store = useDIDManagementStore();
    store.$patch({ creationFlow: "submitting" });
    store.closeCreateForm();
    expect(store.creationFlow).toBe("submitting");
  });

  it("createIdentity() with import path skips mnemonic-display and reloads", async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = [];
    invoke.mockImplementation((channel: string, ...args: unknown[]) => {
      calls.push({ channel, args });
      if (channel === "did:validate-mnemonic") {
        return Promise.resolve(true);
      }
      if (channel === "did:create-from-mnemonic") {
        return Promise.resolve({ did: "did:cc:imported" });
      }
      if (channel === "did:get-all-identities") {
        return Promise.resolve([{ did: "did:cc:imported" }]);
      }
      if (channel === "did:get-current-identity") {
        return Promise.resolve({ did: "did:cc:imported" });
      }
      if (channel === "did:is-published-to-dht") {
        return Promise.resolve(false);
      }
      return Promise.resolve(null);
    });

    const store = useDIDManagementStore();
    store.openCreateForm();
    const ok = await store.createIdentity({
      nickname: "Imported",
      importMnemonic: "twelve words go here for the test mnemonic input",
      setAsDefault: true,
    });

    expect(ok).toBe(true);
    expect(store.creationFlow).toBe("idle");
    expect(store.pendingMnemonic).toBeNull();
    expect(invoke).toHaveBeenCalledWith(
      "did:validate-mnemonic",
      "twelve words go here for the test mnemonic input",
    );
    expect(invoke).not.toHaveBeenCalledWith("did:generate-mnemonic");
    const createCall = calls.find(
      (c) => c.channel === "did:create-from-mnemonic",
    );
    expect(createCall).toBeTruthy();
    expect(createCall!.args[2]).toEqual({ setAsDefault: true });
  });

  it("createIdentity() generates mnemonic and enters mnemonic-display when not importing", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "did:generate-mnemonic") {
        return Promise.resolve("alpha bravo charlie delta echo");
      }
      if (channel === "did:create-from-mnemonic") {
        return Promise.resolve({ did: "did:cc:fresh" });
      }
      if (channel === "did:get-all-identities") {
        return Promise.resolve([{ did: "did:cc:fresh" }]);
      }
      if (channel === "did:get-current-identity") {
        return Promise.resolve({ did: "did:cc:fresh" });
      }
      if (channel === "did:is-published-to-dht") {
        return Promise.resolve(false);
      }
      return Promise.resolve(null);
    });

    const store = useDIDManagementStore();
    store.openCreateForm();
    const ok = await store.createIdentity({ nickname: "Fresh" });

    expect(ok).toBe(true);
    expect(store.creationFlow).toBe("mnemonic-display");
    expect(store.pendingMnemonic).toBe("alpha bravo charlie delta echo");
    expect(store.pendingDid).toBe("did:cc:fresh");
    expect(store.mnemonicCopied).toBe(false);
  });

  it("createIdentity() with invalid import mnemonic stays in form with error", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "did:validate-mnemonic") {
        return Promise.resolve(false);
      }
      return Promise.resolve(null);
    });

    const store = useDIDManagementStore();
    store.openCreateForm();
    const ok = await store.createIdentity({
      nickname: "Bad",
      importMnemonic: "not enough words",
    });

    expect(ok).toBe(false);
    expect(store.creationFlow).toBe("form");
    expect(store.creationError).toMatch(/无效/);
    expect(invoke).not.toHaveBeenCalledWith(
      "did:create-from-mnemonic",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("createIdentity() with empty nickname returns false without IPC", async () => {
    const store = useDIDManagementStore();
    store.openCreateForm();
    const ok = await store.createIdentity({ nickname: "  " });
    expect(ok).toBe(false);
    expect(store.creationError).toMatch(/昵称/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("createIdentity() captures backend error and returns to form", async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === "did:generate-mnemonic") {
        return Promise.resolve("words words words");
      }
      if (channel === "did:create-from-mnemonic") {
        return Promise.reject(new Error("disk full"));
      }
      return Promise.resolve(null);
    });

    const store = useDIDManagementStore();
    store.openCreateForm();
    const ok = await store.createIdentity({ nickname: "Fresh" });
    expect(ok).toBe(false);
    expect(store.creationFlow).toBe("form");
    expect(store.creationError).toBe("disk full");
  });

  it("dismissMnemonic() refuses until mnemonicCopied is true", async () => {
    const store = useDIDManagementStore();
    store.$patch({
      creationFlow: "mnemonic-display",
      pendingMnemonic: "x y z",
      mnemonicCopied: false,
    });
    expect(store.dismissMnemonic()).toBe(false);
    expect(store.creationFlow).toBe("mnemonic-display");

    store.markMnemonicCopied();
    expect(store.dismissMnemonic()).toBe(true);
    expect(store.creationFlow).toBe("idle");
    expect(store.pendingMnemonic).toBeNull();
  });

  it("dismissMnemonic() is a no-op outside the mnemonic-display step", () => {
    const store = useDIDManagementStore();
    store.$patch({ creationFlow: "form", mnemonicCopied: true });
    expect(store.dismissMnemonic()).toBe(false);
    expect(store.creationFlow).toBe("form");
  });

  it("clearCreationError() resets only creationError", () => {
    const store = useDIDManagementStore();
    store.$patch({ creationError: "boom", error: "other" });
    store.clearCreationError();
    expect(store.creationError).toBeNull();
    expect(store.error).toBe("other");
  });
});
