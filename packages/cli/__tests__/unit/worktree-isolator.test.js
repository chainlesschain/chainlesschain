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
  assessAgentWorktreeCleanup,
  diffWorktree,
  previewWorktreeMerge,
  applyWorktreeAutomationCandidate,
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

    it("KEEPS an agent worktree with uncommitted changes (P1-5 guard)", () => {
      const wt = createWorktree(repoDir, "agent/dirty");
      writeFileSync(join(wt.path, "scratch.txt"), "wip\n", "utf-8");

      const cleaned = cleanupAgentWorktrees(repoDir);
      expect(cleaned).toBe(0);
      expect(
        listWorktrees(repoDir).some((w) => w.branch === "agent/dirty"),
      ).toBe(true);
    });

    it("KEEPS an agent worktree with an unpushed local commit", () => {
      const wt = createWorktree(repoDir, "agent/committed");
      writeFileSync(join(wt.path, "f.txt"), "content\n", "utf-8");
      execSync("git add -A", { cwd: wt.path });
      execSync('git commit -m "agent work"', { cwd: wt.path });

      const cleaned = cleanupAgentWorktrees(repoDir);
      expect(cleaned).toBe(0);
      expect(
        listWorktrees(repoDir).some((w) => w.branch === "agent/committed"),
      ).toBe(true);
    });

    it("force:true wipes even unsafe worktrees (legacy behavior)", () => {
      const wt = createWorktree(repoDir, "agent/dirty2");
      writeFileSync(join(wt.path, "scratch.txt"), "wip\n", "utf-8");

      const cleaned = cleanupAgentWorktrees(repoDir, { force: true });
      expect(cleaned).toBe(1);
      expect(
        listWorktrees(repoDir).some((w) => w.branch === "agent/dirty2"),
      ).toBe(false);
    });
  });

  describe("assessAgentWorktreeCleanup", () => {
    it("reports removable vs kept with blockers, deleting nothing", () => {
      createWorktree(repoDir, "agent/clean");
      const dirty = createWorktree(repoDir, "agent/dirty3");
      writeFileSync(join(dirty.path, "scratch.txt"), "wip\n", "utf-8");

      const report = assessAgentWorktreeCleanup(repoDir);
      expect(report.removable).toBe(1);
      expect(report.kept).toBe(1);
      const dirtyAssessment = report.assessments.find(
        (a) => a.branch === "agent/dirty3",
      );
      expect(dirtyAssessment.safeToRemove).toBe(false);
      expect(dirtyAssessment.blockers).toContain("untracked-files");

      // read-only: both worktrees still present
      expect(
        listWorktrees(repoDir).filter((w) => w.branch?.startsWith("agent/"))
          .length,
      ).toBe(2);
    });
  });

  describe("mergeWorktree", () => {
    it("returns file-level conflict summaries and suggestions", () => {
      const worktree = createWorktree(repoDir, "agent/conflict-branch");

      writeFileSync(join(repoDir, "README.md"), "# main change\n", "utf-8");
      execSync("git add README.md", { cwd: repoDir });
      execSync('git commit -m "main change"', { cwd: repoDir });

      writeFileSync(
        join(worktree.path, "README.md"),
        "# branch change\n",
        "utf-8",
      );
      execSync("git add README.md", { cwd: worktree.path });
      execSync('git commit -m "branch change"', { cwd: worktree.path });

      const result = mergeWorktree(repoDir, "agent/conflict-branch", {
        deleteBranch: false,
      });

      expect(result.success).toBe(false);
      expect(result.summary.conflictedFiles).toBe(1);
      expect(result.conflicts[0].path).toBe("README.md");
      expect(result.conflicts[0].suggestion).toContain("README.md");
      expect(result.conflicts[0].automationCandidates.length).toBeGreaterThan(
        0,
      );
      expect(result.conflicts[0].diffPreview.route.type).toBe("worktree-diff");
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.previewEntrypoints[0].filePath).toBe("README.md");
      expect(result.conflicts[0].automationCandidates[0]).toHaveProperty(
        "executable",
      );
    });
  });

  describe("previewWorktreeMerge", () => {
    it("returns conflict summaries without mutating the isolated worktree branch", () => {
      const worktree = createWorktree(repoDir, "agent/preview-branch");

      writeFileSync(join(repoDir, "README.md"), "# main change\n", "utf-8");
      execSync("git add README.md", { cwd: repoDir });
      execSync('git commit -m "main change"', { cwd: repoDir });

      writeFileSync(
        join(worktree.path, "README.md"),
        "# branch change\n",
        "utf-8",
      );
      execSync("git add README.md", { cwd: worktree.path });
      execSync('git commit -m "branch change"', { cwd: worktree.path });

      const result = previewWorktreeMerge(repoDir, "agent/preview-branch", {
        baseBranch: "HEAD",
      });

      expect(result.success).toBe(false);
      expect(result.previewOnly).toBe(true);
      expect(result.summary.conflictedFiles).toBe(1);
      expect(result.conflicts[0].path).toBe("README.md");
      expect(result.previewEntrypoints[0].filePath).toBe("README.md");
      expect(() =>
        execSync("git rev-parse --verify MERGE_HEAD", {
          cwd: worktree.path,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        }),
      ).toThrow();
    });
  });

  describe("applyWorktreeAutomationCandidate", () => {
    it("applies a safe conflict resolution inside the isolated worktree branch", () => {
      const worktree = createWorktree(repoDir, "agent/conflict-branch");

      writeFileSync(join(repoDir, "README.md"), "# main change\n", "utf-8");
      execSync("git add README.md", { cwd: repoDir });
      execSync('git commit -m "main change"', { cwd: repoDir });

      writeFileSync(
        join(worktree.path, "README.md"),
        "# branch change\n",
        "utf-8",
      );
      execSync("git add README.md", { cwd: worktree.path });
      execSync('git commit -m "branch change"', { cwd: worktree.path });

      const result = applyWorktreeAutomationCandidate(
        repoDir,
        "agent/conflict-branch",
        {
          baseBranch: "HEAD",
          filePath: "README.md",
          candidateId: "accept-current",
          conflictType: "both_modified",
        },
      );

      expect(result.success).toBe(true);
      expect(result.filePath).toBe("README.md");
      expect(result.summary.filesChanged).toBe(0);
      expect(
        execSync("git show HEAD:README.md", {
          cwd: worktree.path,
          encoding: "utf-8",
        }),
      ).toContain("# main change");
    });

    // Regression: previewWorktreeMerge merges the base branch INTO the agent
    // worktree, so ours=agent and theirs=base — the REVERSE of the normal merge
    // direction the conflict-type labels were written for. For a delete/modify
    // conflict the surviving file lives on whichever side did NOT delete it, so
    // the "keep the file" candidate must checkout that side. Before the fix the
    // conflict type was mis-derived, so the keep-file candidate ran `git checkout`
    // against the side that DELETED the file ("path does not have their/our
    // version") and threw — leaving no automated way to preserve the file.
    it("keeps the agent's modified file when the base branch deleted it (UD)", () => {
      const worktree = createWorktree(repoDir, "agent/mod-vs-del");
      writeFileSync(
        join(worktree.path, "README.md"),
        "# agent modified\n",
        "utf-8",
      );
      execSync("git add README.md", { cwd: worktree.path });
      execSync('git commit -m "agent modifies"', { cwd: worktree.path });
      execSync("git rm README.md", { cwd: repoDir });
      execSync('git commit -m "base deletes"', { cwd: repoDir });

      const preview = previewWorktreeMerge(repoDir, "agent/mod-vs-del", {
        baseBranch: "HEAD",
      });
      const conflict = preview.conflicts.find((c) => c.path === "README.md");
      expect(conflict).toBeTruthy();
      const keepFile = conflict.automationCandidates.find(
        (c) =>
          c.executable === true &&
          c.id !== "confirm-delete" &&
          c.id !== "accept-delete",
      );
      expect(keepFile).toBeTruthy();

      const result = applyWorktreeAutomationCandidate(
        repoDir,
        "agent/mod-vs-del",
        {
          baseBranch: "HEAD",
          filePath: "README.md",
          candidateId: keepFile.id,
          conflictType: conflict.type,
        },
      );
      expect(result.success).toBe(true);
      expect(
        execSync("git show HEAD:README.md", {
          cwd: worktree.path,
          encoding: "utf-8",
        }),
      ).toContain("# agent modified");
    });

    it("keeps the base's modified file when the agent branch deleted it (DU)", () => {
      const worktree = createWorktree(repoDir, "agent/del-vs-mod");
      execSync("git rm README.md", { cwd: worktree.path });
      execSync('git commit -m "agent deletes"', { cwd: worktree.path });
      writeFileSync(join(repoDir, "README.md"), "# base modified\n", "utf-8");
      execSync("git add README.md", { cwd: repoDir });
      execSync('git commit -m "base modifies"', { cwd: repoDir });

      const preview = previewWorktreeMerge(repoDir, "agent/del-vs-mod", {
        baseBranch: "HEAD",
      });
      const conflict = preview.conflicts.find((c) => c.path === "README.md");
      expect(conflict).toBeTruthy();
      const keepFile = conflict.automationCandidates.find(
        (c) =>
          c.executable === true &&
          c.id !== "confirm-delete" &&
          c.id !== "accept-delete",
      );
      expect(keepFile).toBeTruthy();

      const result = applyWorktreeAutomationCandidate(
        repoDir,
        "agent/del-vs-mod",
        {
          baseBranch: "HEAD",
          filePath: "README.md",
          candidateId: keepFile.id,
          conflictType: conflict.type,
        },
      );
      expect(result.success).toBe(true);
      expect(
        execSync("git show HEAD:README.md", {
          cwd: worktree.path,
          encoding: "utf-8",
        }),
      ).toContain("# base modified");
    });
  });

  describe("diffWorktree", () => {
    it("supports file-scoped diff previews", () => {
      const worktree = createWorktree(repoDir, "agent/diff-branch");

      writeFileSync(
        join(worktree.path, "README.md"),
        "# changed readme\n",
        "utf-8",
      );
      writeFileSync(join(worktree.path, "notes.txt"), "new note\n", "utf-8");
      execSync("git add README.md notes.txt", { cwd: worktree.path });
      execSync('git commit -m "branch changes"', { cwd: worktree.path });

      const result = diffWorktree(repoDir, "agent/diff-branch", {
        filePath: "README.md",
      });

      expect(result.filePath).toBe("README.md");
      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe("README.md");
      expect(result.diff).toContain("README.md");
      expect(result.diff).not.toContain("notes.txt");
    });
  });

  describe("ref-injection guard (shell-safety)", () => {
    it("rejects a branch name with shell metacharacters before any git call", () => {
      expect(() => createWorktree(repoDir, "x$(touch HACKED)")).toThrow(
        /Unsafe/,
      );
      expect(() => diffWorktree(repoDir, "a;b")).toThrow(/Unsafe/);
      expect(() => mergeWorktree(repoDir, "a`id`")).toThrow(/Unsafe/);
      // the injected side-effect must NOT have executed
      expect(existsSync(join(repoDir, "HACKED"))).toBe(false);
    });

    it("rejects an unsafe baseBranch option", () => {
      expect(() =>
        diffWorktree(repoDir, "main", { baseBranch: "a$(whoami)" }),
      ).toThrow(/Unsafe/);
    });

    it("rejects a filePath with shell metacharacters", () => {
      createWorktree(repoDir, "agent/fp-branch");
      expect(() =>
        diffWorktree(repoDir, "agent/fp-branch", {
          filePath: 'README.md"; touch INJECTED; echo "',
        }),
      ).toThrow(/Unsafe/);
      expect(existsSync(join(repoDir, "INJECTED"))).toBe(false);
    });

    it("does not execute shell metacharacters in an automation-candidate commit message", () => {
      // Set up a real both_modified conflict so the candidate commits a message.
      const worktree = createWorktree(repoDir, "agent/auto-msg-branch");

      writeFileSync(join(repoDir, "README.md"), "# main side\n", "utf-8");
      execSync("git add README.md", { cwd: repoDir });
      execSync('git commit -m "main side"', { cwd: repoDir });

      writeFileSync(
        join(worktree.path, "README.md"),
        "# branch side\n",
        "utf-8",
      );
      execSync("git add README.md", { cwd: worktree.path });
      execSync('git commit -m "branch side"', { cwd: worktree.path });

      const sentinel = join(repoDir, "AUTO_PWNED");
      const result = applyWorktreeAutomationCandidate(
        repoDir,
        "agent/auto-msg-branch",
        {
          baseBranch: "HEAD",
          filePath: "README.md",
          candidateId: "accept-current",
          conflictType: "both_modified",
          // Free-text caller message with command substitution. argv makes it inert.
          commitMessage: `$(touch "${sentinel}")\`touch "${sentinel}"\``,
        },
      );

      expect(result.success).toBe(true);
      expect(existsSync(sentinel)).toBe(false); // substitution did NOT run
      const lastMsg = execSync("git log -1 --pretty=%B", {
        cwd: worktree.path,
        encoding: "utf-8",
      }).trim();
      expect(lastMsg).toContain("$(touch"); // stored literally
    });

    it("does not execute shell metacharacters in a merge commit message", () => {
      const worktree = createWorktree(repoDir, "agent/msg-branch");
      // Non-conflicting change so the squash merge applies cleanly.
      writeFileSync(
        join(worktree.path, "feature.txt"),
        "new feature\n",
        "utf-8",
      );
      execSync("git add -A", { cwd: worktree.path });
      execSync('git commit -m "add feature"', { cwd: worktree.path });

      const sentinel = join(repoDir, "PWNED");
      // The old `-m "${msg.replace(/"/g,'\\"')}"` left $()/backticks live; argv
      // makes the message inert.
      mergeWorktree(repoDir, "agent/msg-branch", {
        strategy: "squash",
        message: `$(touch "${sentinel}")\`touch "${sentinel}"\``,
        deleteBranch: false,
      });

      expect(existsSync(sentinel)).toBe(false); // command substitution did NOT run
      const lastMsg = execSync("git log -1 --pretty=%B", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();
      expect(lastMsg).toContain("$(touch"); // stored literally
    });
  });
});
