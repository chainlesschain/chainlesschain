/**
 * Worktree Isolator — git worktree-based task isolation.
 *
 * Creates temporary git worktrees for parallel agent tasks,
 * ensuring file operations don't interfere with the main working tree.
 *
 * Feature-flag gated: WORKTREE_ISOLATION
 */

import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { isGitRepo, gitExec } from "./git-integration.js";

const WORKTREE_DIR = ".worktrees";

// ── Low-level worktree operations ───────────────────────────────────────

/**
 * Create a new git worktree with a new branch.
 * @param {string} repoDir — Root of the git repository
 * @param {string} branchName — Branch name (e.g. "agent/task-123")
 * @param {string} [baseBranch] — Base branch (default: HEAD)
 * @returns {{ path: string, branch: string }}
 */
export function createWorktree(repoDir, branchName, baseBranch) {
  if (!isGitRepo(repoDir)) {
    throw new Error("Not a git repository");
  }

  const worktreePath = resolve(
    repoDir,
    WORKTREE_DIR,
    branchName.replace(/\//g, "-"),
  );

  if (existsSync(worktreePath)) {
    throw new Error(`Worktree already exists: ${worktreePath}`);
  }

  const base = baseBranch || "HEAD";
  gitExec(`worktree add "${worktreePath}" -b "${branchName}" ${base}`, repoDir);

  return { path: worktreePath, branch: branchName };
}

/**
 * Remove a git worktree and its branch.
 * @param {string} repoDir
 * @param {string} worktreePath — Absolute path to the worktree
 * @param {object} [options]
 * @param {boolean} [options.deleteBranch=true] — Also delete the branch
 */
export function removeWorktree(repoDir, worktreePath, options = {}) {
  const deleteBranch = options.deleteBranch !== false;

  // Get branch name before removal
  let branch = null;
  if (deleteBranch) {
    try {
      branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: worktreePath,
        encoding: "utf-8",
      }).trim();
    } catch (_e) {
      // Can't determine branch — skip branch deletion
    }
  }

  try {
    gitExec(`worktree remove "${worktreePath}" --force`, repoDir);
  } catch (_e) {
    // If git worktree remove fails, try manual cleanup
    if (existsSync(worktreePath)) {
      rmSync(worktreePath, { recursive: true, force: true });
    }
    gitExec("worktree prune", repoDir);
  }

  // Delete the branch
  if (
    deleteBranch &&
    branch &&
    branch !== "HEAD" &&
    !branch.startsWith("main") &&
    !branch.startsWith("master")
  ) {
    try {
      gitExec(`branch -D "${branch}"`, repoDir);
    } catch (_e) {
      // Branch might already be deleted
    }
  }
}

/**
 * List all worktrees.
 * @param {string} repoDir
 * @returns {Array<{path: string, branch: string, head: string}>}
 */
export function listWorktrees(repoDir) {
  if (!isGitRepo(repoDir)) return [];

  try {
    const output = gitExec("worktree list --porcelain", repoDir);
    const worktrees = [];
    let current = {};

    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        if (current.path) worktrees.push(current);
        current = { path: line.slice(9) };
      } else if (line.startsWith("HEAD ")) {
        current.head = line.slice(5);
      } else if (line.startsWith("branch ")) {
        current.branch = line.slice(7).replace("refs/heads/", "");
      } else if (line === "bare") {
        current.bare = true;
      }
    }
    if (current.path) worktrees.push(current);

    return worktrees;
  } catch (_e) {
    return [];
  }
}

/**
 * Prune stale worktrees (where directory no longer exists).
 * @param {string} repoDir
 * @returns {number} Number pruned
 */
export function pruneWorktrees(repoDir) {
  if (!isGitRepo(repoDir)) return 0;

  const before = listWorktrees(repoDir).length;
  gitExec("worktree prune", repoDir);
  const after = listWorktrees(repoDir).length;
  return before - after;
}

// ── High-level isolation API ────────────────────────────────────────────

/**
 * Run a function in an isolated git worktree.
 *
 * Creates a worktree → executes fn(worktreePath) → cleans up.
 * If fn throws, the worktree is still cleaned up.
 *
 * @param {string} repoDir — Root of the git repository
 * @param {string} taskId — Used to generate branch name: agent/{taskId}
 * @param {Function} fn — async (worktreePath) => result
 * @returns {Promise<{result, branch, merged}>}
 */
export async function isolateTask(repoDir, taskId, fn) {
  const branchName = `agent/${taskId}`;
  const { path: worktreePath } = createWorktree(repoDir, branchName);

  try {
    const result = await fn(worktreePath);

    // Check if the worktree has any changes
    const hasChanges = _hasUncommittedChanges(worktreePath);

    return {
      result,
      branch: branchName,
      worktreePath,
      hasChanges,
    };
  } finally {
    // Always clean up the worktree (but keep branch if there are commits)
    try {
      const hasCommits = _hasBranchCommits(repoDir, branchName);
      removeWorktree(repoDir, worktreePath, {
        deleteBranch: !hasCommits,
      });
    } catch (_e) {
      // Best-effort cleanup
    }
  }
}

/**
 * Clean up all agent worktrees (e.g. after crash recovery).
 * @param {string} repoDir
 * @returns {number} Number of worktrees cleaned
 */
export function cleanupAgentWorktrees(repoDir) {
  const worktrees = listWorktrees(repoDir);
  let cleaned = 0;

  for (const wt of worktrees) {
    if (wt.branch && wt.branch.startsWith("agent/")) {
      try {
        removeWorktree(repoDir, wt.path, { deleteBranch: true });
        cleaned++;
      } catch (_e) {
        // Skip if can't clean
      }
    }
  }

  pruneWorktrees(repoDir);
  return cleaned;
}

// ── Internal helpers ────────────────────────────────────────────────────

function _hasUncommittedChanges(worktreePath) {
  try {
    const output = execSync("git status --porcelain", {
      cwd: worktreePath,
      encoding: "utf-8",
    });
    return output.trim().length > 0;
  } catch (_e) {
    return false;
  }
}

function _hasBranchCommits(repoDir, branchName) {
  try {
    // Check if branch has commits not in HEAD
    const output = gitExec(`log HEAD..${branchName} --oneline`, repoDir);
    return output.trim().length > 0;
  } catch (_e) {
    return false;
  }
}
