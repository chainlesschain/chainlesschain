/**
 * useTemplateStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: filteredTemplates (category/subcategory) / templatesByCategory
 *    (group + 'other' default)
 *  - Actions (electronAPI.template.* mocked): fetchTemplates (populate / fail→[] /
 *    feature-disable after 3 failures), getTemplateById (local-cache short-circuit),
 *    createTemplate (push), updateTemplate (in-place replace), deleteTemplate
 *    (remove), recordUsage (usage_count++), renderPrompt (return / empty throws)
 *
 * NB: template.ts imports `electronAPI` from "../utils/ipc"; from
 * stores/__tests__/ that is "../../utils/ipc". Mock object is built in
 * vi.hoisted so it exists when the factory runs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const { tpl } = vi.hoisted(() => ({
  tpl: {
    getAll: vi.fn(),
    getById: vi.fn(),
    search: vi.fn(),
    renderPrompt: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    duplicate: vi.fn(),
    recordUsage: vi.fn(),
    getStats: vi.fn(),
  },
}));

vi.mock("../../utils/ipc", () => ({
  electronAPI: { template: tpl },
}));
vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { useTemplateStore } from "../template";
import type { Template } from "../template";

function tmpl(id: string, overrides: Partial<Template> = {}): Template {
  return {
    id,
    name: `T ${id}`,
    category: "general",
    content: "body",
    ...overrides,
  };
}

describe("useTemplateStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    Object.values(tpl).forEach((m) => m.mockReset());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty with no active category", () => {
      const store = useTemplateStore();
      expect(store.templates).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.currentCategory).toBeNull();
      expect(store.currentSubcategory).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("filteredTemplates returns all without an active category", () => {
      const store = useTemplateStore();
      store.templates = [tmpl("a"), tmpl("b")];
      expect(store.filteredTemplates.map((t) => t.id)).toEqual(["a", "b"]);
    });

    it("filteredTemplates respects category + subcategory", () => {
      const store = useTemplateStore();
      store.templates = [
        tmpl("a", { category: "x", subcategory: "s1" }),
        tmpl("b", { category: "x", subcategory: "s2" }),
        tmpl("c", { category: "y" }),
      ];
      store.currentCategory = "x";
      expect(store.filteredTemplates.map((t) => t.id)).toEqual(["a", "b"]);
      store.currentSubcategory = "s2";
      expect(store.filteredTemplates.map((t) => t.id)).toEqual(["b"]);
    });

    it("templatesByCategory groups, defaulting empty category to 'other'", () => {
      const store = useTemplateStore();
      store.templates = [
        tmpl("a", { category: "data" }),
        tmpl("b", { category: "" }),
        tmpl("c", { category: "data" }),
      ];
      const groups = store.templatesByCategory;
      expect(groups.data.map((t) => t.id)).toEqual(["a", "c"]);
      expect(groups.other.map((t) => t.id)).toEqual(["b"]);
    });
  });

  // -------------------------------------------------------------------------
  // fetchTemplates + feature-disable
  // -------------------------------------------------------------------------

  describe("fetchTemplates", () => {
    it("populates templates on success", async () => {
      const store = useTemplateStore();
      tpl.getAll.mockResolvedValue({
        success: true,
        templates: [tmpl("a"), tmpl("b")],
      });
      const result = await store.fetchTemplates({ category: "general" });
      expect(tpl.getAll).toHaveBeenCalledWith({ category: "general" });
      expect(result.map((t) => t.id)).toEqual(["a", "b"]);
      expect(store.loading).toBe(false);
    });

    it("clears templates and returns [] on a failed result", async () => {
      const store = useTemplateStore();
      tpl.getAll.mockResolvedValue({ success: false, error: "no mgr" });
      const result = await store.fetchTemplates();
      expect(result).toEqual([]);
      expect(store.templates).toEqual([]);
    });

    it("disables the feature after 3 consecutive failures (no further IPC)", async () => {
      const store = useTemplateStore();
      tpl.getAll.mockResolvedValue({ success: false, error: "no mgr" });
      await store.fetchTemplates();
      await store.fetchTemplates();
      await store.fetchTemplates();
      expect(tpl.getAll).toHaveBeenCalledTimes(3);
      // 4th call short-circuits: feature marked unavailable
      const result = await store.fetchTemplates();
      expect(result).toEqual([]);
      expect(tpl.getAll).toHaveBeenCalledTimes(3); // unchanged
    });
  });

  // -------------------------------------------------------------------------
  // CRUD + usage
  // -------------------------------------------------------------------------

  describe("CRUD + usage", () => {
    it("getTemplateById returns from the local cache without IPC", async () => {
      const store = useTemplateStore();
      store.templates = [tmpl("a", { name: "cached" })];
      const result = await store.getTemplateById("a");
      expect(result.name).toBe("cached");
      expect(tpl.getById).not.toHaveBeenCalled();
    });

    it("createTemplate pushes the created template", async () => {
      const store = useTemplateStore();
      tpl.create.mockResolvedValue({ success: true, template: tmpl("new") });
      const created = await store.createTemplate({
        name: "new",
        category: "g",
        content: "c",
      });
      expect(created.id).toBe("new");
      expect(store.templates.map((t) => t.id)).toEqual(["new"]);
    });

    it("updateTemplate replaces the template in place", async () => {
      const store = useTemplateStore();
      store.templates = [tmpl("a", { name: "old" }), tmpl("b")];
      tpl.update.mockResolvedValue({
        success: true,
        template: tmpl("a", { name: "fresh" }),
      });
      await store.updateTemplate("a", { name: "fresh" });
      expect(store.templates.find((t) => t.id === "a")?.name).toBe("fresh");
      expect(store.templates.map((t) => t.id)).toEqual(["a", "b"]);
    });

    it("deleteTemplate removes the template and returns true", async () => {
      const store = useTemplateStore();
      store.templates = [tmpl("a"), tmpl("b")];
      tpl.delete.mockResolvedValue({ success: true });
      const ok = await store.deleteTemplate("a");
      expect(ok).toBe(true);
      expect(store.templates.map((t) => t.id)).toEqual(["b"]);
    });

    it("recordUsage increments the local usage_count on success", async () => {
      const store = useTemplateStore();
      store.templates = [tmpl("a", { usage_count: 2 })];
      tpl.recordUsage.mockResolvedValue({ success: true });
      await store.recordUsage("a", "u1", "p1", { foo: 1 });
      expect(store.templates[0].usage_count).toBe(3);
    });

    it("renderPrompt returns the rendered string, and throws when empty", async () => {
      const store = useTemplateStore();
      tpl.renderPrompt.mockResolvedValue({
        success: true,
        renderedPrompt: "Hello",
      });
      expect(await store.renderPrompt("a", {})).toBe("Hello");

      tpl.renderPrompt.mockResolvedValue({ success: true, renderedPrompt: "" });
      await expect(store.renderPrompt("a", {})).rejects.toThrow(
        "渲染成功但返回结果为空",
      );
    });
  });
});
