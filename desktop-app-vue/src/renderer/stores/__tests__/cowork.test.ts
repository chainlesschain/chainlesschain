/**
 * useCoworkStore — Pinia store unit tests (multi-agent cowork)
 *
 * Covers (pure surface only — 25 getters + selection/filter actions):
 *  - Initial state shape
 *  - Team getters: filteredTeams (status + search) / activeTeams / pausedTeams /
 *    completedTeams / hasSelectedTeams / selectedTeamCount
 *  - Task getters: filteredTasks (status + teamId + search) / runningTasks /
 *    pendingTasks / completedTasks / failedTasks / hasSelectedTasks / selectedTaskCount
 *  - Skill getters: skillsByType / officeSkills
 *  - Loading getters: isLoading / isLoadingTeams / isLoadingTasks
 *  - Selection actions: toggleTeamSelection / clearTeamSelection /
 *    toggleTaskSelection / clearTaskSelection
 *  - Filter actions: setTeamFilters / clearTeamFilters / setTaskFilters /
 *    clearTaskFilters
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { useCoworkStore } from "../cowork";
import type { Team, Task, Skill } from "../cowork";

function team(id: string, overrides: Partial<Team> = {}): Team {
  return { id, name: `Team ${id}`, status: "active", ...overrides };
}

function task(id: string, overrides: Partial<Task> = {}): Task {
  return { id, name: `Task ${id}`, status: "pending", ...overrides };
}

function skill(name: string, type?: string): Skill {
  return { name, type };
}

describe("useCoworkStore", () => {
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
    it("starts empty with no selection", () => {
      const store = useCoworkStore();
      expect(store.teams).toEqual([]);
      expect(store.tasks).toEqual([]);
      expect(store.selectedTeamIds).toEqual([]);
      expect(store.selectedTaskIds).toEqual([]);
      expect(store.isLoading).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Team getters
  // -------------------------------------------------------------------------

  describe("team getters", () => {
    function seed(store: ReturnType<typeof useCoworkStore>) {
      store.teams = [
        team("a", { status: "active", name: "Alpha", description: "first" }),
        team("b", { status: "paused", name: "Beta" }),
        team("c", { status: "completed", name: "Gamma" }),
        team("d", { status: "active", name: "Delta" }),
      ];
    }

    it("status-split getters", () => {
      const store = useCoworkStore();
      seed(store);
      expect(store.activeTeams.map((t) => t.id)).toEqual(["a", "d"]);
      expect(store.pausedTeams.map((t) => t.id)).toEqual(["b"]);
      expect(store.completedTeams.map((t) => t.id)).toEqual(["c"]);
    });

    it("filteredTeams applies status filter", () => {
      const store = useCoworkStore();
      seed(store);
      store.teamFilters.status = "active";
      expect(store.filteredTeams.map((t) => t.id)).toEqual(["a", "d"]);
    });

    it("filteredTeams applies search across name + description (case-insensitive)", () => {
      const store = useCoworkStore();
      seed(store);
      store.teamFilters.searchQuery = "ALPHA";
      expect(store.filteredTeams.map((t) => t.id)).toEqual(["a"]);
      store.teamFilters.searchQuery = "first"; // matches description
      expect(store.filteredTeams.map((t) => t.id)).toEqual(["a"]);
    });

    it("selection getters reflect selectedTeamIds", () => {
      const store = useCoworkStore();
      expect(store.hasSelectedTeams).toBe(false);
      expect(store.selectedTeamCount).toBe(0);
      store.selectedTeamIds = ["a", "b"];
      expect(store.hasSelectedTeams).toBe(true);
      expect(store.selectedTeamCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Task getters
  // -------------------------------------------------------------------------

  describe("task getters", () => {
    function seed(store: ReturnType<typeof useCoworkStore>) {
      store.tasks = [
        task("1", { status: "running", teamId: "a", name: "Build" }),
        task("2", { status: "pending", teamId: "a" }),
        task("3", { status: "completed", teamId: "b" }),
        task("4", { status: "failed", teamId: "b" }),
        task("5", { status: "running", teamId: "b" }),
      ];
    }

    it("status-split getters", () => {
      const store = useCoworkStore();
      seed(store);
      expect(store.runningTasks.map((t) => t.id)).toEqual(["1", "5"]);
      expect(store.pendingTasks.map((t) => t.id)).toEqual(["2"]);
      expect(store.completedTasks.map((t) => t.id)).toEqual(["3"]);
      expect(store.failedTasks.map((t) => t.id)).toEqual(["4"]);
    });

    it("filteredTasks combines status + teamId + search", () => {
      const store = useCoworkStore();
      seed(store);
      store.taskFilters.teamId = "b";
      expect(store.filteredTasks.map((t) => t.id)).toEqual(["3", "4", "5"]);
      store.taskFilters.status = "running";
      expect(store.filteredTasks.map((t) => t.id)).toEqual(["5"]);
      // search on a fresh filter
      store.taskFilters.teamId = null;
      store.taskFilters.status = null;
      store.taskFilters.searchQuery = "build";
      expect(store.filteredTasks.map((t) => t.id)).toEqual(["1"]);
    });

    it("selection getters reflect selectedTaskIds", () => {
      const store = useCoworkStore();
      store.selectedTaskIds = ["1"];
      expect(store.hasSelectedTasks).toBe(true);
      expect(store.selectedTaskCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Skill + loading getters
  // -------------------------------------------------------------------------

  describe("skill + loading getters", () => {
    it("skillsByType groups by type (default 'other'); officeSkills filters office", () => {
      const store = useCoworkStore();
      store.skills = [
        skill("docx", "office"),
        skill("search", "web"),
        skill("xlsx", "office"),
        skill("misc"), // no type → 'other'
      ];
      const g = store.skillsByType;
      expect(g.office.map((s) => s.name)).toEqual(["docx", "xlsx"]);
      expect(g.web.map((s) => s.name)).toEqual(["search"]);
      expect(g.other.map((s) => s.name)).toEqual(["misc"]);
      expect(store.officeSkills.map((s) => s.name)).toEqual(["docx", "xlsx"]);
    });

    it("isLoading / isLoadingTeams / isLoadingTasks reflect the loading map", () => {
      const store = useCoworkStore();
      expect(store.isLoading).toBe(false);
      store.loading.teams = true;
      expect(store.isLoading).toBe(true);
      expect(store.isLoadingTeams).toBe(true);
      expect(store.isLoadingTasks).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Selection actions
  // -------------------------------------------------------------------------

  describe("selection actions", () => {
    it("toggleTeamSelection adds then removes", () => {
      const store = useCoworkStore();
      store.toggleTeamSelection("a");
      expect(store.selectedTeamIds).toEqual(["a"]);
      store.toggleTeamSelection("b");
      expect(store.selectedTeamIds).toEqual(["a", "b"]);
      store.toggleTeamSelection("a"); // remove
      expect(store.selectedTeamIds).toEqual(["b"]);
      store.clearTeamSelection();
      expect(store.selectedTeamIds).toEqual([]);
    });

    it("toggleTaskSelection adds then removes", () => {
      const store = useCoworkStore();
      store.toggleTaskSelection("1");
      store.toggleTaskSelection("2");
      store.toggleTaskSelection("1");
      expect(store.selectedTaskIds).toEqual(["2"]);
      store.clearTaskSelection();
      expect(store.selectedTaskIds).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Filter actions
  // -------------------------------------------------------------------------

  describe("filter actions", () => {
    it("setTeamFilters merges; clearTeamFilters resets to defaults", () => {
      const store = useCoworkStore();
      store.setTeamFilters({ status: "active", searchQuery: "x" });
      expect(store.teamFilters.status).toBe("active");
      expect(store.teamFilters.searchQuery).toBe("x");
      store.clearTeamFilters();
      expect(store.teamFilters).toEqual({
        searchQuery: "",
        status: null,
        sortBy: "created_at",
        sortOrder: "desc",
      });
    });

    it("setTaskFilters merges; clearTaskFilters resets to defaults", () => {
      const store = useCoworkStore();
      store.setTaskFilters({ teamId: "b", status: "running" });
      expect(store.taskFilters.teamId).toBe("b");
      expect(store.taskFilters.status).toBe("running");
      store.clearTaskFilters();
      expect(store.taskFilters).toEqual({
        searchQuery: "",
        status: null,
        teamId: null,
        sortBy: "created_at",
        sortOrder: "desc",
      });
    });
  });
});
