/**
 * project-root subdirectory discovery — Claude-Code 2.1.178 "closest `.claude`
 * directory wins" parity. Running `cc` from a project SUBDIRECTORY must still
 * pick up the project-root `.claude` config (settings.json permission rules,
 * output-styles, slash-commands, sub-agents), while a cwd-local `.claude` still
 * overrides the root on a name clash.
 *
 * Uses a REAL temp project (with a `.git` marker at the root) so the shared
 * walk-up in `project-root.cjs` exercises real `node:fs` / `node:path`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  findGitProjectRoot,
  projectRootBase,
} from "../../src/lib/project-root.cjs";
import {
  discoverOutputStyles,
  resolveOutputStyle,
} from "../../src/lib/output-styles.js";
import { discoverCommands } from "../../src/lib/slash-commands.js";
import { discoverAgents } from "../../src/lib/agents.js";
// settings-loader is CJS.
const settingsLoader = require("../../src/lib/settings-loader.cjs");

let root, sub, home;

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf-8");
}

beforeEach(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "cc-proot-"));
  root = path.join(base, "myproject");
  sub = path.join(root, "packages", "thing", "src");
  home = path.join(base, "home");
  fs.mkdirSync(sub, { recursive: true });
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  // `.git` marks the project root (a file is enough — worktrees use a gitfile).
  fs.writeFileSync(path.join(root, ".git"), "gitdir: /nowhere\n", "utf-8");

  // Project-root config.
  write(
    path.join(root, ".claude", "settings.json"),
    JSON.stringify({ permissions: { deny: ["Bash(rm:*)"] } }),
  );
  write(
    path.join(root, ".claude", "output-styles", "rooty.md"),
    "---\nname: rooty\ndescription: from project root\n---\nRoot persona body.",
  );
  write(
    path.join(root, ".claude", "commands", "deploy.md"),
    "---\ndescription: deploy it\n---\nDeploy the app.",
  );
  write(
    path.join(root, ".claude", "agents", "reviewer.md"),
    "---\ndescription: reviews code\n---\nYou are a reviewer.",
  );
});

afterEach(() => {
  delete settingsLoader._deps.homedir;
  try {
    fs.rmSync(path.dirname(root), { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("project-root.cjs walk-up", () => {
  it("findGitProjectRoot walks up to the nearest .git", () => {
    // Normalize both sides through realpathSync: the function returns a
    // path.resolve()'d (not realpath'd) path, so on macOS its result keeps the
    // `/var/...` form while fs.realpathSync(root) resolves the `/var → /private/var`
    // symlink — same directory, different string. Comparing realpath'd values is
    // OS-portable (identity on Linux/Windows temp dirs).
    expect(fs.realpathSync(findGitProjectRoot(sub, { fs, path }))).toBe(
      fs.realpathSync(root),
    );
  });

  it("projectRootBase returns the ancestor root from a subdir, null at the root", () => {
    expect(fs.realpathSync(projectRootBase(sub, { fs, path }))).toBe(
      fs.realpathSync(root),
    );
    expect(projectRootBase(root, { fs, path })).toBe(null);
  });

  it("bails to null when the injected path lacks dirname (defensive)", () => {
    const brokenPath = { join: (...p) => p.join("/") }; // no dirname/resolve
    expect(findGitProjectRoot(sub, { fs, path: brokenPath })).toBe(null);
    expect(projectRootBase(sub, { fs, path: brokenPath })).toBe(null);
  });

  it("returns null when no .git ancestor exists", () => {
    const orphan = fs.mkdtempSync(path.join(os.tmpdir(), "cc-orphan-"));
    expect(findGitProjectRoot(orphan, { fs, path })).toBe(null);
    fs.rmSync(orphan, { recursive: true, force: true });
  });
});

describe("settings-loader from a subdirectory", () => {
  beforeEach(() => {
    settingsLoader._deps.homedir = () => home;
  });

  it("picks up the project-root deny rule when run from a subdir", () => {
    const { rules } = settingsLoader.loadSettings({ cwd: sub, env: {} });
    expect(rules.deny).toContain("Bash(rm:*)");
  });

  it("a cwd-local settings file still applies alongside the root's", () => {
    write(
      path.join(sub, ".claude", "settings.json"),
      JSON.stringify({ permissions: { allow: ["Read"] } }),
    );
    const { rules } = settingsLoader.loadSettings({ cwd: sub, env: {} });
    // Root deny accretes; cwd allow is added — both present.
    expect(rules.deny).toContain("Bash(rm:*)");
    expect(rules.allow).toContain("Read");
  });
});

describe("output-styles / commands / agents from a subdirectory", () => {
  it("output-styles finds the project-root style", () => {
    const names = discoverOutputStyles(sub, { home }).map((s) => s.name);
    expect(names).toContain("rooty");
    expect(resolveOutputStyle("rooty", sub, { home }).body).toMatch(
      /Root persona/,
    );
  });

  it("a cwd-local output-style shadows the root one on a name clash (closest wins)", () => {
    write(
      path.join(sub, ".claude", "output-styles", "rooty.md"),
      "---\nname: rooty\n---\nLocal override body.",
    );
    expect(resolveOutputStyle("rooty", sub, { home }).body).toMatch(
      /Local override/,
    );
  });

  it("slash-commands finds the project-root command", () => {
    const names = discoverCommands(sub, { home }).map((c) => c.name);
    expect(names).toContain("deploy");
  });

  it("sub-agents find the project-root agent", () => {
    const names = discoverAgents(sub, { home }).map((a) => a.name);
    expect(names).toContain("reviewer");
  });
});
