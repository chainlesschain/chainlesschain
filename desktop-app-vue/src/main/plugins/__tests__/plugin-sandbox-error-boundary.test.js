import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const PluginSandbox = require("../plugin-sandbox.js");

describe("PluginSandbox error boundary", () => {
  it("uses a stable code when an optional plugin method is unavailable", async () => {
    const sandbox = new PluginSandbox(
      "plugin-id",
      "C:/plugins/plugin-id",
      {},
      {},
    );
    sandbox.instance = {};

    try {
      await expect(sandbox.callMethod("secret-method-name")).rejects.toEqual(
        expect.objectContaining({
          message: "Plugin method unavailable",
          code: "PLUGIN_METHOD_UNAVAILABLE",
        }),
      );
      await expect(
        sandbox.callMethod("another-secret-method-name"),
      ).rejects.not.toThrow("another-secret-method-name");
    } finally {
      sandbox.destroy();
    }
  });

  it("does not disclose plugin entry read errors or emit them", async () => {
    const originalFsp = PluginSandbox._deps.fsp;
    const secret = "plugin-sandbox-entry-secret";
    PluginSandbox._deps.fsp = {
      readFile: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error(secret), { code: "EACCES" }),
        ),
    };
    const sandbox = new PluginSandbox(
      "plugin-id",
      "C:/plugins/plugin-id",
      {},
      {},
    );
    let failureEvent = null;
    sandbox.on("error", (event) => {
      failureEvent = event;
    });

    try {
      const loading = sandbox.load();
      await expect(loading).rejects.toMatchObject({
        message: "Plugin operation failed",
        code: "PLUGIN_OPERATION_FAILED",
      });
      await expect(loading).rejects.not.toThrow(secret);
      expect(failureEvent).toEqual({
        pluginId: "plugin-id",
        error: "Plugin operation failed",
        code: "PLUGIN_OPERATION_FAILED",
      });
      expect(JSON.stringify(failureEvent)).not.toContain(secret);
    } finally {
      PluginSandbox._deps.fsp = originalFsp;
      sandbox.destroy();
    }
  });

  it("has no raw caught-error rethrows or dynamic error events", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/main/plugins/plugin-sandbox.js"),
      "utf8",
    );

    expect(source).not.toMatch(/throw\s+(?:error|err|e)\s*;/u);
    expect(source).not.toMatch(/\{[^}]*\berror\s*\}/u);
  });
});
