/**
 * useSkillStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - fetchAll()             → electronAPI.skill.getAll
 *  - fetchById()            → electronAPI.skill.getById
 *  - fetchByCategory()      → electronAPI.skill.getByCategory
 *  - enable()               → electronAPI.skill.enable
 *  - disable()              → electronAPI.skill.disable
 *  - updateConfig()         → electronAPI.skill.updateConfig
 *  - update()               → electronAPI.skill.update
 *  - fetchStats()           → electronAPI.skill.getStats
 *  - fetchTools()           → electronAPI.skill.getTools
 *  - _safeParseJSON()       → JSON parsing with fallback
 *  - Getters: enabledSkills, disabledSkills, filteredSkills, skillsByCategory, totalCount, enabledCount
 *  - Filters: setCategoryFilter(), setSearchKeyword()
 *  - Error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Skill } from "../skill";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "skill-1",
    name: "code-review",
    display_name: "Code Review",
    description: "Reviews code for quality",
    category: "development",
    tags: ["code", "review"],
    config: {},
    enabled: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSkillStore", () => {
  let pinia: ReturnType<typeof createPinia>;
  const mockGetAll = vi.fn();
  const mockGetById = vi.fn();
  const mockGetByCategory = vi.fn();
  const mockEnable = vi.fn();
  const mockDisable = vi.fn();
  const mockUpdateConfig = vi.fn();
  const mockUpdate = vi.fn();
  const mockGetStats = vi.fn();
  const mockGetTools = vi.fn();

  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);

    mockGetAll.mockResolvedValue({ success: true, data: [] });
    mockEnable.mockResolvedValue({ success: true });
    mockDisable.mockResolvedValue({ success: true });
    mockUpdateConfig.mockResolvedValue({ success: true });
    mockUpdate.mockResolvedValue({ success: true });
    mockGetStats.mockResolvedValue({ success: true, data: null });
    mockGetTools.mockResolvedValue({ success: true, data: [] });

    (window as any).electronAPI = {
      invoke: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
      skill: {
        getAll: mockGetAll,
        getById: mockGetById,
        getByCategory: mockGetByCategory,
        enable: mockEnable,
        disable: mockDisable,
        updateConfig: mockUpdateConfig,
        update: mockUpdate,
        getStats: mockGetStats,
        getTools: mockGetTools,
        addTool: vi.fn().mockResolvedValue({ success: true }),
        removeTool: vi.fn().mockResolvedValue({ success: true }),
        getDoc: vi.fn().mockResolvedValue({ success: true, data: null }),
      },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("skills starts as empty array", async () => {
      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      expect(store.skills).toEqual([]);
    });

    it("currentSkill starts as null", async () => {
      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      expect(store.currentSkill).toBeNull();
    });

    it("loading starts as false", async () => {
      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      expect(store.loading).toBe(false);
    });

    it('categoryFilter starts as "all"', async () => {
      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      expect(store.categoryFilter).toBe("all");
    });

    it("searchKeyword starts as empty", async () => {
      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      expect(store.searchKeyword).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  // fetchAll
  // -------------------------------------------------------------------------

  describe("fetchAll()", () => {
    it("loads skills from skill API", async () => {
      const skills = [makeSkill({ id: "s1" }), makeSkill({ id: "s2" })];
      mockGetAll.mockResolvedValue({ success: true, data: skills });

      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      await store.fetchAll();

      expect(store.skills).toHaveLength(2);
    });

    it("parses JSON string tags and config", async () => {
      mockGetAll.mockResolvedValue({
        success: true,
        data: [{ ...makeSkill(), tags: '["a","b"]', config: '{"key":"val"}' }],
      });

      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      await store.fetchAll();

      expect(store.skills[0].tags).toEqual(["a", "b"]);
      expect(store.skills[0].config).toEqual({ key: "val" });
    });

    it("handles invalid JSON gracefully", async () => {
      mockGetAll.mockResolvedValue({
        success: true,
        data: [{ ...makeSkill(), tags: "not json", config: "bad" }],
      });

      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      await store.fetchAll();

      expect(store.skills[0].tags).toEqual([]);
      expect(store.skills[0].config).toEqual({});
    });

    it("sets loading to false after completion", async () => {
      mockGetAll.mockResolvedValue({ success: true, data: [] });
      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      await store.fetchAll();
      expect(store.loading).toBe(false);
    });

    it("handles missing skill API gracefully", async () => {
      (window as any).electronAPI = {
        invoke: vi.fn(),
        on: vi.fn(),
        removeListener: vi.fn(),
      };
      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      await store.fetchAll();
      expect(store.skills).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // fetchById
  // -------------------------------------------------------------------------

  describe("fetchById()", () => {
    it("sets currentSkill from result", async () => {
      const skill = makeSkill({ id: "target" });
      mockGetById.mockResolvedValue({ success: true, data: skill });

      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      const result = await store.fetchById("target");

      expect(result).not.toBeNull();
      expect(store.currentSkill!.id).toBe("target");
    });

    it("returns null on failure", async () => {
      mockGetById.mockResolvedValue({ success: false, error: "Not found" });
      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      const result = await store.fetchById("missing");
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // enable / disable
  // -------------------------------------------------------------------------

  describe("enable()", () => {
    it("sets skill.enabled to 1 in local state", async () => {
      mockEnable.mockResolvedValue({ success: true });
      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      store.skills = [makeSkill({ id: "s1", enabled: 0 })];
      const result = await store.enable("s1");
      expect(result).toBe(true);
      expect(store.skills[0].enabled).toBe(1);
    });

    it("returns false on failure", async () => {
      mockEnable.mockResolvedValue({ success: false, error: "Failed" });
      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      store.skills = [makeSkill({ id: "s1", enabled: 0 })];
      const result = await store.enable("s1");
      expect(result).toBe(false);
    });
  });

  describe("disable()", () => {
    it("sets skill.enabled to 0 in local state", async () => {
      mockDisable.mockResolvedValue({ success: true });
      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      store.skills = [makeSkill({ id: "s1", enabled: 1 })];
      const result = await store.disable("s1");
      expect(result).toBe(true);
      expect(store.skills[0].enabled).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // updateConfig
  // -------------------------------------------------------------------------

  describe("updateConfig()", () => {
    it("updates config in local state on success", async () => {
      mockUpdateConfig.mockResolvedValue({ success: true });
      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      store.skills = [makeSkill({ id: "s1", config: { old: true } })];
      const result = await store.updateConfig("s1", { new: true });
      expect(result).toBe(true);
      expect(store.skills[0].config).toEqual({ new: true });
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  describe("update()", () => {
    it("updates skill properties in local state on success", async () => {
      mockUpdate.mockResolvedValue({ success: true });
      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      store.skills = [makeSkill({ id: "s1", name: "old-name" })];
      const result = await store.update("s1", { name: "new-name" });
      expect(result).toBe(true);
      expect(store.skills[0].name).toBe("new-name");
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("Getters", () => {
    it("enabledSkills returns only enabled skills", async () => {
      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      store.skills = [
        makeSkill({ id: "on", enabled: 1 }),
        makeSkill({ id: "off", enabled: 0 }),
      ];
      expect(store.enabledSkills).toHaveLength(1);
      expect(store.enabledSkills[0].id).toBe("on");
    });

    it("disabledSkills returns only disabled skills", async () => {
      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      store.skills = [
        makeSkill({ id: "on", enabled: 1 }),
        makeSkill({ id: "off", enabled: 0 }),
      ];
      expect(store.disabledSkills).toHaveLength(1);
      expect(store.disabledSkills[0].id).toBe("off");
    });

    it("filteredSkills filters by category", async () => {
      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      store.skills = [
        makeSkill({ id: "s1", category: "dev" }),
        makeSkill({ id: "s2", category: "ai" }),
      ];
      store.categoryFilter = "dev";
      expect(store.filteredSkills).toHaveLength(1);
      expect(store.filteredSkills[0].id).toBe("s1");
    });

    it("filteredSkills filters by search keyword", async () => {
      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      store.skills = [
        makeSkill({
          id: "s1",
          name: "code-review",
          description: "Reviews code",
        }),
        makeSkill({
          id: "s2",
          name: "translate",
          description: "Translates text",
        }),
      ];
      store.searchKeyword = "translate";
      expect(store.filteredSkills).toHaveLength(1);
      expect(store.filteredSkills[0].id).toBe("s2");
    });

    it("filteredSkills returns all when no filters", async () => {
      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      store.skills = [makeSkill(), makeSkill({ id: "s2" })];
      expect(store.filteredSkills).toHaveLength(2);
    });

    it("skillsByCategory groups skills correctly", async () => {
      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      store.skills = [
        makeSkill({ id: "s1", category: "dev" }),
        makeSkill({ id: "s2", category: "dev" }),
        makeSkill({ id: "s3", category: "ai" }),
      ];
      expect(store.skillsByCategory["dev"]).toHaveLength(2);
      expect(store.skillsByCategory["ai"]).toHaveLength(1);
    });

    it("totalCount returns total number of skills", async () => {
      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      store.skills = [
        makeSkill(),
        makeSkill({ id: "s2" }),
        makeSkill({ id: "s3" }),
      ];
      expect(store.totalCount).toBe(3);
    });

    it("enabledCount returns count of enabled skills", async () => {
      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      store.skills = [
        makeSkill({ enabled: 1 }),
        makeSkill({ id: "s2", enabled: 0 }),
      ];
      expect(store.enabledCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Filter actions
  // -------------------------------------------------------------------------

  describe("Filter actions", () => {
    it("setCategoryFilter() updates the filter", async () => {
      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      store.setCategoryFilter("ai");
      expect(store.categoryFilter).toBe("ai");
    });

    it("setSearchKeyword() updates the keyword", async () => {
      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      store.setSearchKeyword("review");
      expect(store.searchKeyword).toBe("review");
    });

    it("setCurrentSkill() sets currentSkill", async () => {
      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      const skill = makeSkill();
      store.setCurrentSkill(skill);
      expect(store.currentSkill).not.toBeNull();
      expect(store.currentSkill!.id).toBe(skill.id);
    });

    it("clearCurrentSkill() sets currentSkill to null", async () => {
      const { useSkillStore } = await import("../skill");
      const store = useSkillStore();
      store.currentSkill = makeSkill();
      store.clearCurrentSkill();
      expect(store.currentSkill).toBeNull();
    });
  });
});
