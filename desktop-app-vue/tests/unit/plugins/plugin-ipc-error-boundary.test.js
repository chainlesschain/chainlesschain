import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "C:/mock-user-data") },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  shell: { openPath: vi.fn().mockResolvedValue("") },
}));

const { parse } = require("espree");

const {
  PLUGIN_METHOD_UNAVAILABLE_CODE,
  createPluginFailureDescriptor,
  createPluginIpcFailureResult,
  createPluginMethodUnavailableError,
  createPluginOperationError,
  sanitizePluginPersistedError,
} = require("../../../src/main/plugins/plugin-ipc-error-boundary");
const { registerPluginIPC } = require("../../../src/main/plugins/plugin-ipc");

function registerPageContentHandler(sandbox) {
  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
  };
  const pluginManager = {
    getPlugin: () => ({ state: "enabled" }),
    registry: {
      getExtensionsByPoint: () => [],
    },
    sandboxes: new Map([["plugin-id", sandbox]]),
  };

  registerPluginIPC({ pluginManager, ipcMain, mainWindow: {} });
  return handlers.get("plugin:get-page-content");
}

function collectJavaScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return collectJavaScriptFiles(entryPath);
    }
    return entry.name.endsWith(".js") ? [entryPath] : [];
  });
}

function findRawCaughtErrorPropagation(source, file) {
  const ast = parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    loc: true,
  });
  const findings = [];

  function visit(node, caughtName = null) {
    if (!node || typeof node !== "object") {
      return;
    }
    if (node.type === "CatchClause") {
      const nestedCaughtName =
        node.param?.type === "Identifier" ? node.param.name : null;
      visit(node.body, nestedCaughtName);
      return;
    }
    if (
      caughtName &&
      node.type === "ThrowStatement" &&
      node.argument?.type === "Identifier" &&
      node.argument.name === caughtName
    ) {
      findings.push(`${file}:${node.loc.start.line}:throw`);
    }
    if (
      caughtName &&
      node.type === "CallExpression" &&
      node.arguments[0]?.type === "Identifier" &&
      node.arguments[0].name === caughtName
    ) {
      const isDirectReject =
        node.callee.type === "Identifier" && node.callee.name === "reject";
      const isPromiseReject =
        node.callee.type === "MemberExpression" &&
        !node.callee.computed &&
        node.callee.object.type === "Identifier" &&
        node.callee.object.name === "Promise" &&
        node.callee.property.type === "Identifier" &&
        node.callee.property.name === "reject";
      if (isDirectReject || isPromiseReject) {
        findings.push(`${file}:${node.loc.start.line}:reject`);
      }
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        value.forEach((child) => visit(child, caughtName));
      } else {
        visit(value, caughtName);
      }
    }
  }

  visit(ast);
  return findings;
}

const IPC_SOURCES = [
  "src/main/plugins/plugin-ipc.js",
  "src/main/plugins/plugin-lazy-ipc.js",
  "src/main/plugins/marketplace-ipc.js",
  "src/main/marketplace/marketplace-ipc.js",
  "src/main/marketplace/token-ipc.js",
  "src/main/marketplace/skill-service-ipc.js",
];

const PLUGIN_FAILURE_SOURCES = [
  "src/main/plugins/plugin-manager.js",
  "src/main/plugins/plugin-registry.js",
  "src/main/plugins/update-manager.js",
  "src/main/marketplace/plugin-installer.js",
  "src/main/marketplace/plugin-updater.js",
];

describe("plugin IPC error boundary", () => {
  it.each([
    ["plugin", "PLUGIN_OPERATION_FAILED", "Plugin operation failed"],
    ["pluginLazy", "PLUGIN_LAZY_OPERATION_FAILED", "Plugin operation failed"],
    [
      "pluginMarketplace",
      "PLUGIN_MARKETPLACE_OPERATION_FAILED",
      "Plugin marketplace operation failed",
    ],
    [
      "marketplace",
      "MARKETPLACE_OPERATION_FAILED",
      "Marketplace operation failed",
    ],
    ["token", "TOKEN_OPERATION_FAILED", "Token operation failed"],
    [
      "skillService",
      "SKILL_SERVICE_OPERATION_FAILED",
      "Skill service operation failed",
    ],
  ])("returns a stable %s failure", (kind, code, error) => {
    expect(createPluginIpcFailureResult(kind)).toEqual({
      success: false,
      error,
      code,
    });
  });

  it("rejects unknown failure kinds", () => {
    expect(() => createPluginIpcFailureResult("unknown")).toThrow(
      "Plugin IPC failure kind is invalid",
    );
  });

  it("creates a stable descriptor without IPC success state", () => {
    expect(createPluginFailureDescriptor("plugin")).toEqual({
      error: "Plugin operation failed",
      code: "PLUGIN_OPERATION_FAILED",
    });
  });

  it("creates a stable operation error without dynamic details", () => {
    expect(createPluginOperationError("plugin")).toMatchObject({
      message: "Plugin operation failed",
      code: "PLUGIN_OPERATION_FAILED",
    });
  });

  it("creates a stable optional-method signal without method details", () => {
    expect(PLUGIN_METHOD_UNAVAILABLE_CODE).toBe("PLUGIN_METHOD_UNAVAILABLE");
    expect(createPluginMethodUnavailableError()).toMatchObject({
      message: "Plugin method unavailable",
      code: "PLUGIN_METHOD_UNAVAILABLE",
    });
  });

  it("projects persisted error text to the selected stable boundary", () => {
    expect(
      sanitizePluginPersistedError("pluginMarketplace", "database-row-secret"),
    ).toBe("Plugin marketplace operation failed");
    expect(sanitizePluginPersistedError("plugin", null)).toBeNull();
  });

  it("returns a fixed page receipt without invoking plugin content", async () => {
    const secret = "plugin-page-content-secret";
    const sandbox = {
      callMethod: vi.fn().mockResolvedValue({
        contentType: "html",
        html: secret,
        componentPath: secret,
        src: secret,
      }),
    };
    const handler = registerPageContentHandler(sandbox);

    await expect(handler({}, "plugin-id", "main")).resolves.toEqual({
      success: true,
      contentType: "component",
      props: { pluginId: "plugin-id", pageId: "main" },
    });
    expect(sandbox.callMethod).not.toHaveBeenCalled();
  });

  it("projects regular plugin query and filesystem success payloads", async () => {
    const secret = "C:/private/regular-plugin-secret";
    const handlers = new Map();
    const plugin = {
      id: "plugin-1",
      name: "Plugin",
      version: "1.0.0",
      enabled: 1,
      state: "enabled",
      path: secret,
      manifest: { entry: secret },
    };
    const pluginManager = {
      getPlugins: () => [plugin],
      getPlugin: () => plugin,
      installPlugin: async () => ({
        success: true,
        pluginId: "plugin-1",
        path: secret,
      }),
      registry: {
        getExtensionsByPoint: (point) => [
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
        ],
        getPluginSettingDefinitions: () => [
          { key: "apiKey", secret: true, default: secret },
          { key: "theme", type: "string" },
        ],
        getPluginSettings: () => ({
          apiKey: secret,
          theme: "dark",
          undeclared: secret,
        }),
      },
    };
    registerPluginIPC({
      pluginManager,
      ipcMain: {
        handle(channel, handler) {
          handlers.set(channel, handler);
        },
      },
      mainWindow: {},
    });

    const list = await handlers.get("plugin:get-plugins")({}, {});
    const detail = await handlers.get("plugin:get-plugin")({}, "plugin-1");
    const install = await handlers.get("plugin:install")({}, secret, {});
    const settings = await handlers.get("plugin:get-settings")({}, "plugin-1");
    const extensions = await handlers.get("plugin:get-ui-extensions")();
    const slot = await handlers.get("plugin:get-slot-extensions")(
      {},
      "global-header",
    );
    const page = await handlers.get("plugin:get-page-content")(
      {},
      "plugin-1",
      "main",
    );

    expect(list.plugins[0]).toMatchObject({
      id: "plugin-1",
      plugin_id: "plugin-1",
      name: "Plugin",
      enabled: true,
    });
    expect(detail.plugin).toEqual(list.plugins[0]);
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
    expect(
      JSON.stringify({
        list,
        detail,
        install,
        settings,
        extensions,
        slot,
        page,
      }),
    ).not.toContain(secret);
  });

  it("forbids dynamic caught error messages in plugin IPC payloads", () => {
    const dynamicError = /(?:error|message)\s*:\s*(?:error|err|e)\.message/u;

    for (const relativePath of IPC_SOURCES) {
      const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
      expect(source, relativePath).not.toMatch(dynamicError);
    }
  });

  it("forbids dynamic errors in plugin results, events, and records", () => {
    const dynamicError =
      /(?:error|message|stack)\s*:\s*(?:error|err|e)\.(?:message|stack)/u;

    for (const relativePath of PLUGIN_FAILURE_SOURCES) {
      const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
      expect(source, relativePath).not.toMatch(dynamicError);
    }
  });

  it("forbids raw caught-error rethrows in plugin manager", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/main/plugins/plugin-manager.js"),
      "utf8",
    );

    expect(source).not.toMatch(/throw\s+(?:error|err|e)\s*;/u);
  });

  it("forbids raw caught-error rethrows and message matching in plugin IPC", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/main/plugins/plugin-ipc.js"),
      "utf8",
    );

    expect(source).not.toMatch(/throw\s+(?:error|err|e)\s*;/u);
    expect(source).not.toMatch(
      /(?:error|err|e)\??\.message\.(?:includes|match)/u,
    );
  });

  it("forbids raw caught-error propagation across production plugin trees", () => {
    const roots = [
      resolve(process.cwd(), "src/main/plugins"),
      resolve(process.cwd(), "src/main/marketplace"),
    ];
    const findings = roots.flatMap((root) =>
      collectJavaScriptFiles(root).flatMap((file) =>
        findRawCaughtErrorPropagation(readFileSync(file, "utf8"), file),
      ),
    );

    expect(findings).toEqual([]);
  });
});
