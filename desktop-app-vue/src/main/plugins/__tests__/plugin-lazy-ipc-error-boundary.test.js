import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ipc = {
  handlers: new Map(),
  handle: vi.fn(),
};

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { registerLazyPluginIPC } = require("../plugin-lazy-ipc.js");

describe("lazy plugin IPC error boundary", () => {
  beforeEach(() => {
    ipc.handlers.clear();
    ipc.handle.mockReset();
    ipc.handle.mockImplementation((channel, handler) => {
      ipc.handlers.set(channel, handler);
    });
  });

  it("returns a stable failure when initialization rejects", async () => {
    const secret = "plugin-lazy-initialization-secret";
    registerLazyPluginIPC({
      app: {
        pluginInitialized: false,
        initializePluginSystem: vi.fn().mockRejectedValue(new Error(secret)),
      },
      mainWindow: null,
      ipc,
    });

    const result = await ipc.handlers.get("plugin:get-plugins")({}, {});

    expect(result).toEqual({
      success: false,
      error: "Plugin operation failed",
      code: "PLUGIN_LAZY_OPERATION_FAILED",
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("projects successful plugin queries and install receipts", async () => {
    const secret = "C:/private/lazy-plugin-secret";
    const sandbox = {
      callMethod: vi.fn().mockResolvedValue({ secret }),
    };
    const plugin = {
      id: "plugin-1",
      name: "Plugin",
      version: "1.0.0",
      enabled: 1,
      state: "enabled",
      path: secret,
      manifest: {
        entry: secret,
        tools: [
          {
            id: "tool-1",
            name: "search",
            displayName: "Search",
            description: "Search public data",
            category: "knowledge",
            type: "function",
            riskLevel: 3,
            requiredPermissions: ["network"],
            handler: secret,
            parameters: { default: secret },
          },
        ],
        skills: [
          {
            id: "skill-1",
            name: "Research",
            displayName: "Research",
            description: "Research workflow",
            category: "knowledge",
            icon: "SearchOutlined",
            tags: ["research"],
            tools: ["search"],
            config: { secret },
          },
        ],
      },
    };
    registerLazyPluginIPC({
      app: {
        pluginInitialized: true,
        pluginManager: {
          getPlugins: vi.fn().mockReturnValue([plugin]),
          getPlugin: vi.fn().mockReturnValue(plugin),
          installPlugin: vi.fn().mockResolvedValue({
            success: true,
            pluginId: "plugin-1",
            path: secret,
          }),
          plugins: new Map([["plugin-1", { sandbox }]]),
          registry: {
            getExtensionsByPoint: vi.fn((point) => [
              {
                id: `${point}-1`,
                plugin_id: "plugin-1",
                plugin_name: "Plugin",
                priority: 1,
                config: {
                  id: "main",
                  path: "/main",
                  label: "Menu",
                  slot: "global-header",
                  type: "html",
                  html: secret,
                  meta: { secret },
                  componentPath: secret,
                },
              },
            ]),
            getPluginSettingDefinitions: vi.fn().mockReturnValue([
              { key: "apiKey", is_secret: 1, default: secret },
              { key: "theme", type: "string" },
            ]),
            getPluginSettings: vi.fn().mockReturnValue({
              apiKey: secret,
              theme: "dark",
              undeclared: secret,
            }),
          },
        },
      },
      mainWindow: null,
      ipc,
    });

    const list = await ipc.handlers.get("plugin:get-plugins")({}, {});
    const detail = await ipc.handlers.get("plugin:get-plugin")({}, "plugin-1");
    const install = await ipc.handlers.get("plugin:install")({}, secret, {});
    const settings = await ipc.handlers.get("plugin:get-settings")(
      {},
      "plugin-1",
    );
    const extensions = await ipc.handlers.get("plugin:get-ui-extensions")();
    const slot = await ipc.handlers.get("plugin:get-slot-extensions")(
      {},
      "global-header",
    );
    const page = await ipc.handlers.get("plugin:get-page-content")(
      {},
      "plugin-1",
      "main",
    );
    const tools = await ipc.handlers.get("plugin:get-tools")({}, "plugin-1");
    const skills = await ipc.handlers.get("plugin:get-skills")({}, "plugin-1");
    const execution = await ipc.handlers.get("plugin:execute-tool")(
      {},
      "plugin-1",
      "search",
      { query: "public" },
    );

    expect(list[0]).toMatchObject({
      id: "plugin-1",
      plugin_id: "plugin-1",
      name: "Plugin",
      enabled: true,
    });
    expect(detail).toEqual(list[0]);
    expect(install).toEqual({ success: true, pluginId: "plugin-1" });
    expect(settings).toEqual({
      success: true,
      settings: {
        apiKey: { configured: true, redacted: true },
        theme: "dark",
      },
    });
    expect(extensions.extensions.pages[0].config).toEqual({
      id: "main",
      path: "/main",
      title: "",
      icon: "",
    });
    expect(slot.extensions[0].config.type).toBe("custom");
    expect(page).toEqual({
      success: true,
      contentType: "component",
      props: { pluginId: "plugin-1", pageId: "main" },
    });
    expect(tools.tools[0]).toEqual({
      id: "tool-1",
      name: "search",
      displayName: "Search",
      description: "Search public data",
      category: "knowledge",
      type: "function",
      riskLevel: 3,
      requiredPermissions: ["network"],
    });
    expect(skills.skills[0]).toEqual({
      id: "skill-1",
      name: "Research",
      displayName: "Research",
      description: "Research workflow",
      category: "knowledge",
      icon: "SearchOutlined",
      tags: ["research"],
      tools: ["search"],
    });
    expect(execution).toEqual({ success: true, executed: true });
    expect(sandbox.callMethod).toHaveBeenCalledWith("executeTool", "search", {
      query: "public",
    });
    expect(
      JSON.stringify({
        list,
        detail,
        install,
        settings,
        extensions,
        slot,
        page,
        tools,
        skills,
        execution,
      }),
    ).not.toContain(secret);
  });

  it("has no raw caught-error rethrows", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/main/plugins/plugin-lazy-ipc.js"),
      "utf8",
    );

    expect(source).not.toMatch(/throw\s+(?:error|err|e)\s*;/u);
  });
});
