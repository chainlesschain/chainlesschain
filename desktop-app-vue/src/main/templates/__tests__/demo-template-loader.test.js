/**
 * Unit tests for DemoTemplateLoader
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const fs = require("fs");
const path = require("path");
const {
  DemoTemplateLoader,
  getDemoTemplateLoader,
  DEMO_CATEGORIES,
} = require("../demo-template-loader.js");

describe("DemoTemplateLoader", () => {
  let loader;

  beforeEach(() => {
    loader = new DemoTemplateLoader();
  });

  describe("DEMO_CATEGORIES", () => {
    it("should include all expected categories", () => {
      expect(DEMO_CATEGORIES).toContain("automation");
      expect(DEMO_CATEGORIES).toContain("ai-workflow");
      expect(DEMO_CATEGORIES).toContain("knowledge");
      expect(DEMO_CATEGORIES).toContain("remote");
      expect(DEMO_CATEGORIES).toContain("devops");
      expect(DEMO_CATEGORIES).toContain("testing");
      expect(DEMO_CATEGORIES).toContain("content");
    });

    it("should have 7 categories", () => {
      expect(DEMO_CATEGORIES.length).toBe(7);
    });
  });

  describe("constructor", () => {
    it("should initialize with empty state", () => {
      expect(loader.templates.size).toBe(0);
      expect(loader.loaded).toBe(false);
    });

    it("should set templatesDir to module directory", () => {
      expect(loader.templatesDir).toBeDefined();
      expect(typeof loader.templatesDir).toBe("string");
    });
  });

  describe("loadAll()", () => {
    it("should load templates from all demo categories", async () => {
      const result = await loader.loadAll();
      expect(result.loaded).toBeGreaterThan(0);
      expect(result.errors).toEqual([]);
      expect(loader.loaded).toBe(true);
    });

    it("should set loaded flag after loading", async () => {
      expect(loader.loaded).toBe(false);
      await loader.loadAll();
      expect(loader.loaded).toBe(true);
    });

    it("should populate templates map", async () => {
      await loader.loadAll();
      expect(loader.templates.size).toBeGreaterThan(0);
    });

    it("should mark all loaded templates as builtin", async () => {
      await loader.loadAll();
      for (const template of loader.templates.values()) {
        expect(template.is_builtin).toBe(true);
      }
    });

    it("should return loaded count matching templates size", async () => {
      const result = await loader.loadAll();
      expect(result.loaded).toBe(loader.templates.size);
    });

    it("should handle non-existent category directories gracefully", async () => {
      // This tests the fs.existsSync check in loadAll
      const customLoader = new DemoTemplateLoader();
      customLoader.templatesDir = path.join(__dirname, "nonexistent-dir");
      const result = await customLoader.loadAll();
      expect(result.loaded).toBe(0);
      expect(result.errors).toEqual([]);
      expect(customLoader.loaded).toBe(true);
    });
  });

  describe("getAllDemoTemplates()", () => {
    it("should return empty array before loading", () => {
      expect(loader.getAllDemoTemplates()).toEqual([]);
    });

    it("should return all templates as array after loading", async () => {
      await loader.loadAll();
      const templates = loader.getAllDemoTemplates();
      expect(Array.isArray(templates)).toBe(true);
      expect(templates.length).toBe(loader.templates.size);
    });

    it("should return templates with required fields", async () => {
      await loader.loadAll();
      const templates = loader.getAllDemoTemplates();
      for (const t of templates) {
        expect(t.id).toBeDefined();
        expect(t.name).toBeDefined();
        expect(t.display_name).toBeDefined();
      }
    });
  });

  describe("getDemosByCategory()", () => {
    it("should return empty object before loading", () => {
      expect(loader.getDemosByCategory()).toEqual({});
    });

    it("should group templates by category", async () => {
      await loader.loadAll();
      const grouped = loader.getDemosByCategory();
      expect(typeof grouped).toBe("object");

      // At least some categories should have templates
      const categories = Object.keys(grouped);
      expect(categories.length).toBeGreaterThan(0);

      // Each category should have array of templates
      for (const cat of categories) {
        expect(Array.isArray(grouped[cat])).toBe(true);
        expect(grouped[cat].length).toBeGreaterThan(0);
      }
    });

    it("should include devops category with templates", async () => {
      await loader.loadAll();
      const grouped = loader.getDemosByCategory();
      expect(grouped["devops"]).toBeDefined();
      expect(grouped["devops"].length).toBeGreaterThan(0);
    });

    it("should include testing category with templates", async () => {
      await loader.loadAll();
      const grouped = loader.getDemosByCategory();
      expect(grouped["testing"]).toBeDefined();
      expect(grouped["testing"].length).toBeGreaterThan(0);
    });

    it("should include content category with templates", async () => {
      await loader.loadAll();
      const grouped = loader.getDemosByCategory();
      expect(grouped["content"]).toBeDefined();
      expect(grouped["content"].length).toBeGreaterThan(0);
    });
  });

  describe("getDemosBySkill()", () => {
    it("should return empty array for unknown skill", async () => {
      await loader.loadAll();
      expect(loader.getDemosBySkill("nonexistent-skill")).toEqual([]);
    });

    it("should find templates using memory-management skill", async () => {
      await loader.loadAll();
      const results = loader.getDemosBySkill("memory-management");
      expect(results.length).toBeGreaterThan(0);
      for (const t of results) {
        expect(t.skills_used).toContain("memory-management");
      }
    });

    it("should find templates using k8s-deployer skill", async () => {
      await loader.loadAll();
      const results = loader.getDemosBySkill("k8s-deployer");
      expect(results.length).toBeGreaterThan(0);
    });

    it("should find templates using webapp-testing skill", async () => {
      await loader.loadAll();
      const results = loader.getDemosBySkill("webapp-testing");
      expect(results.length).toBeGreaterThan(0);
    });

    it("should find templates using deep-research skill", async () => {
      await loader.loadAll();
      const results = loader.getDemosBySkill("deep-research");
      expect(results.length).toBeGreaterThan(0);
    });

    it("should find templates using ultrathink skill", async () => {
      await loader.loadAll();
      const results = loader.getDemosBySkill("ultrathink");
      expect(results.length).toBeGreaterThan(0);
    });

    it("should handle templates without skills_used field", () => {
      loader.templates.set("test", {
        id: "test",
        name: "test",
        display_name: "Test",
      });
      expect(loader.getDemosBySkill("any-skill")).toEqual([]);
    });
  });

  describe("getDemoById()", () => {
    it("should return null for unknown ID", () => {
      expect(loader.getDemoById("nonexistent-id")).toBeNull();
    });

    it("should find template by ID", async () => {
      await loader.loadAll();
      const template = loader.getDemoById("tpl_demo_k8s_001");
      expect(template).not.toBeNull();
      expect(template.id).toBe("tpl_demo_k8s_001");
      expect(template.name).toBe("k8s_deployment_pipeline");
    });

    it("should find original demo templates", async () => {
      await loader.loadAll();
      const template = loader.getDemoById("tpl_demo_codereview_001");
      expect(template).not.toBeNull();
      expect(template.skills_used).toContain("code-review");
    });
  });

  describe("getDemosByDifficulty()", () => {
    it("should filter by beginner difficulty", async () => {
      await loader.loadAll();
      const results = loader.getDemosByDifficulty("beginner");
      expect(results.length).toBeGreaterThan(0);
      for (const t of results) {
        expect(t.difficulty).toBe("beginner");
      }
    });

    it("should filter by intermediate difficulty", async () => {
      await loader.loadAll();
      const results = loader.getDemosByDifficulty("intermediate");
      expect(results.length).toBeGreaterThan(0);
      for (const t of results) {
        expect(t.difficulty).toBe("intermediate");
      }
    });

    it("should filter by advanced difficulty", async () => {
      await loader.loadAll();
      const results = loader.getDemosByDifficulty("advanced");
      expect(results.length).toBeGreaterThan(0);
      for (const t of results) {
        expect(t.difficulty).toBe("advanced");
      }
    });

    it("should return empty array for unknown difficulty", async () => {
      await loader.loadAll();
      expect(loader.getDemosByDifficulty("expert")).toEqual([]);
    });
  });

  describe("getSummary()", () => {
    it("should return empty summary before loading", () => {
      const summary = loader.getSummary();
      expect(summary.total).toBe(0);
      expect(summary.byCategory).toEqual({});
      expect(summary.byDifficulty).toEqual({});
      expect(summary.skillUsage).toEqual({});
    });

    it("should return populated summary after loading", async () => {
      await loader.loadAll();
      const summary = loader.getSummary();
      expect(summary.total).toBeGreaterThan(0);
      expect(summary.total).toBe(loader.templates.size);
    });

    it("should count categories correctly", async () => {
      await loader.loadAll();
      const summary = loader.getSummary();
      const totalFromCategories = Object.values(summary.byCategory).reduce(
        (sum, count) => sum + count,
        0,
      );
      expect(totalFromCategories).toBe(summary.total);
    });

    it("should track skill usage", async () => {
      await loader.loadAll();
      const summary = loader.getSummary();
      expect(summary.skillUsage["memory-management"]).toBeGreaterThan(0);
    });

    it("should track difficulty distribution", async () => {
      await loader.loadAll();
      const summary = loader.getSummary();
      expect(Object.keys(summary.byDifficulty).length).toBeGreaterThan(0);
    });
  });

  describe("registerWithTemplateManager()", () => {
    it("should register all templates with template manager", async () => {
      await loader.loadAll();
      const mockManager = { saveTemplate: vi.fn().mockResolvedValue(true) };
      const count = await loader.registerWithTemplateManager(mockManager);
      expect(count).toBe(loader.templates.size);
      expect(mockManager.saveTemplate).toHaveBeenCalledTimes(
        loader.templates.size,
      );
    });

    it("should auto-load if not loaded yet", async () => {
      const mockManager = { saveTemplate: vi.fn().mockResolvedValue(true) };
      expect(loader.loaded).toBe(false);
      await loader.registerWithTemplateManager(mockManager);
      expect(loader.loaded).toBe(true);
      expect(mockManager.saveTemplate).toHaveBeenCalled();
    });

    it("should handle save errors gracefully", async () => {
      await loader.loadAll();
      const mockManager = {
        saveTemplate: vi.fn().mockRejectedValue(new Error("Save failed")),
      };
      const count = await loader.registerWithTemplateManager(mockManager);
      expect(count).toBe(0);
    });
  });

  describe("getDemoTemplateLoader() singleton", () => {
    it("should return the same instance", () => {
      const a = getDemoTemplateLoader();
      const b = getDemoTemplateLoader();
      expect(a).toBe(b);
    });

    it("should return a DemoTemplateLoader instance", () => {
      const instance = getDemoTemplateLoader();
      expect(instance).toBeInstanceOf(DemoTemplateLoader);
    });
  });

  describe("template data integrity", () => {
    it("should load all new v1.2.0 demo templates", async () => {
      await loader.loadAll();
      const newTemplateIds = [
        "tpl_demo_k8s_001",
        "tpl_demo_terraform_001",
        "tpl_demo_docker_001",
        "tpl_demo_cron_001",
        "tpl_demo_webtest_001",
        "tpl_demo_prreview_001",
        "tpl_demo_agentbrowser_001",
        "tpl_demo_youtube_001",
        "tpl_demo_news_001",
        "tpl_demo_publish_001",
        "tpl_demo_remotion_001",
        "tpl_demo_deepresearch_001",
        "tpl_demo_apidocs_001",
        "tpl_demo_dbquery_001",
        "tpl_demo_ultrathink_001",
        "tpl_demo_proactive_001",
        "tpl_demo_findskills_001",
        "tpl_demo_planning_001",
        "tpl_demo_worktree_001",
        "tpl_demo_cursorrules_001",
      ];
      for (const id of newTemplateIds) {
        const t = loader.getDemoById(id);
        expect(t).not.toBeNull();
        expect(t.id).toBe(id);
      }
    });

    it("should have valid skills_used arrays for all templates", async () => {
      await loader.loadAll();
      for (const t of loader.templates.values()) {
        if (t.skills_used) {
          expect(Array.isArray(t.skills_used)).toBe(true);
          expect(t.skills_used.length).toBeGreaterThan(0);
          for (const skill of t.skills_used) {
            expect(typeof skill).toBe("string");
            expect(skill.length).toBeGreaterThan(0);
          }
        }
      }
    });

    it("should have valid difficulty values", async () => {
      await loader.loadAll();
      const validDifficulties = ["beginner", "intermediate", "advanced"];
      for (const t of loader.templates.values()) {
        if (t.difficulty) {
          expect(validDifficulties).toContain(t.difficulty);
        }
      }
    });

    it("should have valid variables_schema for all templates", async () => {
      await loader.loadAll();
      for (const t of loader.templates.values()) {
        if (t.variables_schema) {
          expect(Array.isArray(t.variables_schema)).toBe(true);
          for (const v of t.variables_schema) {
            expect(v.name).toBeDefined();
            expect(v.label).toBeDefined();
            expect(v.type).toBeDefined();
          }
        }
      }
    });

    it("should have unique template IDs", async () => {
      await loader.loadAll();
      const ids = new Set();
      for (const t of loader.templates.values()) {
        expect(ids.has(t.id)).toBe(false);
        ids.add(t.id);
      }
    });

    it("should cover new v1.2.0 skills in demo templates", async () => {
      await loader.loadAll();
      const summary = loader.getSummary();
      const newSkills = [
        "k8s-deployer",
        "terraform-iac",
        "docker-compose-generator",
        "cron-scheduler",
        "webapp-testing",
        "pr-reviewer",
        "agent-browser",
        "youtube-summarizer",
        "news-monitor",
        "content-publisher",
        "remotion-video",
        "deep-research",
        "tavily-search",
        "ultrathink",
        "api-docs-generator",
        "database-query",
        "proactive-agent",
        "find-skills",
        "skill-creator",
        "planning-with-files",
        "git-worktree-manager",
        "cursor-rules-generator",
      ];
      for (const skill of newSkills) {
        expect(summary.skillUsage[skill]).toBeGreaterThan(0);
      }
    });
  });
});
