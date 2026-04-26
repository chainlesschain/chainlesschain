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
    expect(ids).toContain("enterprise-dashboard");
    expect(ids).toContain("cross-chain-bridge");
    expect(ids).toContain("wallet");
    expect(ids).toContain("analytics-dashboard");
    expect(ids).toContain("did-management");
    expect(ids).toContain("projects");
    expect(ids).toContain("p2p-messaging");
    expect(ids).toContain("community");
    expect(ids).toContain("ai-chat");
    expect(ids).toContain("settings");
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

  it("enterprise-dashboard 的 /enterprise slash + EnterpriseDashboardWidget 被注册", () => {
    const slash = Array.from(pm.uiRegistry.slashCommands.values());
    const ent = slash.find((s) => s.trigger === "/enterprise");
    expect(ent).toBeDefined();
    expect(ent.handler).toBe("builtin:openEnterpriseDashboardPanel");
    expect(ent.pluginId).toBe("enterprise-dashboard");

    const widgets = Array.from(pm.uiRegistry.homeWidgets.values());
    const entWidget = widgets.find(
      (w) => w.component === "builtin:EnterpriseDashboardWidget",
    );
    expect(entWidget).toBeDefined();
    expect(entWidget.title).toBe("企业仪表盘");
  });

  it("cross-chain-bridge 的 /bridge slash + CrossChainBridgeWidget 被注册", () => {
    const slash = Array.from(pm.uiRegistry.slashCommands.values());
    const br = slash.find((s) => s.trigger === "/bridge");
    expect(br).toBeDefined();
    expect(br.handler).toBe("builtin:openCrossChainBridgePanel");
    expect(br.pluginId).toBe("cross-chain-bridge");

    const widgets = Array.from(pm.uiRegistry.homeWidgets.values());
    const brWidget = widgets.find(
      (w) => w.component === "builtin:CrossChainBridgeWidget",
    );
    expect(brWidget).toBeDefined();
    expect(brWidget.title).toBe("跨链桥");
  });

  it("wallet 的 /wallet slash + WalletWidget 被注册", () => {
    const slash = Array.from(pm.uiRegistry.slashCommands.values());
    const wl = slash.find((s) => s.trigger === "/wallet");
    expect(wl).toBeDefined();
    expect(wl.handler).toBe("builtin:openWalletPanel");
    expect(wl.pluginId).toBe("wallet");

    const widgets = Array.from(pm.uiRegistry.homeWidgets.values());
    const wlWidget = widgets.find(
      (w) => w.component === "builtin:WalletWidget",
    );
    expect(wlWidget).toBeDefined();
    expect(wlWidget.title).toBe("钱包");
  });

  it("analytics-dashboard 的 /analytics slash + AnalyticsDashboardWidget 被注册", () => {
    const slash = Array.from(pm.uiRegistry.slashCommands.values());
    const an = slash.find((s) => s.trigger === "/analytics");
    expect(an).toBeDefined();
    expect(an.handler).toBe("builtin:openAnalyticsDashboardPanel");
    expect(an.pluginId).toBe("analytics-dashboard");

    const widgets = Array.from(pm.uiRegistry.homeWidgets.values());
    const anWidget = widgets.find(
      (w) => w.component === "builtin:AnalyticsDashboardWidget",
    );
    expect(anWidget).toBeDefined();
    expect(anWidget.title).toBe("高级分析");
  });

  it("did-management 的 /did slash + DIDManagementWidget 被注册", () => {
    const slash = Array.from(pm.uiRegistry.slashCommands.values());
    const dm = slash.find((s) => s.trigger === "/did");
    expect(dm).toBeDefined();
    expect(dm.handler).toBe("builtin:openDIDManagementPanel");
    expect(dm.pluginId).toBe("did-management");

    const widgets = Array.from(pm.uiRegistry.homeWidgets.values());
    const dmWidget = widgets.find(
      (w) => w.component === "builtin:DIDManagementWidget",
    );
    expect(dmWidget).toBeDefined();
    expect(dmWidget.size).toBe("medium");
    expect(dmWidget.title).toBe("DID 身份");
  });

  it("projects 的 /projects slash + ProjectsWidget 被注册", () => {
    const slash = Array.from(pm.uiRegistry.slashCommands.values());
    const pj = slash.find((s) => s.trigger === "/projects");
    expect(pj).toBeDefined();
    expect(pj.handler).toBe("builtin:openProjectsPanel");
    expect(pj.pluginId).toBe("projects");

    const widgets = Array.from(pm.uiRegistry.homeWidgets.values());
    const pjWidget = widgets.find(
      (w) => w.component === "builtin:ProjectsWidget",
    );
    expect(pjWidget).toBeDefined();
    expect(pjWidget.size).toBe("medium");
    expect(pjWidget.title).toBe("项目");
  });

  it("p2p-messaging 的 /p2p slash + P2PMessagingWidget 被注册", () => {
    const slash = Array.from(pm.uiRegistry.slashCommands.values());
    const p2p = slash.find((s) => s.trigger === "/p2p");
    expect(p2p).toBeDefined();
    expect(p2p.handler).toBe("builtin:openP2PMessagingPanel");
    expect(p2p.pluginId).toBe("p2p-messaging");

    const widgets = Array.from(pm.uiRegistry.homeWidgets.values());
    const p2pWidget = widgets.find(
      (w) => w.component === "builtin:P2PMessagingWidget",
    );
    expect(p2pWidget).toBeDefined();
    expect(p2pWidget.size).toBe("medium");
    expect(p2pWidget.title).toBe("P2P 消息");
  });

  it("community 的 /community slash + CommunityWidget 被注册", () => {
    const slash = Array.from(pm.uiRegistry.slashCommands.values());
    const cm = slash.find((s) => s.trigger === "/community");
    expect(cm).toBeDefined();
    expect(cm.handler).toBe("builtin:openCommunityPanel");
    expect(cm.pluginId).toBe("community");

    const widgets = Array.from(pm.uiRegistry.homeWidgets.values());
    const cmWidget = widgets.find(
      (w) => w.component === "builtin:CommunityWidget",
    );
    expect(cmWidget).toBeDefined();
    expect(cmWidget.size).toBe("medium");
    expect(cmWidget.title).toBe("社区");
  });

  it("ai-chat 的 /chat slash + AIChatWidget 被注册", () => {
    const slash = Array.from(pm.uiRegistry.slashCommands.values());
    const ch = slash.find((s) => s.trigger === "/chat");
    expect(ch).toBeDefined();
    expect(ch.handler).toBe("builtin:openAIChatPanel");
    expect(ch.pluginId).toBe("ai-chat");

    const widgets = Array.from(pm.uiRegistry.homeWidgets.values());
    const chWidget = widgets.find(
      (w) => w.component === "builtin:AIChatWidget",
    );
    expect(chWidget).toBeDefined();
    expect(chWidget.size).toBe("medium");
    expect(chWidget.title).toBe("AI 对话");
  });

  it("settings 的 /settings slash + SettingsWidget 被注册", () => {
    const slash = Array.from(pm.uiRegistry.slashCommands.values());
    const st = slash.find((s) => s.trigger === "/settings");
    expect(st).toBeDefined();
    expect(st.handler).toBe("builtin:openSettingsPanel");
    expect(st.pluginId).toBe("settings");

    const widgets = Array.from(pm.uiRegistry.homeWidgets.values());
    const stWidget = widgets.find(
      (w) => w.component === "builtin:SettingsWidget",
    );
    expect(stWidget).toBeDefined();
    expect(stWidget.size).toBe("medium");
    expect(stWidget.title).toBe("设置");
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
