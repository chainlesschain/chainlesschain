import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {
  collectPluginBinDirs,
  applyPluginBinPath,
  resolvePluginBinCommand,
} from "../../src/lib/plugin-runtime/bin.js";
import { pluginVersionDir } from "../../src/lib/plugin-runtime/scopes.js";
import {
  trustPlugin,
  _deps as trustDeps,
  _resetTrustWarnings,
} from "../../src/lib/plugin-runtime/trust.js";

let cwd;
let storeFile;
let savedStorePath;

function installBinPlugin(scope, name, binFiles, { manifest = {} } = {}) {
  const dir = pluginVersionDir(scope, name, "1.0.0", { cwd });
  fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    JSON.stringify({ name, version: "1.0.0", ...manifest }),
    "utf8",
  );
  for (const f of binFiles) {
    fs.writeFileSync(path.join(dir, "bin", f), "#!/bin/sh\necho hi\n", "utf8");
  }
  return path.join(dir, "bin");
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pbin-"));
  storeFile = path.join(cwd, "trust.json");
  savedStorePath = trustDeps.storePath;
  trustDeps.storePath = () => storeFile;
  _resetTrustWarnings();
});
afterEach(() => {
  trustDeps.storePath = savedStorePath;
  try {
    fs.rmSync(cwd, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("collectPluginBinDirs — component-level capability gate", () => {
  it("refuses a bin dir when the plugin declared permissions but not 'process'", () => {
    installBinPlugin("local", "p", ["tool"], {
      manifest: { permissions: {} }, // opted in, but no process capability
    });
    expect(collectPluginBinDirs({ cwd, scopes: ["local"] })).toEqual([]);
  });

  it("allows the bin dir once 'process' is declared", () => {
    installBinPlugin("local", "p", ["tool"], {
      manifest: { permissions: { process: true } },
    });
    expect(collectPluginBinDirs({ cwd, scopes: ["local"] })).toHaveLength(1);
  });

  it("a legacy plugin (no permissions block) is unaffected", () => {
    installBinPlugin("local", "p", ["tool"]);
    expect(collectPluginBinDirs({ cwd, scopes: ["local"] })).toHaveLength(1);
  });
});

describe("collectPluginBinDirs", () => {
  it("returns a trusted plugin's bin dir (deduped per dir)", () => {
    const binDir = installBinPlugin("local", "toolkit", ["a", "b"]);
    const dirs = collectPluginBinDirs({ cwd, scopes: ["local"] });
    expect(dirs).toHaveLength(1); // two bins, one dir
    expect(dirs[0].dir).toBe(binDir);
    expect(dirs[0].plugin).toBe("toolkit");
  });

  it("returns [] when no plugin ships a bin", () => {
    const dir = pluginVersionDir("local", "nobins", "1.0.0", { cwd });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "plugin.json"),
      JSON.stringify({ name: "nobins", version: "1.0.0" }),
      "utf8",
    );
    expect(collectPluginBinDirs({ cwd, scopes: ["local"] })).toEqual([]);
  });

  it("trust-gates: an untrusted project plugin contributes no bin dir until trusted", () => {
    installBinPlugin("project", "toolkit", ["a"]);
    expect(collectPluginBinDirs({ cwd, scopes: ["project"] })).toEqual([]);
    trustPlugin("toolkit", { scope: "project", version: "1.0.0" });
    expect(collectPluginBinDirs({ cwd, scopes: ["project"] })).toHaveLength(1);
  });
});

describe("applyPluginBinPath", () => {
  it("prepends bin dirs to env.PATH and restore() puts it back", () => {
    const binDir = installBinPlugin("local", "toolkit", ["mytool"]);
    const env = { PATH: "/usr/bin" };
    const res = applyPluginBinPath({ cwd, scopes: ["local"], env });
    expect(res.added).toEqual([binDir]);
    expect(env.PATH.split(path.delimiter)[0]).toBe(binDir);
    expect(env.PATH).toContain("/usr/bin");
    res.restore();
    expect(env.PATH).toBe("/usr/bin");
  });

  it("is a no-op (empty added) when nothing is installed", () => {
    const env = { PATH: "/usr/bin" };
    const res = applyPluginBinPath({ cwd, scopes: ["local"], env });
    expect(res.added).toEqual([]);
    expect(env.PATH).toBe("/usr/bin");
    expect(() => res.restore()).not.toThrow();
  });

  it("does not add a dir already present on PATH", () => {
    const binDir = installBinPlugin("local", "toolkit", ["mytool"]);
    const env = { PATH: `${binDir}${path.delimiter}/usr/bin` };
    const res = applyPluginBinPath({ cwd, scopes: ["local"], env });
    expect(res.added).toEqual([]);
    expect(env.PATH).toBe(`${binDir}${path.delimiter}/usr/bin`);
  });
});

describe("resolvePluginBinCommand", () => {
  it("returns provenance for a trusted plugin executable token", () => {
    const binDir = installBinPlugin("local", "toolkit", ["mytool"]);
    expect(resolvePluginBinCommand("mytool --version", {
      cwd,
      scopes: ["local"],
    })).toMatchObject({
      pluginId: "toolkit",
      pluginVersion: "1.0.0",
      binPath: path.join(binDir, "mytool"),
    });
  });

  it("does not attribute an ordinary command or an untrusted plugin", () => {
    installBinPlugin("project", "toolkit", ["mytool"]);
    expect(resolvePluginBinCommand("mytool", {
      cwd,
      scopes: ["project"],
    })).toBeNull();
    expect(resolvePluginBinCommand("node --version", {
      cwd,
      scopes: ["local"],
    })).toBeNull();
  });
});
