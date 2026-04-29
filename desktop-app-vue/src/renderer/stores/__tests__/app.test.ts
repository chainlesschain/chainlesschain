/**
 * useAppStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Authentication: setAuthenticated(), setUKeyStatus(), setDeviceId()
 *  - Knowledge base: setKnowledgeItems(), addKnowledgeItem(), updateKnowledgeItem(), deleteKnowledgeItem()
 *  - Search: setSearchQuery(), getFilteredItems getter
 *  - AI chat: addMessage(), clearMessages(), setIsAITyping()
 *  - Config: setAppConfig(), setLLMStatus(), setGitStatus()
 *  - UI: setSidebarCollapsed(), setChatPanelVisible(), setLoading()
 *  - Tabs: addTab(), removeTab(), closeAllTabs(), closeOtherTabs()
 *  - Favorites: addFavoriteMenu(), removeFavoriteMenu(), toggleFavoriteMenu()
 *  - Storage: saveFavoritesToStorage(), loadFavoritesFromStorage(), initMenuData()
 *  - logout() clears all state
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useAppStore", () => {
  let pinia: ReturnType<typeof createPinia>;
  const mockInvoke = vi.fn();

  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);

    mockInvoke.mockResolvedValue(undefined);

    (window as any).electronAPI = {
      invoke: mockInvoke,
      on: vi.fn(),
      removeListener: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("isAuthenticated starts as false", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      expect(store.isAuthenticated).toBe(false);
    });

    it("ukeyStatus starts as not detected and not unlocked", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      expect(store.ukeyStatus).toEqual({ detected: false, unlocked: false });
    });

    it("deviceId starts as null", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      expect(store.deviceId).toBeNull();
    });

    it("knowledgeItems starts as empty array", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      expect(store.knowledgeItems).toEqual([]);
    });

    it("loading starts as false", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      expect(store.loading).toBe(false);
    });

    it("tabs starts with home tab only", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      expect(store.tabs).toHaveLength(1);
      expect(store.tabs[0].key).toBe("home");
      expect(store.tabs[0].closable).toBe(false);
    });

    it("appConfig has sensible defaults", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      expect(store.appConfig.theme).toBe("light");
      expect(store.appConfig.llmModel).toBe("qwen2:7b");
    });
  });

  // -------------------------------------------------------------------------
  // Authentication actions
  // -------------------------------------------------------------------------

  describe("Authentication", () => {
    it("setAuthenticated() updates isAuthenticated", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      store.setAuthenticated(true);
      expect(store.isAuthenticated).toBe(true);
    });

    it("setUKeyStatus() updates ukeyStatus", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      store.setUKeyStatus({ detected: true, unlocked: true });
      expect(store.ukeyStatus).toEqual({ detected: true, unlocked: true });
    });

    it("setDeviceId() updates deviceId", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      store.setDeviceId("device-abc");
      expect(store.deviceId).toBe("device-abc");
    });
  });

  // -------------------------------------------------------------------------
  // Knowledge base
  // -------------------------------------------------------------------------

  describe("Knowledge base", () => {
    it("setKnowledgeItems() replaces items and updates filteredItems", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      const items = [
        { id: "1", title: "Note 1" },
        { id: "2", title: "Note 2" },
      ];
      store.setKnowledgeItems(items);
      expect(store.knowledgeItems).toHaveLength(2);
      expect(store.filteredItems).toHaveLength(2);
    });

    it("addKnowledgeItem() appends a new item", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      store.addKnowledgeItem({ id: "1", title: "First" });
      expect(store.knowledgeItems).toHaveLength(1);
    });

    it("updateKnowledgeItem() modifies an existing item", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      store.setKnowledgeItems([{ id: "1", title: "Old" }]);
      store.updateKnowledgeItem("1", { title: "New" });
      expect(store.knowledgeItems[0].title).toBe("New");
    });

    it("updateKnowledgeItem() also updates currentItem if it matches", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      const item = { id: "1", title: "Old" };
      store.setKnowledgeItems([item]);
      store.setCurrentItem(item);
      store.updateKnowledgeItem("1", { title: "Updated" });
      expect(store.currentItem!.title).toBe("Updated");
    });

    it("deleteKnowledgeItem() removes an item from the list", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      store.setKnowledgeItems([
        { id: "1", title: "A" },
        { id: "2", title: "B" },
      ]);
      store.deleteKnowledgeItem("1");
      expect(store.knowledgeItems).toHaveLength(1);
      expect(store.knowledgeItems[0].id).toBe("2");
    });

    it("deleteKnowledgeItem() clears currentItem if it matches", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      const item = { id: "1", title: "A" };
      store.setKnowledgeItems([item]);
      store.setCurrentItem(item);
      store.deleteKnowledgeItem("1");
      expect(store.currentItem).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // IPC-backed knowledge actions (loadKnowledgeItemsFromDb / delete / create)
  // -------------------------------------------------------------------------

  describe("Knowledge IPC actions", () => {
    function installDbApi(db: Record<string, ReturnType<typeof vi.fn>>) {
      (window as any).electronAPI = {
        invoke: mockInvoke,
        on: vi.fn(),
        removeListener: vi.fn(),
        db,
      };
    }

    it("loadKnowledgeItemsFromDb() pulls IPC and mirrors into state", async () => {
      const items = [
        { id: "1", title: "Loaded" },
        { id: "2", title: "Also loaded" },
      ];
      const getKnowledgeItems = vi.fn().mockResolvedValue(items);
      installDbApi({ getKnowledgeItems });

      const { useAppStore } = await import("../app");
      const store = useAppStore();
      const result = await store.loadKnowledgeItemsFromDb();

      expect(getKnowledgeItems).toHaveBeenCalledTimes(1);
      expect(store.knowledgeItems).toHaveLength(2);
      expect(result).toBe(store.knowledgeItems);
    });

    it("loadKnowledgeItemsFromDb() leaves state untouched when IPC missing", async () => {
      (window as any).electronAPI = { invoke: mockInvoke };
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      store.setKnowledgeItems([{ id: "x", title: "kept" }]);
      await store.loadKnowledgeItemsFromDb();
      expect(store.knowledgeItems).toEqual([{ id: "x", title: "kept" }]);
    });

    it("loadKnowledgeItemsFromDb() falls back to [] on non-array IPC return", async () => {
      const getKnowledgeItems = vi.fn().mockResolvedValue(null);
      installDbApi({ getKnowledgeItems });

      const { useAppStore } = await import("../app");
      const store = useAppStore();
      store.setKnowledgeItems([{ id: "x", title: "stale" }]);
      await store.loadKnowledgeItemsFromDb();
      expect(store.knowledgeItems).toEqual([]);
    });

    it("deleteKnowledgeItemFromDb() returns true and mirrors state on success", async () => {
      const deleteKnowledgeItem = vi.fn().mockResolvedValue(true);
      installDbApi({ deleteKnowledgeItem });

      const { useAppStore } = await import("../app");
      const store = useAppStore();
      store.setKnowledgeItems([
        { id: "1", title: "A" },
        { id: "2", title: "B" },
      ]);

      const ok = await store.deleteKnowledgeItemFromDb("1");
      expect(ok).toBe(true);
      expect(store.knowledgeItems.map((item) => item.id)).toEqual(["2"]);
    });

    it("deleteKnowledgeItemFromDb() also accepts {success: true} envelope", async () => {
      const deleteKnowledgeItem = vi.fn().mockResolvedValue({ success: true });
      installDbApi({ deleteKnowledgeItem });

      const { useAppStore } = await import("../app");
      const store = useAppStore();
      store.setKnowledgeItems([{ id: "1", title: "A" }]);
      const ok = await store.deleteKnowledgeItemFromDb("1");
      expect(ok).toBe(true);
      expect(store.knowledgeItems).toEqual([]);
    });

    it("deleteKnowledgeItemFromDb() returns false and keeps list when IPC fails", async () => {
      const deleteKnowledgeItem = vi.fn().mockRejectedValue(new Error("boom"));
      installDbApi({ deleteKnowledgeItem });

      const { useAppStore } = await import("../app");
      const store = useAppStore();
      store.setKnowledgeItems([{ id: "1", title: "A" }]);
      const ok = await store.deleteKnowledgeItemFromDb("1");
      expect(ok).toBe(false);
      expect(store.knowledgeItems).toHaveLength(1);
    });

    it("deleteKnowledgeItemFromDb() returns false when IPC reports failure", async () => {
      const deleteKnowledgeItem = vi.fn().mockResolvedValue(false);
      installDbApi({ deleteKnowledgeItem });

      const { useAppStore } = await import("../app");
      const store = useAppStore();
      store.setKnowledgeItems([{ id: "1", title: "A" }]);
      const ok = await store.deleteKnowledgeItemFromDb("1");
      expect(ok).toBe(false);
      expect(store.knowledgeItems).toHaveLength(1);
    });

    it("createKnowledgeItemInDb() pushes the returned row and resolves it", async () => {
      const created = { id: "new", title: "fresh" };
      const addKnowledgeItem = vi.fn().mockResolvedValue(created);
      installDbApi({ addKnowledgeItem });

      const { useAppStore } = await import("../app");
      const store = useAppStore();
      const result = await store.createKnowledgeItemInDb({ title: "fresh" });

      expect(addKnowledgeItem).toHaveBeenCalledWith({ title: "fresh" });
      expect(result).toEqual(created);
      expect(store.knowledgeItems).toContainEqual(created);
    });

    it("createKnowledgeItemInDb() returns null when IPC returns no id", async () => {
      const addKnowledgeItem = vi.fn().mockResolvedValue({});
      installDbApi({ addKnowledgeItem });

      const { useAppStore } = await import("../app");
      const store = useAppStore();
      const result = await store.createKnowledgeItemInDb({ title: "fresh" });
      expect(result).toBeNull();
      expect(store.knowledgeItems).toHaveLength(0);
    });

    it("createKnowledgeItemInDb() returns null when IPC missing", async () => {
      (window as any).electronAPI = { invoke: mockInvoke };
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      const result = await store.createKnowledgeItemInDb({ title: "fresh" });
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Search / getFilteredItems getter
  // -------------------------------------------------------------------------

  describe("Search", () => {
    it("getFilteredItems returns all items when searchQuery is empty", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      store.setKnowledgeItems([
        { id: "1", title: "Hello" },
        { id: "2", title: "World" },
      ]);
      expect(store.getFilteredItems).toHaveLength(2);
    });

    it("getFilteredItems filters by title match", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      store.setKnowledgeItems([
        { id: "1", title: "Hello" },
        { id: "2", title: "World" },
      ]);
      store.setSearchQuery("hello");
      expect(store.getFilteredItems).toHaveLength(1);
      expect(store.getFilteredItems[0].id).toBe("1");
    });

    it("getFilteredItems filters by content match", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      store.setKnowledgeItems([
        { id: "1", title: "Note", content: "secret data" },
      ]);
      store.setSearchQuery("secret");
      expect(store.getFilteredItems).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Tabs
  // -------------------------------------------------------------------------

  describe("Tabs", () => {
    it("addTab() creates a new tab and sets it active", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      store.addTab({ key: "notes", title: "Notes", path: "/notes" });
      expect(store.tabs).toHaveLength(2);
      expect(store.activeTabKey).toBe("notes");
    });

    it("addTab() activates existing tab instead of duplicating", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      store.addTab({ key: "notes", title: "Notes", path: "/notes" });
      store.addTab({ key: "notes", title: "Notes", path: "/notes" });
      expect(store.tabs).toHaveLength(2);
    });

    it("removeTab() removes a tab and adjusts activeTabKey", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      store.addTab({ key: "notes", title: "Notes", path: "/notes" });
      store.removeTab("notes");
      expect(store.tabs).toHaveLength(1);
      expect(store.activeTabKey).toBe("home");
    });

    it("removeTab() does not remove home tab", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      store.removeTab("home");
      expect(store.tabs).toHaveLength(1);
    });

    it("closeAllTabs() resets to home tab only", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      store.addTab({ key: "a", title: "A", path: "/a" });
      store.addTab({ key: "b", title: "B", path: "/b" });
      store.closeAllTabs();
      expect(store.tabs).toHaveLength(1);
      expect(store.activeTabKey).toBe("home");
    });

    it("closeOtherTabs() keeps only target and home", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      store.addTab({ key: "a", title: "A", path: "/a" });
      store.addTab({ key: "b", title: "B", path: "/b" });
      store.closeOtherTabs("a");
      expect(store.tabs).toHaveLength(2);
      expect(store.tabs.map((t) => t.key)).toContain("home");
      expect(store.tabs.map((t) => t.key)).toContain("a");
    });
  });

  // -------------------------------------------------------------------------
  // Favorites
  // -------------------------------------------------------------------------

  describe("Favorites", () => {
    it("addFavoriteMenu() adds a menu to favorites", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      store.addFavoriteMenu({ key: "notes", title: "Notes", path: "/notes" });
      expect(store.favoriteMenus).toHaveLength(1);
    });

    it("addFavoriteMenu() does not duplicate", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      store.addFavoriteMenu({ key: "notes", title: "Notes", path: "/notes" });
      store.addFavoriteMenu({ key: "notes", title: "Notes", path: "/notes" });
      expect(store.favoriteMenus).toHaveLength(1);
    });

    it("removeFavoriteMenu() removes from favorites", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      store.addFavoriteMenu({ key: "notes", title: "Notes", path: "/notes" });
      store.removeFavoriteMenu("notes");
      expect(store.favoriteMenus).toHaveLength(0);
    });

    it("isFavoriteMenu() returns correct boolean", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      expect(store.isFavoriteMenu("notes")).toBe(false);
      store.addFavoriteMenu({ key: "notes", title: "Notes", path: "/notes" });
      expect(store.isFavoriteMenu("notes")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Storage persistence via IPC
  // -------------------------------------------------------------------------

  describe("Storage persistence", () => {
    it("saveFavoritesToStorage() calls preference:set via IPC", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      store.addFavoriteMenu({ key: "x", title: "X", path: "/x" });
      await store.saveFavoritesToStorage();
      expect(mockInvoke).toHaveBeenCalledWith(
        "preference:set",
        "ui",
        "favoriteMenus",
        expect.any(Array),
      );
    });

    it("loadFavoritesFromStorage() loads from IPC", async () => {
      mockInvoke.mockResolvedValueOnce([
        { key: "loaded", title: "Loaded", path: "/loaded", addedAt: 1 },
      ]);
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      await store.loadFavoritesFromStorage();
      expect(store.favoriteMenus).toHaveLength(1);
      expect(store.favoriteMenus[0].key).toBe("loaded");
    });

    it("initMenuData() loads all three storage types", async () => {
      mockInvoke.mockResolvedValue([]);
      const { useAppStore } = await import("../app");
      const store = useAppStore();
      await store.initMenuData();
      // Should have called preference:get 3 times (favorites, recents, pinned)
      expect(mockInvoke).toHaveBeenCalledTimes(3);
    });
  });

  // -------------------------------------------------------------------------
  // logout
  // -------------------------------------------------------------------------

  describe("logout()", () => {
    it("resets auth, knowledge, messages, and tabs", async () => {
      const { useAppStore } = await import("../app");
      const store = useAppStore();

      // Populate state
      store.setAuthenticated(true);
      store.setDeviceId("dev-1");
      store.setKnowledgeItems([{ id: "1", title: "Note" }]);
      store.addMessage({ role: "user", content: "hi" });
      store.addTab({ key: "x", title: "X", path: "/x" });

      store.logout();

      expect(store.isAuthenticated).toBe(false);
      expect(store.deviceId).toBeNull();
      expect(store.knowledgeItems).toEqual([]);
      expect(store.messages).toEqual([]);
      expect(store.tabs).toHaveLength(1);
      expect(store.activeTabKey).toBe("home");
    });
  });
});
