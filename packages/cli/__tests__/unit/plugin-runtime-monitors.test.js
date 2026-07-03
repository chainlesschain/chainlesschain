import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { collectPluginMonitors } from "../../src/lib/plugin-runtime/monitors.js";
import { pluginVersionDir } from "../../src/lib/plugin-runtime/scopes.js";
import {
  trustPlugin,
  _deps as trustDeps,
  _resetTrustWarnings,
} from "../../src/lib/plugin-runtime/trust.js";

let cwd;
let storeFile;
let savedStorePath;

function installMonitorPlugin(
  scope,
  name,
  monitorsJson,
  { manifest = {} } = {},
) {
  const dir = pluginVersionDir(scope, name, "1.0.0", { cwd });
  fs.mkdirSync(path.join(dir, "monitors"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    JSON.stringify({ name, version: "1.0.0", ...manifest }),
    "utf8",
  );
  if (monitorsJson !== undefined) {
    fs.writeFileSync(
      path.join(dir, "monitors", "monitors.json"),
      JSON.stringify(monitorsJson),
      "utf8",
    );
  }
  return dir;
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pmon-"));
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

describe("collectPluginMonitors", () => {
  it("collects + namespaces monitors from a trusted (local) plugin", () => {
    installMonitorPlugin("local", "toolkit", {
      monitors: [
        {
          name: "tests",
          command: "npm",
          args: ["test"],
          mode: "interval",
          intervalMs: 5000,
        },
        {
          name: "logs",
          command: "tail",
          args: ["-f", "app.log"],
          mode: "longRunning",
        },
      ],
    });
    const mons = collectPluginMonitors({ cwd, scopes: ["local"] });
    expect(mons).toHaveLength(2);
    const tests = mons.find((m) => m.name === "tests");
    expect(tests.id).toBe("toolkit:tests");
    expect(tests.mode).toBe("interval");
    expect(tests.intervalMs).toBe(5000);
    expect(tests.command).toBe("npm");
    const logs = mons.find((m) => m.name === "logs");
    expect(logs.mode).toBe("longRunning");
  });

  it("defaults mode to interval and drops an entry missing name/command", () => {
    installMonitorPlugin("local", "p", {
      monitors: [
        { name: "ok", command: "echo" }, // no mode -> interval
        { command: "no-name" }, // dropped
        { name: "no-command" }, // dropped
      ],
    });
    const mons = collectPluginMonitors({ cwd, scopes: ["local"] });
    expect(mons).toHaveLength(1);
    expect(mons[0].mode).toBe("interval");
  });

  it("returns [] when no plugin declares monitors", () => {
    installMonitorPlugin("local", "noop", undefined);
    expect(collectPluginMonitors({ cwd, scopes: ["local"] })).toEqual([]);
  });

  it("never throws on a broken plugin manifest", () => {
    const dir = pluginVersionDir("local", "broken", "1.0.0", { cwd });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "plugin.json"), "{ not json", "utf8");
    expect(() =>
      collectPluginMonitors({ cwd, scopes: ["local"] }),
    ).not.toThrow();
  });
});

describe("collectPluginMonitors — trust gating (monitors spawn commands)", () => {
  it("does NOT collect an UNTRUSTED project plugin's monitors, but does after trust", () => {
    installMonitorPlugin("project", "toolkit", {
      monitors: [{ name: "tests", command: "npm", args: ["test"] }],
    });
    expect(collectPluginMonitors({ cwd, scopes: ["project"] })).toEqual([]);
    trustPlugin("toolkit", { scope: "project", version: "1.0.0" });
    const mons = collectPluginMonitors({ cwd, scopes: ["project"] });
    expect(mons).toHaveLength(1);
    expect(mons[0].id).toBe("toolkit:tests");
  });
});
