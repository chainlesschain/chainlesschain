/**
 * useMarketplaceStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: hasUpdates / updateCount / installedCount / enabledPlugins /
 *    disabledPlugins / isInstalled (curried) / totalPages (ceil)
 *  - Pure actions: setCurrentPage / setPageSize / setSelectedCategory /
 *    setSearchKeyword / clearCurrentPlugin / reset
 *  - IPC actions (mocked window.electronAPI.invoke): enablePlugin / disablePlugin
 *    (local enabled flag flip) + error path
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useMarketplaceStore } from "../marketplace";
import type { InstalledPlugin } from "../marketplace";

function makePlugin(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    id: "i1",
    plugin_id: "p1",
    name: "Plugin 1",
    version: "1.0.0",
    install_path: "/plugins/p1",
    installed_at: 1700000000000,
    enabled: true,
    auto_update: false,
    source: "official",
    ...overrides,
  };
}

describe("useMarketplaceStore", () => {
  const mockInvoke = vi.fn();

  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue({ success: true });
    (window as any).electronAPI = { invoke: mockInvoke };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty", () => {
      const store = useMarketplaceStore();
      expect(store.plugins).toEqual([]);
      expect(store.installedPlugins).toEqual([]);
      expect(store.availableUpdates).toEqual([]);
      expect(store.currentPlugin).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("hasUpdates + updateCount reflect availableUpdates", () => {
      const store = useMarketplaceStore();
      expect(store.hasUpdates).toBe(false);
      expect(store.updateCount).toBe(0);
      store.availableUpdates = [
        { plugin_id: "p1" } as any,
        { plugin_id: "p2" } as any,
      ];
      expect(store.hasUpdates).toBe(true);
      expect(store.updateCount).toBe(2);
    });

    it("installedCount + enabled/disabled split", () => {
      const store = useMarketplaceStore();
      store.installedPlugins = [
        makePlugin({ plugin_id: "a", enabled: true }),
        makePlugin({ plugin_id: "b", enabled: false }),
        makePlugin({ plugin_id: "c", enabled: true }),
      ];
      expect(store.installedCount).toBe(3);
      expect(store.enabledPlugins.map((p) => p.plugin_id)).toEqual(["a", "c"]);
      expect(store.disabledPlugins.map((p) => p.plugin_id)).toEqual(["b"]);
    });

    it("isInstalled is a curried predicate over plugin_id", () => {
      const store = useMarketplaceStore();
      store.installedPlugins = [makePlugin({ plugin_id: "a" })];
      expect(store.isInstalled("a")).toBe(true);
      expect(store.isInstalled("missing")).toBe(false);
    });

    it("totalPages is ceil(totalPlugins / pageSize)", () => {
      const store = useMarketplaceStore();
      store.totalPlugins = 25;
      store.pageSize = 10;
      expect(store.totalPages).toBe(3);
      store.totalPlugins = 20;
      expect(store.totalPages).toBe(2);
      store.totalPlugins = 0;
      expect(store.totalPages).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Pure actions
  // -------------------------------------------------------------------------

  describe("pure actions", () => {
    it("pagination + filter setters update state", () => {
      const store = useMarketplaceStore();
      store.setCurrentPage(3);
      store.setPageSize(50);
      store.setSelectedCategory("ai");
      store.setSearchKeyword("chat");
      expect(store.currentPage).toBe(3);
      expect(store.pageSize).toBe(50);
      expect(store.selectedCategory).toBe("ai");
      expect(store.searchKeyword).toBe("chat");
    });

    it("clearCurrentPlugin clears plugin + ratings", () => {
      const store = useMarketplaceStore();
      store.currentPlugin = { plugin_id: "p1" } as any;
      store.ratings = [{ id: "r1" } as any];
      store.clearCurrentPlugin();
      expect(store.currentPlugin).toBeNull();
      expect(store.ratings).toEqual([]);
    });

    it("reset restores initial state", () => {
      const store = useMarketplaceStore();
      store.installedPlugins = [makePlugin()];
      store.currentPage = 5;
      store.searchKeyword = "x";
      store.reset();
      expect(store.installedPlugins).toEqual([]);
      expect(store.currentPage).toBe(1);
      expect(store.searchKeyword).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("enable / disable plugin", () => {
    it("enablePlugin flips the local enabled flag on success", async () => {
      const store = useMarketplaceStore();
      store.installedPlugins = [
        makePlugin({ plugin_id: "p1", enabled: false }),
      ];
      mockInvoke.mockResolvedValueOnce({ success: true });
      await store.enablePlugin("p1");
      expect(mockInvoke).toHaveBeenCalledWith("marketplace:enable-plugin", {
        pluginId: "p1",
      });
      expect(store.installedPlugins[0].enabled).toBe(true);
      expect(store.loading).toBe(false);
    });

    it("disablePlugin flips the local enabled flag on success", async () => {
      const store = useMarketplaceStore();
      store.installedPlugins = [makePlugin({ plugin_id: "p1", enabled: true })];
      mockInvoke.mockResolvedValueOnce({ success: true });
      await store.disablePlugin("p1");
      expect(store.installedPlugins[0].enabled).toBe(false);
    });

    it("enablePlugin leaves flag unchanged when result.success is false", async () => {
      const store = useMarketplaceStore();
      store.installedPlugins = [
        makePlugin({ plugin_id: "p1", enabled: false }),
      ];
      mockInvoke.mockResolvedValueOnce({ success: false });
      await store.enablePlugin("p1");
      expect(store.installedPlugins[0].enabled).toBe(false);
    });

    it("enablePlugin sets error and rethrows when IPC throws", async () => {
      const store = useMarketplaceStore();
      store.installedPlugins = [
        makePlugin({ plugin_id: "p1", enabled: false }),
      ];
      mockInvoke.mockRejectedValueOnce(new Error("boom"));
      await expect(store.enablePlugin("p1")).rejects.toThrow("boom");
      expect(store.error).toBe("boom");
      expect(store.loading).toBe(false);
    });
  });
});
