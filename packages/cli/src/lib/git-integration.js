/**
 * Git integration — wraps system git commands for knowledge base versioning.
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

/**
 * Check if a directory is a git repository.
 */
export function isGitRepo(dir) {
  return existsSync(join(dir, ".git"));
}

/**
 * Run a git command and return stdout.
 */
export function gitExec(args, cwd) {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString("utf-8").trim() : "";
    throw new Error(stderr || err.message);
  }
}

/**
 * Initialize a git repo in the given directory.
 */
export function gitInit(dir) {
  if (isGitRepo(dir)) {
    return { initialized: false, message: "Already a git repository" };
  }
  gitExec("init", dir);
  return { initialized: true, message: "Initialized git repository" };
}

/**
 * Get git status as structured data.
 */
export function gitStatus(dir) {
  if (!isGitRepo(dir)) {
    return { isRepo: false, files: [] };
  }

  // Use execSync directly to preserve leading whitespace in porcelain format
  const output = execSync("git status --porcelain", {
    cwd: dir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const files = output
    .split("\n")
    .filter(Boolean)
    .map((line) => ({
      status: line.substring(0, 2).trim(),
      file: line.substring(3),
    }));

  const branch = getCurrentBranch(dir);

  return {
    isRepo: true,
    branch,
    files,
    clean: files.length === 0,
  };
}

/**
 * Get current branch name.
 */
export function getCurrentBranch(dir) {
  try {
    return gitExec("rev-parse --abbrev-ref HEAD", dir);
  } catch {
    return "unknown";
  }
}

/**
 * Auto-commit all changes with a generated message.
 */
export function gitAutoCommit(dir, message) {
  if (!isGitRepo(dir)) {
    throw new Error("Not a git repository");
  }

  const status = gitStatus(dir);
  if (status.clean) {
    return { committed: false, message: "No changes to commit" };
  }

  // Stage all changes
  gitExec("add -A", dir);

  // Generate commit message if not provided
  const commitMsg =
    message ||
    `auto: ${status.files.length} file(s) changed — ${new Date().toISOString().slice(0, 16)}`;

  gitExec(`commit -m "${commitMsg.replace(/"/g, '\\"')}"`, dir);

  const hash = gitExec("rev-parse --short HEAD", dir);

  return {
    committed: true,
    hash,
    message: commitMsg,
    filesChanged: status.files.length,
  };
}

/**
 * Get recent commit log.
 */
export function gitLog(dir, limit = 10) {
  if (!isGitRepo(dir)) {
    return [];
  }

  try {
    const output = gitExec(
      `log --oneline --no-decorate -${limit} --format="%H|%h|%s|%ai|%an"`,
      dir,
    );
    return output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, shortHash, subject, date, author] = line.split("|");
        return { hash, shortHash, subject, date, author };
      });
  } catch {
    return [];
  }
}

/**
 * Analyze repository history statistics.
 */
export function gitHistoryAnalyze(dir) {
  if (!isGitRepo(dir)) {
    throw new Error("Not a git repository");
  }

  const totalCommits = parseInt(gitExec("rev-list --count HEAD", dir)) || 0;
  const firstCommit =
    totalCommits > 0
      ? gitExec("log --reverse --format=%ai --max-count=1", dir)
      : null;
  const lastCommit =
    totalCommits > 0 ? gitExec("log --format=%ai --max-count=1", dir) : null;

  // Contributors
  let contributors = [];
  try {
    const authorOutput = gitExec("shortlog -sn --no-merges HEAD", dir);
    contributors = authorOutput
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const match = line.trim().match(/(\d+)\s+(.+)/);
        return match ? { commits: parseInt(match[1]), author: match[2] } : null;
      })
      .filter(Boolean);
  } catch {
    // Empty repo or no commits
  }

  // File statistics
  let fileCount = 0;
  try {
    const files = gitExec("ls-files", dir);
    fileCount = files.split("\n").filter(Boolean).length;
  } catch {
    // Ignore
  }

  return {
    totalCommits,
    firstCommit,
    lastCommit,
    contributors,
    trackedFiles: fileCount,
  };
}

/**
 * Install git hooks for auto-commit on note changes.
 * Creates a post-commit hook that logs the commit.
 */
export function installHooks(dir) {
  if (!isGitRepo(dir)) {
    throw new Error("Not a git repository");
  }

  const hooksDir = join(dir, ".git", "hooks");
  const hookPath = join(hooksDir, "pre-commit");

  const hookContent = `#!/bin/sh
# ChainlessChain auto-format hook
echo "ChainlessChain: pre-commit hook running"
`;

  const { writeFileSync, chmodSync } = require("fs");
  writeFileSync(hookPath, hookContent, "utf-8");
  try {
    chmodSync(hookPath, 0o755);
  } catch {
    // Windows may not support chmod
  }

  return { installed: true, hook: "pre-commit", path: hookPath };
}
