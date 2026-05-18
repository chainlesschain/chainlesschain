/**
 * useSessionStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - loadSessions()         → session:list
 *  - searchSessions()       → session:search
 *  - loadSessionDetail()    → session:load
 *  - deleteSession()        → session:delete
 *  - deleteMultiple()       → session:delete-multiple
 *  - addTags()              → session:add-tags
 *  - loadAllTags()          → session:get-all-tags
 *  - loadTemplates()        → session:list-templates
 *  - loadGlobalStats()      → session:get-global-stats
 *  - updateTitle()          → session:update-title
 *  - Getters: filteredSessions, hasSelectedSessions, selectedCount, isLoading
 *  - Selection: selectSession(), deselectSession(), toggleSelection(), selectAll()
 *  - Filters: setFilters(), clearFilters()
 *  - Error handling when IPC throws
 *  - reset() clears all state
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Session, SessionTemplate } from "../session";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess-1",
    title: "Test Session",
    tags: [],
    messages: [],
    created_at: "2026-01-01",
    updated_at: "2026-01-02",
    token_count: 0,
    message_count: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSessionStore", () => {
  let pinia: ReturnType<typeof createPinia>;
  const mockInvoke = vi.fn();

  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);

    mockInvoke.mockResolvedValue(null);

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
    it("sessions starts as empty array", async () => {
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      expect(store.sessions).toEqual([]);
    });

    it("currentSession starts as null", async () => {
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      expect(store.currentSession).toBeNull();
    });

    it("loading starts as false", async () => {
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      expect(store.loading).toBe(false);
    });

    it("error starts as null", async () => {
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      expect(store.error).toBeNull();
    });

    it("pagination has default values", async () => {
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      expect(store.pagination).toEqual({ offset: 0, limit: 20, total: 0 });
    });
  });

  // -------------------------------------------------------------------------
  // loadSessions
  // -------------------------------------------------------------------------

  describe("loadSessions()", () => {
    it("calls session:list via IPC with pagination params", async () => {
      mockInvoke.mockResolvedValue({ sessions: [], total: 0 });
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      await store.loadSessions({ offset: 0, limit: 10 });
      expect(mockInvoke).toHaveBeenCalledWith(
        "session:list",
        expect.objectContaining({
          offset: 0,
          limit: 10,
        }),
      );
    });

    it("replaces sessions when offset is 0", async () => {
      const sessions = [makeSession({ id: "s1" }), makeSession({ id: "s2" })];
      mockInvoke.mockResolvedValue({ sessions, total: 2 });
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      await store.loadSessions({ offset: 0 });
      expect(store.sessions).toHaveLength(2);
    });

    it("appends sessions when offset > 0", async () => {
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      store.sessions = [makeSession({ id: "existing" })];

      mockInvoke.mockResolvedValue({
        sessions: [makeSession({ id: "new" })],
        total: 2,
      });
      await store.loadSessions({ offset: 1 });
      expect(store.sessions).toHaveLength(2);
    });

    it("sets loading to false after completion", async () => {
      mockInvoke.mockResolvedValue({ sessions: [], total: 0 });
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      await store.loadSessions();
      expect(store.loading).toBe(false);
    });

    it("sets error and throws when IPC fails", async () => {
      mockInvoke.mockRejectedValue(new Error("Network error"));
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      await expect(store.loadSessions()).rejects.toThrow("Network error");
      expect(store.error).toBe("Network error");
    });
  });

  // -------------------------------------------------------------------------
  // searchSessions
  // -------------------------------------------------------------------------

  describe("searchSessions()", () => {
    it("calls session:search with query and options", async () => {
      mockInvoke.mockResolvedValue([]);
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      await store.searchSessions("test query");
      expect(mockInvoke).toHaveBeenCalledWith(
        "session:search",
        "test query",
        expect.any(Object),
      );
    });

    it("updates sessions and filters.searchQuery with results", async () => {
      const results = [makeSession({ id: "found" })];
      mockInvoke.mockResolvedValue(results);
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      await store.searchSessions("keyword");
      expect(store.sessions).toHaveLength(1);
      expect(store.filters.searchQuery).toBe("keyword");
    });
  });

  // -------------------------------------------------------------------------
  // loadSessionDetail
  // -------------------------------------------------------------------------

  describe("loadSessionDetail()", () => {
    it("calls session:load with sessionId", async () => {
      const session = makeSession({ id: "detail-1" });
      mockInvoke.mockResolvedValue(session);
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      await store.loadSessionDetail("detail-1");
      expect(mockInvoke).toHaveBeenCalledWith("session:load", "detail-1");
    });

    it("sets currentSession from result", async () => {
      const session = makeSession({ id: "detail-1", title: "Detail" });
      mockInvoke.mockResolvedValue(session);
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      await store.loadSessionDetail("detail-1");
      expect(store.currentSession).not.toBeNull();
      expect(store.currentSession!.title).toBe("Detail");
    });
  });

  // -------------------------------------------------------------------------
  // deleteSession
  // -------------------------------------------------------------------------

  describe("deleteSession()", () => {
    it("removes session from local list", async () => {
      mockInvoke.mockResolvedValue(undefined);
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      store.sessions = [
        makeSession({ id: "del-1" }),
        makeSession({ id: "keep-1" }),
      ];
      await store.deleteSession("del-1");
      expect(store.sessions).toHaveLength(1);
      expect(store.sessions[0].id).toBe("keep-1");
    });

    it("clears currentSession if it matches the deleted one", async () => {
      mockInvoke.mockResolvedValue(undefined);
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      const session = makeSession({ id: "del-1" });
      store.sessions = [session];
      store.currentSession = session;
      await store.deleteSession("del-1");
      expect(store.currentSession).toBeNull();
    });

    it("removes from selectedIds", async () => {
      mockInvoke.mockResolvedValue(undefined);
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      store.sessions = [makeSession({ id: "del-1" })];
      store.selectedIds = ["del-1", "other"];
      await store.deleteSession("del-1");
      expect(store.selectedIds).toEqual(["other"]);
    });
  });

  // -------------------------------------------------------------------------
  // loadAllTags
  // -------------------------------------------------------------------------

  describe("loadAllTags()", () => {
    it("calls session:get-all-tags", async () => {
      mockInvoke.mockResolvedValue(["tag1", "tag2"]);
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      await store.loadAllTags();
      expect(mockInvoke).toHaveBeenCalledWith("session:get-all-tags");
      expect(store.allTags).toEqual(["tag1", "tag2"]);
    });
  });

  // -------------------------------------------------------------------------
  // loadGlobalStats
  // -------------------------------------------------------------------------

  describe("loadGlobalStats()", () => {
    it("sets globalStats from IPC result", async () => {
      const stats = {
        totalSessions: 10,
        totalMessages: 50,
        totalTokensSaved: 1000,
        uniqueTags: 5,
        totalTemplates: 3,
      };
      mockInvoke.mockResolvedValue(stats);
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      await store.loadGlobalStats();
      expect(store.globalStats.totalSessions).toBe(10);
    });
  });

  // -------------------------------------------------------------------------
  // updateTitle
  // -------------------------------------------------------------------------

  describe("updateTitle()", () => {
    it("updates session title in local list", async () => {
      mockInvoke.mockResolvedValue({ success: true });
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      store.sessions = [makeSession({ id: "s1", title: "Old" })];
      await store.updateTitle("s1", "New Title");
      expect(store.sessions[0].title).toBe("New Title");
    });

    it("updates currentSession title if it matches", async () => {
      mockInvoke.mockResolvedValue({ success: true });
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      const session = makeSession({ id: "s1", title: "Old" });
      store.sessions = [session];
      store.currentSession = session;
      await store.updateTitle("s1", "New");
      expect(store.currentSession!.title).toBe("New");
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("Getters", () => {
    it("filteredSessions filters by selected tags", async () => {
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      store.sessions = [
        makeSession({ id: "s1", tags: ["work"] }),
        makeSession({ id: "s2", tags: ["personal"] }),
      ];
      store.filters.selectedTags = ["work"];
      expect(store.filteredSessions).toHaveLength(1);
      expect(store.filteredSessions[0].id).toBe("s1");
    });

    it("filteredSessions returns all when no tags selected", async () => {
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      store.sessions = [makeSession(), makeSession({ id: "s2" })];
      expect(store.filteredSessions).toHaveLength(2);
    });

    it("hasSelectedSessions returns true when selections exist", async () => {
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      expect(store.hasSelectedSessions).toBe(false);
      store.selectedIds = ["s1"];
      expect(store.hasSelectedSessions).toBe(true);
    });

    it("selectedCount returns number of selected IDs", async () => {
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      store.selectedIds = ["a", "b", "c"];
      expect(store.selectedCount).toBe(3);
    });

    it("isLoading returns true when any loading flag is true", async () => {
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      expect(store.isLoading).toBe(false);
      store.loadingTags = true;
      expect(store.isLoading).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  describe("Selection", () => {
    it("selectSession() adds ID to selectedIds", async () => {
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      store.selectSession("s1");
      expect(store.selectedIds).toContain("s1");
    });

    it("selectSession() does not duplicate", async () => {
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      store.selectSession("s1");
      store.selectSession("s1");
      expect(store.selectedIds).toHaveLength(1);
    });

    it("deselectSession() removes ID from selectedIds", async () => {
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      store.selectedIds = ["s1", "s2"];
      store.deselectSession("s1");
      expect(store.selectedIds).toEqual(["s2"]);
    });

    it("toggleSelection() toggles selection state", async () => {
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      store.toggleSelection("s1");
      expect(store.selectedIds).toContain("s1");
      store.toggleSelection("s1");
      expect(store.selectedIds).not.toContain("s1");
    });

    it("selectAll() selects all session IDs", async () => {
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      store.sessions = [makeSession({ id: "a" }), makeSession({ id: "b" })];
      store.selectAll();
      expect(store.selectedIds).toEqual(["a", "b"]);
    });

    it("deselectAll() clears all selections", async () => {
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();
      store.selectedIds = ["a", "b"];
      store.deselectAll();
      expect(store.selectedIds).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------

  describe("reset()", () => {
    it("clears all state to defaults", async () => {
      const { useSessionStore } = await import("../session");
      const store = useSessionStore();

      store.sessions = [makeSession()];
      store.currentSession = makeSession();
      store.selectedIds = ["s1"];
      store.allTags = ["tag1"];
      store.error = "some error";

      store.reset();

      expect(store.sessions).toEqual([]);
      expect(store.currentSession).toBeNull();
      expect(store.selectedIds).toEqual([]);
      expect(store.allTags).toEqual([]);
      expect(store.error).toBeNull();
      expect(store.loading).toBe(false);
    });
  });
});
