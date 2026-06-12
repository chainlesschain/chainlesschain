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

import { execSync } from "child_process";
import { createWorktree, removeWorktree } from "./worktree-isolator.js";
import { findProjectRoot } from "./project-instructions.js";

export const _deps = { execSync, createWorktree, removeWorktree };

function git(cmd, cwd, deps) {
  return (deps.execSync || execSync)(`git ${cmd}`, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/**
 * @returns {{ path, branch, repoRoot, baseSha }}
 */
export function setupAgentWorktree({
  cwd = process.cwd(),
  now = new Date(),
  deps = _deps,
} = {}) {
  const repoRoot = findProjectRoot(cwd);
  if (!repoRoot) {
    throw new Error("--worktree requires running inside a git repository");
  }
  const stamp = now.toISOString().slice(0, 19).replace(/[-:T]/g, "");
  const suffix = Math.random().toString(36).slice(2, 6);
  const branch = `cc-agent-${stamp}-${suffix}`;
  const info = (deps.createWorktree || createWorktree)(repoRoot, branch);
  const baseSha = git("rev-parse HEAD", info.path, deps).trim();
  return { ...info, repoRoot, baseSha };
}

/**
 * @returns {{ removed:boolean, kept:boolean, reason:string, mergeHint?:string }}
 */
export function finishAgentWorktree(info, { deps = _deps } = {}) {
  if (!info) return { removed: false, kept: false, reason: "no worktree" };

  let dirty = true;
  let headSha = null;
  try {
    dirty = git("status --porcelain", info.path, deps).trim().length > 0;
    headSha = git("rev-parse HEAD", info.path, deps).trim();
  } catch {
    /* unreadable → keep, never destroy work we cannot verify */
  }

  const hasCommits = headSha !== null && headSha !== info.baseSha;
  if (!dirty && !hasCommits) {
    try {
      (deps.removeWorktree || removeWorktree)(info.repoRoot, info.path);
      return { removed: true, kept: false, reason: "no changes" };
    } catch (err) {
      return { removed: false, kept: true, reason: `cleanup failed: ${err.message}` };
    }
  }
  return {
    removed: false,
    kept: true,
    reason: dirty ? "uncommitted changes" : "new commits",
    mergeHint: `git merge ${info.branch}   # or: cd ${info.path}`,
  };
}
