import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const {
  createPluginFailureDescriptor,
  createPluginIpcFailureResult,
  createPluginOperationError,
} = require("../../../src/main/plugins/plugin-ipc-error-boundary");

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
});
