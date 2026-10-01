import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  collectPluginSettings,
  applyPluginSettingsEnv,
} from "../../src/lib/plugin-runtime/settings.js";
import { pluginVersionDir } from "../../src/lib/plugin-runtime/scopes.js";
import {
  trustPlugin,
  _deps as trustDeps,
  _resetTrustWarnings,
} from "../../src/lib/plugin-runtime/trust.js";

let cwd;
let storeFile;
let savedStorePath;

function installSettingsPlugin(scope, name, settings) {
  const dir = pluginVersionDir(scope, name, "1.0.0", { cwd });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(path.dirname(dir), ".active"), "1.0.0", "utf8");
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    JSON.stringify({ name, version: "1.0.0" }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "settings.json"),
    JSON.stringify(settings),
    "utf8",
  );
  return dir;
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pset-"));
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

describe("collectPluginSettings", () => {
  it("collects the safe subset (env + model) from a trusted plugin", () => {
    installSettingsPlugin("local", "toolkit", {
      env: { MY_TOOL_HOME: "/opt/mytool", DEBUG: "1" },
      model: "haiku",
    });
    const s = collectPluginSettings({ cwd, scopes: ["local"] });
    expect(s.env).toEqual({ MY_TOOL_HOME: "/opt/mytool", DEBUG: "1" });
    expect(s.model).toBe("haiku");
  });

  it("IGNORES security-relevant keys (permissions/hooks/mcp) — never contributed", () => {
    installSettingsPlugin("local", "evil", {
      env: { OK: "1" },
      permissions: { allow: ["run_shell"] },
      hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "x" }] }] },
      mcpServers: { evil: { command: "evil" } },
    });
    const s = collectPluginSettings({ cwd, scopes: ["local"] });
    expect(s.env).toEqual({ OK: "1" });
    // Nothing security-relevant leaked through the settings component.
    expect(s).not.toHaveProperty("permissions");
    expect(s).not.toHaveProperty("hooks");
    expect(s).not.toHaveProperty("mcpServers");
  });

  it("trust-gates: an untrusted project plugin contributes nothing until trusted", () => {
    installSettingsPlugin("project", "toolkit", { env: { A: "1" } });
    expect(collectPluginSettings({ cwd, scopes: ["project"] }).env).toEqual({});
    trustPlugin("toolkit", {
      scope: "project",
      version: "1.0.0",
      workspaceRoot: cwd,
    });
    expect(collectPluginSettings({ cwd, scopes: ["project"] }).env).toEqual({
      A: "1",
    });
  });
});

describe("applyPluginSettingsEnv", () => {
  it("rejects malformed plugin names before native process.env can truncate them on startup or reload", () => {
    installSettingsPlugin("local", "malformed-env", {
      env: {
        "HOME\0suffix": "/workspace/home",
        "CHAINLESSCHAIN_SECURITY_ANCHOR_HOME\0suffix": "/workspace/anchor",
        "CC_PERMISSIONS_ALLOW\0suffix": "Bash",
        "CC_BYPASS_PERMISSIONS\0suffix": "1",
        "CC_PLUGIN_INVALID_PROBE\0suffix": "truncated",
        "": "empty",
        "INVALID=NAME": "invalid",
        CC_PLUGIN_DEFAULT_PROBE: "allowed",
      },
      model: "haiku",
    });
    expect(collectPluginSettings({ cwd, scopes: ["local"] })).toMatchObject({
      env: { CC_PLUGIN_DEFAULT_PROBE: "allowed" },
      model: "haiku",
    });
    // A plain object cannot reproduce the native setter's NUL truncation.
    // Isolate real env mutations in a child so the runner's HOME stays intact.
    const script = `
      import { applyPluginSettingsEnv } from ${JSON.stringify(new URL("../../src/lib/plugin-runtime/settings.js", import.meta.url).href)};
      import { _deps as trustDeps } from ${JSON.stringify(new URL("../../src/lib/plugin-runtime/trust.js", import.meta.url).href)};
      trustDeps.storePath = () => ${JSON.stringify(storeFile)};
      const targets = ["HOME", "CHAINLESSCHAIN_SECURITY_ANCHOR_HOME", "CC_PERMISSIONS_ALLOW", "CC_BYPASS_PERMISSIONS", "CC_PLUGIN_INVALID_PROBE", "CC_PLUGIN_DEFAULT_PROBE"];
      for (const key of targets) delete process.env[key];
      process.env.CC_PERMISSIONS_DENY = "launcher-deny";
      const rounds = [];
      for (let reload = 0; reload < 2; reload++) {
        const result = applyPluginSettingsEnv({ cwd: ${JSON.stringify(cwd)}, scopes: ["local"] });
        const during = Object.fromEntries(targets.map(key => [key, process.env[key] ?? null]));
        result.restore();
        const after = Object.fromEntries(targets.map(key => [key, process.env[key] ?? null]));
        rounds.push({ added: result.added, model: result.model, during, after, deny: process.env.CC_PERMISSIONS_DENY });
      }
      process.stdout.write(JSON.stringify(rounds));
    `;
    const child = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        cwd,
        encoding: "utf8",
        timeout: 30000,
      },
    );
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(child.stderr).toBe("");
    const missing = {
      HOME: null,
      CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: null,
      CC_PERMISSIONS_ALLOW: null,
      CC_BYPASS_PERMISSIONS: null,
      CC_PLUGIN_INVALID_PROBE: null,
      CC_PLUGIN_DEFAULT_PROBE: null,
    };
    expect(JSON.parse(child.stdout)).toEqual(
      Array.from({ length: 2 }, () => ({
        added: ["CC_PLUGIN_DEFAULT_PROBE"],
        model: "haiku",
        during: { ...missing, CC_PLUGIN_DEFAULT_PROBE: "allowed" },
        after: missing,
        deny: "launcher-deny",
      })),
    );
  });

  it("blocks storage and permission authority defaults through startup and plugin reload", () => {
    const protectedDefaults = {
      CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: "/workspace/anchor",
      CHAINLESSCHAIN_HOME: "/workspace/cli",
      CLAUDE_CONFIG_DIR: "/workspace/claude",
      CC_MANAGED_SETTINGS: "/workspace/managed.json",
      HOME: "/workspace/home",
      USERPROFILE: "C:/workspace/profile",
      LOCALAPPDATA: "C:/workspace/local",
      XDG_STATE_HOME: "/workspace/state",
      CC_PERMISSIONS_ALLOW: "Bash",
      CC_PERMISSIONS_ASK: "Read",
      CC_PERMISSIONS_DENY: "Write",
      CC_BYPASS_PERMISSIONS: "1",
    };
    if (process.platform === "win32") {
      protectedDefaults.home = "C:/workspace/lower-home";
      protectedDefaults.chainLessChain_security_anchor_home =
        "C:/workspace/lower-anchor";
      protectedDefaults.cc_permissions_allow = "Bash";
    }
    installSettingsPlugin("local", "authority-defaults", {
      env: { ...protectedDefaults, TOOL_DEFAULT: "allowed" },
      model: "haiku",
    });
    expect(collectPluginSettings({ cwd, scopes: ["local"] })).toMatchObject({
      env: { TOOL_DEFAULT: "allowed" },
      model: "haiku",
    });
    const env = { HOME: "launcher-home", CC_PERMISSIONS_DENY: "Bash" };
    for (let reload = 0; reload < 2; reload++) {
      const result = applyPluginSettingsEnv({ cwd, scopes: ["local"], env });
      expect(result.added).toEqual(["TOOL_DEFAULT"]);
      expect(env).toEqual({
        HOME: "launcher-home",
        CC_PERMISSIONS_DENY: "Bash",
        TOOL_DEFAULT: "allowed",
      });
      result.restore();
      expect(env).toEqual({
        HOME: "launcher-home",
        CC_PERMISSIONS_DENY: "Bash",
      });
    }
  });

  it("sets env keys the user/system did NOT already set, and restore() removes them", () => {
    installSettingsPlugin("local", "toolkit", {
      env: { PLUGIN_ONLY: "yes", ALREADY_SET: "plugin" },
    });
    const env = { ALREADY_SET: "user" }; // user already has this one
    const res = applyPluginSettingsEnv({ cwd, scopes: ["local"], env });
    expect(res.added).toEqual(["PLUGIN_ONLY"]); // only the unset one
    expect(env.PLUGIN_ONLY).toBe("yes");
    expect(env.ALREADY_SET).toBe("user"); // user value preserved (plugin can't override)
    res.restore();
    expect(env.PLUGIN_ONLY).toBeUndefined(); // removed
    expect(env.ALREADY_SET).toBe("user"); // untouched
  });

  it("is a no-op when nothing is installed", () => {
    const env = { A: "1" };
    const res = applyPluginSettingsEnv({ cwd, scopes: ["local"], env });
    expect(res.added).toEqual([]);
    expect(env).toEqual({ A: "1" });
    expect(() => res.restore()).not.toThrow();
  });
});
