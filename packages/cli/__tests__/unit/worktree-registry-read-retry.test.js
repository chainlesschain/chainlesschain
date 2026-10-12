import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _deps as gitDeps } from "../../src/lib/git-integration.js";
import {
  createWorktree,
  listWorktrees,
  removeWorktree,
} from "../../src/lib/worktree-isolator.js";

const MISSING_LOCK =
  "fatal: failed to read '.git/worktrees/peer-task/locked': No such file or directory";
const isRegistryRead = (args) =>
  JSON.stringify(args) === JSON.stringify(["worktree", "list", "--porcelain"]);

describe("worktree registry read retries", { timeout: 60_000 }, () => {
  let repoDir;

  function git(...args) {
    return execFileSync("git", args, {
      cwd: repoDir,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  }

  beforeEach(() => {
    repoDir = realpathSync(
      mkdtempSync(join(tmpdir(), "cc-worktree-registry-retry-")),
    );
    git("init");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Worktree Test");
    writeFileSync(join(repoDir, "README.md"), "registry fixture\n");
    git("add", "README.md");
    git("commit", "-m", "initial");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (repoDir) rmSync(repoDir, { recursive: true, force: true });
  });

  function interceptGit(intercept) {
    const original = gitDeps.spawnSync;
    return vi.spyOn(gitDeps, "spawnSync").mockImplementation((...args) => {
      return intercept(...args) ?? original(...args);
    });
  }

  function readCalls(spy) {
    return spy.mock.calls.filter(([, args]) => isRegistryRead(args));
  }

  function addCalls(spy) {
    return spy.mock.calls.filter(
      ([, args]) => args[0] === "worktree" && args[1] === "add",
    );
  }

  function expectOriginalError(operation, originalError) {
    let caught;
    try {
      operation();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(originalError);
  }

  it.each([
    MISSING_LOCK,
    "fatal: failed to read 'C:\\repo\\.git\\worktrees\\peer-task\\locked': No such file or directory",
  ])("re-reads a transient missing lock before one creation: %s", (message) => {
    const peer = createWorktree(repoDir, "peer-task");
    let failed = false;
    const spy = interceptGit((command, args) => {
      if (isRegistryRead(args) && !failed) {
        failed = true;
        return {
          status: 128,
          stderr: message,
          stdout: "worktree /incomplete-untrusted-snapshot\n",
        };
      }
    });

    const created = createWorktree(repoDir, "new-task");
    const firstAdd = spy.mock.calls.findIndex(
      ([, args]) => args[0] === "worktree" && args[1] === "add",
    );
    expect(
      spy.mock.calls
        .slice(0, firstAdd)
        .filter(([, args]) => isRegistryRead(args)),
    ).toHaveLength(2);
    expect(addCalls(spy)).toHaveLength(1);
    expect(
      listWorktrees(repoDir).map(({ path }) => path.replaceAll("\\", "/")),
    ).toEqual(
      [repoDir, created.path, peer.path].map((path) =>
        path.replaceAll("\\", "/"),
      ),
    );
    expect(existsSync(join(created.path, "README.md"))).toBe(true);
  });

  it("throws the final original error after three reads without creating a worktree", () => {
    const failures = Array.from({ length: 3 }, () => new Error(MISSING_LOCK));
    const spy = interceptGit((command, args) => {
      if (isRegistryRead(args)) {
        return { error: failures[readCalls(spy).length - 1] };
      }
    });

    expectOriginalError(
      () => createWorktree(repoDir, "never-created"),
      failures[2],
    );
    expect(readCalls(spy)).toHaveLength(3);
    expect(addCalls(spy)).toHaveLength(0);
    expect(git("branch", "--list", "never-created")).toBe("");
  });

  it.each([
    MISSING_LOCK.replace("No such file or directory", "Permission denied"),
    MISSING_LOCK.replace("/locked'", "/HEAD'"),
    MISSING_LOCK.replace("/worktrees/", "/unrelated/"),
    `${MISSING_LOCK}\nfatal: unrelated repository failure`,
  ])("does not retry another registry error: %s", (message) => {
    const originalError = new Error(message);
    const spy = interceptGit((command, args) => {
      if (isRegistryRead(args)) return { error: originalError };
    });

    expectOriginalError(
      () => createWorktree(repoDir, "never-created"),
      originalError,
    );
    expect(readCalls(spy)).toHaveLength(1);
    expect(addCalls(spy)).toHaveLength(0);
  });

  it("validates the fresh registry instead of trusting a successful retry", () => {
    const spy = interceptGit((command, args) => {
      if (!isRegistryRead(args)) return;
      return readCalls(spy).length === 1
        ? { status: 128, stderr: MISSING_LOCK }
        : { status: 0, stdout: "worktree /unregistered-checkout\n" };
    });

    expect(() => createWorktree(repoDir, "never-created")).toThrow(
      "repository checkout is not a registered git worktree",
    );
    expect(readCalls(spy)).toHaveLength(2);
    expect(addCalls(spy)).toHaveLength(0);
  });

  it("does not retry a mutation even when it reports the same missing lock", () => {
    const originalError = new Error(MISSING_LOCK);
    const spy = interceptGit((command, args) => {
      if (args[0] === "worktree" && args[1] === "add") {
        return { error: originalError };
      }
    });

    expectOriginalError(
      () => createWorktree(repoDir, "never-created"),
      originalError,
    );
    expect(addCalls(spy)).toHaveLength(1);
    expect(git("branch", "--list", "never-created")).toBe("");
  });

  it("still refuses removal when the fresh registry identifies a locked worktree", () => {
    const created = createWorktree(repoDir, "locked-task");
    git("worktree", "lock", "--reason", "active lease", created.path);
    let failed = false;
    const spy = interceptGit((command, args) => {
      if (isRegistryRead(args) && !failed) {
        failed = true;
        return { status: 128, stderr: MISSING_LOCK };
      }
    });

    expect(() =>
      removeWorktree(repoDir, created.path, {
        branchName: "locked-task",
        deleteBranch: true,
        force: true,
      }),
    ).toThrow(/locked worktree.*active lease/u);
    expect(readCalls(spy).length).toBeGreaterThanOrEqual(2);
    expect(existsSync(join(created.path, "README.md"))).toBe(true);
    expect(git("branch", "--list", "locked-task")).not.toBe("");
    expect(
      spy.mock.calls.some(
        ([, args]) =>
          (args[0] === "worktree" && ["remove", "prune"].includes(args[1])) ||
          (args[0] === "branch" && args[1] === "-D"),
      ),
    ).toBe(false);
  });
});
