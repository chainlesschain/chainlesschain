import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {
  filterByManagedPolicy,
  loadManagedPluginPolicy,
  _deps as policyDeps,
  _resetPolicyCache,
  _resetPolicyWarnings,
} from "../../src/lib/plugin-runtime/policy.js";
import {
  discoverPlugins,
  pluginVersionDir,
} from "../../src/lib/plugin-runtime/scopes.js";

const P = (name) => ({ name });

beforeEach(() => {
  _resetPolicyCache();
  _resetPolicyWarnings();
});

describe("filterByManagedPolicy", () => {
  it("keeps everything when there is no managed policy", () => {
    const plugins = [P("a"), P("b")];
    const { kept, dropped } = filterByManagedPolicy(plugins, null);
    expect(kept).toEqual(plugins);
    expect(dropped).toEqual([]);
  });

  it("drops a denied plugin (fail-closed) but keeps the rest", () => {
    const { kept, dropped } = filterByManagedPolicy([P("good"), P("evil")], {
      deniedPlugins: ["evil"],
    });
    expect(kept.map((p) => p.name)).toEqual(["good"]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].name).toBe("evil");
    expect(dropped[0].reason).toMatch(/denied/);
  });

  it("with an allowlist, drops anything not on it", () => {
    const { kept, dropped } = filterByManagedPolicy(
      [P("blessed"), P("random")],
      { allowedPlugins: ["blessed"] },
    );
    expect(kept.map((p) => p.name)).toEqual(["blessed"]);
    expect(dropped.map((d) => d.name)).toEqual(["random"]);
    expect(dropped[0].reason).toMatch(/allowlist/);
  });
});

describe("loadManagedPluginPolicy — memoized + fail-closed", () => {
  let saved;
  afterEach(() => {
    policyDeps.loadManagedSettings = saved;
    _resetPolicyCache();
  });

  it("memoizes the load (reads once per file key)", () => {
    saved = policyDeps.loadManagedSettings;
    let calls = 0;
    policyDeps.loadManagedSettings = () => {
      calls++;
      return { file: "m.json", settings: { deniedPlugins: ["x"] } };
    };
    const a = loadManagedPluginPolicy({ managedSettingsFile: "m.json" });
    const b = loadManagedPluginPolicy({ managedSettingsFile: "m.json" });
    expect(a).toBe(b);
    expect(calls).toBe(1); // second call served from cache
  });

  it("propagates a malformed-managed-settings error (fail-closed)", () => {
    saved = policyDeps.loadManagedSettings;
    policyDeps.loadManagedSettings = () => {
      const e = new Error("malformed");
      e.code = "CC_MANAGED_SETTINGS_INVALID";
      throw e;
    };
    expect(() =>
      loadManagedPluginPolicy({ managedSettingsFile: "bad.json" }),
    ).toThrow(/malformed/);
  });
});

describe("discoverPlugins — managed policy enforced at load", () => {
  let cwd;
  let saved;

  function install(scope, name) {
    const dir = pluginVersionDir(scope, name, "1.0.0", { cwd });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "plugin.json"),
      JSON.stringify({ name, version: "1.0.0" }),
      "utf8",
    );
  }

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ppolicy-"));
    _resetPolicyCache();
    saved = policyDeps.loadManagedSettings;
  });
  afterEach(() => {
    policyDeps.loadManagedSettings = saved;
    _resetPolicyCache();
    try {
      fs.rmSync(cwd, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("does NOT surface a denied plugin to any collector", () => {
    install("local", "good");
    install("local", "denied-one");
    policyDeps.loadManagedSettings = () => ({
      file: "m.json",
      settings: { deniedPlugins: ["denied-one"] },
    });
    const names = discoverPlugins({ cwd, scopes: ["local"] }).map(
      (p) => p.name,
    );
    expect(names).toContain("good");
    expect(names).not.toContain("denied-one");
  });

  it("skipPolicy:true bypasses the org filter (admin view)", () => {
    install("local", "denied-one");
    policyDeps.loadManagedSettings = () => ({
      file: "m.json",
      settings: { deniedPlugins: ["denied-one"] },
    });
    const names = discoverPlugins({
      cwd,
      scopes: ["local"],
      skipPolicy: true,
    }).map((p) => p.name);
    expect(names).toContain("denied-one");
  });

  it("no managed file → no filtering", () => {
    install("local", "anything");
    policyDeps.loadManagedSettings = () => ({ file: null, settings: null });
    const names = discoverPlugins({ cwd, scopes: ["local"] }).map(
      (p) => p.name,
    );
    expect(names).toEqual(["anything"]);
  });
});
