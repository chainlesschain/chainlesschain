/**
 * Worktree Isolator - git worktree-based task isolation.
 *
 * Creates temporary git worktrees for parallel agent tasks,
 * ensuring file operations don't interfere with the main working tree.
 *
 * Feature-flag gated: WORKTREE_ISOLATION
 */

import { execSync } from "node:child_process";
import { existsSync, rmSync, symlinkSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import {
  isGitRepo,
  gitExec,
  gitExecArgs,
  assertSafeGitRef,
  assertSafeGitPath,
} from "../lib/git-integration.js";
import { evaluateWorktreeCleanup } from "../lib/worktree-cleanup-safety.js";
import {
  normalizeSparsePaths,
  planSymlinkDirectories,
} from "../lib/worktree-sparse.js";

const WORKTREE_DIR = ".worktrees";

export function createWorktree(repoDir, branchName, baseBranch, options = {}) {
  assertSafeGitRef(branchName, "branch name");
  if (baseBranch) assertSafeGitRef(baseBranch, "base branch");
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

  const result = { path: worktreePath, branch: branchName };

  // Sparse checkout: only materialize the packages this task needs. For a
  // large monorepo this cuts worktree creation time and disk. Cone mode wants
  // directory paths — our sparsePaths are package dirs. Fail-closed on unsafe
  // paths (normalizeSparsePaths drops them); empty/absent → full checkout,
  // byte-identical to the no-sparse path.
  const sparsePaths = normalizeSparsePaths(options.sparsePaths);
  if (sparsePaths) {
    for (const p of sparsePaths) assertSafeGitPath(p, "sparse path");
    gitExecArgs(["sparse-checkout", "set", ...sparsePaths], worktreePath);
    result.sparsePaths = sparsePaths;
  }

  // Dependency reuse: link explicitly-approved directories (e.g. node_modules)
  // from the main checkout into the worktree so the task does not reinstall.
  // planSymlinkDirectories throws (fail-closed) on any junction/symlink escape.
  if (options.symlinkDirectories != null) {
    const plan = planSymlinkDirectories(options.symlinkDirectories, {
      repoDir,
      worktreePath,
    });
    const linked = [];
    for (const { name, source, dest } of plan) {
      if (!existsSync(source)) continue; // approved but absent — nothing to reuse
      if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
      mkdirSync(dirname(dest), { recursive: true });
      // 'junction' on Windows needs no admin and works for directories;
      // 'dir' elsewhere. Both resolve to an absolute source we validated.
      symlinkSync(
        source,
        dest,
        process.platform === "win32" ? "junction" : "dir",
      );
      linked.push(name);
    }
    if (linked.length > 0) result.symlinkedDirectories = linked;
  }

  return result;
}

export function removeWorktree(repoDir, worktreePath, options = {}) {
  const deleteBranch = options.deleteBranch !== false;

  let branch = null;
  if (deleteBranch) {
    try {
      branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: worktreePath,
        encoding: "utf-8",
      }).trim();
    } catch (_e) {
      // Can't determine branch, skip branch deletion.
    }
  }

  try {
    gitExec(`worktree remove "${worktreePath}" --force`, repoDir);
  } catch (_e) {
    if (existsSync(worktreePath)) {
      rmSync(worktreePath, { recursive: true, force: true });
    }
    gitExec("worktree prune", repoDir);
  }

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
      // Branch might already be deleted.
    }
  }
}

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

export function pruneWorktrees(repoDir) {
  if (!isGitRepo(repoDir)) return 0;

  const before = listWorktrees(repoDir).length;
  gitExec("worktree prune", repoDir);
  const after = listWorktrees(repoDir).length;
  return before - after;
}

export async function isolateTask(repoDir, taskId, fn, options = {}) {
  const branchName = `agent/${taskId}`;
  // options (large-monorepo): { sparsePaths, symlinkDirectories } forwarded to
  // createWorktree so an isolated task only materializes the packages it needs
  // and reuses approved dep dirs. Empty/absent → full checkout (byte-identical).
  const { path: worktreePath } = createWorktree(
    repoDir,
    branchName,
    undefined,
    options || {},
  );

  try {
    const result = await fn(worktreePath);
    const hasChanges = _hasUncommittedChanges(worktreePath);

    return {
      result,
      branch: branchName,
      worktreePath,
      hasChanges,
    };
  } finally {
    try {
      const hasCommits = _hasBranchCommits(repoDir, branchName);
      removeWorktree(repoDir, worktreePath, {
        deleteBranch: !hasCommits,
      });
    } catch (_e) {
      // Best-effort cleanup.
    }
  }
}

/**
 * Gather the cleanup-safety state of one worktree for
 * [[worktree-cleanup-safety.js]] `evaluateWorktreeCleanup`. Fail-closed: any git
 * command that cannot be read leaves the worktree marked unverifiable (→ kept).
 * `linkedPrs` is not known at this layer (no PR store here) and is left empty;
 * a higher layer that knows about PRs can call `evaluateWorktreeCleanup` itself.
 */
function _worktreeCleanupState(repoDir, wt) {
  const state = {
    readable: true,
    uncommitted: false,
    untracked: false,
    unpushed: false,
    linkedPrs: [],
  };

  // Dirty state: separate tracked modifications from untracked files.
  try {
    const porcelain = execSync("git status --porcelain", {
      cwd: wt.path,
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const lines = porcelain.split("\n").filter((l) => l.trim().length > 0);
    state.untracked = lines.some((l) => l.startsWith("??"));
    state.uncommitted = lines.some((l) => !l.startsWith("??"));
  } catch (_e) {
    state.readable = false; // cannot verify → fail-closed keep
    return state;
  }

  // Unpushed: only relevant if the branch has commits beyond the repo HEAD; if
  // it does, they are unpushed unless a remote branch contains them.
  try {
    assertSafeGitRef(wt.branch, "branch name");
    if (_hasBranchCommits(repoDir, wt.branch)) {
      const remotes = gitExecArgs(
        ["branch", "-r", "--contains", wt.branch],
        repoDir,
      );
      state.unpushed = remotes.trim().length === 0;
    }
  } catch (_e) {
    state.unpushed = true; // cannot prove the commits are pushed → keep
  }

  return state;
}

/**
 * Assess (read-only) which `agent/*` worktrees are safe to remove. Returns the
 * per-worktree decision from [[worktree-cleanup-safety.js]] without deleting
 * anything — the "清理前检查未提交修改、未追踪文件、未 Push Commit 和关联 PR"
 * report from IDE gap P1-5.
 */
export function assessAgentWorktreeCleanup(repoDir) {
  const worktrees = listWorktrees(repoDir);
  const assessments = [];
  for (const wt of worktrees) {
    if (!(wt.branch && wt.branch.startsWith("agent/"))) continue;
    const state = _worktreeCleanupState(repoDir, wt);
    const decision = evaluateWorktreeCleanup(state);
    assessments.push({
      path: wt.path,
      branch: wt.branch,
      safeToRemove: decision.safeToRemove,
      blockers: decision.blockers,
    });
  }
  return {
    assessments,
    removable: assessments.filter((a) => a.safeToRemove).length,
    kept: assessments.filter((a) => !a.safeToRemove).length,
  };
}

/**
 * Remove `agent/*` worktrees. By DEFAULT this is now fail-closed: a worktree
 * with uncommitted / untracked / unpushed work (or one whose state cannot be
 * read) is KEPT, not force-deleted — the P1-5 data-loss guard. Pass
 * `{ force: true }` for the legacy "wipe every agent worktree" behavior.
 *
 * @returns {number} count of worktrees actually removed
 */
export function cleanupAgentWorktrees(repoDir, options = {}) {
  const force = options.force === true;
  const worktrees = listWorktrees(repoDir);
  let cleaned = 0;

  for (const wt of worktrees) {
    if (wt.branch && wt.branch.startsWith("agent/")) {
      if (!force) {
        const decision = evaluateWorktreeCleanup(
          _worktreeCleanupState(repoDir, wt),
        );
        if (!decision.safeToRemove) continue; // keep work we cannot safely lose
      }
      try {
        removeWorktree(repoDir, wt.path, { deleteBranch: true });
        cleaned++;
      } catch (_e) {
        // Skip if cleanup fails.
      }
    }
  }

  pruneWorktrees(repoDir);
  return cleaned;
}

export function diffWorktree(repoDir, branchName, options = {}) {
  assertSafeGitRef(branchName, "branch name");
  if (options.baseBranch) assertSafeGitRef(options.baseBranch, "base branch");
  const base = options.baseBranch || "HEAD";
  const filePath = options.filePath || null;
  if (filePath) assertSafeGitPath(filePath, "file path");
  const fileArg = filePath ? ` -- "${filePath}"` : "";
  const statOutput = gitExec(
    `diff ${base}...${branchName} --stat --numstat${fileArg}`,
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

  const totalInsertions = files.reduce((sum, file) => sum + file.insertions, 0);
  const totalDeletions = files.reduce((sum, file) => sum + file.deletions, 0);

  let diff = "";
  try {
    diff = gitExec(`diff ${base}...${branchName}${fileArg}`, repoDir);
    if (diff.length > 50000) {
      diff = `${diff.slice(0, 50000)}\n... [diff truncated at 50KB]`;
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
    filePath,
  };
}

export function mergeWorktree(repoDir, branchName, options = {}) {
  assertSafeGitRef(branchName, "branch name");
  if (options.baseBranch) assertSafeGitRef(options.baseBranch, "base branch");
  const strategy = options.strategy || "merge";
  const deleteBranch = options.deleteBranch !== false;

  try {
    if (strategy === "squash") {
      gitExec(`merge --squash ${branchName}`, repoDir);
      const msg =
        options.message ||
        `feat: merge agent work from ${branchName} (squashed)`;
      // Free-text message → argv (no shell) so `$()`/backticks/quotes in it
      // can't inject a command (the old `-m "…"` only escaped `"`).
      gitExecArgs(["commit", "-m", msg], repoDir);
    } else {
      const msg =
        options.message || `Merge branch '${branchName}' (agent task)`;
      gitExecArgs(["merge", branchName, "--no-edit", "-m", msg], repoDir);
    }

    if (deleteBranch) {
      try {
        gitExec(`branch -D "${branchName}"`, repoDir);
      } catch (_e) {
        // Non-critical.
      }
    }

    return {
      success: true,
      strategy,
      message: `Successfully merged ${branchName} via ${strategy}`,
    };
  } catch (err) {
    const errMsg = err.message || String(err);
    if (errMsg.includes("CONFLICT") || errMsg.includes("conflict")) {
      const conflictPaths = _collectConflictFiles(repoDir);
      if (conflictPaths.length === 0) {
        conflictPaths.push(..._extractConflictPathsFromMessage(errMsg));
      }
      const conflicts = [...new Set(conflictPaths)].map((filePath) =>
        _buildConflictSummary(repoDir, filePath, branchName),
      );
      const suggestions = _buildConflictSuggestions(conflicts);

      try {
        gitExec("merge --abort", repoDir);
      } catch (_e) {
        // Best effort.
      }

      return {
        success: false,
        strategy,
        message: "Merge conflicts detected - manual resolution required",
        conflicts,
        summary: {
          conflictedFiles: conflicts.length,
          bothModified: conflicts.filter(
            (item) => item.type === "both_modified",
          ).length,
          bothAdded: conflicts.filter((item) => item.type === "both_added")
            .length,
          deleteModify: conflicts.filter(
            (item) =>
              item.type === "deleted_by_us" || item.type === "deleted_by_them",
          ).length,
        },
        suggestions,
        previewEntrypoints: conflicts.map((item) => item.diffPreview.route),
      };
    }

    return {
      success: false,
      strategy,
      message: `Merge failed: ${errMsg}`,
    };
  }
}

export function previewWorktreeMerge(repoDir, branchName, options = {}) {
  assertSafeGitRef(branchName, "branch name");
  if (options.baseBranch) assertSafeGitRef(options.baseBranch, "base branch");
  const strategy = options.strategy || "merge";
  const baseBranch = _resolveBaseBranchForMerge(repoDir, options.baseBranch);
  const worktree = _findWorktreeByBranch(repoDir, branchName);
  if (!worktree?.path) {
    throw new Error(`Worktree not found for branch: ${branchName}`);
  }

  _abortMergeIfPresent(worktree.path);

  let mergeStarted = false;
  try {
    gitExec(`merge ${baseBranch} --no-commit --no-ff`, worktree.path);
    mergeStarted = true;

    return {
      success: true,
      previewOnly: true,
      strategy,
      branch: branchName,
      baseBranch,
      message: `Merge preview is clean. ${branchName} can be merged into ${baseBranch} without conflicts.`,
      summary: {
        conflictedFiles: 0,
        bothModified: 0,
        bothAdded: 0,
        deleteModify: 0,
      },
      conflicts: [],
      suggestions: [
        `No merge conflicts detected between ${branchName} and ${baseBranch}.`,
        "You can proceed with the final merge when ready.",
      ],
      previewEntrypoints: [],
    };
  } catch (error) {
    const errMsg = error.message || String(error);
    const conflictPaths = _collectConflictFiles(worktree.path);
    if (
      errMsg.includes("CONFLICT") ||
      errMsg.includes("conflict") ||
      conflictPaths.length > 0
    ) {
      const normalizedPaths =
        conflictPaths.length > 0
          ? conflictPaths
          : _extractConflictPathsFromMessage(errMsg);
      const conflicts = [...new Set(normalizedPaths)].map((filePath) =>
        _buildConflictSummary(worktree.path, filePath, branchName),
      );
      const suggestions = _buildConflictSuggestions(conflicts);

      return {
        success: false,
        previewOnly: true,
        strategy,
        branch: branchName,
        baseBranch,
        message: "Merge preview detected conflicts - review before merging",
        conflicts,
        summary: {
          conflictedFiles: conflicts.length,
          bothModified: conflicts.filter(
            (item) => item.type === "both_modified",
          ).length,
          bothAdded: conflicts.filter((item) => item.type === "both_added")
            .length,
          deleteModify: conflicts.filter(
            (item) =>
              item.type === "deleted_by_us" || item.type === "deleted_by_them",
          ).length,
        },
        suggestions,
        previewEntrypoints: conflicts.map((item) => item.diffPreview.route),
      };
    }

    throw error;
  } finally {
    if (mergeStarted || _collectConflictFiles(worktree.path).length > 0) {
      _abortMergeIfPresent(worktree.path);
    }
  }
}

export function applyWorktreeAutomationCandidate(
  repoDir,
  branchName,
  options = {},
) {
  assertSafeGitRef(branchName, "branch name");
  if (options.baseBranch) assertSafeGitRef(options.baseBranch, "base branch");
  const filePath = options.filePath || null;
  const candidateId = options.candidateId || null;
  const conflictType = options.conflictType || null;
  const baseBranch = _resolveBaseBranchForMerge(repoDir, options.baseBranch);

  if (filePath) assertSafeGitPath(filePath, "file path");
  if (!filePath) {
    throw new Error("filePath is required");
  }
  if (!candidateId) {
    throw new Error("candidateId is required");
  }

  const worktree = _findWorktreeByBranch(repoDir, branchName);
  if (!worktree?.path) {
    throw new Error(`Worktree not found for branch: ${branchName}`);
  }

  const candidate = _resolveAutomationCandidate(
    conflictType,
    filePath,
    branchName,
    candidateId,
  );
  if (!candidate) {
    throw new Error(`Unsupported automation candidate: ${candidateId}`);
  }
  if (candidate.executable !== true) {
    throw new Error(`Automation candidate is advisory only: ${candidateId}`);
  }

  _abortMergeIfPresent(worktree.path);

  let mergeStarted = false;
  try {
    gitExec(`merge ${baseBranch} --no-commit --no-ff`, worktree.path);
    mergeStarted = true;
  } catch (error) {
    const errMsg = error.message || String(error);
    const conflictFiles = _collectConflictFiles(worktree.path);
    if (
      !errMsg.includes("CONFLICT") &&
      !errMsg.includes("conflict") &&
      conflictFiles.length === 0
    ) {
      _abortMergeIfPresent(worktree.path);
      throw error;
    }
    mergeStarted = true;
  }

  try {
    const unresolvedFiles = _collectConflictFiles(worktree.path);
    if (unresolvedFiles.length > 0) {
      _applyAutomationResolution(worktree.path, candidateId, filePath);

      const remainingFiles = _collectConflictFiles(worktree.path);
      if (remainingFiles.includes(filePath)) {
        throw new Error(
          `Unable to resolve ${filePath} with automation candidate ${candidateId}`,
        );
      }
      if (remainingFiles.length > 0) {
        throw new Error(
          `Automation candidate ${candidateId} only resolved ${filePath}. Remaining conflicted files: ${remainingFiles.join(", ")}`,
        );
      }
    }

    const commitMessage =
      options.commitMessage ||
      `Resolve ${filePath} via ${candidate.label || candidateId}`;
    // Free-text message → argv (no shell) so `$()` / backticks / quotes in a
    // caller-supplied commitMessage can't inject a command. The prior
    // `-m "${msg.replace(/"/g,'\\"')}"` only neutralized double quotes — the
    // same gap already fixed in mergeWorktree.
    gitExecArgs(["commit", "-m", commitMessage], worktree.path);

    const diff = diffWorktree(repoDir, branchName, { baseBranch });
    const filesChanged = diff.summary?.filesChanged || 0;

    return {
      success: true,
      branch: branchName,
      baseBranch,
      filePath,
      candidateId,
      message:
        filesChanged > 0
          ? `${candidate.label || candidateId} applied in ${branchName}. Review the updated branch diff before merging.`
          : `${candidate.label || candidateId} applied in ${branchName}. The branch is now aligned with ${baseBranch} for ${filePath}.`,
      files: diff.files,
      summary: diff.summary,
      diff: diff.diff,
    };
  } catch (error) {
    if (mergeStarted) {
      _abortMergeIfPresent(worktree.path);
    }
    throw error;
  }
}

export function worktreeLog(repoDir, branchName, baseBranch = "HEAD") {
  assertSafeGitRef(branchName, "branch name");
  assertSafeGitRef(baseBranch, "base branch");
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

function _fileStatus(repoDir, base, branch, filePath) {
  try {
    // filePath here comes from git's conflict output (a tracked file name);
    // pass it via argv so an exotic / maliciously-named file can't inject.
    const output = gitExecArgs(
      ["diff", `${base}...${branch}`, "--name-status", "--", filePath],
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
      // A worktree with many dirty files produces >1 MB of porcelain output and
      // would ENOBUFS on the default cap — the catch below then reports "clean"
      // (fail-OPEN), which could let a caller discard a worktree full of
      // uncommitted work. Give it the same 64 MB headroom as gitExec.
      maxBuffer: 64 * 1024 * 1024,
    });
    return output.trim().length > 0;
  } catch (_e) {
    return false;
  }
}

function _hasBranchCommits(repoDir, branchName) {
  try {
    const output = gitExec(`log HEAD..${branchName} --oneline`, repoDir);
    return output.trim().length > 0;
  } catch (_e) {
    return false;
  }
}

function _collectConflictFiles(repoDir) {
  try {
    const output = gitExec("diff --name-only --diff-filter=U", repoDir);
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (_e) {
    return [];
  }
}

function _extractConflictPathsFromMessage(errMsg) {
  const paths = [];
  const matches = String(errMsg).matchAll(
    /(?:Merge conflict in|CONFLICT [^:]+:\s*)([^\n]+)/g,
  );
  for (const match of matches) {
    const value = match[1]?.trim();
    if (!value) continue;
    const normalized = value.replace(/^in\s+/, "").trim();
    paths.push(normalized);
  }
  return paths;
}

function _buildConflictSummary(repoDir, filePath, branchName) {
  const statusCode = _conflictStatusCode(repoDir, filePath);
  const type = _mapConflictType(statusCode);

  return {
    path: filePath,
    statusCode,
    type,
    suggestion: _suggestAction(type, filePath),
    automationCandidates: _buildAutomationCandidates(
      type,
      filePath,
      branchName,
    ),
    diffPreview: _buildDiffPreview(repoDir, filePath, branchName),
  };
}

function _conflictStatusCode(repoDir, filePath) {
  try {
    const output = gitExecArgs(
      ["status", "--porcelain", "--", filePath],
      repoDir,
    );
    const firstLine = output.split("\n").find((line) => line.trim());
    return firstLine ? firstLine.slice(0, 2) : "UU";
  } catch (_e) {
    return "UU";
  }
}

function _mapConflictType(statusCode) {
  // NOTE: the porcelain XY code is reported relative to the ACTUAL merge, which
  // previewWorktreeMerge/applyWorktreeAutomationCandidate run as `git merge
  // <base>` INSIDE the agent worktree — i.e. ours=agent, theirs=base, the
  // REVERSE of the "current merges in the agent branch" direction the candidate
  // labels/suggestions describe. For symmetric codes (UU/AA) direction is
  // irrelevant. For the asymmetric delete/add codes the U/D (us/them) halves
  // must be swapped back to the label direction, otherwise the "keep the file"
  // candidate checks out the side that DELETED it (`git checkout --ours/--theirs`
  // → "path does not have our/their version") and throws — leaving no automated
  // way to preserve the surviving file.
  switch (statusCode) {
    case "UU":
      return "both_modified";
    case "AA":
      return "both_added";
    case "DU": // ours(agent) deleted, theirs(base) modified
      return "deleted_by_them";
    case "UD": // ours(agent) modified, theirs(base) deleted
      return "deleted_by_us";
    case "AU": // added by ours(agent)
      return "added_by_them";
    case "UA": // added by theirs(base)
      return "added_by_us";
    default:
      return "unmerged";
  }
}

function _suggestAction(type, filePath) {
  switch (type) {
    case "both_modified":
      return `Review both sides in ${filePath} and resolve conflict markers manually.`;
    case "both_added":
      return `Compare the two added versions of ${filePath} and keep one or merge their contents.`;
    case "deleted_by_us":
      return `Decide whether ${filePath} should stay deleted locally or be restored from the agent branch.`;
    case "deleted_by_them":
      return `Decide whether ${filePath} should stay deleted in the agent branch or be kept from the current branch.`;
    case "added_by_us":
    case "added_by_them":
      return `Review the newly added ${filePath} and confirm whether it should coexist or replace the other side.`;
    default:
      return `Inspect ${filePath} and resolve the unmerged state before retrying the merge.`;
  }
}

function _buildConflictSuggestions(conflicts) {
  if (conflicts.length === 0) {
    return ["Run git status to inspect the merge state before retrying."];
  }

  const suggestions = [
    `Resolve ${conflicts.length} conflicted file(s), then rerun the merge.`,
  ];

  if (conflicts.some((item) => item.type === "both_modified")) {
    suggestions.push(
      "Start with files marked both_modified; they usually need direct hunk reconciliation.",
    );
  }
  if (
    conflicts.some(
      (item) =>
        item.type === "deleted_by_us" || item.type === "deleted_by_them",
    )
  ) {
    suggestions.push(
      "For delete/modify conflicts, decide whether the file should exist at all before resolving content.",
    );
  }

  return suggestions;
}

function _buildAutomationCandidates(type, filePath, branchName) {
  const common = [
    {
      id: "preview-diff",
      label: "Preview diff",
      confidence: "high",
      executable: false,
      command: `git diff HEAD...${branchName} -- "${filePath}"`,
      description: `Inspect the branch delta for ${filePath} before resolving.`,
    },
  ];

  switch (type) {
    case "both_modified":
      return [
        {
          id: "accept-current",
          label: "Keep current branch",
          confidence: "medium",
          executable: true,
          command: `git checkout --ours -- "${filePath}" && git add "${filePath}"`,
          description: `Resolve ${filePath} by keeping the current branch version.`,
        },
        {
          id: "accept-incoming",
          label: "Keep agent branch",
          confidence: "medium",
          executable: true,
          command: `git checkout --theirs -- "${filePath}" && git add "${filePath}"`,
          description: `Resolve ${filePath} by taking the incoming agent version.`,
        },
        ...common,
      ];
    case "both_added":
      return [
        {
          id: "rename-one-side",
          label: "Rename one copy",
          confidence: "low",
          executable: false,
          command: `git checkout --theirs -- "${filePath}"`,
          description: `Restore the incoming version, then rename or merge it manually to keep both copies.`,
        },
        ...common,
      ];
    case "deleted_by_us":
      return [
        {
          id: "restore-incoming",
          label: "Restore file",
          confidence: "medium",
          executable: true,
          command: `git checkout --theirs -- "${filePath}" && git add "${filePath}"`,
          description: `Bring back ${filePath} from the agent branch.`,
        },
        {
          id: "confirm-delete",
          label: "Keep deletion",
          confidence: "medium",
          executable: true,
          command: `git rm -- "${filePath}"`,
          description: `Resolve by keeping the deletion on the current branch.`,
        },
        ...common,
      ];
    case "deleted_by_them":
      return [
        {
          id: "restore-current",
          label: "Keep current file",
          confidence: "medium",
          executable: true,
          command: `git checkout --ours -- "${filePath}" && git add "${filePath}"`,
          description: `Keep the current branch copy of ${filePath}.`,
        },
        {
          id: "accept-delete",
          label: "Accept deletion",
          confidence: "medium",
          executable: true,
          command: `git rm -- "${filePath}"`,
          description: `Resolve by accepting the deletion from the agent branch.`,
        },
        ...common,
      ];
    default:
      return common;
  }
}

function _buildDiffPreview(repoDir, filePath, branchName) {
  const preview = {
    filePath,
    branch: branchName,
    command: `git diff HEAD...${branchName} -- "${filePath}"`,
    route: {
      type: "worktree-diff",
      branch: branchName,
      filePath,
    },
  };

  try {
    const diff = gitExecArgs(
      ["diff", `HEAD...${branchName}`, "--", filePath],
      repoDir,
    );
    preview.snippet =
      diff.length > 2000
        ? `${diff.slice(0, 2000)}\n... [diff truncated]`
        : diff;
  } catch (_e) {
    preview.snippet = "";
  }

  return preview;
}

function _findWorktreeByBranch(repoDir, branchName) {
  return (
    listWorktrees(repoDir).find((item) => item.branch === branchName) || null
  );
}

function _resolveAutomationCandidate(type, filePath, branchName, candidateId) {
  const typesToCheck = type
    ? [type]
    : ["both_modified", "both_added", "deleted_by_us", "deleted_by_them"];

  for (const candidateType of typesToCheck) {
    const candidate = _buildAutomationCandidates(
      candidateType,
      filePath,
      branchName,
    ).find((item) => item.id === candidateId);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function _abortMergeIfPresent(repoDir) {
  try {
    gitExec("merge --abort", repoDir);
  } catch (_e) {
    // Ignore if there is no in-progress merge.
  }
}

function _resolveBaseBranchForMerge(repoDir, baseBranch) {
  if (baseBranch && baseBranch !== "HEAD") {
    return baseBranch;
  }

  try {
    return gitExec("rev-parse --abbrev-ref HEAD", repoDir) || "HEAD";
  } catch (_e) {
    return "HEAD";
  }
}

function _applyAutomationResolution(repoDir, candidateId, filePath) {
  // filePath here is a conflicted filename straight from `git diff --name-only`
  // — i.e. it reflects whatever names exist in the (possibly untrusted) branch
  // being merged. The sibling public functions assertSafeGitPath their filePath,
  // but this internal helper interpolated it raw into a shell command string, so
  // a file named `x"; rm -rf ~; ".txt` was a command-injection vector. Use the
  // array-form gitExecArgs (spawnSync, no shell) so the path is a literal arg —
  // injection-proof and correct for filenames with spaces/special chars too.
  switch (candidateId) {
    case "accept-current":
      gitExecArgs(["checkout", "--theirs", "--", filePath], repoDir);
      gitExecArgs(["add", "--", filePath], repoDir);
      return;
    case "accept-incoming":
    case "restore-incoming":
      gitExecArgs(["checkout", "--ours", "--", filePath], repoDir);
      gitExecArgs(["add", "--", filePath], repoDir);
      return;
    case "restore-current":
      gitExecArgs(["checkout", "--theirs", "--", filePath], repoDir);
      gitExecArgs(["add", "--", filePath], repoDir);
      return;
    case "confirm-delete":
    case "accept-delete":
      gitExecArgs(["rm", "--", filePath], repoDir);
      return;
    default:
      throw new Error(`Unsupported automation resolution: ${candidateId}`);
  }
}
