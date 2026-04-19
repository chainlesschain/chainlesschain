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


// ===== V2 Surface: Git Integration governance overlay (CLI v0.139.0) =====
export const GIT_REPO_MATURITY_V2 = Object.freeze({
  PENDING: "pending", ACTIVE: "active", ARCHIVED: "archived", DECOMMISSIONED: "decommissioned",
});
export const GIT_COMMIT_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued", COMMITTING: "committing", COMMITTED: "committed", FAILED: "failed", CANCELLED: "cancelled",
});

const _grTrans = new Map([
  [GIT_REPO_MATURITY_V2.PENDING, new Set([GIT_REPO_MATURITY_V2.ACTIVE, GIT_REPO_MATURITY_V2.DECOMMISSIONED])],
  [GIT_REPO_MATURITY_V2.ACTIVE, new Set([GIT_REPO_MATURITY_V2.ARCHIVED, GIT_REPO_MATURITY_V2.DECOMMISSIONED])],
  [GIT_REPO_MATURITY_V2.ARCHIVED, new Set([GIT_REPO_MATURITY_V2.ACTIVE, GIT_REPO_MATURITY_V2.DECOMMISSIONED])],
  [GIT_REPO_MATURITY_V2.DECOMMISSIONED, new Set()],
]);
const _grTerminal = new Set([GIT_REPO_MATURITY_V2.DECOMMISSIONED]);
const _gcTrans = new Map([
  [GIT_COMMIT_LIFECYCLE_V2.QUEUED, new Set([GIT_COMMIT_LIFECYCLE_V2.COMMITTING, GIT_COMMIT_LIFECYCLE_V2.CANCELLED])],
  [GIT_COMMIT_LIFECYCLE_V2.COMMITTING, new Set([GIT_COMMIT_LIFECYCLE_V2.COMMITTED, GIT_COMMIT_LIFECYCLE_V2.FAILED, GIT_COMMIT_LIFECYCLE_V2.CANCELLED])],
  [GIT_COMMIT_LIFECYCLE_V2.COMMITTED, new Set()],
  [GIT_COMMIT_LIFECYCLE_V2.FAILED, new Set()],
  [GIT_COMMIT_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _grsV2 = new Map();
const _gcsV2 = new Map();
let _grMaxActivePerOwner = 10;
let _grMaxPendingCommitsPerRepo = 20;
let _grIdleMs = 30 * 24 * 60 * 60 * 1000;
let _gcStuckMs = 5 * 60 * 1000;

function _grPos(n, lbl) { const v = Math.floor(Number(n)); if (!Number.isFinite(v) || v <= 0) throw new Error(`${lbl} must be positive integer`); return v; }

export function setMaxActiveGitReposPerOwnerV2(n) { _grMaxActivePerOwner = _grPos(n, "maxActiveGitReposPerOwner"); }
export function getMaxActiveGitReposPerOwnerV2() { return _grMaxActivePerOwner; }
export function setMaxPendingGitCommitsPerRepoV2(n) { _grMaxPendingCommitsPerRepo = _grPos(n, "maxPendingGitCommitsPerRepo"); }
export function getMaxPendingGitCommitsPerRepoV2() { return _grMaxPendingCommitsPerRepo; }
export function setGitRepoIdleMsV2(n) { _grIdleMs = _grPos(n, "gitRepoIdleMs"); }
export function getGitRepoIdleMsV2() { return _grIdleMs; }
export function setGitCommitStuckMsV2(n) { _gcStuckMs = _grPos(n, "gitCommitStuckMs"); }
export function getGitCommitStuckMsV2() { return _gcStuckMs; }

export function _resetStateGitIntegrationV2() {
  _grsV2.clear(); _gcsV2.clear();
  _grMaxActivePerOwner = 10; _grMaxPendingCommitsPerRepo = 20;
  _grIdleMs = 30 * 24 * 60 * 60 * 1000; _gcStuckMs = 5 * 60 * 1000;
}

export function registerGitRepoV2({ id, owner, branch, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!owner || typeof owner !== "string") throw new Error("owner is required");
  if (_grsV2.has(id)) throw new Error(`git repo ${id} already registered`);
  const now = Date.now();
  const r = { id, owner, branch: branch || "main", status: GIT_REPO_MATURITY_V2.PENDING, createdAt: now, updatedAt: now, activatedAt: null, decommissionedAt: null, lastTouchedAt: now, metadata: { ...(metadata || {}) } };
  _grsV2.set(id, r);
  return { ...r, metadata: { ...r.metadata } };
}
function _grCheckR(from, to) { const a = _grTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid git repo transition ${from} → ${to}`); }
function _grCountActive(owner) { let n = 0; for (const r of _grsV2.values()) if (r.owner === owner && r.status === GIT_REPO_MATURITY_V2.ACTIVE) n++; return n; }

export function activateGitRepoV2(id) {
  const r = _grsV2.get(id); if (!r) throw new Error(`git repo ${id} not found`);
  _grCheckR(r.status, GIT_REPO_MATURITY_V2.ACTIVE);
  const recovery = r.status === GIT_REPO_MATURITY_V2.ARCHIVED;
  if (!recovery) { const c = _grCountActive(r.owner); if (c >= _grMaxActivePerOwner) throw new Error(`max active git repos per owner (${_grMaxActivePerOwner}) reached for ${r.owner}`); }
  const now = Date.now(); r.status = GIT_REPO_MATURITY_V2.ACTIVE; r.updatedAt = now; r.lastTouchedAt = now; if (!r.activatedAt) r.activatedAt = now;
  return { ...r, metadata: { ...r.metadata } };
}
export function archiveGitRepoV2(id) { const r = _grsV2.get(id); if (!r) throw new Error(`git repo ${id} not found`); _grCheckR(r.status, GIT_REPO_MATURITY_V2.ARCHIVED); r.status = GIT_REPO_MATURITY_V2.ARCHIVED; r.updatedAt = Date.now(); return { ...r, metadata: { ...r.metadata } }; }
export function decommissionGitRepoV2(id) { const r = _grsV2.get(id); if (!r) throw new Error(`git repo ${id} not found`); _grCheckR(r.status, GIT_REPO_MATURITY_V2.DECOMMISSIONED); const now = Date.now(); r.status = GIT_REPO_MATURITY_V2.DECOMMISSIONED; r.updatedAt = now; if (!r.decommissionedAt) r.decommissionedAt = now; return { ...r, metadata: { ...r.metadata } }; }
export function touchGitRepoV2(id) { const r = _grsV2.get(id); if (!r) throw new Error(`git repo ${id} not found`); if (_grTerminal.has(r.status)) throw new Error(`cannot touch terminal git repo ${id}`); const now = Date.now(); r.lastTouchedAt = now; r.updatedAt = now; return { ...r, metadata: { ...r.metadata } }; }
export function getGitRepoV2(id) { const r = _grsV2.get(id); if (!r) return null; return { ...r, metadata: { ...r.metadata } }; }
export function listGitReposV2() { return [..._grsV2.values()].map((r) => ({ ...r, metadata: { ...r.metadata } })); }

function _gcCountPending(repoId) { let n = 0; for (const c of _gcsV2.values()) if (c.repoId === repoId && (c.status === GIT_COMMIT_LIFECYCLE_V2.QUEUED || c.status === GIT_COMMIT_LIFECYCLE_V2.COMMITTING)) n++; return n; }

export function createGitCommitV2({ id, repoId, message, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!repoId || typeof repoId !== "string") throw new Error("repoId is required");
  if (_gcsV2.has(id)) throw new Error(`git commit ${id} already exists`);
  if (!_grsV2.has(repoId)) throw new Error(`git repo ${repoId} not found`);
  const pending = _gcCountPending(repoId);
  if (pending >= _grMaxPendingCommitsPerRepo) throw new Error(`max pending git commits per repo (${_grMaxPendingCommitsPerRepo}) reached for ${repoId}`);
  const now = Date.now();
  const c = { id, repoId, message: message || "", status: GIT_COMMIT_LIFECYCLE_V2.QUEUED, createdAt: now, updatedAt: now, startedAt: null, settledAt: null, metadata: { ...(metadata || {}) } };
  _gcsV2.set(id, c);
  return { ...c, metadata: { ...c.metadata } };
}
function _gcCheckC(from, to) { const a = _gcTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid git commit transition ${from} → ${to}`); }
export function startGitCommitV2(id) { const c = _gcsV2.get(id); if (!c) throw new Error(`git commit ${id} not found`); _gcCheckC(c.status, GIT_COMMIT_LIFECYCLE_V2.COMMITTING); const now = Date.now(); c.status = GIT_COMMIT_LIFECYCLE_V2.COMMITTING; c.updatedAt = now; if (!c.startedAt) c.startedAt = now; return { ...c, metadata: { ...c.metadata } }; }
export function commitGitCommitV2(id) { const c = _gcsV2.get(id); if (!c) throw new Error(`git commit ${id} not found`); _gcCheckC(c.status, GIT_COMMIT_LIFECYCLE_V2.COMMITTED); const now = Date.now(); c.status = GIT_COMMIT_LIFECYCLE_V2.COMMITTED; c.updatedAt = now; if (!c.settledAt) c.settledAt = now; return { ...c, metadata: { ...c.metadata } }; }
export function failGitCommitV2(id, reason) { const c = _gcsV2.get(id); if (!c) throw new Error(`git commit ${id} not found`); _gcCheckC(c.status, GIT_COMMIT_LIFECYCLE_V2.FAILED); const now = Date.now(); c.status = GIT_COMMIT_LIFECYCLE_V2.FAILED; c.updatedAt = now; if (!c.settledAt) c.settledAt = now; if (reason) c.metadata.failReason = String(reason); return { ...c, metadata: { ...c.metadata } }; }
export function cancelGitCommitV2(id, reason) { const c = _gcsV2.get(id); if (!c) throw new Error(`git commit ${id} not found`); _gcCheckC(c.status, GIT_COMMIT_LIFECYCLE_V2.CANCELLED); const now = Date.now(); c.status = GIT_COMMIT_LIFECYCLE_V2.CANCELLED; c.updatedAt = now; if (!c.settledAt) c.settledAt = now; if (reason) c.metadata.cancelReason = String(reason); return { ...c, metadata: { ...c.metadata } }; }
export function getGitCommitV2(id) { const c = _gcsV2.get(id); if (!c) return null; return { ...c, metadata: { ...c.metadata } }; }
export function listGitCommitsV2() { return [..._gcsV2.values()].map((c) => ({ ...c, metadata: { ...c.metadata } })); }

export function autoArchiveIdleGitReposV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const r of _grsV2.values()) if (r.status === GIT_REPO_MATURITY_V2.ACTIVE && (t - r.lastTouchedAt) >= _grIdleMs) { r.status = GIT_REPO_MATURITY_V2.ARCHIVED; r.updatedAt = t; flipped.push(r.id); } return { flipped, count: flipped.length }; }
export function autoFailStuckGitCommitsV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const c of _gcsV2.values()) if (c.status === GIT_COMMIT_LIFECYCLE_V2.COMMITTING && c.startedAt != null && (t - c.startedAt) >= _gcStuckMs) { c.status = GIT_COMMIT_LIFECYCLE_V2.FAILED; c.updatedAt = t; if (!c.settledAt) c.settledAt = t; c.metadata.failReason = "auto-fail-stuck"; flipped.push(c.id); } return { flipped, count: flipped.length }; }

export function getGitIntegrationGovStatsV2() {
  const reposByStatus = {}; for (const s of Object.values(GIT_REPO_MATURITY_V2)) reposByStatus[s] = 0; for (const r of _grsV2.values()) reposByStatus[r.status]++;
  const commitsByStatus = {}; for (const s of Object.values(GIT_COMMIT_LIFECYCLE_V2)) commitsByStatus[s] = 0; for (const c of _gcsV2.values()) commitsByStatus[c.status]++;
  return { totalGitReposV2: _grsV2.size, totalGitCommitsV2: _gcsV2.size, maxActiveGitReposPerOwner: _grMaxActivePerOwner, maxPendingGitCommitsPerRepo: _grMaxPendingCommitsPerRepo, gitRepoIdleMs: _grIdleMs, gitCommitStuckMs: _gcStuckMs, reposByStatus, commitsByStatus };
}
