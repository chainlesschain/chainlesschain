import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {
  collectPluginHooks,
  mergePluginHooks,
} from "../../src/lib/plugin-runtime/hooks.js";
import { pluginVersionDir } from "../../src/lib/plugin-runtime/scopes.js";
import {
  runHooks,
  _deps as hookRunnerDeps,
  _restoreProcessRunners,
} from "../../src/lib/hook-runner.js";

let cwd;

function installHookPlugin(scope, name, hooksJson, { manifest = {} } = {}) {
  const dir = pluginVersionDir(scope, name, "1.0.0", { cwd });
  fs.mkdirSync(path.join(dir, "hooks"), { recursive: true });
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
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-phook-"));
});
afterEach(() => {
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
      spawnSync: vi.fn(() => ({ status: 0, stdout: "", stderr: "" })),
    };
    runHooks(map.SessionStart[0].hooks, {}, { broker, event: "SessionStart" });
    expect(broker.spawnSync.mock.calls[0][2].sandboxPolicy).toEqual({
      requiredBoundaries: ["filesystem", "network"],
    });
  });

  it("drops an invalid command-hook descriptor instead of running it unsandboxed", () => {
    installHookPlugin("local", "bad-hooks", {
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

    const hooks = collectPluginHooks({ cwd, scopes: ["local"] }).SessionStart[0]
      .hooks;

    expect(hooks).toHaveLength(1);
    expect(hooks[0].command).toBe("good");
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
      if (previousSandboxDisable === undefined) {
        delete process.env.CC_SANDBOX_DISABLE;
      } else {
        process.env.CC_SANDBOX_DISABLE = previousSandboxDisable;
      }
    }
  });
});
