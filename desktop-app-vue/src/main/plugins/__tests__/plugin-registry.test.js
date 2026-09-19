// @vitest-environment node

/**
 * PluginRegistry — corrupt-JSON-column regression.
 *
 * getInstalledPlugins() has NO outer try/catch, so an unguarded
 * JSON.parse(row.manifest) used to throw straight out of the function on a
 * single corrupt manifest column — failing the ENTIRE installed-plugins list.
 * getPluginExtensions/getExtensionsByPoint had the same shape for `config`.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const PluginRegistry = require("../plugin-registry.js");

it("does not disclose migration read errors", async () => {
  const originalFsp = PluginRegistry._deps.fsp;
  const secret = "plugin-registry-migration-secret";
  PluginRegistry._deps.fsp = {
    readFile: vi
      .fn()
      .mockRejectedValue(Object.assign(new Error(secret), { code: "EACCES" })),
  };
  const registry = new PluginRegistry({ db: {} });

  try {
    const initialization = registry.initialize();
    await expect(initialization).rejects.toMatchObject({
      message: "Plugin operation failed",
      code: "PLUGIN_OPERATION_FAILED",
    });
    await expect(initialization).rejects.not.toThrow(secret);
  } finally {
    PluginRegistry._deps.fsp = originalFsp;
  }
});

it("has no raw caught-error rethrows", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "src/main/plugins/plugin-registry.js"),
    "utf8",
  );

  expect(source).not.toMatch(/throw\s+(?:error|err|e)\s*;/u);
});

it("redacts persisted plugin errors and event data", async () => {
  const runs = [];
  const registry = new PluginRegistry({
    db: {
      prepare: () => ({
        run: (...args) => runs.push(args),
        free: () => {},
      }),
    },
  });
  const secret = "plugin-registry-secret";

  await registry.recordError("plugin-1", new Error(secret));

  expect(JSON.stringify(runs)).not.toContain(secret);
  expect(runs[0][0]).toBe("Plugin operation failed");
  expect(JSON.parse(runs[1][2])).toEqual({
    error: "Plugin operation failed",
    code: "PLUGIN_OPERATION_FAILED",
  });
});

// Minimal sql.js-style db: prepare().all() returns the given rows; free() noop.
function regWith(rows) {
  return new PluginRegistry({
    db: {
      prepare: () => ({
        all: () => rows,
        free: () => {},
      }),
    },
  });
}

describe("PluginRegistry.getInstalledPlugins", () => {
  it("does not fail the whole list when one manifest is corrupt", () => {
    const reg = regWith([
      { id: "a", manifest: JSON.stringify({ name: "A" }), enabled: 1 },
      { id: "b", manifest: "{not-valid-json", enabled: 0 },
    ]);

    // Before the fix this THREW (no try/catch in getInstalledPlugins).
    const result = reg.getInstalledPlugins();

    expect(result).toHaveLength(2);
    expect(result[0].manifest).toEqual({ name: "A" });
    expect(result[1].manifest).toEqual({}); // corrupt → default {}
    expect(result[1].enabled).toBe(false);
  });

  it("does not expose legacy last_error values", () => {
    const reg = regWith([
      {
        id: "a",
        manifest: "{}",
        enabled: 1,
        last_error: "legacy-plugin-secret",
      },
    ]);

    expect(reg.getInstalledPlugins()[0].last_error).toBe(
      "Plugin operation failed",
    );
  });
});

describe("PluginRegistry.getPluginExtensions", () => {
  it("tolerates a corrupt config column", () => {
    const reg = regWith([
      { id: "x", config: JSON.stringify({ a: 1 }), enabled: 1 },
      { id: "y", config: "{broken", enabled: 1 },
    ]);
    const result = reg.getPluginExtensions("p1");
    expect(result).toHaveLength(2);
    expect(result[0].config).toEqual({ a: 1 });
    expect(result[1].config).toBeNull(); // corrupt → default null
  });
});
