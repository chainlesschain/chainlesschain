import { describe, it, expect, vi, afterEach } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAddDirs } from "../../src/commands/agent.js";
import { transformBackgroundLaunchArgv } from "../../src/lib/background-command-argv.js";

const OPTION_SPECS = [
  { long: "--model", required: true },
  { long: "--system-prompt", required: true },
  { long: "--add-dir", required: true },
  { short: "--bg", long: "--background" },
  { long: "--worktree" },
  { long: "--no-worktree" },
];
const COMMAND_NAMES = ["agent", "a"];
const canonicalPath = realpathSync.native || realpathSync;

describe("resolveAddDirs — --add-dir resolution + validation", () => {
  let warnSpy;
  afterEach(() => {
    warnSpy?.mockRestore();
    warnSpy = null;
  });

  it("resolves existing directories to absolute, de-duped paths", () => {
    const a = mkdtempSync(join(tmpdir(), "cc-add-dir-a-"));
    const b = mkdtempSync(join(tmpdir(), "cc-add-dir-b-"));
    try {
      const out = resolveAddDirs([a, b, a]); // duplicate a
      expect(out).toEqual([canonicalPath(a), canonicalPath(b)]); // canonical, deduped, order preserved
      expect(out.every((p) => p === join(p))).toBe(true); // already absolute
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });

  it("skips a path that is a file, not a directory (with warning)", () => {
    warnSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const dir = mkdtempSync(join(tmpdir(), "cc-add-dir-f-"));
    const file = join(dir, "not-a-dir.txt");
    writeFileSync(file, "x", "utf8");
    try {
      expect(resolveAddDirs([file])).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("non-directory"),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips a non-existent path (with warning)", () => {
    warnSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    expect(resolveAddDirs(["/no/such/dir/xyz123"])).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("non-directory"),
    );
  });

  it("returns [] for empty / undefined input", () => {
    expect(resolveAddDirs()).toEqual([]);
    expect(resolveAddDirs([])).toEqual([]);
  });

  it("remaps repository roots into the worktree and warns for external roots", () => {
    warnSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const root = mkdtempSync(join(tmpdir(), "cc-add-dir-worktree-"));
    const repoRoot = join(root, "repo");
    const worktreePath = join(root, "worktree");
    const external = join(root, "external");
    const repoSource = join(repoRoot, "src");
    const worktreeSource = join(worktreePath, "src");
    for (const directory of [repoSource, worktreeSource, external]) {
      mkdirSync(directory, { recursive: true });
    }
    try {
      expect(
        resolveAddDirs(["src", repoSource, external], {
          cwd: repoRoot,
          worktree: { repoRoot, path: worktreePath },
          warnOnExternalShare: true,
        }),
      ).toEqual([canonicalPath(worktreeSource), canonicalPath(external)]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("shared external root"),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists canonical external roots instead of mutable repo aliases", () => {
    warnSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const root = mkdtempSync(join(tmpdir(), "cc-add-dir-link-"));
    const repoRoot = join(root, "repo");
    const worktreePath = join(root, "worktree");
    const external = join(root, "external");
    const source = join(repoRoot, "src");
    const mappedAlias = join(worktreePath, "src");
    const repoAlias = join(repoRoot, "external-link");
    for (const directory of [repoRoot, worktreePath, external, source]) {
      mkdirSync(directory, { recursive: true });
    }
    const linkType = process.platform === "win32" ? "junction" : "dir";
    symlinkSync(external, mappedAlias, linkType);
    symlinkSync(external, repoAlias, linkType);
    try {
      const canonicalExternal = canonicalPath(external);
      expect(
        resolveAddDirs([source, repoAlias], {
          cwd: repoRoot,
          worktree: { repoRoot, path: worktreePath },
          warnOnExternalShare: true,
        }),
      ).toEqual([canonicalExternal]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("shared external root"),
      );
      expect(warnSpy).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rewrites repeatable add-dir argv to the resolved roots", () => {
    expect(
      transformBackgroundLaunchArgv(
        [
          "agent",
          "--add-dir",
          "relative-a",
          "--model",
          "m",
          "--add-dir=relative-b",
          "-p",
          "task",
        ],
        {
          directories: ["/isolated/a", "/shared/b"],
          optionSpecs: OPTION_SPECS,
          commandNames: COMMAND_NAMES,
        },
      ),
    ).toEqual([
      "agent",
      "--model",
      "m",
      "-p",
      "task",
      "--add-dir",
      "/isolated/a",
      "--add-dir",
      "/shared/b",
    ]);

    expect(
      transformBackgroundLaunchArgv(
        [
          "agent",
          "--add-dir",
          "relative-a",
          "--",
          "prompt",
          "--add-dir",
          "literal",
        ],
        {
          directories: ["/isolated/a"],
          optionSpecs: OPTION_SPECS,
          commandNames: COMMAND_NAMES,
        },
      ),
    ).toEqual([
      "agent",
      "--add-dir",
      "/isolated/a",
      "--",
      "prompt",
      "--add-dir",
      "literal",
    ]);
  });

  it("strips parent-only flags only before the option terminator", () => {
    expect(
      transformBackgroundLaunchArgv(
        [
          "agent",
          "--bg",
          "--worktree",
          "--",
          "prompt",
          "--bg",
          "--no-worktree",
        ],
        {
          optionSpecs: OPTION_SPECS,
          commandNames: COMMAND_NAMES,
        },
      ),
    ).toEqual(["agent", "--", "prompt", "--bg", "--no-worktree"]);
  });

  it("does not treat another option's value as a parent or add-dir option", () => {
    expect(
      transformBackgroundLaunchArgv(
        [
          "agent",
          "--system-prompt",
          "--add-dir",
          "--model",
          "--no-worktree",
          "--bg",
          "task",
        ],
        {
          directories: ["/isolated/root"],
          optionSpecs: OPTION_SPECS,
          commandNames: COMMAND_NAMES,
        },
      ),
    ).toEqual([
      "agent",
      "--system-prompt",
      "--add-dir",
      "--model",
      "--no-worktree",
      "task",
      "--add-dir",
      "/isolated/root",
    ]);
  });
});
