/**
 * settings-hooks subdirectory discovery — Claude-Code 2.1.178 "closest `.claude`
 * directory wins" parity, completing the settings walk-up for HOOKS. Running
 * `cc` from a project SUBDIRECTORY must still load the project-root
 * `.claude/settings.json` hooks; since those run shell commands, a project-root
 * guard hook silently vanishing from a subdir is a safety regression.
 *
 * Uses a REAL temp project (with a `.git` marker at the root) so the shared
 * walk-up in `project-root.cjs` exercises real `node:fs` / `node:path` through
 * settings-hooks' own `_deps.fs`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// settings-hooks is CJS.
const settingsHooks = require("../../src/lib/settings-hooks.cjs");

let root, sub, home;

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf-8");
}

beforeEach(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "cc-hooks-sub-"));
  root = path.join(base, "myproject");
  sub = path.join(root, "packages", "thing", "src");
  home = path.join(base, "home");
  fs.mkdirSync(sub, { recursive: true });
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  // `.git` marks the project root (a file is enough — worktrees use a gitfile).
  fs.writeFileSync(path.join(root, ".git"), "gitdir: /nowhere\n", "utf-8");

  settingsHooks._deps.homedir = () => home;
  // Project-root settings.json carries a PreToolUse guard hook.
  write(
    path.join(root, ".claude", "settings.json"),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "./guard.sh", timeout: 60 }],
          },
        ],
      },
    }),
  );
});

afterEach(() => {
  delete settingsHooks._deps.homedir;
  try {
    fs.rmSync(path.dirname(root), { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("settings-hooks from a subdirectory", () => {
  it("loads the project-root PreToolUse hook when run from a subdir", () => {
    const { hooks, files } = settingsHooks.loadHooks({ cwd: sub });
    expect(hooks.PreToolUse).toBeTruthy();
    const commands = hooks.PreToolUse.flatMap((g) =>
      g.hooks.map((h) => h.command),
    );
    expect(commands).toContain("./guard.sh");
    expect(files).toContain(path.join(root, ".claude", "settings.json"));
  });

  it("a cwd-local hook is concatenated alongside the project-root hook", () => {
    write(
      path.join(sub, ".claude", "settings.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: "./local.sh" }],
            },
          ],
        },
      }),
    );
    const { hooks } = settingsHooks.loadHooks({ cwd: sub });
    const commands = hooks.PreToolUse.flatMap((g) =>
      g.hooks.map((h) => h.command),
    );
    // Hooks accrete (no override) — both the root and the cwd-local guard fire.
    expect(commands).toContain("./guard.sh");
    expect(commands).toContain("./local.sh");
  });

  it("CC_SETTINGS_HOOKS=0 safe-mode still wins (no hooks) from a subdir", () => {
    const prev = process.env.CC_SETTINGS_HOOKS;
    process.env.CC_SETTINGS_HOOKS = "0";
    try {
      const { hooks } = settingsHooks.loadHooks({ cwd: sub });
      expect(Object.keys(hooks)).toHaveLength(0);
    } finally {
      if (prev === undefined) delete process.env.CC_SETTINGS_HOOKS;
      else process.env.CC_SETTINGS_HOOKS = prev;
    }
  });
});
