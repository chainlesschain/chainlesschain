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

// ── Worktree Merge Assistant ────────────────────────────────────────────

/**
 * Get a diff preview between agent branch and base branch.
 * Shows what would change if the agent's work were merged.
 *
 * @param {string} repoDir — Root of the git repository
 * @param {string} branchName — Agent branch (e.g. "agent/task-123")
 * @param {object} [options]
 * @param {string} [options.baseBranch="HEAD"] — Branch to compare against
 * @param {boolean} [options.stat=true] — Include diffstat summary
 * @returns {{ files: Array<{path, insertions, deletions, status}>, summary: {filesChanged, insertions, deletions}, diff: string }}
 */
export function diffWorktree(repoDir, branchName, options = {}) {
  const base = options.baseBranch || "HEAD";

  // Get diff stat
  const statOutput = gitExec(
    `diff ${base}...${branchName} --stat --numstat`,
    repoDir,
  );

  const files = [];
  for (const line of statOutput.split("\n")) {
    const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (match) {
      files.push({
        path: match[3].trim(),
        insertions: match[1] === "-" ? 0 : parseInt(match[1], 10),
        deletions: match[2] === "-" ? 0 : parseInt(match[2], 10),
        status: _fileStatus(repoDir, base, branchName, match[3].trim()),
      });
    }
  }

  const totalInsertions = files.reduce((s, f) => s + f.insertions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

  // Get full diff (limited to reasonable size)
  let diff = "";
  try {
    diff = gitExec(`diff ${base}...${branchName}`, repoDir);
    if (diff.length > 50000) {
      diff = diff.slice(0, 50000) + "\n... [diff truncated at 50KB]";
    }
  } catch (_e) {
    diff = "(unable to generate diff)";
  }

  return {
    files,
    summary: {
      filesChanged: files.length,
      insertions: totalInsertions,
      deletions: totalDeletions,
    },
    diff,
  };
}

/**
 * Merge an agent branch into the current branch (one-click merge).
 *
 * @param {string} repoDir — Root of the git repository
 * @param {string} branchName — Agent branch to merge
 * @param {object} [options]
 * @param {string} [options.strategy="merge"] — "merge" or "squash"
 * @param {string} [options.message] — Custom commit message (for squash)
 * @param {boolean} [options.deleteBranch=true] — Delete branch after merge
 * @returns {{ success: boolean, strategy: string, message: string, conflicts?: string[] }}
 */
export function mergeWorktree(repoDir, branchName, options = {}) {
  const strategy = options.strategy || "merge";
  const deleteBranch = options.deleteBranch !== false;

  try {
    if (strategy === "squash") {
      gitExec(`merge --squash ${branchName}`, repoDir);
      const msg =
        options.message ||
        `feat: merge agent work from ${branchName} (squashed)`;
      gitExec(`commit -m "${msg.replace(/"/g, '\\"')}"`, repoDir);
    } else {
      const msg =
        options.message || `Merge branch '${branchName}' (agent task)`;
      gitExec(
        `merge ${branchName} --no-edit -m "${msg.replace(/"/g, '\\"')}"`,
        repoDir,
      );
    }

    // Delete branch after successful merge
    if (deleteBranch) {
      try {
        gitExec(`branch -D "${branchName}"`, repoDir);
      } catch (_e) {
        // Non-critical
      }
    }

    return {
      success: true,
      strategy,
      message: `Successfully merged ${branchName} via ${strategy}`,
    };
  } catch (err) {
    // Check for merge conflicts
    const errMsg = err.message || String(err);
    if (errMsg.includes("CONFLICT") || errMsg.includes("conflict")) {
      // Abort the failed merge
      try {
        gitExec("merge --abort", repoDir);
      } catch (_e) {
        // Best effort
      }

      // List conflicting files
      const conflicts = [];
      const conflictMatch = errMsg.match(/CONFLICT[^:]*:\s*([^\n]+)/g);
      if (conflictMatch) {
        for (const c of conflictMatch) {
          conflicts.push(c.replace(/^CONFLICT[^:]*:\s*/, "").trim());
        }
      }

      return {
        success: false,
        strategy,
        message: `Merge conflicts detected — manual resolution required`,
        conflicts,
      };
    }

    return {
      success: false,
      strategy,
      message: `Merge failed: ${errMsg}`,
    };
  }
}

/**
 * Get the commit log for an agent branch (what the agent did).
 * @param {string} repoDir
 * @param {string} branchName
 * @param {string} [baseBranch="HEAD"]
 * @returns {Array<{hash, message, date}>}
 */
export function worktreeLog(repoDir, branchName, baseBranch = "HEAD") {
  try {
    const output = gitExec(
      `log ${baseBranch}..${branchName} --pretty=format:"%h|%s|%ci"`,
      repoDir,
    );
    if (!output.trim()) return [];

    return output
      .trim()
      .split("\n")
      .map((line) => {
        const parts = line.replace(/^"|"$/g, "").split("|");
        return {
          hash: parts[0],
          message: parts[1] || "",
          date: parts[2] || "",
        };
      });
  } catch (_e) {
    return [];
  }
}

// ── Internal helpers ────────────────────────────────────────────────────

function _fileStatus(repoDir, base, branch, filePath) {
  try {
    const output = gitExec(
      `diff ${base}...${branch} --name-status -- "${filePath}"`,
      repoDir,
    );
    const status = output.trim().charAt(0);
    switch (status) {
      case "A":
        return "added";
      case "D":
        return "deleted";
      case "M":
        return "modified";
      case "R":
        return "renamed";
      default:
        return "modified";
    }
  } catch (_e) {
    return "modified";
  }
}

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
