import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

// We use real git operations for these tests (no mocks).
// Each test gets its own temp git repo.

const baseDir = join(tmpdir(), `cc-wt-test-${Date.now()}`);

function createTestRepo() {
  const dir = join(baseDir, `repo-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  execSync("git init", { cwd: dir, encoding: "utf-8" });
  execSync('git config user.email "test@test.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  // Initial commit (git worktree requires at least one commit)
  writeFileSync(join(dir, "README.md"), "# Test Repo\n", "utf-8");
  execSync("git add -A", { cwd: dir });
  execSync('git commit -m "initial"', { cwd: dir });
  return dir;
}

// Dynamic import after setup
const {
  createWorktree,
  removeWorktree,
  listWorktrees,
  pruneWorktrees,
  isolateTask,
  cleanupAgentWorktrees,
  mergeWorktree,
} = await import("../../src/lib/worktree-isolator.js");

describe("worktree-isolator", () => {
  let repoDir;

  beforeEach(() => {
    repoDir = createTestRepo();
  });

  afterEach(() => {
    if (existsSync(baseDir)) {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  // ── createWorktree ────────────────────────────────────────────────

  describe("createWorktree", () => {
    it("creates a worktree with new branch", () => {
      const { path, branch } = createWorktree(repoDir, "test-branch");
      expect(existsSync(path)).toBe(true);
      expect(branch).toBe("test-branch");

      // Verify the worktree is a git checkout
      const head = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: path,
        encoding: "utf-8",
      }).trim();
      expect(head).toBe("test-branch");
    });

    it("throws for non-git directory", () => {
      const nonGitDir = join(baseDir, "not-a-repo");
      mkdirSync(nonGitDir, { recursive: true });
      expect(() => createWorktree(nonGitDir, "branch")).toThrow(
        /Not a git repository/,
      );
    });

    it("throws for duplicate worktree", () => {
      createWorktree(repoDir, "dup-branch");
      expect(() => createWorktree(repoDir, "dup-branch")).toThrow(
        /already exists/,
      );
    });
  });

  // ── removeWorktree ────────────────────────────────────────────────

  describe("removeWorktree", () => {
    it("removes a worktree and deletes its branch", () => {
      const { path } = createWorktree(repoDir, "remove-me");
      removeWorktree(repoDir, path, { deleteBranch: true });
      expect(existsSync(path)).toBe(false);

      // Branch should be deleted too
      const branches = execSync("git branch", {
        cwd: repoDir,
        encoding: "utf-8",
      });
      expect(branches).not.toContain("remove-me");
    });

    it("keeps branch when deleteBranch=false", () => {
      const { path } = createWorktree(repoDir, "keep-branch");
      removeWorktree(repoDir, path, { deleteBranch: false });
      expect(existsSync(path)).toBe(false);

      const branches = execSync("git branch", {
        cwd: repoDir,
        encoding: "utf-8",
      });
      expect(branches).toContain("keep-branch");
    });
  });

  // ── listWorktrees ─────────────────────────────────────────────────

  describe("listWorktrees", () => {
    it("lists the main worktree", () => {
      const worktrees = listWorktrees(repoDir);
      expect(worktrees.length).toBeGreaterThanOrEqual(1);
    });

    it("includes created worktrees", () => {
      createWorktree(repoDir, "list-test");
      const worktrees = listWorktrees(repoDir);
      expect(worktrees.length).toBeGreaterThanOrEqual(2);
      expect(worktrees.some((w) => w.branch === "list-test")).toBe(true);
    });

    it("returns empty for non-git directory", () => {
      expect(listWorktrees("/tmp/nonexistent")).toEqual([]);
    });
  });

  // ── pruneWorktrees ────────────────────────────────────────────────

  describe("pruneWorktrees", () => {
    it("prunes stale worktrees", () => {
      const { path } = createWorktree(repoDir, "stale-branch");
      // Manually delete the worktree directory (simulating stale)
      rmSync(path, { recursive: true, force: true });
      const pruned = pruneWorktrees(repoDir);
      expect(pruned).toBeGreaterThanOrEqual(1);
    });
  });

  // ── isolateTask ───────────────────────────────────────────────────

  describe("isolateTask", () => {
    it("runs function in isolated worktree", async () => {
      const { result, branch } = await isolateTask(
        repoDir,
        "test-task-1",
        async (wtPath) => {
          // Verify we're in the worktree
          expect(existsSync(wtPath)).toBe(true);
          const head = execSync("git rev-parse --abbrev-ref HEAD", {
            cwd: wtPath,
            encoding: "utf-8",
          }).trim();
          expect(head).toBe("agent/test-task-1");
          return "task-done";
        },
      );
      expect(result).toBe("task-done");
      expect(branch).toBe("agent/test-task-1");
    });

    it("cleans up worktree even if function throws", async () => {
      let capturedPath;
      await expect(
        isolateTask(repoDir, "fail-task", async (wtPath) => {
          capturedPath = wtPath;
          throw new Error("task failed");
        }),
      ).rejects.toThrow("task failed");

      // Worktree should be cleaned up
      expect(existsSync(capturedPath)).toBe(false);
    });
  });

  // ── cleanupAgentWorktrees ─────────────────────────────────────────

  describe("cleanupAgentWorktrees", () => {
    it("cleans up all agent/* worktrees", () => {
      createWorktree(repoDir, "agent/task-a");
      createWorktree(repoDir, "agent/task-b");
      createWorktree(repoDir, "keep-this");

      const cleaned = cleanupAgentWorktrees(repoDir);
      expect(cleaned).toBe(2);

      const worktrees = listWorktrees(repoDir);
      expect(worktrees.some((w) => w.branch === "keep-this")).toBe(true);
      expect(
        worktrees.some((w) => w.branch && w.branch.startsWith("agent/")),
      ).toBe(false);
    });
  });

  describe("mergeWorktree", () => {
    it("returns file-level conflict summaries and suggestions", () => {
      const worktree = createWorktree(repoDir, "agent/conflict-branch");

      writeFileSync(join(repoDir, "README.md"), "# main change\n", "utf-8");
      execSync("git add README.md", { cwd: repoDir });
      execSync('git commit -m "main change"', { cwd: repoDir });

      writeFileSync(join(worktree.path, "README.md"), "# branch change\n", "utf-8");
      execSync("git add README.md", { cwd: worktree.path });
      execSync('git commit -m "branch change"', { cwd: worktree.path });

      const result = mergeWorktree(repoDir, "agent/conflict-branch", {
        deleteBranch: false,
      });

      expect(result.success).toBe(false);
      expect(result.summary.conflictedFiles).toBe(1);
      expect(result.conflicts[0].path).toBe("README.md");
      expect(result.conflicts[0].suggestion).toContain("README.md");
      expect(result.suggestions.length).toBeGreaterThan(0);
    });
  });
});
