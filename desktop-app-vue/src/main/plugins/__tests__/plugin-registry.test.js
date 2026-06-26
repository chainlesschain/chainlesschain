// @vitest-environment node

/**
 * PluginRegistry — corrupt-JSON-column regression.
 *
 * getInstalledPlugins() has NO outer try/catch, so an unguarded
 * JSON.parse(row.manifest) used to throw straight out of the function on a
 * single corrupt manifest column — failing the ENTIRE installed-plugins list.
 * getPluginExtensions/getExtensionsByPoint had the same shape for `config`.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const PluginRegistry = require("../plugin-registry.js");

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
