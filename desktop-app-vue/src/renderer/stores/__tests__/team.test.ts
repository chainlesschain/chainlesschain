/**
 * useTeamStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: rootTeams / filteredTeams (parentTeamId + search) /
 *    getChildTeams (curried) / totalTeamCount / totalMemberCount /
 *    hasChildTeams / isLoading
 *  - Pure actions: setViewMode / setFilters / clearFilters / _buildHierarchy / reset
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { useTeamStore } from "../team";
import type { Team } from "../team";

function team(id: string, overrides: Partial<Team> = {}): Team {
  return {
    id,
    orgId: "org1",
    name: `Team ${id}`,
    parentTeamId: null,
    memberCount: 0,
    createdAt: 1700000000000,
    ...overrides,
  };
}

describe("useTeamStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty with list view and default filters", () => {
      const store = useTeamStore();
      expect(store.teams).toEqual([]);
      expect(store.currentTeam).toBeNull();
      expect(store.viewMode).toBe("list");
      expect(store.filters).toEqual({ searchQuery: "", parentTeamId: null });
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    function seed(store: ReturnType<typeof useTeamStore>) {
      store.teams = [
        team("root", {
          parentTeamId: null,
          memberCount: 3,
          name: "Engineering",
          description: "core",
        }),
        team("a", { parentTeamId: "root", memberCount: 2, name: "Frontend" }),
        team("b", { parentTeamId: "root", memberCount: 4, name: "Backend" }),
        team("c", { parentTeamId: "a", memberCount: 1, name: "Design" }),
      ];
    }

    it("rootTeams returns teams with no parent", () => {
      const store = useTeamStore();
      seed(store);
      expect(store.rootTeams.map((t) => t.id)).toEqual(["root"]);
    });

    it("getChildTeams is a curried lookup by parentId", () => {
      const store = useTeamStore();
      seed(store);
      expect(store.getChildTeams("root").map((t) => t.id)).toEqual(["a", "b"]);
      expect(store.getChildTeams("a").map((t) => t.id)).toEqual(["c"]);
      expect(store.getChildTeams("c")).toEqual([]);
    });

    it("filteredTeams applies parentTeamId filter", () => {
      const store = useTeamStore();
      seed(store);
      store.filters.parentTeamId = "root";
      expect(store.filteredTeams.map((t) => t.id)).toEqual(["a", "b"]);
    });

    it("filteredTeams applies search across name + description", () => {
      const store = useTeamStore();
      seed(store);
      store.filters.searchQuery = "ENGIN"; // name
      expect(store.filteredTeams.map((t) => t.id)).toEqual(["root"]);
      store.filters.searchQuery = "core"; // description
      expect(store.filteredTeams.map((t) => t.id)).toEqual(["root"]);
    });

    it("totalTeamCount + totalMemberCount", () => {
      const store = useTeamStore();
      seed(store);
      expect(store.totalTeamCount).toBe(4);
      expect(store.totalMemberCount).toBe(10); // 3+2+4+1
    });

    it("hasChildTeams reflects the current team", () => {
      const store = useTeamStore();
      seed(store);
      expect(store.hasChildTeams).toBe(false); // no current team
      store.currentTeam = team("root");
      expect(store.hasChildTeams).toBe(true);
      store.currentTeam = team("c");
      expect(store.hasChildTeams).toBe(false); // leaf
    });

    it("isLoading reflects any loading flag", () => {
      const store = useTeamStore();
      expect(store.isLoading).toBe(false);
      store.loading.teams = true;
      expect(store.isLoading).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Pure actions
  // -------------------------------------------------------------------------

  describe("pure actions", () => {
    it("setViewMode updates the view mode", () => {
      const store = useTeamStore();
      store.setViewMode("tree");
      expect(store.viewMode).toBe("tree");
    });

    it("setFilters merges; clearFilters resets to defaults", () => {
      const store = useTeamStore();
      store.setFilters({ searchQuery: "x", parentTeamId: "root" });
      expect(store.filters.searchQuery).toBe("x");
      expect(store.filters.parentTeamId).toBe("root");
      store.clearFilters();
      expect(store.filters).toEqual({ searchQuery: "", parentTeamId: null });
    });

    it("_buildHierarchy nests teams under their parents", () => {
      const store = useTeamStore();
      store.teams = [
        team("root", { parentTeamId: null }),
        team("a", { parentTeamId: "root" }),
        team("c", { parentTeamId: "a" }),
      ];
      store._buildHierarchy();
      expect(store.teamHierarchy).toHaveLength(1);
      const root = store.teamHierarchy[0];
      expect(root.id).toBe("root");
      expect(root.children.map((n: any) => n.id)).toEqual(["a"]);
      expect(root.children[0].children.map((n: any) => n.id)).toEqual(["c"]);
    });

    it("reset restores initial state", () => {
      const store = useTeamStore();
      store.teams = [team("a")];
      store.viewMode = "card";
      store.reset();
      expect(store.teams).toEqual([]);
      expect(store.viewMode).toBe("list");
    });
  });
});
