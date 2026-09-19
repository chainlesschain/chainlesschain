import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const PluginUpdateManager = require("../update-manager.js");

function createManager({ pluginManager, marketplaceAPI }) {
  return new PluginUpdateManager(pluginManager, {
    autoCheck: false,
    marketplaceAPI,
  });
}

describe("PluginUpdateManager error boundary", () => {
  it("does not disclose update-check errors or emit them", async () => {
    const secret = "plugin-update-check-secret";
    const manager = createManager({
      pluginManager: { getPlugins: vi.fn(() => [{ id: "p1" }]) },
      marketplaceAPI: {
        checkUpdates: vi.fn().mockRejectedValue(new Error(secret)),
      },
    });
    const checkError = vi.fn();
    manager.on("check-error", checkError);

    const checking = manager.checkForUpdates();

    await expect(checking).rejects.toMatchObject({
      message: "Plugin operation failed",
      code: "PLUGIN_OPERATION_FAILED",
    });
    await expect(checking).rejects.not.toThrow(secret);
    expect(checkError).toHaveBeenCalledWith({
      error: "Plugin operation failed",
      code: "PLUGIN_OPERATION_FAILED",
    });
    expect(manager.checking).toBe(false);
  });

  it("does not disclose single-plugin update errors or emit them", async () => {
    const secret = "plugin-update-operation-secret";
    const manager = createManager({
      pluginManager: {
        getPlugin: vi.fn().mockRejectedValue(new Error(secret)),
      },
      marketplaceAPI: {},
    });
    const updateError = vi.fn();
    manager.on("update-error", updateError);

    const update = manager.updatePlugin("p1");

    await expect(update).rejects.toMatchObject({
      message: "Plugin operation failed",
      code: "PLUGIN_OPERATION_FAILED",
    });
    await expect(update).rejects.not.toThrow(secret);
    expect(updateError).toHaveBeenCalledWith("p1", {
      error: "Plugin operation failed",
      code: "PLUGIN_OPERATION_FAILED",
    });
  });

  it("has no raw caught-error rethrows or Error event payloads", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/main/plugins/update-manager.js"),
      "utf8",
    );

    expect(source).not.toMatch(/throw\s+(?:error|err|e)\s*;/u);
    expect(source).not.toContain('this.emit("check-error", error)');
    expect(source).not.toContain('this.emit("update-error", pluginId, error)');
  });
});
