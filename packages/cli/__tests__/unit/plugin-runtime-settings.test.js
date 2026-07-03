import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
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
    trustPlugin("toolkit", { scope: "project", version: "1.0.0" });
    expect(collectPluginSettings({ cwd, scopes: ["project"] }).env).toEqual({
      A: "1",
    });
  });
});

describe("applyPluginSettingsEnv", () => {
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
