import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {
  ensurePluginLspServers,
  _resetPluginLspLoadState,
} from "../../src/lib/plugin-runtime/lsp.js";
import {
  languageIdForFile,
  probeServers,
  _resetPluginServers,
} from "../../src/lib/lsp/lsp-server-registry.js";
import { pluginVersionDir } from "../../src/lib/plugin-runtime/scopes.js";

let cwd;

function installLspPlugin(scope, name, lsp) {
  const dir = pluginVersionDir(scope, name, "1.0.0", { cwd });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    JSON.stringify({ name, version: "1.0.0" }),
    "utf8",
  );
  fs.writeFileSync(path.join(dir, ".lsp.json"), JSON.stringify(lsp), "utf8");
  return dir;
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-plsp-"));
  _resetPluginServers();
  _resetPluginLspLoadState();
});
afterEach(() => {
  _resetPluginServers();
  _resetPluginLspLoadState();
  try {
    fs.rmSync(cwd, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("ensurePluginLspServers", () => {
  it("registers a plugin-declared language server into the LSP registry", () => {
    installLspPlugin("project", "toml-tools", {
      servers: [
        {
          languageId: "toml",
          command: "taplo",
          args: ["lsp", "stdio"],
          extensions: [".toml"],
        },
      ],
    });

    const res = ensurePluginLspServers({ cwd, scopes: ["project"] });
    expect(res.registered).toEqual([
      { plugin: "toml-tools", languageId: "toml", id: "taplo" },
    ]);

    // The plugin's extension mapping is now known to the registry…
    expect(languageIdForFile(path.join(cwd, "config.toml"))).toBe("toml");
    // …and the server appears in the probe (available:false — taplo not installed).
    const toml = probeServers(cwd).find((s) => s.languageId === "toml");
    expect(toml).toBeTruthy();
    expect(toml.id).toBe("taplo");
  });

  it("is memoized per root — a second call is a no-op unless forced", () => {
    installLspPlugin("project", "toml-tools", {
      servers: [
        { languageId: "toml", command: "taplo", extensions: [".toml"] },
      ],
    });
    expect(
      ensurePluginLspServers({ cwd, scopes: ["project"] }).registered,
    ).toHaveLength(1);
    // Second call: already loaded for this root.
    expect(
      ensurePluginLspServers({ cwd, scopes: ["project"] }).registered,
    ).toHaveLength(0);
    // force re-scans.
    expect(
      ensurePluginLspServers({ cwd, scopes: ["project"], force: true })
        .registered,
    ).toHaveLength(1);
  });

  it("never throws on a broken plugin manifest", () => {
    const dir = pluginVersionDir("project", "broken", "1.0.0", { cwd });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "plugin.json"), "{ not json", "utf8");
    expect(() =>
      ensurePluginLspServers({ cwd, scopes: ["project"] }),
    ).not.toThrow();
  });

  it("skips lsp entries missing languageId/command", () => {
    installLspPlugin("project", "partial", {
      servers: [{ extensions: [".x"] }, { languageId: "ok", command: "okls" }],
    });
    const res = ensurePluginLspServers({ cwd, scopes: ["project"] });
    expect(res.registered).toEqual([
      { plugin: "partial", languageId: "ok", id: "okls" },
    ]);
  });
});
