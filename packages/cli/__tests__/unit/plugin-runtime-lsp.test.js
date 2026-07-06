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
import {
  trustPlugin,
  _deps as trustDeps,
  _resetTrustWarnings,
} from "../../src/lib/plugin-runtime/trust.js";

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
    installLspPlugin("local", "toml-tools", {
      servers: [
        {
          languageId: "toml",
          command: "taplo",
          args: ["lsp", "stdio"],
          extensions: [".toml"],
        },
      ],
    });

    const res = ensurePluginLspServers({ cwd, scopes: ["local"] });
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
    installLspPlugin("local", "toml-tools", {
      servers: [
        { languageId: "toml", command: "taplo", extensions: [".toml"] },
      ],
    });
    expect(
      ensurePluginLspServers({ cwd, scopes: ["local"] }).registered,
    ).toHaveLength(1);
    // Second call: already loaded for this root.
    expect(
      ensurePluginLspServers({ cwd, scopes: ["local"] }).registered,
    ).toHaveLength(0);
    // force re-scans.
    expect(
      ensurePluginLspServers({ cwd, scopes: ["local"], force: true })
        .registered,
    ).toHaveLength(1);
  });

  it("never throws on a broken plugin manifest", () => {
    const dir = pluginVersionDir("local", "broken", "1.0.0", { cwd });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "plugin.json"), "{ not json", "utf8");
    expect(() =>
      ensurePluginLspServers({ cwd, scopes: ["local"] }),
    ).not.toThrow();
  });

  it("_resetPluginServers rolls back extension overrides — even ones shadowing a builtin", () => {
    // A plugin remaps a BUILTIN extension (.py) onto its own language. Before the
    // fix, registerLanguageServer mutated the shared EXTENSION_LANGUAGE map and
    // _resetPluginServers only cleared the server Map — so after a reload the
    // dead ".py"→"mylang" mapping survived and the builtin python server for .py
    // became unreachable for the rest of the process.
    installLspPlugin("local", "py-hijack", {
      servers: [
        { languageId: "mylang", command: "myls", extensions: [".py", ".ml1"] },
      ],
    });
    ensurePluginLspServers({ cwd, scopes: ["local"] });
    expect(languageIdForFile("x.py")).toBe("mylang");
    expect(languageIdForFile("x.ml1")).toBe("mylang");

    _resetPluginServers();
    // Plugin-only extension is gone entirely…
    expect(languageIdForFile("x.ml1")).toBe(null);
    // …and the builtin mapping for .py is restored, not left pointing at the
    // uninstalled plugin language.
    expect(languageIdForFile("x.py")).toBe("python");
  });

  it("skips lsp entries missing languageId/command", () => {
    installLspPlugin("local", "partial", {
      servers: [{ extensions: [".x"] }, { languageId: "ok", command: "okls" }],
    });
    const res = ensurePluginLspServers({ cwd, scopes: ["local"] });
    expect(res.registered).toEqual([
      { plugin: "partial", languageId: "ok", id: "okls" },
    ]);
  });
});

describe("ensurePluginLspServers — trust gating", () => {
  let storeFile;
  let savedStorePath;

  beforeEach(() => {
    // Isolate the trust store so we never touch the real user-data dir.
    storeFile = path.join(cwd, "trust.json");
    savedStorePath = trustDeps.storePath;
    trustDeps.storePath = () => storeFile;
    _resetTrustWarnings();
  });
  afterEach(() => {
    trustDeps.storePath = savedStorePath;
  });

  it("does NOT register an UNTRUSTED project plugin's server, but does after trust", () => {
    installLspPlugin("project", "toml-tools", {
      servers: [
        { languageId: "toml", command: "taplo", extensions: [".toml"] },
      ],
    });

    // Untrusted project scope → gated out.
    expect(
      ensurePluginLspServers({ cwd, scopes: ["project"] }).registered,
    ).toHaveLength(0);

    // Trust it → now its server registers.
    trustPlugin("toml-tools", { scope: "project", version: "1.0.0" });
    _resetPluginServers();
    _resetPluginLspLoadState();
    expect(
      ensurePluginLspServers({ cwd, scopes: ["project"] }).registered,
    ).toHaveLength(1);
  });
});
