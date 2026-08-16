import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {
  collectPluginHooks,
  mergePluginHooks,
  _deps as pluginHookDeps,
} from "../../src/lib/plugin-runtime/hooks.js";
import { pluginVersionDir } from "../../src/lib/plugin-runtime/scopes.js";
import {
  runHooks,
  _deps as hookRunnerDeps,
  _processDeps as hookProcessDeps,
  _restoreProcessRunners,
} from "../../src/lib/hook-runner.js";
import { executeTool } from "../../src/runtime/agent-core.js";

let cwd;
const originalDiscoverPlugins = pluginHookDeps.discoverPlugins;
const originalReadFileSync = pluginHookDeps.readFileSync;

function installHookPlugin(scope, name, hooksJson, { manifest = {} } = {}) {
  const dir = pluginVersionDir(scope, name, "1.0.0", { cwd });
  fs.mkdirSync(path.join(dir, "hooks"), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(dir), ".active"), "1.0.0", "utf8");
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    JSON.stringify({ name, version: "1.0.0", ...manifest }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "hooks", "hooks.json"),
    JSON.stringify(hooksJson),
    "utf8",
  );
  return dir;
}

beforeEach(() => {
  pluginHookDeps.discoverPlugins = originalDiscoverPlugins;
  pluginHookDeps.readFileSync = originalReadFileSync;
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-phook-"));
});
afterEach(() => {
  pluginHookDeps.discoverPlugins = originalDiscoverPlugins;
  pluginHookDeps.readFileSync = originalReadFileSync;
  try {
    fs.rmSync(cwd, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("collectPluginHooks — component-level capability gate", () => {
  const oneHook = {
    SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }],
  };

  it("refuses hooks when the plugin declared permissions but not 'process'", () => {
    installHookPlugin("local", "p", oneHook, {
      manifest: { permissions: {} }, // opted in, but no process capability
    });
    expect(collectPluginHooks({ cwd, scopes: ["local"] })).toEqual({});
  });

  it("allows hooks once 'process' is declared", () => {
    installHookPlugin("local", "p", oneHook, {
      manifest: { permissions: { process: true } },
    });
    expect(
      collectPluginHooks({ cwd, scopes: ["local"] }).SessionStart,
    ).toHaveLength(1);
    expect(
      collectPluginHooks({ cwd, scopes: ["local"] }).SessionStart[0].hooks[0],
    ).toMatchObject({
      origin: "plugin:hook",
      pluginId: "p",
      pluginVersion: "1.0.0",
    });
  });

  it("a legacy plugin (no permissions block) is unaffected", () => {
    installHookPlugin("local", "p", oneHook);
    expect(
      collectPluginHooks({ cwd, scopes: ["local"] }).SessionStart,
    ).toHaveLength(1);
  });
});

describe("collectPluginHooks", () => {
  it("stamps immutable source provenance and a SHA-256 digest", () => {
    const dir = installHookPlugin("local", "provenance", {
      hooks: {
        PreToolUse: [
          {
            hooks: [
              {
                type: "command",
                command: "guard",
                authoritySource: {
                  kind: "managed",
                  sourceFile: "forged.json",
                  digest: "forged",
                },
              },
            ],
          },
        ],
      },
    });

    const hook = collectPluginHooks({ cwd, scopes: ["local"] }).PreToolUse[0]
      .hooks[0];
    expect(hook.authoritySource).toEqual({
      kind: "plugin",
      sourceFile: path.join(dir, "hooks", "hooks.json"),
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(Object.isFrozen(hook.authoritySource)).toBe(true);
    expect(
      Object.getOwnPropertyDescriptor(hook, "authoritySource"),
    ).toMatchObject({
      enumerable: true,
      writable: false,
      configurable: false,
    });
  });

  it("propagates plugin discovery failures as authority metadata", () => {
    pluginHookDeps.discoverPlugins = vi.fn(() => {
      throw new Error("discovery unavailable");
    });

    const map = collectPluginHooks({ cwd, scopes: ["local"] });

    expect(Object.keys(map)).toEqual([]);
    expect(map._authorityErrors).toEqual([
      expect.objectContaining({
        code: "CC_PLUGIN_HOOK_DISCOVERY_FAILED",
        kind: "plugin",
        authorityBearing: true,
        stage: "discover",
      }),
    ]);
  });

  it("propagates plugin hook read failures as authority metadata", () => {
    const dir = installHookPlugin("local", "unreadable", {
      SessionStart: [{ hooks: [{ type: "command", command: "guard" }] }],
    });
    const hookFile = path.join(dir, "hooks", "hooks.json");
    pluginHookDeps.readFileSync = vi.fn((file, ...args) => {
      if (path.resolve(file) === path.resolve(hookFile)) {
        throw new Error("EACCES");
      }
      return originalReadFileSync(file, ...args);
    });

    const map = collectPluginHooks({ cwd, scopes: ["local"] });

    expect(map.SessionStart).toBeUndefined();
    expect(map._authorityErrors).toEqual([
      expect.objectContaining({
        code: "CC_PLUGIN_HOOK_READ_FAILED",
        pluginId: "unreadable",
        sourceFile: hookFile,
        digest: null,
        stage: "read",
      }),
    ]);
  });

  it("propagates malformed plugin hook JSON with its source digest", () => {
    const dir = installHookPlugin("local", "malformed", {
      SessionStart: [{ hooks: [{ type: "command", command: "guard" }] }],
    });
    const hookFile = path.join(dir, "hooks", "hooks.json");
    fs.writeFileSync(hookFile, '{"SessionStart":', "utf8");

    const map = collectPluginHooks({ cwd, scopes: ["local"] });

    expect(map.SessionStart).toBeUndefined();
    expect(map._authorityErrors).toEqual([
      expect.objectContaining({
        code: "CC_PLUGIN_HOOK_PARSE_FAILED",
        pluginId: "malformed",
        sourceFile: hookFile,
        digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        stage: "parse",
      }),
    ]);
  });

  it("collects wrapped { hooks: { Event: [...] } } form", () => {
    installHookPlugin("local", "p", {
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }],
      },
    });
    const map = collectPluginHooks({ cwd, scopes: ["local"] });
    expect(map.SessionStart).toHaveLength(1);
    expect(map.SessionStart[0].hooks[0]).not.toHaveProperty("sandboxPolicy");
  });

  it("merges manifest, group, and command-hook sandbox requirements", () => {
    installHookPlugin(
      "local",
      "strict-hooks",
      {
        hooks: {
          SessionStart: [
            {
              sandboxPolicy: { requiredBoundaries: ["network"] },
              hooks: [
                {
                  type: "command",
                  command: "guard",
                  sandboxPolicy: { requiredBoundaries: ["filesystem"] },
                },
              ],
            },
          ],
        },
      },
      {
        manifest: {
          sandboxPolicy: { requiredBoundaries: ["filesystem"] },
        },
      },
    );

    const map = collectPluginHooks({ cwd, scopes: ["local"] });

    expect(map.SessionStart[0]).not.toHaveProperty("sandboxPolicy");
    expect(map.SessionStart[0].hooks[0].sandboxPolicy).toEqual({
      requiredBoundaries: ["filesystem", "network"],
    });

    const broker = {
      issueLinuxWorkspaceSandboxExecutionContract: vi.fn(() => ({
        kind: "test-plugin-hook-contract",
      })),
      spawnSync: vi.fn(() => ({ status: 0, stdout: "", stderr: "" })),
    };
    runHooks(
      map.SessionStart[0].hooks,
      {},
      {
        broker,
        cwd,
        event: "SessionStart",
      },
    );
    expect(broker.spawnSync.mock.calls[0][2].sandboxPolicy).toEqual({
      requiredBoundaries: ["filesystem", "network"],
    });
    expect(broker.spawnSync.mock.calls[0][2]).toMatchObject({
      shell: false,
      sandboxExecutionContract: {
        kind: "test-plugin-hook-contract",
      },
    });
  });

  it("marks an invalid sandbox policy as an authority failure", () => {
    const dir = installHookPlugin("local", "bad-hooks", {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: "bad",
                sandboxPolicy: { requiredBoundaries: ["filesytem"] },
              },
              { type: "command", command: "good" },
            ],
          },
        ],
      },
    });

    const map = collectPluginHooks({ cwd, scopes: ["local"] });
    const hooks = map.SessionStart[0].hooks;

    expect(hooks).toHaveLength(1);
    expect(hooks[0].command).toBe("good");
    expect(map._authorityErrors).toEqual([
      expect.objectContaining({
        code: "CC_PLUGIN_HOOK_SANDBOX_INVALID",
        pluginId: "bad-hooks",
        sourceFile: path.join(dir, "hooks", "hooks.json"),
        digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        stage: "sandbox-policy",
      }),
    ]);
  });

  it("collects unwrapped { Event: [...] } form", () => {
    installHookPlugin("local", "p", {
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "echo x" }] },
      ],
    });
    const map = collectPluginHooks({ cwd, scopes: ["local"] });
    expect(map.PreToolUse).toHaveLength(1);
  });

  it("concatenates hooks from multiple plugins for the same event", () => {
    installHookPlugin("local", "a", {
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo a" }] }],
      },
    });
    installHookPlugin("local", "b", {
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo b" }] }],
      },
    });
    const map = collectPluginHooks({ cwd, scopes: ["local", "local"] });
    expect(map.SessionStart).toHaveLength(2);
  });

  it("skips a plugin whose manifest failed validation", () => {
    installHookPlugin(
      "local",
      "evil",
      {
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "echo x" }] }],
        },
      },
      { manifest: { skills: [{ name: "esc", path: "../../../etc" }] } },
    );
    expect(collectPluginHooks({ cwd, scopes: ["local"] })).toEqual({});
  });

  it("collects hooks declared INLINE in plugin.json (no separate hooks.json)", () => {
    // Inline hooks: the manifest carries the whole hooks map, with NO
    // hooks/hooks.json file. The normalized component has no absPath, so the
    // collector must re-read the manifest (mirroring the MCP collector) or the
    // hooks silently never fire.
    const dir = pluginVersionDir("local", "inlinehooks", "1.0.0", { cwd });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(path.dirname(dir), ".active"), "1.0.0", "utf8");
    fs.writeFileSync(
      path.join(dir, "plugin.json"),
      JSON.stringify({
        name: "inlinehooks",
        version: "1.0.0",
        hooks: {
          SessionStart: [
            { hooks: [{ type: "command", command: "echo inline" }] },
          ],
        },
      }),
      "utf8",
    );
    const map = collectPluginHooks({ cwd, scopes: ["local"] });
    expect(map.SessionStart).toHaveLength(1);
    expect(map.SessionStart[0].hooks[0].command).toBe("echo inline");
  });
});

describe("mergePluginHooks", () => {
  it("returns the input unchanged when no plugins contribute hooks", () => {
    const existing = { PreToolUse: [{ hooks: [] }] };
    expect(mergePluginHooks(existing, { cwd, scopes: ["local"] })).toBe(
      existing,
    );
  });

  it("preserves settings errors and combines plugin errors without hook events", () => {
    const dir = installHookPlugin("local", "malformed", {
      SessionStart: [{ hooks: [{ type: "command", command: "guard" }] }],
    });
    fs.writeFileSync(
      path.join(dir, "hooks", "hooks.json"),
      '{"SessionStart":',
      "utf8",
    );
    const existing = { PreToolUse: [{ hooks: [] }] };
    Object.defineProperty(existing, "_authorityErrors", {
      value: Object.freeze([
        Object.freeze({
          code: "CC_SETTINGS_HOOKS_INVALID",
          sourceFile: path.join(cwd, ".claude", "settings.json"),
        }),
      ]),
      enumerable: false,
      writable: false,
      configurable: false,
    });

    const merged = mergePluginHooks(existing, { cwd, scopes: ["local"] });

    expect(merged).not.toBe(existing);
    expect(Object.keys(merged)).toEqual(["PreToolUse"]);
    expect(merged._authorityErrors.map((entry) => entry.code)).toEqual([
      "CC_SETTINGS_HOOKS_INVALID",
      "CC_PLUGIN_HOOK_PARSE_FAILED",
    ]);
    expect(Object.isFrozen(merged._authorityErrors)).toBe(true);
    expect(merged._authorityErrors.every(Object.isFrozen)).toBe(true);
    expect(
      Object.getOwnPropertyDescriptor(merged, "_authorityErrors"),
    ).toMatchObject({
      enumerable: false,
      writable: false,
      configurable: false,
    });
  });

  it("feeds plugin loader failures into the runtime fail-closed fence", async () => {
    const dir = installHookPlugin("local", "malformed-runtime", {
      PreToolUse: [{ hooks: [{ type: "command", command: "guard" }] }],
    });
    fs.writeFileSync(
      path.join(dir, "hooks", "hooks.json"),
      '{"PreToolUse":',
      "utf8",
    );
    const readable = path.join(cwd, "readable.txt");
    fs.writeFileSync(readable, "must-not-be-read", "utf8");

    const settingsHooks = mergePluginHooks(null, {
      cwd,
      scopes: ["local"],
    });
    const result = await executeTool(
      "read_file",
      { path: readable },
      { cwd, settingsHooks },
    );

    expect(result).toMatchObject({
      policy: { decision: "blocked", via: "hook-authority-load" },
      incidents: [{ code: "CC_PLUGIN_HOOK_PARSE_FAILED" }],
    });
    expect(result.content).toBeUndefined();
  });

  it("ADDS plugin hooks onto the user's existing event array (does not replace)", () => {
    installHookPlugin("local", "p", {
      hooks: {
        PreToolUse: [{ hooks: [{ type: "command", command: "echo plugin" }] }],
      },
    });
    const existing = {
      PreToolUse: [{ hooks: [{ type: "command", command: "echo user" }] }],
    };
    const merged = mergePluginHooks(existing, { cwd, scopes: ["local"] });
    expect(merged.PreToolUse).toHaveLength(2);
    // user's entry preserved as-is
    expect(merged.PreToolUse[0].hooks[0].command).toBe("echo user");
  });

  it("builds a fresh map when the user had no hooks", () => {
    installHookPlugin("local", "p", {
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo x" }] }],
      },
    });
    const merged = mergePluginHooks(null, { cwd, scopes: ["local"] });
    expect(Object.keys(merged)).toEqual(["SessionStart"]);
  });
});

// End-to-end through the REAL hook-runner (spawns the hook command) — no LLM.
describe("plugin hooks fire through the settings-hook lifecycle", () => {
  it("a plugin SessionStart hook runs and injects its stdout as context", async () => {
    const previousSandboxDisable = process.env.CC_SANDBOX_DISABLE;
    process.env.CC_SANDBOX_DISABLE = "1";
    try {
      // Reproduce the cross-suite CJS cache state that previously made this
      // live lifecycle smoke fail only in the full Ubuntu unit shard.
      hookRunnerDeps.runSync = null;
      hookProcessDeps.runSync = null;
      _restoreProcessRunners();
      installHookPlugin("local", "greeter", {
        hooks: {
          SessionStart: [
            { hooks: [{ type: "command", command: "echo PLUGIN_HOOK_OK" }] },
          ],
        },
      });
      const merged = mergePluginHooks(null, { cwd, scopes: ["local"] });
      const { runSessionStartHooks } =
        await import("../../src/lib/settings-hook-events.js");
      const res = runSessionStartHooks(merged, { source: "startup", cwd });
      expect(res.additionalContext || "", JSON.stringify(res)).toContain(
        "PLUGIN_HOOK_OK",
      );
    } finally {
      _restoreProcessRunners();
      if (previousSandboxDisable === undefined) {
        delete process.env.CC_SANDBOX_DISABLE;
      } else {
        process.env.CC_SANDBOX_DISABLE = previousSandboxDisable;
      }
    }
  });
});
