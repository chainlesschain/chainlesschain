/**
 * Worktree stability matrix — edge cells (gap #5, cell 7). Real git, no
 * mocks; each test gets its own temp repo. Covers only what the existing
 * worktree libs support (src/harness/worktree-isolator.js +
 * src/lib/agent-worktree.js):
 *
 *  7a. nested repo        — an inner repo living inside an outer repo gets
 *      its worktree under the INNER root (nearest .git wins), the outer
 *      checkout is never touched
 *  7b. worktree-in-worktree — creating a worktree from inside another
 *      worktree works and registers with the shared repo
 *  7c. junction/symlink path — repo reached through a directory link
 *      (Windows junction / POSIX symlink; junctions need no admin) still
 *      creates, lists and removes worktrees
 *  7d. dirty-merge rollback — a conflicted mergeWorktree aborts cleanly:
 *      no MERGE_HEAD, clean status, base content intact
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createWorktree,
  listWorktrees,
  mergeWorktree,
  removeWorktree,
} from "../../src/lib/worktree-isolator.js";
import {
  finishAgentWorktree,
  setupAgentWorktree,
} from "../../src/lib/agent-worktree.js";

let baseDir;

function initRepo(dir) {
  mkdirSync(dir, { recursive: true });
  execSync("git init", { cwd: dir, encoding: "utf-8" });
  execSync('git config user.email "test@test.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  // deterministic content round-trips on Windows: a checkout after
  // merge --abort must give back the exact bytes we assert on
  execSync("git config core.autocrlf false", { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# base\n", "utf-8");
  execSync("git add -A", { cwd: dir });
  execSync('git commit -m "initial"', { cwd: dir });
  return dir;
}

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "cc-wt-edge-"));
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe("7a. nested repo — nearest .git wins, outer checkout untouched", () => {
  it("setupAgentWorktree from an inner repo roots the worktree at the inner repo", () => {
    const outer = initRepo(join(baseDir, "outer"));
    const inner = initRepo(join(outer, "vendor", "inner")); // repo-in-repo

    const info = setupAgentWorktree({ cwd: inner });
    try {
      expect(info.repoRoot).toBe(inner);
      expect(info.path.startsWith(join(inner, ".worktrees"))).toBe(true);
      // the outer repo never grows a .worktrees dir nor sees the branch
      expect(existsSync(join(outer, ".worktrees"))).toBe(false);
      const outerBranches = execSync("git branch --list 'cc-agent-*'", {
        cwd: outer,
        encoding: "utf-8",
      });
      expect(outerBranches.trim()).toBe("");
      // base sha is the INNER repo's HEAD
      const innerHead = execSync("git rev-parse HEAD", {
        cwd: inner,
        encoding: "utf-8",
      }).trim();
      expect(info.baseSha).toBe(innerHead);
    } finally {
      // clean, commit-free worktree → finish removes it (also exercises the
      // remove path on a nested layout)
      const result = finishAgentWorktree(info);
      expect(result.removed).toBe(true);
    }
  });
});

describe("7b. worktree created from inside another worktree", () => {
  it("registers with the shared repo and materializes a usable checkout", () => {
    const repo = initRepo(join(baseDir, "repo"));
    const outerWt = createWorktree(repo, "agent/outer-wt");
    expect(existsSync(join(outerWt.path, "README.md"))).toBe(true);

    // create a second worktree USING the first worktree as the repo dir —
    // git worktree metadata is shared, so this must work and register
    const innerWt = createWorktree(outerWt.path, "agent/inner-wt");
    expect(existsSync(join(innerWt.path, "README.md"))).toBe(true);
    expect(innerWt.path.startsWith(join(outerWt.path, ".worktrees"))).toBe(
      true,
    );

    // both are visible from the main repo's shared worktree list
    const branches = listWorktrees(repo).map((w) => w.branch);
    expect(branches).toContain("agent/outer-wt");
    expect(branches).toContain("agent/inner-wt");

    // teardown INNER first (removing outer first would orphan it), then outer
    removeWorktree(repo, innerWt.path);
    removeWorktree(repo, outerWt.path);
    const after = listWorktrees(repo).map((w) => w.branch);
    expect(after).not.toContain("agent/inner-wt");
    expect(after).not.toContain("agent/outer-wt");
  });
});

describe("7c. repo reached through a directory link (junction on Windows, symlink elsewhere)", () => {
  it("create / list / remove all work through the linked path", () => {
    const real = initRepo(join(baseDir, "real-repo"));
    const link = join(baseDir, "linked-repo");
    // Windows: junction (works without admin / Developer Mode);
    // POSIX: the type argument is ignored → plain directory symlink.
    symlinkSync(real, link, "junction");
    expect(existsSync(join(link, "README.md"))).toBe(true);

    const wt = createWorktree(link, "agent/via-link");
    // the worktree lands under the linked path, which is the same physical
    // directory as the real repo's .worktrees
    expect(existsSync(wt.path)).toBe(true);
    expect(existsSync(join(wt.path, "README.md"))).toBe(true);
    expect(existsSync(join(real, ".worktrees", "agent-via-link"))).toBe(true);

    // the worktree is a functional checkout: commit inside it via the link
    writeFileSync(join(wt.path, "new.txt"), "hello\n", "utf-8");
    execSync("git add -A", { cwd: wt.path });
    execSync('git commit -m "in worktree"', { cwd: wt.path });

    expect(listWorktrees(link).map((w) => w.branch)).toContain(
      "agent/via-link",
    );

    removeWorktree(link, wt.path);
    expect(existsSync(join(real, ".worktrees", "agent-via-link"))).toBe(false);
    // removeWorktree deletes non-main branches by default
    const branches = execSync("git branch --list 'agent/*'", {
      cwd: real,
      encoding: "utf-8",
    });
    expect(branches.trim()).toBe("");
  });
});

describe("7d. dirty-merge rollback — conflicted mergeWorktree leaves the base repo pristine", () => {
  it("aborts the merge: no MERGE_HEAD, clean status, base content intact, worktree branch preserved", () => {
    const repo = initRepo(join(baseDir, "merge-repo"));
    const wt = createWorktree(repo, "agent/conflicting");

    // diverge both sides on the same file
    writeFileSync(join(repo, "README.md"), "# main change\n", "utf-8");
    execSync("git add README.md", { cwd: repo });
    execSync('git commit -m "main change"', { cwd: repo });
    writeFileSync(join(wt.path, "README.md"), "# branch change\n", "utf-8");
    execSync("git add README.md", { cwd: wt.path });
    execSync('git commit -m "branch change"', { cwd: wt.path });

    const result = mergeWorktree(repo, "agent/conflicting", {
      deleteBranch: false,
    });
    expect(result.success).toBe(false);
    expect(result.summary.conflictedFiles).toBe(1);

    // ROLLBACK ASSERTIONS (the actual matrix cell): the failed merge was
    // aborted, leaving the base repo exactly as it was
    expect(() =>
      execSync("git rev-parse --verify MERGE_HEAD", {
        cwd: repo,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    ).toThrow(); // no merge in progress
    const status = execSync("git status --porcelain", {
      cwd: repo,
      encoding: "utf-8",
    });
    // no conflict markers / staged leftovers — the only line allowed is the
    // untracked .worktrees/ container dir itself (expected layout, not merge
    // residue)
    const residue = status
      .split("\n")
      .filter((line) => line.trim() && !line.includes(".worktrees"));
    expect(residue).toEqual([]);
    expect(readFileSync(join(repo, "README.md"), "utf-8")).toBe(
      "# main change\n",
    );
    // the agent's work is untouched and still mergeable later
    expect(listWorktrees(repo).map((w) => w.branch)).toContain(
      "agent/conflicting",
    );
    expect(readFileSync(join(wt.path, "README.md"), "utf-8")).toBe(
      "# branch change\n",
    );
  });
});
