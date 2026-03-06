/**
 * Demo Templates E2E Tests
 *
 * Tests the demo template loading pipeline, IPC integration,
 * and template data integrity through the Electron main process.
 */
import { test, expect, _electron as electron } from "@playwright/test";
import path from "path";

test.describe("演示模板系统", () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    electronApp = await electron.launch({
      args: [path.join(__dirname, "../../dist/main/index.js")],
      env: {
        ...process.env,
        NODE_ENV: "test",
      },
    });

    window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test("应该能够通过 IPC 加载演示模板", async () => {
    const result = await electronApp.evaluate(async ({ ipcMain }) => {
      // Simulate IPC call to get demo templates
      const { getDemoTemplateLoader } = require(
        "../src/main/templates/demo-template-loader.js",
      );
      const loader = getDemoTemplateLoader();
      await loader.loadAll();
      return {
        total: loader.getAllDemoTemplates().length,
        loaded: loader.loaded,
      };
    });

    expect(result.loaded).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(27); // 10 original + 17 new
  });

  test("应该包含所有7个演示分类", async () => {
    const categories = await electronApp.evaluate(async () => {
      const { getDemoTemplateLoader } = require(
        "../src/main/templates/demo-template-loader.js",
      );
      const loader = getDemoTemplateLoader();
      if (!loader.loaded) await loader.loadAll();
      const grouped = loader.getDemosByCategory();
      return Object.keys(grouped);
    });

    expect(categories).toContain("automation");
    expect(categories).toContain("ai-workflow");
    expect(categories).toContain("knowledge");
    expect(categories).toContain("remote");
    expect(categories).toContain("devops");
    expect(categories).toContain("testing");
    expect(categories).toContain("content");
  });

  test("应该能够按技能名搜索演示模板", async () => {
    const results = await electronApp.evaluate(async () => {
      const { getDemoTemplateLoader } = require(
        "../src/main/templates/demo-template-loader.js",
      );
      const loader = getDemoTemplateLoader();
      if (!loader.loaded) await loader.loadAll();

      return {
        k8s: loader.getDemosBySkill("k8s-deployer").length,
        ultrathink: loader.getDemosBySkill("ultrathink").length,
        webapp: loader.getDemosBySkill("webapp-testing").length,
        memory: loader.getDemosBySkill("memory-management").length,
      };
    });

    expect(results.k8s).toBeGreaterThan(0);
    expect(results.ultrathink).toBeGreaterThan(0);
    expect(results.webapp).toBeGreaterThan(0);
    expect(results.memory).toBeGreaterThan(0);
  });

  test("应该能够按难度筛选演示模板", async () => {
    const results = await electronApp.evaluate(async () => {
      const { getDemoTemplateLoader } = require(
        "../src/main/templates/demo-template-loader.js",
      );
      const loader = getDemoTemplateLoader();
      if (!loader.loaded) await loader.loadAll();

      return {
        beginner: loader.getDemosByDifficulty("beginner").length,
        intermediate: loader.getDemosByDifficulty("intermediate").length,
        advanced: loader.getDemosByDifficulty("advanced").length,
      };
    });

    expect(results.beginner).toBeGreaterThan(0);
    expect(results.intermediate).toBeGreaterThan(0);
    expect(results.advanced).toBeGreaterThan(0);
  });

  test("应该能够获取演示模板统计摘要", async () => {
    const summary = await electronApp.evaluate(async () => {
      const { getDemoTemplateLoader } = require(
        "../src/main/templates/demo-template-loader.js",
      );
      const loader = getDemoTemplateLoader();
      if (!loader.loaded) await loader.loadAll();
      return loader.getSummary();
    });

    expect(summary.total).toBeGreaterThanOrEqual(27);
    expect(Object.keys(summary.byCategory).length).toBeGreaterThanOrEqual(7);
    expect(Object.keys(summary.byDifficulty).length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(summary.skillUsage).length).toBeGreaterThan(10);
  });

  test("所有新v1.2.0技能应有对应的演示模板", async () => {
    const coverage = await electronApp.evaluate(async () => {
      const { getDemoTemplateLoader } = require(
        "../src/main/templates/demo-template-loader.js",
      );
      const loader = getDemoTemplateLoader();
      if (!loader.loaded) await loader.loadAll();

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

      const result: Record<string, number> = {};
      for (const skill of newSkills) {
        result[skill] = loader.getDemosBySkill(skill).length;
      }
      return result;
    });

    for (const [skill, count] of Object.entries(coverage)) {
      expect(count, `Skill "${skill}" should have at least 1 demo template`).toBeGreaterThan(0);
    }
  });

  test("所有演示模板应有有效的 JSON 结构", async () => {
    const validation = await electronApp.evaluate(async () => {
      const { getDemoTemplateLoader } = require(
        "../src/main/templates/demo-template-loader.js",
      );
      const loader = getDemoTemplateLoader();
      if (!loader.loaded) await loader.loadAll();

      const issues: string[] = [];
      for (const t of loader.getAllDemoTemplates()) {
        if (!t.id) issues.push(`Missing id: ${t.name}`);
        if (!t.name) issues.push(`Missing name: ${t.id}`);
        if (!t.display_name) issues.push(`Missing display_name: ${t.id}`);
        if (!t.is_builtin) issues.push(`Not marked builtin: ${t.id}`);
        if (!t.skills_used || t.skills_used.length === 0)
          issues.push(`Missing skills_used: ${t.id}`);
        if (!t.difficulty) issues.push(`Missing difficulty: ${t.id}`);
        if (!t.category) issues.push(`Missing category: ${t.id}`);
      }
      return { issues, total: loader.getAllDemoTemplates().length };
    });

    expect(validation.issues).toEqual([]);
    expect(validation.total).toBeGreaterThanOrEqual(27);
  });

  test("应该能够通过模板管理页面查看演示模板", async () => {
    await window.waitForTimeout(2000);

    // Navigate to template management page
    await window.evaluate(() => {
      (window as any).location.hash = "#/template-management?e2e=true";
    });
    await window.waitForTimeout(3000);

    const url = await window.evaluate(() => (window as any).location.hash);
    expect(url).toContain("/template-management");

    // Verify the page has some content rendered
    const hasContent = await window.evaluate(() => {
      return document.body.innerText.length > 0;
    });
    expect(hasContent).toBeTruthy();
  });
});
