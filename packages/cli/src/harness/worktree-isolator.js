/**
 * Worktree Isolator - git worktree-based task isolation.
 *
 * Creates temporary git worktrees for parallel agent tasks,
 * ensuring file operations don't interfere with the main working tree.
 *
 * Feature-flag gated: WORKTREE_ISOLATION
 */

import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { isGitRepo, gitExec } from "../lib/git-integration.js";

const WORKTREE_DIR = ".worktrees";

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

export async function isolateTask(repoDir, taskId, fn) {
  const branchName = `agent/${taskId}`;
  const { path: worktreePath } = createWorktree(repoDir, branchName);

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

export function cleanupAgentWorktrees(repoDir) {
  const worktrees = listWorktrees(repoDir);
  let cleaned = 0;

  for (const wt of worktrees) {
    if (wt.branch && wt.branch.startsWith("agent/")) {
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
  const base = options.baseBranch || "HEAD";
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

  const totalInsertions = files.reduce((sum, file) => sum + file.insertions, 0);
  const totalDeletions = files.reduce((sum, file) => sum + file.deletions, 0);

  let diff = "";
  try {
    diff = gitExec(`diff ${base}...${branchName}`, repoDir);
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
  };
}

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
          bothModified: conflicts.filter((item) => item.type === "both_modified")
            .length,
          bothAdded: conflicts.filter((item) => item.type === "both_added").length,
          deleteModify: conflicts.filter((item) =>
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
  const matches = String(errMsg).matchAll(/(?:Merge conflict in|CONFLICT [^:]+:\s*)([^\n]+)/g);
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
    automationCandidates: _buildAutomationCandidates(type, filePath, branchName),
    diffPreview: _buildDiffPreview(repoDir, filePath, branchName),
  };
}

function _conflictStatusCode(repoDir, filePath) {
  try {
    const output = gitExec(`status --porcelain -- "${filePath}"`, repoDir);
    const firstLine = output.split("\n").find((line) => line.trim());
    return firstLine ? firstLine.slice(0, 2) : "UU";
  } catch (_e) {
    return "UU";
  }
}

function _mapConflictType(statusCode) {
  switch (statusCode) {
    case "UU":
      return "both_modified";
    case "AA":
      return "both_added";
    case "DU":
      return "deleted_by_us";
    case "UD":
      return "deleted_by_them";
    case "AU":
      return "added_by_us";
    case "UA":
      return "added_by_them";
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
          command: `git checkout --ours -- "${filePath}" && git add "${filePath}"`,
          description: `Resolve ${filePath} by keeping the current branch version.`,
        },
        {
          id: "accept-incoming",
          label: "Keep agent branch",
          confidence: "medium",
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
          command: `git checkout --theirs -- "${filePath}" && git add "${filePath}"`,
          description: `Bring back ${filePath} from the agent branch.`,
        },
        {
          id: "confirm-delete",
          label: "Keep deletion",
          confidence: "medium",
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
          command: `git checkout --ours -- "${filePath}" && git add "${filePath}"`,
          description: `Keep the current branch copy of ${filePath}.`,
        },
        {
          id: "accept-delete",
          label: "Accept deletion",
          confidence: "medium",
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
    const diff = gitExec(`diff HEAD...${branchName} -- "${filePath}"`, repoDir);
    preview.snippet =
      diff.length > 2000 ? `${diff.slice(0, 2000)}\n... [diff truncated]` : diff;
  } catch (_e) {
    preview.snippet = "";
  }

  return preview;
}
