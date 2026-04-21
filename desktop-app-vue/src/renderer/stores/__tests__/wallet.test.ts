/**
 * useWalletStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state defaults
 *  - loadAll() populates wallets + hasLoaded
 *  - loadAll() tolerates null / undefined / non-array from invoke
 *  - loadAll() thrown error captured in error ref
 *  - defaultWallet getter: picks wallet with isDefault=true; falls back to first; null on empty
 *  - setDefault() calls IPC with correct payload then refreshes list
 *  - setDefault() thrown error captured
 *  - clearError() resets error
 *  - loading flag toggles during loadAll
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useWalletStore, type WalletSummary } from "../wallet";

describe("useWalletStore", () => {
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

  it("initializes with empty state", () => {
    const store = useWalletStore();
    expect(store.wallets).toEqual([]);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
    expect(store.hasLoaded).toBe(false);
    expect(store.defaultWallet).toBeNull();
  });

  it("loadAll() populates wallets + hasLoaded", async () => {
    const fake: WalletSummary[] = [
      { id: "w1", address: "0xaa", name: "Alice" },
      { id: "w2", address: "0xbb", name: "Bob", isDefault: true },
    ];
    invoke.mockResolvedValueOnce(fake);
    const store = useWalletStore();
    await store.loadAll();
    expect(store.wallets).toEqual(fake);
    expect(store.hasLoaded).toBe(true);
    expect(store.loading).toBe(false);
    expect(invoke).toHaveBeenCalledWith("wallet:get-all");
  });

  it("loadAll() tolerates null", async () => {
    invoke.mockResolvedValueOnce(null);
    const store = useWalletStore();
    await store.loadAll();
    expect(store.wallets).toEqual([]);
    expect(store.hasLoaded).toBe(true);
  });

  it("loadAll() tolerates non-array response", async () => {
    invoke.mockResolvedValueOnce({ unexpected: true });
    const store = useWalletStore();
    await store.loadAll();
    expect(store.wallets).toEqual([]);
    expect(store.hasLoaded).toBe(true);
  });

  it("loadAll() without electronAPI stays empty", async () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    const store = useWalletStore();
    await store.loadAll();
    expect(store.wallets).toEqual([]);
    expect(store.hasLoaded).toBe(true);
  });

  it("loadAll() thrown error captured", async () => {
    invoke.mockRejectedValueOnce(new Error("rpc down"));
    const store = useWalletStore();
    await store.loadAll();
    expect(store.error).toBe("rpc down");
    expect(store.loading).toBe(false);
  });

  it("defaultWallet prefers isDefault=true", async () => {
    invoke.mockResolvedValueOnce([
      { id: "w1", isDefault: false },
      { id: "w2", isDefault: true },
      { id: "w3" },
    ]);
    const store = useWalletStore();
    await store.loadAll();
    expect(store.defaultWallet?.id).toBe("w2");
  });

  it("defaultWallet falls back to first wallet when none marked default", async () => {
    invoke.mockResolvedValueOnce([{ id: "w1" }, { id: "w2" }]);
    const store = useWalletStore();
    await store.loadAll();
    expect(store.defaultWallet?.id).toBe("w1");
  });

  it("defaultWallet is null for empty list", async () => {
    invoke.mockResolvedValueOnce([]);
    const store = useWalletStore();
    await store.loadAll();
    expect(store.defaultWallet).toBeNull();
  });

  it("setDefault() invokes wallet:set-default then refreshes", async () => {
    invoke
      .mockResolvedValueOnce(undefined) // set-default
      .mockResolvedValueOnce([{ id: "w3", isDefault: true }]); // refresh
    const store = useWalletStore();
    await store.setDefault("w3");
    expect(invoke.mock.calls[0]).toEqual([
      "wallet:set-default",
      { walletId: "w3" },
    ]);
    expect(invoke.mock.calls[1][0]).toBe("wallet:get-all");
    expect(store.wallets).toEqual([{ id: "w3", isDefault: true }]);
  });

  it("setDefault() thrown error captured", async () => {
    invoke.mockRejectedValueOnce(new Error("forbidden"));
    const store = useWalletStore();
    await store.setDefault("w1");
    expect(store.error).toBe("forbidden");
  });

  it("clearError() nulls the error", async () => {
    invoke.mockRejectedValueOnce(new Error("boom"));
    const store = useWalletStore();
    await store.loadAll();
    expect(store.error).toBe("boom");
    store.clearError();
    expect(store.error).toBeNull();
  });

  it("loading flag toggles during loadAll", async () => {
    let resolveIt: (v: unknown) => void = () => {};
    invoke.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveIt = r;
        }),
    );
    const store = useWalletStore();
    const p = store.loadAll();
    expect(store.loading).toBe(true);
    resolveIt([]);
    await p;
    expect(store.loading).toBe(false);
  });
});
