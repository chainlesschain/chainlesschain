/**
 * useCategoryStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: rootCategories / getCategoryById / getChildCategories /
 *    getCategoryPath (breadcrumb) / primaryCategoriesOptions
 *  - _flattenCategories helper (recursive tree → flat list)
 *  - IPC actions (window.electronAPI.category.* mocked): fetchCategories
 *    (populate + flatten), deleteCategory (clears selection when it matches)
 *  - Pure actions: setSelectedCategory / showEditDialog / hideEditDialog / reset
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { useCategoryStore } from "../category";
import type { Category } from "../category";

function cat(
  id: string,
  parent_id: string | null,
  overrides: Partial<Category> = {},
): Category {
  return {
    id,
    name: `Cat ${id}`,
    parent_id,
    user_id: "local-user",
    ...overrides,
  };
}

/** Tree: root1 -> [child1a -> [grandchild]] , root2 */
function tree(): Category[] {
  const grandchild = cat("g", "1a");
  const child1a = cat("1a", "root1", { children: [grandchild] });
  const root1 = cat("root1", null, {
    icon: "i1",
    color: "#111",
    children: [child1a],
  });
  const root2 = cat("root2", null);
  return [root1, root2];
}

const mockCategory = {
  initializeDefaults: vi.fn(),
  getAll: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  updateSort: vi.fn(),
};

describe("useCategoryStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    Object.values(mockCategory).forEach((m) => m.mockReset());
    (window as any).electronAPI = { category: mockCategory };
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as any).electronAPI;
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty and uninitialized", () => {
      const store = useCategoryStore();
      expect(store.categories).toEqual([]);
      expect(store.flatCategories).toEqual([]);
      expect(store.selectedCategory).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.initialized).toBe(false);
      expect(store.dialogVisible).toBe(false);
      expect(store.editingCategory).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // _flattenCategories
  // -------------------------------------------------------------------------

  describe("_flattenCategories", () => {
    it("flattens a nested tree depth-first", () => {
      const store = useCategoryStore();
      const flat = store._flattenCategories(tree());
      expect(flat.map((c) => c.id)).toEqual(["root1", "1a", "g", "root2"]);
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    function seed(store: ReturnType<typeof useCategoryStore>) {
      store.categories = tree();
      store.flatCategories = store._flattenCategories(tree());
    }

    it("rootCategories returns the top-level tree", () => {
      const store = useCategoryStore();
      seed(store);
      expect(store.rootCategories.map((c) => c.id)).toEqual(["root1", "root2"]);
    });

    it("getCategoryById finds by id (undefined when absent)", () => {
      const store = useCategoryStore();
      seed(store);
      expect(store.getCategoryById("1a")?.name).toBe("Cat 1a");
      expect(store.getCategoryById("missing")).toBeUndefined();
    });

    it("getChildCategories returns direct children of a parent", () => {
      const store = useCategoryStore();
      seed(store);
      expect(store.getChildCategories("root1").map((c) => c.id)).toEqual([
        "1a",
      ]);
      expect(store.getChildCategories("1a").map((c) => c.id)).toEqual(["g"]);
      expect(store.getChildCategories("root2")).toEqual([]);
    });

    it("getCategoryPath builds the breadcrumb root → leaf", () => {
      const store = useCategoryStore();
      seed(store);
      expect(store.getCategoryPath("g").map((c) => c.id)).toEqual([
        "root1",
        "1a",
        "g",
      ]);
      expect(store.getCategoryPath("root1").map((c) => c.id)).toEqual([
        "root1",
      ]);
      expect(store.getCategoryPath("missing")).toEqual([]);
    });

    it("primaryCategoriesOptions maps top-level + children to options", () => {
      const store = useCategoryStore();
      seed(store);
      const opts = store.primaryCategoriesOptions;
      expect(opts.map((o) => o.value)).toEqual(["root1", "root2"]);
      expect(opts[0]).toMatchObject({
        label: "Cat root1",
        value: "root1",
        icon: "i1",
        color: "#111",
      });
      expect(opts[0].children?.map((c) => c.value)).toEqual(["1a"]);
      expect(opts[1].children).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("fetchCategories populates categories and the flat list", async () => {
      const store = useCategoryStore();
      mockCategory.getAll.mockResolvedValue(tree());
      const result = await store.fetchCategories("local-user");
      expect(mockCategory.getAll).toHaveBeenCalledWith("local-user");
      expect(result.map((c) => c.id)).toEqual(["root1", "root2"]);
      expect(store.flatCategories.map((c) => c.id)).toEqual([
        "root1",
        "1a",
        "g",
        "root2",
      ]);
      expect(store.loading).toBe(false);
    });

    it("deleteCategory clears the selection when it matches", async () => {
      const store = useCategoryStore();
      store.selectedCategory = cat("root2", null);
      mockCategory.delete.mockResolvedValue(undefined);
      mockCategory.getAll.mockResolvedValue([]);
      await store.deleteCategory("root2");
      expect(mockCategory.delete).toHaveBeenCalledWith("root2");
      expect(store.selectedCategory).toBeNull();
    });

    it("deleteCategory keeps a non-matching selection", async () => {
      const store = useCategoryStore();
      store.selectedCategory = cat("root1", null);
      mockCategory.delete.mockResolvedValue(undefined);
      mockCategory.getAll.mockResolvedValue([]);
      await store.deleteCategory("root2");
      expect(store.selectedCategory?.id).toBe("root1");
    });
  });

  // -------------------------------------------------------------------------
  // Pure actions
  // -------------------------------------------------------------------------

  describe("pure actions", () => {
    it("setSelectedCategory sets and clears the selection", () => {
      const store = useCategoryStore();
      store.setSelectedCategory(cat("a", null));
      expect(store.selectedCategory?.id).toBe("a");
      store.setSelectedCategory(null);
      expect(store.selectedCategory).toBeNull();
    });

    it("showEditDialog / hideEditDialog toggle dialog state", () => {
      const store = useCategoryStore();
      const c = cat("a", null);
      store.showEditDialog(c);
      expect(store.dialogVisible).toBe(true);
      expect(store.editingCategory?.id).toBe("a");
      store.hideEditDialog();
      expect(store.dialogVisible).toBe(false);
      expect(store.editingCategory).toBeNull();
    });

    it("reset restores the initial state", () => {
      const store = useCategoryStore();
      store.categories = tree();
      store.flatCategories = tree();
      store.selectedCategory = cat("a", null);
      store.initialized = true;
      store.dialogVisible = true;
      store.reset();
      expect(store.categories).toEqual([]);
      expect(store.flatCategories).toEqual([]);
      expect(store.selectedCategory).toBeNull();
      expect(store.initialized).toBe(false);
      expect(store.dialogVisible).toBe(false);
      expect(store.editingCategory).toBeNull();
    });
  });
});
