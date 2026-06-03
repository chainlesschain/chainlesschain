/**
 * useToolStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: enabledTools / disabledTools / filteredTools
 *    (category + status + search) / toolsByCategory / totalCount /
 *    enabledCount / builtinCount / pluginCount
 *  - Pure actions: setCategoryFilter / setStatusFilter / setSearchKeyword /
 *    setCurrentTool / clearCurrentTool
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { useToolStore } from "../tool";
import type { Tool } from "../tool";

function tool(id: string, overrides: Partial<Tool> = {}): Tool {
  return {
    id,
    name: `tool_${id}`,
    category: "general",
    enabled: 1,
    is_builtin: 1,
    parameters_schema: {} as any,
    return_schema: {} as any,
    required_permissions: [],
    ...overrides,
  };
}

describe("useToolStore", () => {
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
    it("starts empty with default filters", () => {
      const store = useToolStore();
      expect(store.tools).toEqual([]);
      expect(store.currentTool).toBeNull();
      expect(store.categoryFilter).toBe("all");
      expect(store.statusFilter).toBe("all");
      expect(store.searchKeyword).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    function seed(store: ReturnType<typeof useToolStore>) {
      store.tools = [
        tool("a", {
          category: "file",
          enabled: 1,
          is_builtin: 1,
          name: "read_file",
        }),
        tool("b", {
          category: "file",
          enabled: 0,
          is_builtin: 1,
          name: "write_file",
        }),
        tool("c", {
          category: "web",
          enabled: 1,
          is_builtin: 0,
          plugin_id: "p1",
          name: "fetch",
          description: "http get",
        }),
      ];
    }

    it("enabledTools / disabledTools split by enabled flag", () => {
      const store = useToolStore();
      seed(store);
      expect(store.enabledTools.map((t) => t.id)).toEqual(["a", "c"]);
      expect(store.disabledTools.map((t) => t.id)).toEqual(["b"]);
    });

    it("counts: total / enabled / builtin / plugin", () => {
      const store = useToolStore();
      seed(store);
      expect(store.totalCount).toBe(3);
      expect(store.enabledCount).toBe(2);
      expect(store.builtinCount).toBe(2); // a, b
      expect(store.pluginCount).toBe(1); // c has plugin_id
    });

    it("toolsByCategory groups by category", () => {
      const store = useToolStore();
      seed(store);
      const g = store.toolsByCategory;
      expect(g.file.map((t) => t.id)).toEqual(["a", "b"]);
      expect(g.web.map((t) => t.id)).toEqual(["c"]);
    });

    it("filteredTools applies category filter ('all' = no filter)", () => {
      const store = useToolStore();
      seed(store);
      expect(store.filteredTools).toHaveLength(3);
      store.categoryFilter = "file";
      expect(store.filteredTools.map((t) => t.id)).toEqual(["a", "b"]);
    });

    it("filteredTools applies status filter", () => {
      const store = useToolStore();
      seed(store);
      store.statusFilter = "enabled";
      expect(store.filteredTools.map((t) => t.id)).toEqual(["a", "c"]);
      store.statusFilter = "disabled";
      expect(store.filteredTools.map((t) => t.id)).toEqual(["b"]);
    });

    it("filteredTools applies search across name + display_name + description", () => {
      const store = useToolStore();
      seed(store);
      store.searchKeyword = "FILE"; // matches read_file / write_file names
      expect(store.filteredTools.map((t) => t.id)).toEqual(["a", "b"]);
      store.searchKeyword = "http get"; // matches c.description
      expect(store.filteredTools.map((t) => t.id)).toEqual(["c"]);
    });

    it("filteredTools combines category + status + search (AND)", () => {
      const store = useToolStore();
      seed(store);
      store.categoryFilter = "file";
      store.statusFilter = "enabled";
      expect(store.filteredTools.map((t) => t.id)).toEqual(["a"]);
    });
  });

  // -------------------------------------------------------------------------
  // Pure actions
  // -------------------------------------------------------------------------

  describe("pure actions", () => {
    it("filter setters update state", () => {
      const store = useToolStore();
      store.setCategoryFilter("web");
      store.setStatusFilter("disabled");
      store.setSearchKeyword("fetch");
      expect(store.categoryFilter).toBe("web");
      expect(store.statusFilter).toBe("disabled");
      expect(store.searchKeyword).toBe("fetch");
    });

    it("setCurrentTool / clearCurrentTool manage selection", () => {
      const store = useToolStore();
      const t = tool("x");
      store.setCurrentTool(t);
      expect(store.currentTool?.id).toBe("x");
      store.clearCurrentTool();
      expect(store.currentTool).toBeNull();
    });
  });
});
