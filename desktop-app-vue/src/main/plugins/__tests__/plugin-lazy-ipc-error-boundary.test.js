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
    const plugin = {
      id: "plugin-1",
      name: "Plugin",
      version: "1.0.0",
      enabled: 1,
      state: "enabled",
      path: secret,
      manifest: { entry: secret },
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
        },
      },
      mainWindow: null,
      ipc,
    });

    const list = await ipc.handlers.get("plugin:get-plugins")({}, {});
    const detail = await ipc.handlers.get("plugin:get-plugin")({}, "plugin-1");
    const install = await ipc.handlers.get("plugin:install")({}, secret, {});

    expect(list[0]).toMatchObject({
      id: "plugin-1",
      plugin_id: "plugin-1",
      name: "Plugin",
      enabled: true,
    });
    expect(detail).toEqual(list[0]);
    expect(install).toEqual({ success: true, pluginId: "plugin-1" });
    expect(JSON.stringify({ list, detail, install })).not.toContain(secret);
  });

  it("has no raw caught-error rethrows", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/main/plugins/plugin-lazy-ipc.js"),
      "utf8",
    );

    expect(source).not.toMatch(/throw\s+(?:error|err|e)\s*;/u);
  });
});
