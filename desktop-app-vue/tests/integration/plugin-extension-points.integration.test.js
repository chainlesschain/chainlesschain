/**
 * Integration — v6 shell extension points end-to-end.
 *
 * 目标：PluginManager 启动后应加载 first-party 插件，产生一组正确的贡献；
 * 把一个"企业覆盖"插件放到 mdmExtractDir 后，高优先级贡献应该胜过内置默认。
 *
 * 不依赖 Electron 的真实 DB，用一个假的 registry 让 initialize() 顺利通过。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// Stub electron：PluginLoader 构造依赖 app.getPath，vitest 的 vi.mock 只管
// Vitest 模块图，而 createRequire 走 Node 原生 require，绕过了 mock。
// 直接在 require.cache 里放一份假 electron。
const electronPath = require.resolve("electron");
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ext-electron-"));
require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: {
    app: {
      getPath: (k) => (k === "temp" ? os.tmpdir() : tmpUserData),
      getName: () => "test-app",
      getVersion: () => "1.0.0",
    },
    ipcMain: {
      handle: () => {},
      on: () => {},
      once: () => {},
      removeHandler: () => {},
    },
    BrowserWindow: class {},
  },
};

// PluginRegistry 使用 database；first-party 插件流程完全绕过 DB，
// 只需让 initialize() 能跑到 loadFirstPartyPlugins()。
class FakeRegistry {
  async initialize() {}
  getInstalledPlugins() {
    return [];
  }
}

const pluginRegistryPath = require.resolve(
  path.resolve(__dirname, "../../src/main/plugins/plugin-registry"),
);
require.cache[pluginRegistryPath] = {
  id: pluginRegistryPath,
  filename: pluginRegistryPath,
  loaded: true,
  exports: FakeRegistry,
};

const { PluginManager } = require("../../src/main/plugins/plugin-manager");

describe("v6 extension points — first-party + MDM override", () => {
  let mdmDir;
  let pm;

  beforeAll(async () => {
    mdmDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ext-int-"));

    const overrideDir = path.join(mdmDir, "acme-override");
    fs.mkdirSync(overrideDir, { recursive: true });
    fs.writeFileSync(
      path.join(overrideDir, "plugin.json"),
      JSON.stringify({
        id: "acme-override",
        name: "Acme Corp Override",
        version: "1.0.0",
        firstParty: true,
        description: "Integration test synthetic override",
        extensionPoints: [
          {
            point: "brand.theme",
            priority: 100,
            config: {
              id: "acme-corporate",
              name: "Acme Corporate",
              mode: "light",
              tokens: { "--cc-primary": "#e91e63" },
            },
          },
          {
            point: "ai.llm-provider",
            priority: 100,
            config: {
              id: "acme-llm",
              name: "Acme LLM",
              models: ["acme-gpt-4"],
              endpoint: "https://llm.acme.example",
              capabilities: { streaming: true },
            },
          },
        ],
      }),
      "utf-8",
    );

    pm = new PluginManager(/* database */ null, {});
    pm.setMDMExtractDir(mdmDir);
    await pm.initialize();
  });

  afterAll(() => {
    try {
      fs.rmSync(mdmDir, { recursive: true, force: true });
    } catch (_err) {
      /* ignore */
    }
  });

  it("加载所有 first-party 插件 + MDM 覆盖插件", () => {
    const ids = Array.from(pm.plugins.keys());
    expect(ids).toContain("brand-default");
    expect(ids).toContain("ai-ollama-default");
    expect(ids).toContain("admin-console");
    expect(ids).toContain("ai-prompts");
    expect(ids).toContain("git-hooks");
    expect(ids).toContain("knowledge-graph");
    expect(ids).toContain("workflow-designer");
    expect(ids).toContain("acme-override");
  });

  it("ai-prompts 的 /prompts slash 命令 + AIPromptsWidget home widget 被注册", () => {
    const slash = Array.from(pm.uiRegistry.slashCommands.values());
    const prompts = slash.find((s) => s.trigger === "/prompts");
    expect(prompts).toBeDefined();
    expect(prompts.handler).toBe("builtin:openPromptsPanel");
    expect(prompts.pluginId).toBe("ai-prompts");

    const widgets = Array.from(pm.uiRegistry.homeWidgets.values());
    const aiWidget = widgets.find(
      (w) => w.component === "builtin:AIPromptsWidget",
    );
    expect(aiWidget).toBeDefined();
    expect(aiWidget.size).toBe("medium");
    expect(aiWidget.title).toBe("AI 提示模板");
  });

  it("git-hooks 的 /git-hooks slash 命令 + GitHooksWidget home widget 被注册", () => {
    const slash = Array.from(pm.uiRegistry.slashCommands.values());
    const gitHooks = slash.find((s) => s.trigger === "/git-hooks");
    expect(gitHooks).toBeDefined();
    expect(gitHooks.handler).toBe("builtin:openGitHooksPanel");
    expect(gitHooks.pluginId).toBe("git-hooks");

    const widgets = Array.from(pm.uiRegistry.homeWidgets.values());
    const hooksWidget = widgets.find(
      (w) => w.component === "builtin:GitHooksWidget",
    );
    expect(hooksWidget).toBeDefined();
    expect(hooksWidget.size).toBe("medium");
    expect(hooksWidget.title).toBe("Git Hooks");
  });

  it("knowledge-graph 的 /kg slash 命令 + KnowledgeGraphWidget home widget 被注册", () => {
    const slash = Array.from(pm.uiRegistry.slashCommands.values());
    const kg = slash.find((s) => s.trigger === "/kg");
    expect(kg).toBeDefined();
    expect(kg.handler).toBe("builtin:openKnowledgeGraphPanel");
    expect(kg.pluginId).toBe("knowledge-graph");

    const widgets = Array.from(pm.uiRegistry.homeWidgets.values());
    const kgWidget = widgets.find(
      (w) => w.component === "builtin:KnowledgeGraphWidget",
    );
    expect(kgWidget).toBeDefined();
    expect(kgWidget.size).toBe("medium");
    expect(kgWidget.title).toBe("知识图谱");
  });

  it("workflow-designer 的 /workflow slash 命令 + WorkflowDesignerWidget home widget 被注册", () => {
    const slash = Array.from(pm.uiRegistry.slashCommands.values());
    const wf = slash.find((s) => s.trigger === "/workflow");
    expect(wf).toBeDefined();
    expect(wf.handler).toBe("builtin:openWorkflowDesignerPanel");
    expect(wf.pluginId).toBe("workflow-designer");

    const widgets = Array.from(pm.uiRegistry.homeWidgets.values());
    const wfWidget = widgets.find(
      (w) => w.component === "builtin:WorkflowDesignerWidget",
    );
    expect(wfWidget).toBeDefined();
    expect(wfWidget.size).toBe("medium");
    expect(wfWidget.title).toBe("工作流");
  });

  it("brand.theme priority 100 覆盖默认 10", () => {
    const active = pm.getActiveBrandTheme();
    expect(active).not.toBeNull();
    expect(active.themeId).toBe("acme-corporate");
    expect(active.priority).toBe(100);
  });

  it("ai.llm-provider priority 100 覆盖默认 10", () => {
    const active = pm.getActiveLLMProvider();
    expect(active).not.toBeNull();
    expect(active.providerId).toBe("acme-llm");
    expect(active.priority).toBe(100);
    expect(active.endpoint).toBe("https://llm.acme.example");
  });

  it("admin-console 的 ui.slash /admin 与 ui.status-bar admin-shortcut 被注册", () => {
    const slash = Array.from(pm.uiRegistry.slashCommands.values());
    const admin = slash.find((s) => s.trigger === "/admin");
    expect(admin).toBeDefined();
    expect(admin.handler).toBe("builtin:openAdminConsole");

    const widgets = Array.from(pm.uiRegistry.statusBarWidgets.values());
    const shortcut = widgets.find(
      (w) => w.component === "builtin:AdminShortcut",
    );
    expect(shortcut).toBeDefined();
    expect(shortcut.position).toBe("right");
  });

  it("getRegisteredBrandThemes 按 priority 降序", () => {
    const list = pm.getRegisteredBrandThemes();
    expect(list.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1].priority).toBeGreaterThanOrEqual(list[i].priority);
    }
  });
});
