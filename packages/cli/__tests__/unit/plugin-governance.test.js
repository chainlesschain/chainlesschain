import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import {
  PASSIVE_COMPONENT_KINDS,
  parsePluginDependencies,
  checkPluginDependencies,
  formatDependencyIssues,
  isPluginInUse,
} from "../../src/lib/plugin-runtime/governance.js";
import {
  resolveServer,
  registerLanguageServer,
  probeServers,
  _resetPluginServers,
  _deps,
} from "../../src/lib/lsp/lsp-server-registry.js";

describe("parsePluginDependencies", () => {
  it("returns empty when there is no dependencies field", () => {
    expect(parsePluginDependencies({})).toEqual({
      deps: {},
      hostRange: null,
      errors: [],
    });
  });

  it("splits host/cc range from plugin deps and validates ranges", () => {
    const r = parsePluginDependencies({
      dependencies: { "other-plugin": "^1.2.0", host: ">=0.162.0" },
    });
    expect(r.deps).toEqual({ "other-plugin": "^1.2.0" });
    expect(r.hostRange).toBe(">=0.162.0");
    expect(r.errors).toEqual([]);
  });

  it("collects invalid ranges and wrong shapes instead of throwing", () => {
    expect(
      parsePluginDependencies({ dependencies: { a: "not-a-range" } }).errors,
    ).toHaveLength(1);
    expect(parsePluginDependencies({ dependencies: [] }).errors).toHaveLength(
      1,
    );
    expect(
      parsePluginDependencies({ dependencies: { a: "" } }).errors,
    ).toHaveLength(1);
  });
});

describe("checkPluginDependencies", () => {
  const manifest = {
    dependencies: { "dep-a": "^1.0.0", host: ">=0.162.0" },
  };

  it("passes when everything is installed and in range", () => {
    const r = checkPluginDependencies(manifest, {
      installed: { "dep-a": "1.4.2" },
      hostVersion: "0.162.158",
    });
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.mismatched).toEqual([]);
    expect(r.hostMismatch).toBeNull();
  });

  it("flags a missing dependency", () => {
    const r = checkPluginDependencies(manifest, {
      installed: {},
      hostVersion: "0.162.158",
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([{ name: "dep-a", range: "^1.0.0" }]);
  });

  it("flags an out-of-range dependency and host", () => {
    const r = checkPluginDependencies(manifest, {
      installed: { "dep-a": "0.9.0" },
      hostVersion: "0.161.0",
    });
    expect(r.ok).toBe(false);
    expect(r.mismatched[0]).toMatchObject({ name: "dep-a", have: "0.9.0" });
    expect(r.hostMismatch).toMatchObject({ have: "0.161.0" });
    const msgs = formatDependencyIssues("my-plugin", r);
    expect(msgs.join("\n")).toMatch(/not satisfied/);
    expect(msgs.join("\n")).toMatch(/requires cc/);
  });

  it("coerces a non-semver installed version", () => {
    const r = checkPluginDependencies(
      { dependencies: { "dep-a": ">=1.0.0" } },
      { installed: { "dep-a": "v1.2" } },
    );
    expect(r.ok).toBe(true);
  });
});

describe("isPluginInUse", () => {
  it("treats an LSP-only plugin as in use (never flagged unused)", () => {
    const plugin = {
      name: "zig-lsp",
      components: { lsp: [{ languageId: "zig", command: "zls" }], skills: [] },
    };
    const r = isPluginInUse(plugin, { invokedNames: [] });
    expect(r.inUse).toBe(true);
    expect(r.reason).toMatch(/passive lsp/);
  });

  it("treats MCP/hooks/monitors as passive usage", () => {
    for (const kind of PASSIVE_COMPONENT_KINDS) {
      const comp =
        kind === "lsp" ? [{ languageId: "x", command: "y" }] : { count: 1 };
      const r = isPluginInUse({ name: "p", components: { [kind]: comp } });
      expect(r.inUse).toBe(true);
    }
  });

  it("flags a skills-only plugin whose skills were never invoked", () => {
    const plugin = {
      name: "idle",
      components: { skills: [{ name: "do-thing" }] },
    };
    expect(isPluginInUse(plugin, { invokedNames: [] }).inUse).toBe(false);
    expect(isPluginInUse(plugin, { invokedNames: ["do-thing"] }).inUse).toBe(
      true,
    );
  });
});

describe("LSP registry fallback (one server failing does not block the extension)", () => {
  let origExists;
  beforeEach(() => {
    origExists = _deps.existsSync;
    _resetPluginServers();
  });
  afterEach(() => {
    _deps.existsSync = origExists;
    _resetPluginServers();
  });

  function existsFor(paths) {
    const set = new Set(paths.map((p) => p.replace(/\\/g, "/")));
    _deps.existsSync = (p) => set.has(String(p).replace(/\\/g, "/"));
  }

  it("falls through to the builtin when a plugin server for the same language is not installed", () => {
    // A plugin claims to serve typescript with an uninstalled binary.
    registerLanguageServer({
      languageId: "typescript",
      command: "my-broken-ts-server",
      args: ["--stdio"],
    });
    const isWin = process.platform === "win32";
    const builtinBin = isWin
      ? "typescript-language-server.cmd"
      : "typescript-language-server";
    // Only the builtin's binary exists (plugin binary does not).
    existsFor([path.join("/proj", "node_modules", ".bin", builtinBin)]);

    const s = resolveServer("typescript", "/proj");
    expect(s).not.toBeNull();
    expect(s.id).toBe("typescript-language-server"); // builtin won, not the broken plugin
  });

  it("tries a second plugin server when the first is unavailable", () => {
    registerLanguageServer({
      languageId: "zig",
      command: "zls-a",
      extensions: [".zig"],
    });
    registerLanguageServer({
      languageId: "zig",
      command: "zls-b",
      extensions: [".zig"],
    });
    const isWin = process.platform === "win32";
    existsFor([
      path.join("/proj", "node_modules", ".bin", isWin ? "zls-b.cmd" : "zls-b"),
    ]);
    const s = resolveServer("zig", "/proj");
    expect(s).not.toBeNull();
    expect(s.id).toBe("zls-b");
  });

  it("probes each server family independently", () => {
    registerLanguageServer({
      languageId: "typescript",
      command: "my-broken-ts-server",
    });
    existsFor([]); // nothing installed
    const rows = probeServers("/proj");
    const ids = rows.map((r) => r.id);
    expect(ids).toContain("my-broken-ts-server");
    expect(ids).toContain("typescript-language-server");
    expect(rows.every((r) => r.available === false)).toBe(true);
  });
});
