import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const PluginSandbox = require("../plugin-sandbox.js");

describe("PluginSandbox error boundary", () => {
  it("redacts sandbox console arguments before forwarding", () => {
    const secret = "plugin-sandbox-console-secret";
    const utils = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const sandbox = new PluginSandbox(
      "plugin-id",
      "C:/plugins/plugin-id",
      {},
      { api: { utils }, getAPI: () => ({}) },
    );

    try {
      const context = sandbox.createSandboxContext();
      context.console.log(secret, { nested: secret });
      context.console.warn(new Error(secret));
      context.console.error(secret);

      expect(utils.log).toHaveBeenCalledWith({
        event: "plugin-console",
        level: "log",
        argumentCount: 2,
        redacted: true,
      });
      expect(utils.warn).toHaveBeenCalledWith({
        event: "plugin-console",
        level: "warn",
        argumentCount: 1,
        redacted: true,
      });
      expect(utils.error).toHaveBeenCalledWith({
        event: "plugin-console",
        level: "error",
        argumentCount: 1,
        redacted: true,
      });
      expect(
        JSON.stringify([
          utils.log.mock.calls,
          utils.warn.mock.calls,
          utils.error.mock.calls,
        ]),
      ).not.toContain(secret);
    } finally {
      sandbox.destroy();
    }
  });

  it("loads plugin dependencies inside the sandbox log boundary", () => {
    const secret = "third-party-dependency-log-secret";
    const pluginPath = fs.mkdtempSync(
      path.join(os.tmpdir(), "chainless-plugin-sandbox-"),
    );
    const dependencyPath = path.join(
      pluginPath,
      "node_modules",
      "sandbox-dependency",
    );
    fs.mkdirSync(dependencyPath, { recursive: true });
    fs.writeFileSync(
      path.join(dependencyPath, "index.js"),
      [
        `console.log(${JSON.stringify(secret)});`,
        'const helper = require("./helper");',
        "module.exports = { value: helper.value };",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(dependencyPath, "helper.js"),
      `console.warn(${JSON.stringify(secret)}); module.exports = { value: 42 };`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(pluginPath, "native.node"),
      "not-native",
      "utf8",
    );

    const utils = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const sandbox = new PluginSandbox(
      "plugin-id",
      pluginPath,
      {},
      {
        api: { utils },
        getAPI: () => ({}),
      },
    );

    try {
      const context = vm.createContext(sandbox.createSandboxContext());
      const sandboxRequire = sandbox.createRequireFunction(context, pluginPath);
      const dependency = sandboxRequire("sandbox-dependency");

      expect(dependency).toEqual({ value: 42 });
      expect(sandboxRequire("sandbox-dependency")).toBe(dependency);
      expect(utils.log).toHaveBeenCalledTimes(1);
      expect(utils.warn).toHaveBeenCalledTimes(1);
      expect(
        JSON.stringify([utils.log.mock.calls, utils.warn.mock.calls]),
      ).not.toContain(secret);
      expect(() => sandboxRequire("./native.node")).toThrow(
        expect.objectContaining({
          message: "Plugin sandbox module unavailable",
          code: "PLUGIN_SANDBOX_MODULE_UNAVAILABLE",
        }),
      );
      expect(() => sandboxRequire("../outside-secret.js")).toThrow(
        expect.objectContaining({
          message: "Plugin sandbox module unavailable",
          code: "PLUGIN_SANDBOX_MODULE_UNAVAILABLE",
        }),
      );
    } finally {
      sandbox.destroy();
      fs.rmSync(pluginPath, { recursive: true, force: true });
    }
  });

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
    expect(source).not.toContain("return require(resolvedPath)");
    expect(source).not.toContain("return require(modulePath)");
  });
});
