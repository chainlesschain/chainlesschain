/**
 * TeamWorktreeCoordinator (Phase 4) — give each teammate its OWN git worktree so
 * parallel task execution never fights over the working tree, then integrate the
 * results by SEQUENTIALLY previewing + merging each branch back to base. Two
 * tasks that touch different files both merge clean; two that touch the same
 * file surface a conflict on the second merge (the first having moved base) —
 * the Phase 4 acceptance "并行 Worktree 修改可预览冲突并安全合并".
 *
 * Unlike `isolateTask` (which removes the worktree as soon as its fn returns),
 * the coordinator KEEPS every worktree until integration is done — merge preview
 * needs the branch's worktree present — then cleans them all up.
 *
 * The git surface (`worktree-isolator`) is injected via `_deps` so the
 * coordinator's orchestration is unit-testable without a real repo; a real-git
 * integration test exercises the actual worktree/commit/merge path.
 */

import {
  createWorktree as _createWorktree,
  removeWorktree as _removeWorktree,
  previewWorktreeMerge as _previewWorktreeMerge,
  mergeWorktree as _mergeWorktree,
} from "../../harness/worktree-isolator.js";
import { isGitRepo as _isGitRepo } from "../../lib/git-integration.js";
import { execFileSync, spawn } from "node:child_process";

function defaultRunShell(command, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, env: process.env });
    let err = "";
    child.stderr?.on("data", (d) => (err += d.toString("utf8")));
    child.on("error", (e) => reject(new Error(e.message)));
    child.on("close", (code) =>
      code === 0
        ? resolve({ code })
        : reject(new Error(err.trim() || `command exited ${code}`)),
    );
  });
}

/** Stage + commit everything in a worktree. Returns true if a commit was made. */
function defaultCommit(worktreePath, message) {
  execFileSync("git", ["add", "-A"], { cwd: worktreePath, stdio: "ignore" });
  try {
    execFileSync(
      "git",
      [
        "-c",
        "user.email=team@chainlesschain.local",
        "-c",
        "user.name=cc team",
        "commit",
        "-m",
        message,
      ],
      { cwd: worktreePath, stdio: "ignore" },
    );
    return true;
  } catch {
    return false; // nothing to commit (no changes)
  }
}

export const _deps = {
  createWorktree: _createWorktree,
  removeWorktree: _removeWorktree,
  previewWorktreeMerge: _previewWorktreeMerge,
  mergeWorktree: _mergeWorktree,
  isGitRepo: _isGitRepo,
  runShell: defaultRunShell,
  commit: defaultCommit,
};

export class TeamWorktreeCoordinator {
  constructor(repoDir) {
    this.repoDir = repoDir;
    this._created = new Map(); // key → { branch, path, committed }
  }

  isGitRepo() {
    return _deps.isGitRepo(this.repoDir);
  }

  branchFor(key) {
    return `team/${key}`;
  }

  /**
   * A TeamRunner `runTask` that runs a task inside a fresh per-task worktree and
   * commits the result. By default it runs the task's shell `command`; pass
   * `runInWorktree({ key, task, holder, cwd })` to instead drive an agent turn
   * (its `prompt`) with cwd set to the worktree, so `--agent --worktree` gets the
   * same parallel isolation as `--exec --worktree`. Throws (→ task failure) on a
   * non-zero command / agent exit so retry/cancel still work.
   */
  makeRunTask({ runInWorktree = null } = {}) {
    return async ({ key, task, holder }) => {
      const branch = this.branchFor(key);
      // A retry (the prior attempt failed and TaskLeaseRegistry re-queued the
      // task) would collide with its own leftover worktree: createWorktree
      // derives a DETERMINISTIC path from the branch and throws "Worktree
      // already exists" (and `worktree add -b` rejects the existing branch), so
      // the retry can never recover — it just re-fails on the collision instead
      // of the real task. Tear down the prior attempt's worktree + branch first
      // so a retry starts clean.
      const prior = this._created.get(key);
      if (prior) {
        try {
          _deps.removeWorktree(this.repoDir, prior.path, {
            deleteBranch: true,
          });
        } catch {
          /* best-effort — a real problem will resurface in createWorktree */
        }
        this._created.delete(key);
      }
      const { path: worktreePath } = _deps.createWorktree(this.repoDir, branch);
      this._created.set(key, { branch, path: worktreePath, committed: false });
      if (typeof runInWorktree === "function") {
        await runInWorktree({ key, task, holder, cwd: worktreePath });
      } else {
        const command = task.metadata?.command || task?.command;
        if (!command) {
          throw new Error(
            `task "${key}" has no \`command\` to run in a worktree`,
          );
        }
        await _deps.runShell(command, worktreePath);
      }
      const committed = _deps.commit(worktreePath, `team task ${key}`);
      this._created.get(key).committed = committed;
      return { branch, committed };
    };
  }

  /**
   * Sequentially preview (and optionally merge) each committed branch back to
   * base. Merging is in-order, so a later branch that conflicts with an
   * already-merged one is reported as a conflict rather than silently clobbering.
   *
   * @param {object} [opts] { merge:boolean }  actually merge clean branches
   * @returns {Array<{key,branch,committed,clean,merged,conflicts,error?}>}
   */
  integrate({ merge = false } = {}) {
    const results = [];
    for (const [key, info] of this._created) {
      if (!info.committed) {
        results.push({
          key,
          branch: info.branch,
          committed: false,
          clean: true,
          merged: false,
          conflicts: [],
          note: "no changes to merge",
        });
        continue;
      }
      let preview;
      try {
        preview = _deps.previewWorktreeMerge(this.repoDir, info.branch);
      } catch (err) {
        results.push({
          key,
          branch: info.branch,
          committed: true,
          clean: false,
          merged: false,
          conflicts: [],
          error: err.message,
        });
        continue;
      }
      const clean = preview?.success === true;
      const conflicts = preview?.conflicts || [];
      let merged = false;
      if (clean && merge) {
        try {
          _deps.mergeWorktree(this.repoDir, info.branch, {
            message: `Merge team task ${key}`,
          });
          merged = true;
        } catch (err) {
          results.push({
            key,
            branch: info.branch,
            committed: true,
            clean: false,
            merged: false,
            conflicts,
            error: `merge failed: ${err.message}`,
          });
          continue;
        }
      }
      results.push({
        key,
        branch: info.branch,
        committed: true,
        clean,
        merged,
        conflicts,
      });
    }
    return results;
  }

  /** Remove every worktree created for this run (branches left intact). */
  cleanupAll({ deleteBranch = false } = {}) {
    for (const [, info] of this._created) {
      try {
        _deps.removeWorktree(this.repoDir, info.path, { deleteBranch });
      } catch {
        /* best-effort */
      }
    }
  }

  branches() {
    return Array.from(this._created.values()).map((i) => i.branch);
  }
}
