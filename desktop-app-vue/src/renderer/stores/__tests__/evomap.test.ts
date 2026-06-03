/**
 * useEvoMapStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape (node status defaults + empty lists)
 *  - Pure getters: isRegistered / creditBalance / publishedCount /
 *    fetchedCount / importedCount
 *  - IPC actions (window.electronAPI.invoke mocked): register (refresh status on
 *    success / error on failure), getStatus (populate nodeStatus), refreshCredits,
 *    searchAssets (data.assets vs data fallback + error path), fetchTrending
 *
 * NB: store calls (window as any).electronAPI.invoke directly, so we stub
 * window.electronAPI per-test rather than vi.mock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useEvoMapStore } from "../evomap";
import type { EvoMapAsset } from "../evomap";

const mockInvoke = vi.fn();

function asset(
  asset_id: string,
  overrides: Partial<EvoMapAsset> = {},
): EvoMapAsset {
  return {
    asset_id,
    type: "instinct",
    status: "active",
    direction: "published",
    content: "",
    summary: "",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...overrides,
  };
}

describe("useEvoMapStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue({ success: true });
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
    it("starts unregistered with empty lists", () => {
      const store = useEvoMapStore();
      expect(store.nodeStatus.registered).toBe(false);
      expect(store.nodeStatus.credits).toBe(0);
      expect(store.nodeStatus.heartbeatInterval).toBe(900000);
      expect(store.assets).toEqual([]);
      expect(store.trendingAssets).toEqual([]);
      expect(store.searchResults).toEqual([]);
      expect(store.config).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("isRegistered + creditBalance read nodeStatus", () => {
      const store = useEvoMapStore();
      expect(store.isRegistered).toBe(false);
      expect(store.creditBalance).toBe(0);
      store.nodeStatus.registered = true;
      store.nodeStatus.credits = 120;
      expect(store.isRegistered).toBe(true);
      expect(store.creditBalance).toBe(120);
    });

    it("publishedCount / fetchedCount split by direction", () => {
      const store = useEvoMapStore();
      store.assets = [
        asset("a", { direction: "published" }),
        asset("b", { direction: "fetched" }),
        asset("c", { direction: "published" }),
      ];
      expect(store.publishedCount).toBe(2);
      expect(store.fetchedCount).toBe(1);
    });

    it("importedCount counts status === 'imported'", () => {
      const store = useEvoMapStore();
      store.assets = [
        asset("a", { status: "imported" }),
        asset("b", { status: "active" }),
        asset("c", { status: "imported" }),
      ];
      expect(store.importedCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Node-management actions
  // -------------------------------------------------------------------------

  describe("node actions", () => {
    it("register refreshes status on success", async () => {
      const store = useEvoMapStore();
      const status = {
        nodeId: "n1",
        credits: 10,
        reputation: 1,
        registered: true,
        lastHeartbeat: null,
        heartbeatInterval: 900000,
        initialized: true,
      };
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // evomap:register
        .mockResolvedValueOnce({ success: true, data: status }); // evomap:get-status
      const result = await store.register();
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "evomap:register");
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "evomap:get-status");
      expect(result.success).toBe(true);
      expect(store.nodeStatus.nodeId).toBe("n1");
      expect(store.loading).toBe(false);
    });

    it("register records the error on failure", async () => {
      const store = useEvoMapStore();
      mockInvoke.mockResolvedValue({ success: false, error: "hub down" });
      await store.register();
      expect(store.error).toBe("hub down");
      expect(store.loading).toBe(false);
    });

    it("getStatus populates nodeStatus from data", async () => {
      const store = useEvoMapStore();
      mockInvoke.mockResolvedValue({
        success: true,
        data: { nodeId: "x", credits: 5, registered: true },
      });
      await store.getStatus();
      expect(store.nodeStatus.nodeId).toBe("x");
      expect(store.nodeStatus.credits).toBe(5);
    });

    it("refreshCredits updates only the credit balance", async () => {
      const store = useEvoMapStore();
      store.nodeStatus.credits = 1;
      mockInvoke.mockResolvedValue({ success: true, data: { credits: 99 } });
      await store.refreshCredits();
      expect(store.nodeStatus.credits).toBe(99);
    });
  });

  // -------------------------------------------------------------------------
  // Discovery actions
  // -------------------------------------------------------------------------

  describe("discovery actions", () => {
    it("searchAssets unwraps data.assets", async () => {
      const store = useEvoMapStore();
      mockInvoke.mockResolvedValue({
        success: true,
        data: { assets: [asset("a"), asset("b")] },
      });
      await store.searchAssets(["sig"], "instinct", "recent");
      expect(mockInvoke).toHaveBeenCalledWith(
        "evomap:search-assets",
        ["sig"],
        "instinct",
        "recent",
      );
      expect(store.searchResults.map((a) => a.asset_id)).toEqual(["a", "b"]);
    });

    it("searchAssets falls back to a bare-array data payload", async () => {
      const store = useEvoMapStore();
      mockInvoke.mockResolvedValue({ success: true, data: [asset("solo")] });
      await store.searchAssets();
      expect(store.searchResults.map((a) => a.asset_id)).toEqual(["solo"]);
    });

    it("searchAssets records the error on failure", async () => {
      const store = useEvoMapStore();
      mockInvoke.mockResolvedValue({ success: false, error: "bad query" });
      await store.searchAssets(["x"]);
      expect(store.error).toBe("bad query");
      expect(store.loading).toBe(false);
    });

    it("fetchTrending populates trendingAssets", async () => {
      const store = useEvoMapStore();
      mockInvoke.mockResolvedValue({
        success: true,
        data: { assets: [asset("t1")] },
      });
      await store.fetchTrending();
      expect(mockInvoke).toHaveBeenCalledWith("evomap:get-trending");
      expect(store.trendingAssets.map((a) => a.asset_id)).toEqual(["t1"]);
    });
  });
});
