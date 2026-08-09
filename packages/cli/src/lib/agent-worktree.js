/**
 * `cc agent --worktree` — Claude-Code 2.1.171 parity: run the WHOLE agent
 * session in a fresh git worktree so edits land on an isolated branch and the
 * main working tree stays untouched (also sidesteps parallel-session races).
 *
 * Thin, testable glue over the existing worktree-isolator harness:
 *  - setupAgentWorktree(): create `<repo>/.worktrees/cc-agent-<stamp>` on a
 *    new branch, remember the base sha;
 *  - finishAgentWorktree(): if the session produced NOTHING (clean tree, no
 *    new commits) remove the worktree + branch; otherwise keep it and return
 *    a merge hint. Removal failures fail-open to "kept".
 */

import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { createWorktree, removeWorktree } from "./worktree-isolator.js";
import { findProjectRoot } from "./project-instructions.js";
import executionBroker from "./process-execution-broker/index.js";

export const _deps = {
  execFileSync: executionBroker.execFileSync.bind(executionBroker),
  createWorktree,
  removeWorktree,
};

function git(args, cwd, deps, options = {}) {
  const run = deps.execFileSync || _deps.execFileSync;
  return run("git", args, {
    cwd,
    encoding: "utf8",
    stdio: options.stdio || ["ignore", "pipe", "ignore"],
    origin: options.origin || "agent-worktree:query",
    policy: "allow",
    scope: "agent-worktree",
    shell: false,
  });
}

function canonicalPath(value) {
  const absolute = resolve(String(value || ""));
  const real = realpathSync.native
    ? realpathSync.native(absolute)
    : realpathSync(absolute);
  return process.platform === "win32" ? real.toLowerCase() : real;
}

function parseRegisteredWorktrees(text) {
  const entries = [];
  let current = null;
  for (const line of String(text || "").split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (current) entries.push(current);
      current = { path: line.slice("worktree ".length) };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("HEAD ")) current.head = line.slice("HEAD ".length);
    if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length);
    }
  }
  if (current) entries.push(current);
  return entries;
}

/**
 * Verify that persisted worktree metadata still identifies the same linked
 * worktree. Cleanup callers use this as a fail-closed identity check before
 * invoking any removal primitive: a missing/corrupt path must never turn into
 * a recursive delete of the repository checkout.
 *
 * @returns {{valid:boolean, reason:string}}
 */
export function validateAgentWorktree(info, { deps = _deps } = {}) {
  const worktreePath = info?.path || info?.worktreePath;
  if (!worktreePath || !info?.repoRoot || !info?.branch || !info?.baseSha) {
    return { valid: false, reason: "incomplete worktree metadata" };
  }
  if (!/^[0-9a-f]{40,64}$/i.test(String(info.baseSha))) {
    return { valid: false, reason: "invalid worktree base SHA" };
  }
  if (!existsSync(worktreePath) || !existsSync(info.repoRoot)) {
    return { valid: false, reason: "worktree or repository path is missing" };
  }

  try {
    const repo = canonicalPath(info.repoRoot);
    const worktree = canonicalPath(worktreePath);
    if (repo === worktree) {
      return {
        valid: false,
        reason: "refusing to treat the main checkout as an agent worktree",
      };
    }

    const repoTop = canonicalPath(
      git(["rev-parse", "--show-toplevel"], info.repoRoot, deps).trim(),
    );
    const worktreeTop = canonicalPath(
      git(["rev-parse", "--show-toplevel"], worktreePath, deps).trim(),
    );
    if (repoTop !== repo || worktreeTop !== worktree) {
      return { valid: false, reason: "worktree path identity mismatch" };
    }

    const registered = parseRegisteredWorktrees(
      git(["worktree", "list", "--porcelain"], info.repoRoot, deps),
    ).find((entry) => {
      try {
        return canonicalPath(entry.path) === worktree;
      } catch {
        return false;
      }
    });
    if (!registered) {
      return {
        valid: false,
        reason: "path is not a registered worktree of the repository",
      };
    }
    if (registered.branch !== `refs/heads/${info.branch}`) {
      return {
        valid: false,
        reason: "registered worktree branch does not match persisted metadata",
      };
    }
    return { valid: true, reason: "verified" };
  } catch (error) {
    return {
      valid: false,
      reason: `worktree identity could not be verified: ${error.message}`,
    };
  }
}

function removeVerifiedAgentWorktree(info, deps, expectedBranchOid) {
  // Keep the injectable removal seam, but send production and tests through
  // the same pinned cleanup contract. The shared isolator re-validates the
  // managed path immediately before mutation and refuses branch-ref movement
  // after the clean-tree inspection above.
  const remove = deps.removeWorktree || removeWorktree;
  const pathExistedBefore = existsSync(info.path);
  try {
    remove(info.repoRoot, info.path, {
      deleteBranch: true,
      branchName: info.branch,
      expectedBranchOid,
      force: false,
    });
    return null;
  } catch (error) {
    if (pathExistedBefore && !existsSync(info.path)) {
      // The worktree itself is already gone. Preserve an honest warning rather
      // than claiming the whole cleanup failed and that the path was kept.
      return `branch cleanup failed: ${error.message}`;
    }
    throw error;
  }
}

/**
 * @returns {{ path, branch, repoRoot, baseSha }}
 */
export function setupAgentWorktree({
  cwd = process.cwd(),
  now = new Date(),
  requireCleanSource = false,
  deps = _deps,
} = {}) {
  const repoRoot = findProjectRoot(cwd);
  if (!repoRoot) {
    throw new Error("--worktree requires running inside a git repository");
  }
  if (requireCleanSource) {
    const status = git(
      [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--ignore-submodules=none",
        "--",
        ".",
        ":(exclude).worktrees",
      ],
      repoRoot,
      deps,
    ).trim();
    if (status) {
      throw new Error(
        "Background worktree isolation requires a clean source checkout; commit/stash the current changes or pass --no-worktree explicitly.",
      );
    }
  }
  const stamp = now.toISOString().slice(0, 19).replace(/[-:T]/g, "");
  const suffix = Math.random().toString(36).slice(2, 6);
  const branch = `cc-agent-${stamp}-${suffix}`;
  const info = (deps.createWorktree || createWorktree)(repoRoot, branch);
  try {
    const baseSha = git(["rev-parse", "HEAD"], info.path, deps).trim();
    return { ...info, repoRoot, baseSha };
  } catch (error) {
    // createWorktree is transactional internally, but ownership has already
    // transferred to this wrapper when the follow-up base-SHA query runs. Roll
    // that partial setup back here so callers never receive `_worktree = null`
    // while a branch and linked checkout have already been created.
    try {
      (deps.removeWorktree || removeWorktree)(repoRoot, info.path, {
        deleteBranch: true,
        branchName: branch,
        force: false,
      });
    } catch (cleanupError) {
      error.retainedWorktree = { ...info, repoRoot, branch };
      error.worktreeCleanupError = cleanupError;
    }
    throw error;
  }
}

/**
 * @returns {{ removed:boolean, kept:boolean, reason:string, mergeHint?:string }}
 */
export function finishAgentWorktree(info, { deps = _deps } = {}) {
  if (!info) return { removed: false, kept: false, reason: "no worktree" };

  // Production cleanup validates the persisted path against git's own
  // worktree registry. Custom dependency bundles are test seams and retain the
  // historical pure mocked behavior unless they provide validateWorktree.
  const validation =
    typeof deps.validateWorktree === "function"
      ? deps.validateWorktree(info)
      : deps === _deps
        ? validateAgentWorktree(info, { deps })
        : { valid: true, reason: "injected validation seam" };
  if (!validation?.valid) {
    return {
      removed: false,
      kept: true,
      reason: `unverifiable worktree: ${validation?.reason || "unknown reason"}`,
    };
  }

  let dirty = true;
  let headSha = null;
  let readable = false;
  try {
    dirty = git(["status", "--porcelain"], info.path, deps).trim().length > 0;
    headSha = git(["rev-parse", "HEAD"], info.path, deps).trim();
    readable = true;
  } catch {
    /* unreadable → keep, never destroy work we cannot verify */
  }

  if (!readable) {
    return {
      removed: false,
      kept: true,
      reason: "unverifiable worktree: git state could not be read",
    };
  }

  const hasCommits = headSha !== null && headSha !== info.baseSha;
  if (!dirty && !hasCommits) {
    try {
      const warning = removeVerifiedAgentWorktree(info, deps, headSha);
      return {
        removed: true,
        kept: false,
        reason: warning ? `no changes; ${warning}` : "no changes",
      };
    } catch (err) {
      return {
        removed: false,
        kept: true,
        reason: `cleanup failed: ${err.message}`,
      };
    }
  }
  return {
    removed: false,
    kept: true,
    reason: dirty ? "uncommitted changes" : "new commits",
    mergeHint: `git merge ${info.branch}   # or: cd ${info.path}`,
  };
}
