/**
 * useMemoryStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: today / hasDailyNote / sectionList (## heading parser) /
 *    hasSearchResults / isLoading / formattedStats
 *  - Pure local actions: updateSearchWeights / setActiveTab / startEditing
 *    (memory vs daily branch) / cancelEditing / clearSearch / clearError / selectDate
 *  - IPC actions via safeIpcInvoke (mocked window.electronAPI.invoke):
 *    loadDailyNote (success / not-found) / loadStats
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useMemoryStore } from "../memory";

const todayIso = () => new Date().toISOString().split("T")[0];

describe("useMemoryStore", () => {
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
    it("has empty collections, today's date, and default search options", () => {
      const store = useMemoryStore();
      expect(store.dailyNotes).toEqual([]);
      expect(store.currentDailyNote).toBeNull();
      expect(store.selectedDate).toBe(todayIso());
      expect(store.memoryContent).toBe("");
      expect(store.searchResults).toEqual([]);
      expect(store.searchOptions).toMatchObject({
        vectorWeight: 0.6,
        textWeight: 0.4,
        limit: 10,
      });
      expect(store.activeTab).toBe("daily");
      expect(store.isEditing).toBe(false);
      expect(store.error).toBeNull();
      expect(Object.values(store.loading).every((v) => v === false)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("today returns the ISO date", () => {
      expect(useMemoryStore().today).toBe(todayIso());
    });

    it("hasDailyNote reflects currentDailyNote presence", () => {
      const store = useMemoryStore();
      expect(store.hasDailyNote).toBe(false);
      store.currentDailyNote = "# Today";
      expect(store.hasDailyNote).toBe(true);
    });

    it("sectionList parses only level-2 (##) headings", () => {
      const store = useMemoryStore();
      store.memoryContent = "# Top\n## Alpha\nbody\n### Sub\n## Beta\ntail";
      const list = store.sectionList;
      expect(list.map((s) => s.title)).toEqual(["Alpha", "Beta"]);
      expect(list.every((s) => typeof s.index === "number")).toBe(true);
    });

    it("sectionList is empty when no ## headings", () => {
      const store = useMemoryStore();
      store.memoryContent = "# Only H1\n### And H3\nplain text";
      expect(store.sectionList).toEqual([]);
    });

    it("hasSearchResults reflects searchResults length", () => {
      const store = useMemoryStore();
      expect(store.hasSearchResults).toBe(false);
      store.searchResults = [{ id: "r1" } as any];
      expect(store.hasSearchResults).toBe(true);
    });

    it("isLoading is true when any loading flag is set", () => {
      const store = useMemoryStore();
      expect(store.isLoading).toBe(false);
      store.loading.search = true;
      expect(store.isLoading).toBe(true);
    });

    it("formattedStats renders human-readable counts", () => {
      const store = useMemoryStore();
      store.stats = {
        dailyNotesCount: 3,
        memorySectionsCount: 5,
        cachedEmbeddingsCount: 12,
        indexedFilesCount: 7,
      };
      expect(store.formattedStats).toEqual({
        dailyNotes: "3 篇",
        sections: "5 个章节",
        embeddings: "12 条缓存",
        indexed: "7 个文件",
      });
    });
  });

  // -------------------------------------------------------------------------
  // Pure local actions
  // -------------------------------------------------------------------------

  describe("pure local actions", () => {
    it("updateSearchWeights sets vector + text weights", () => {
      const store = useMemoryStore();
      store.updateSearchWeights(0.8, 0.2);
      expect(store.searchOptions.vectorWeight).toBe(0.8);
      expect(store.searchOptions.textWeight).toBe(0.2);
    });

    it("setActiveTab switches the active tab", () => {
      const store = useMemoryStore();
      store.setActiveTab("search");
      expect(store.activeTab).toBe("search");
    });

    it("startEditing seeds editingContent from memoryContent on the memory tab", () => {
      const store = useMemoryStore();
      store.activeTab = "memory";
      store.memoryContent = "## Notes";
      store.startEditing();
      expect(store.isEditing).toBe(true);
      expect(store.editingContent).toBe("## Notes");
    });

    it("startEditing seeds editingContent from currentDailyNote on the daily tab", () => {
      const store = useMemoryStore();
      store.activeTab = "daily";
      store.currentDailyNote = "today's note";
      store.startEditing();
      expect(store.editingContent).toBe("today's note");
    });

    it("startEditing falls back to empty string when daily note is null", () => {
      const store = useMemoryStore();
      store.activeTab = "daily";
      store.currentDailyNote = null;
      store.startEditing();
      expect(store.editingContent).toBe("");
    });

    it("cancelEditing clears editing state", () => {
      const store = useMemoryStore();
      store.isEditing = true;
      store.editingContent = "draft";
      store.cancelEditing();
      expect(store.isEditing).toBe(false);
      expect(store.editingContent).toBe("");
    });

    it("clearSearch resets query + results", () => {
      const store = useMemoryStore();
      store.searchQuery = "q";
      store.searchResults = [{ id: "r1" } as any];
      store.clearSearch();
      expect(store.searchQuery).toBe("");
      expect(store.searchResults).toEqual([]);
    });

    it("clearError nulls the error", () => {
      const store = useMemoryStore();
      store.error = "boom";
      store.clearError();
      expect(store.error).toBeNull();
    });

    it("selectDate updates selectedDate", () => {
      const store = useMemoryStore();
      store.selectDate("2026-01-15");
      expect(store.selectedDate).toBe("2026-01-15");
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions (safeIpcInvoke → window.electronAPI.invoke)
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("loadDailyNote sets currentDailyNote + selectedDate on success", async () => {
      const store = useMemoryStore();
      mockInvoke.mockResolvedValueOnce({
        success: true,
        content: "# 2026-01-15",
      });
      await store.loadDailyNote("2026-01-15");
      expect(mockInvoke).toHaveBeenCalledWith("memory:read-daily-note", {
        date: "2026-01-15",
      });
      expect(store.currentDailyNote).toBe("# 2026-01-15");
      expect(store.selectedDate).toBe("2026-01-15");
      expect(store.loading.dailyNotes).toBe(false);
    });

    it("loadDailyNote clears currentDailyNote when not found", async () => {
      const store = useMemoryStore();
      store.currentDailyNote = "stale";
      mockInvoke.mockResolvedValueOnce({ success: false });
      await store.loadDailyNote("2026-01-16");
      expect(store.currentDailyNote).toBeNull();
      expect(store.loading.dailyNotes).toBe(false);
    });

    it("loadStats stores the returned stats", async () => {
      const store = useMemoryStore();
      const stats = {
        dailyNotesCount: 9,
        memorySectionsCount: 4,
        cachedEmbeddingsCount: 100,
        indexedFilesCount: 20,
      };
      mockInvoke.mockResolvedValueOnce({ success: true, stats });
      await store.loadStats();
      expect(store.stats).toEqual(stats);
      expect(store.loading.stats).toBe(false);
    });

    it("loadDailyNote degrades gracefully when IPC is unavailable", async () => {
      const store = useMemoryStore();
      delete (window as any).electronAPI; // safeIpcInvoke → null
      await store.loadDailyNote("2026-01-17");
      expect(store.currentDailyNote).toBeNull();
      expect(store.loading.dailyNotes).toBe(false);
    });
  });
});
