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

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  createWorktree as _createWorktree,
  assertManagedWorktreePath as _assertManagedWorktreePath,
  removeManagedDependencyLinks as _removeManagedDependencyLinks,
  removeWorktree as _removeWorktree,
  previewWorktreeMerge as _previewWorktreeMerge,
  mergeWorktree as _mergeWorktree,
} from "../../harness/worktree-isolator.js";
import { isGitRepo as _isGitRepo } from "../../lib/git-integration.js";
import { normalizeSparsePaths } from "../../lib/worktree-sparse.js";
import executionBroker from "../../lib/process-execution-broker/index.js";
import { stopBackgroundAgentChildTree } from "../../lib/background-agent-supervisor.js";
import { redactSecrets } from "../../lib/secret-scan.js";

export const _processDeps = {
  spawn: executionBroker.spawn.bind(executionBroker),
  execFileSync: executionBroker.execFileSync.bind(executionBroker),
  killProcessTree: (child) => {
    const pid = Number(child?.pid);
    if (Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid) {
      try {
        return stopBackgroundAgentChildTree(pid);
      } catch {
        /* fall through to the direct handle */
      }
    }
    return child?.kill?.() ?? false;
  },
};

export const MAX_TEAM_WORKTREE_STDERR_BYTES = 64 * 1024;
const TEAM_WORKTREE_SNAPSHOT_VERSION = 3;
const MAX_RUN_ID_BYTES = 256;
const MAX_RECORD_VALUE_BYTES = 4096;

/**
 * Resolve the sparse-checkout / dependency-symlink options for a task, letting a
 * per-task value (from the plan) override the coordinator-wide default. Returns
 * `undefined` when nothing is configured so `createWorktree` takes its unchanged
 * full-checkout path (byte-identical to before this feature).
 */
function resolveWorktreeOptions(task, defaults) {
  const t = task || {};
  const sparse = normalizeSparsePaths(
    t.sparsePaths ?? t.metadata?.sparsePaths ?? defaults.sparsePaths ?? null,
  );
  const requestedSymlink =
    t.symlinkDirectories ?? t.metadata?.symlinkDirectories ?? null;
  const approvedSymlink = defaults.symlinkDirectories ?? null;
  let symlink = approvedSymlink;
  if (requestedSymlink != null) {
    const requested = Array.isArray(requestedSymlink)
      ? requestedSymlink
      : [requestedSymlink];
    const approved = new Set(
      (Array.isArray(approvedSymlink)
        ? approvedSymlink
        : approvedSymlink == null
          ? []
          : [approvedSymlink]
      ).map(String),
    );
    if (requested.some((entry) => !approved.has(String(entry)))) {
      throw new Error(
        "task symlinkDirectories must be explicitly approved by --symlink-dirs",
      );
    }
    symlink = requestedSymlink;
  }
  const opts = {};
  if (sparse) opts.sparsePaths = sparse;
  if (symlink != null) opts.symlinkDirectories = symlink;
  return Object.keys(opts).length ? opts : undefined;
}

function safeProcessError(value, fallback) {
  const text = redactSecrets(String(value || "")).trim();
  return (text || fallback).slice(0, 4096);
}

function requireAdjudication(error, code) {
  const failure =
    error instanceof Error ? error : new Error(String(error || code));
  failure.code = failure.code || code;
  failure.retryable = false;
  return failure;
}

function defaultRunShell(command, cwd, { signal = null } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = _processDeps.spawn(command, [], {
        cwd,
        shell: true,
        env: process.env,
        origin: "team-worktree:task-command",
        policy: "allow",
        scope: "team-worktree",
        detached: process.platform !== "win32",
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    let settled = false;
    let stderrBytes = 0;
    const stderrChunks = [];
    let terminationError = null;
    let terminationTimer = null;
    let abortListener = null;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (terminationTimer) clearTimeout(terminationTimer);
      if (abortListener) {
        signal?.removeEventListener?.("abort", abortListener);
      }
      if (error) reject(error);
      else resolve(value);
    };
    const terminate = () => {
      if (settled || terminationError) return;
      terminationError = new Error("Team worktree shell task was cancelled");
      terminationError.code = "TEAM_WORKTREE_SHELL_ABORTED";
      try {
        _processDeps.killProcessTree(child);
      } catch {
        /* wait for close or the bounded grace timer */
      }
      terminationTimer = setTimeout(() => finish(terminationError), 5000);
    };

    // A piped stdout that nobody consumes can fill its OS buffer and deadlock a
    // task before it exits. Worktree commands do not return stdout, so drain it.
    if (typeof child.stdout?.resume === "function") {
      child.stdout.resume();
    } else {
      child.stdout?.on?.("data", () => {});
    }
    child.stderr?.on("data", (data) => {
      if (stderrBytes >= MAX_TEAM_WORKTREE_STDERR_BYTES) return;
      const chunk = Buffer.isBuffer(data)
        ? data
        : Buffer.from(String(data), "utf8");
      const remaining = MAX_TEAM_WORKTREE_STDERR_BYTES - stderrBytes;
      const retained = chunk.subarray(0, remaining);
      if (retained.length > 0) {
        stderrChunks.push(retained);
        stderrBytes += retained.length;
      }
    });
    child.once("error", (error) => {
      if (!terminationError) {
        finish(
          new Error(
            safeProcessError(
              error?.message || error,
              "command failed to start",
            ),
          ),
        );
      }
    });
    child.once("close", (code) => {
      if (terminationError) {
        finish(terminationError);
        return;
      }
      if (code === 0) {
        finish(null, { code });
        return;
      }
      const stderr = Buffer.concat(stderrChunks, stderrBytes).toString("utf8");
      finish(new Error(safeProcessError(stderr, `command exited ${code}`)));
    });
    if (signal) {
      abortListener = terminate;
      if (signal.aborted) terminate();
      else signal.addEventListener?.("abort", abortListener, { once: true });
    }
  });
}

function runTeamGit(args, cwd) {
  return _processDeps.execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    origin: "team-worktree:commit",
    policy: "allow",
    scope: "team-worktree",
    shell: false,
  });
}

function resolveGitRef(cwd, ref = "HEAD") {
  const value = _processDeps.execFileSync(
    "git",
    ["rev-parse", "--verify", ref],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      origin: "team-worktree:recovery",
      policy: "allow",
      scope: "team-worktree",
      shell: false,
    },
  );
  const oid = String(value || "").trim();
  if (!/^[a-f0-9]{40,64}$/i.test(oid)) {
    throw new Error(`invalid Git object id for ${ref}`);
  }
  return oid.toLowerCase();
}

function resolveGitBranch(cwd) {
  try {
    const value = _processDeps.execFileSync(
      "git",
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        origin: "team-worktree:recovery",
        policy: "allow",
        scope: "team-worktree",
        shell: false,
      },
    );
    const branch = String(value || "").trim();
    if (!isGitSafeBranch(branch)) {
      throw new Error("invalid current Git branch");
    }
    return branch;
  } catch (error) {
    if (error?.status === 1 || error?.code === 1) return null;
    throw error;
  }
}

function isGitAncestor(cwd, ancestor, descendant = "HEAD") {
  try {
    _processDeps.execFileSync(
      "git",
      ["merge-base", "--is-ancestor", ancestor, descendant],
      {
        cwd,
        stdio: "ignore",
        origin: "team-worktree:recovery",
        policy: "allow",
        scope: "team-worktree",
        shell: false,
      },
    );
    return true;
  } catch (error) {
    if (error?.status === 1 || error?.code === 1) return false;
    throw error;
  }
}

function isWorktreeClean(cwd, { includeIgnored = false } = {}) {
  const args = [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--ignore-submodules=none",
  ];
  if (includeIgnored) args.push("--ignored=matching");
  const value = _processDeps.execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    origin: "team-worktree:cleanup",
    policy: "allow",
    scope: "team-worktree",
    shell: false,
  });
  return String(value || "").trim() === "";
}

/** Stage + commit everything in a worktree. Returns true if a commit was made. */
function defaultCommit(worktreePath, message) {
  runTeamGit(["add", "-A"], worktreePath);

  try {
    runTeamGit(["diff", "--cached", "--quiet", "--exit-code"], worktreePath);
    return false;
  } catch (error) {
    // `git diff --quiet` uses status 1 exclusively to report a non-empty diff.
    // Any other status is an actual Git failure and must not be hidden.
    if (error?.status !== 1 && error?.code !== 1) throw error;
  }

  // The staged diff was known to be non-empty. A commit failure here may be a
  // hook, lock, identity, or repository problem, so always surface it.
  runTeamGit(
    [
      "-c",
      "user.email=team@chainlesschain.local",
      "-c",
      "user.name=cc team",
      "commit",
      "-m",
      message,
    ],
    worktreePath,
  );
  return true;
}

export const _deps = {
  createWorktree: _createWorktree,
  assertManagedWorktreePath: _assertManagedWorktreePath,
  removeManagedDependencyLinks: _removeManagedDependencyLinks,
  removeWorktree: _removeWorktree,
  previewWorktreeMerge: _previewWorktreeMerge,
  mergeWorktree: _mergeWorktree,
  isGitRepo: _isGitRepo,
  runShell: defaultRunShell,
  commit: defaultCommit,
  resolveGitRef,
  resolveGitBranch,
  isGitAncestor,
  isWorktreeClean,
  pathExists: existsSync,
};

function normalizeRunId(value) {
  if (value == null) return null;
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError("team worktree runId must be a non-empty string");
  }
  if (Buffer.byteLength(value, "utf8") > MAX_RUN_ID_BYTES) {
    throw new RangeError(
      `team worktree runId exceeds ${MAX_RUN_ID_BYTES} bytes`,
    );
  }
  return value;
}

function safeGitSegment(value, fallback) {
  const raw = String(value);
  const digest = createHash("sha256")
    .update(raw, "utf8")
    .digest("hex")
    .slice(0, 16);
  let slug = raw
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 48)
    .replace(/[.-]+$/g, "");
  if (!slug) slug = fallback;
  return `${slug}-${digest}`;
}

function isGitSafeBranch(branch) {
  if (
    typeof branch !== "string" ||
    branch.length === 0 ||
    Buffer.byteLength(branch, "utf8") > MAX_RECORD_VALUE_BYTES ||
    branch === "@" ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    branch.includes("//") ||
    Array.from(branch).some((char) => {
      const code = char.codePointAt(0);
      return code <= 0x20 || code === 0x7f;
    }) ||
    /[~^:?*[\]\\]/u.test(branch)
  ) {
    return false;
  }
  return branch
    .split("/")
    .every(
      (part) =>
        part.length > 0 && !part.startsWith(".") && !part.endsWith(".lock"),
    );
}

function requireRecordString(value, field) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > MAX_RECORD_VALUE_BYTES ||
    value.includes("\0")
  ) {
    throw new TypeError(`invalid team worktree record ${field}`);
  }
  return value;
}

function requireGitOid(value, field) {
  if (typeof value !== "string" || !/^[a-f0-9]{40,64}$/i.test(value)) {
    throw new TypeError(`invalid team worktree record ${field}`);
  }
  return value.toLowerCase();
}

function emptyIntegrationState() {
  return {
    previewed: false,
    clean: null,
    merged: false,
    baseCommit: null,
    mergeCommit: null,
  };
}

function normalizeIntegrationState(value, key) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`invalid team worktree integration state for "${key}"`);
  }
  if (
    typeof value.previewed !== "boolean" ||
    (value.clean !== null && typeof value.clean !== "boolean") ||
    typeof value.merged !== "boolean" ||
    (value.baseCommit !== null &&
      !/^[a-f0-9]{40,64}$/i.test(value.baseCommit)) ||
    (value.mergeCommit !== null &&
      !/^[a-f0-9]{40,64}$/i.test(value.mergeCommit)) ||
    (!value.previewed &&
      (value.clean !== null ||
        value.merged ||
        value.baseCommit !== null ||
        value.mergeCommit !== null)) ||
    (value.previewed &&
      (typeof value.clean !== "boolean" || value.baseCommit == null)) ||
    (!value.merged && value.mergeCommit !== null) ||
    (value.merged && (value.clean !== true || value.mergeCommit == null))
  ) {
    throw new TypeError(`invalid team worktree integration state for "${key}"`);
  }
  return {
    previewed: value.previewed,
    clean: value.clean,
    merged: value.merged,
    baseCommit: value.baseCommit?.toLowerCase() || null,
    mergeCommit: value.mergeCommit?.toLowerCase() || null,
  };
}

function normalizeBaseTarget(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("invalid team worktree base target");
  }
  const branch = value.branch;
  if (branch !== null && !isGitSafeBranch(branch)) {
    throw new TypeError("invalid team worktree base branch");
  }
  return {
    branch,
    commitOid: requireGitOid(value.commitOid, "baseTarget.commitOid"),
  };
}

function normalizeManagedLinks(value, key) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new TypeError(`invalid team worktree managed links for "${key}"`);
  }
  const seen = new Set();
  const links = [];
  for (const item of value) {
    const link = requireRecordString(item, "managedLinks");
    if (seen.has(link)) {
      throw new TypeError(`duplicate team worktree managed link for "${key}"`);
    }
    seen.add(link);
    links.push(link);
  }
  return links;
}

export class TeamWorktreeCoordinator {
  constructor(repoDir, options = {}) {
    this.repoDir = repoDir;
    this.runId = normalizeRunId(options.runId);
    this._baseTarget = null;
    this._created = new Map(); // key → { branch, path, committed }
    // Coordinator-wide sparse-checkout / dependency-symlink defaults; a per-task
    // value (task.sparsePaths / task.metadata.sparsePaths) overrides these.
    this._worktreeDefaults = {
      sparsePaths: options.sparsePaths ?? null,
      symlinkDirectories: options.symlinkDirectories ?? null,
    };
    this._onWorktree =
      typeof options.onWorktree === "function" ? options.onWorktree : null;
    const recovered =
      options.snapshot ??
      options.recover ??
      options.seedRecords ??
      options.seed ??
      null;
    if (recovered) {
      if (Array.isArray(recovered)) this.seed(recovered);
      else this.restore(recovered);
    }
    if (
      this._baseTarget == null &&
      (this._created.size > 0 || _deps.isGitRepo(this.repoDir))
    ) {
      this._captureBaseTarget();
    }
  }

  isGitRepo() {
    return _deps.isGitRepo(this.repoDir);
  }

  _captureBaseTarget() {
    this._baseTarget = {
      branch: _deps.resolveGitBranch(this.repoDir),
      commitOid: requireGitOid(
        _deps.resolveGitRef(this.repoDir, "HEAD"),
        "baseTarget.commitOid",
      ),
    };
    return { ...this._baseTarget };
  }

  _assertBaseTarget({ merge = false } = {}) {
    if (this._baseTarget == null) this._captureBaseTarget();
    const currentBranch = _deps.resolveGitBranch(this.repoDir);
    const currentHead = requireGitOid(
      _deps.resolveGitRef(this.repoDir, "HEAD"),
      "baseTarget.currentHead",
    );
    if (currentBranch !== this._baseTarget.branch) {
      throw requireAdjudication(
        new Error(
          `team worktree base target changed from ${
            this._baseTarget.branch || "detached HEAD"
          } to ${currentBranch || "detached HEAD"}`,
        ),
        "TEAM_WORKTREE_BASE_ADJUDICATION_REQUIRED",
      );
    }
    if (currentBranch == null) {
      if (merge) {
        throw requireAdjudication(
          new Error(
            "refusing to merge team worktrees into a detached HEAD; check out the persisted base branch first",
          ),
          "TEAM_WORKTREE_BASE_ADJUDICATION_REQUIRED",
        );
      }
      if (currentHead !== this._baseTarget.commitOid) {
        throw requireAdjudication(
          new Error(
            "detached team worktree base HEAD moved after run creation",
          ),
          "TEAM_WORKTREE_BASE_ADJUDICATION_REQUIRED",
        );
      }
    } else if (
      currentHead !== this._baseTarget.commitOid &&
      !_deps.isGitAncestor(
        this.repoDir,
        this._baseTarget.commitOid,
        currentHead,
      )
    ) {
      throw requireAdjudication(
        new Error(
          `team worktree base branch "${currentBranch}" no longer descends from its persisted start commit`,
        ),
        "TEAM_WORKTREE_BASE_ADJUDICATION_REQUIRED",
      );
    }
    return { branch: currentBranch, currentHead };
  }

  branchFor(key) {
    if (this.runId == null) return `team/${key}`;
    requireRecordString(key, "key");
    return `team/${safeGitSegment(this.runId, "run")}/${safeGitSegment(
      key,
      "task",
    )}`;
  }

  /** Seed validated worktree records after recovering team state. */
  seed(records) {
    if (!Array.isArray(records)) {
      throw new TypeError("team worktree seed must be an array");
    }
    const normalized = [];
    const keys = new Set(this._created.keys());
    for (const record of records) {
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        throw new TypeError("invalid team worktree record");
      }
      const key = requireRecordString(record.key, "key");
      const branch = requireRecordString(record.branch, "branch");
      const worktreePath = _deps.assertManagedWorktreePath(
        this.repoDir,
        requireRecordString(record.path, "path"),
        { branchName: branch },
      );
      if (!isGitSafeBranch(branch)) {
        throw new TypeError(`invalid team worktree record branch for "${key}"`);
      }
      if (branch !== this.branchFor(key)) {
        throw new Error(`team worktree branch does not match key "${key}"`);
      }
      if (keys.has(key)) {
        throw new Error(`duplicate team worktree record "${key}"`);
      }
      const committed = record.committed;
      const completed = record.completed ?? true;
      const cleanupPrepared = record.cleanupPrepared;
      const cleaned = record.cleaned;
      if (
        typeof committed !== "boolean" ||
        typeof completed !== "boolean" ||
        typeof cleanupPrepared !== "boolean" ||
        typeof cleaned !== "boolean"
      ) {
        throw new TypeError(
          `invalid team worktree completion state for "${key}"`,
        );
      }
      const commitOid = completed
        ? requireGitOid(record.commitOid, "commitOid")
        : record.commitOid == null
          ? null
          : requireGitOid(record.commitOid, "commitOid");
      const integration = normalizeIntegrationState(record.integration, key);
      const managedLinks = normalizeManagedLinks(record.managedLinks, key);
      if (
        !completed &&
        (committed ||
          commitOid !== null ||
          integration.previewed ||
          cleanupPrepared ||
          cleaned)
      ) {
        throw new TypeError(
          `invalid unfinished team worktree recovery state for "${key}"`,
        );
      }
      if (
        cleanupPrepared &&
        (!integration.previewed || integration.clean !== true)
      ) {
        throw new TypeError(
          `prepared team worktree "${key}" has no clean integration record`,
        );
      }
      if (cleaned && !cleanupPrepared) {
        throw new TypeError(
          `cleaned team worktree "${key}" has no cleanup authorization`,
        );
      }
      keys.add(key);
      normalized.push({
        key,
        info: {
          branch,
          path: worktreePath,
          committed,
          completed,
          commitOid,
          integration,
          managedLinks,
          cleanupPrepared,
          cleaned,
        },
      });
    }
    for (const { key, info } of normalized) this._created.set(key, info);
    return this;
  }

  /** Return a detached, JSON-safe recovery snapshot. */
  snapshot() {
    return {
      version: TEAM_WORKTREE_SNAPSHOT_VERSION,
      runId: this.runId,
      baseTarget: this._baseTarget ? { ...this._baseTarget } : null,
      records: Array.from(this._created, ([key, info]) => ({
        key,
        branch: info.branch,
        path: info.path,
        committed: info.committed === true,
        completed: info.completed === true,
        commitOid: info.commitOid || null,
        integration: { ...info.integration },
        managedLinks: [...(info.managedLinks || [])],
        cleanupPrepared: info.cleanupPrepared === true,
        cleaned: info.cleaned === true,
      })),
    };
  }

  /** Restore a snapshot into an empty coordinator. */
  restore(snapshot) {
    if (this._created.size > 0) {
      throw new Error(
        "cannot restore team worktrees into a non-empty coordinator",
      );
    }
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      Array.isArray(snapshot) ||
      snapshot.version !== TEAM_WORKTREE_SNAPSHOT_VERSION ||
      !snapshot.baseTarget ||
      !Array.isArray(snapshot.records)
    ) {
      throw new TypeError("invalid team worktree snapshot");
    }
    const snapshotRunId = normalizeRunId(snapshot.runId);
    const previousRunId = this.runId;
    const previousBaseTarget = this._baseTarget;
    if (this.runId == null) {
      this.runId = snapshotRunId;
    } else if (snapshotRunId !== this.runId) {
      throw new Error("team worktree snapshot runId mismatch");
    }
    this._baseTarget = normalizeBaseTarget(snapshot.baseTarget);
    try {
      return this.seed(snapshot.records);
    } catch (error) {
      this.runId = previousRunId;
      this._baseTarget = previousBaseTarget;
      throw error;
    }
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
    return async (context) => {
      const { key, task, holder } = context;
      this._assertBaseTarget();
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
        if (prior.completed) {
          throw requireAdjudication(
            new Error(`task "${key}" already has completed worktree output`),
            "TEAM_WORKTREE_RETRY_ADJUDICATION_REQUIRED",
          );
        }
        const priorPath = _deps.assertManagedWorktreePath(
          this.repoDir,
          prior.path,
          { branchName: prior.branch },
        );
        const priorBranchHead = _deps.resolveGitRef(this.repoDir, prior.branch);
        const baseHead = _deps.resolveGitRef(this.repoDir, "HEAD");
        if (priorBranchHead !== baseHead) {
          throw requireAdjudication(
            new Error(`task "${key}" has an unsettled worktree commit`),
            "TEAM_WORKTREE_RETRY_ADJUDICATION_REQUIRED",
          );
        }
        try {
          if (_deps.pathExists(priorPath)) {
            if (_deps.resolveGitRef(priorPath, "HEAD") !== priorBranchHead) {
              throw new Error("worktree HEAD moved");
            }
            _deps.removeManagedDependencyLinks(
              this.repoDir,
              priorPath,
              prior.managedLinks || [],
            );
            if (!_deps.isWorktreeClean(priorPath, { includeIgnored: true })) {
              throw new Error("worktree has unsettled or ignored files");
            }
          }
          _deps.removeWorktree(this.repoDir, priorPath, {
            deleteBranch: true,
            branchName: prior.branch,
            expectedBranchOid: priorBranchHead,
            force: false,
          });
        } catch (error) {
          throw requireAdjudication(
            new Error(
              `task "${key}" retry would discard unsettled worktree changes: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
            "TEAM_WORKTREE_RETRY_ADJUDICATION_REQUIRED",
          );
        }
        this._created.delete(key);
      }
      const wtOptions = resolveWorktreeOptions(task, this._worktreeDefaults);
      const created = _deps.createWorktree(
        this.repoDir,
        branch,
        null,
        wtOptions,
      );
      const createdPath = created.path;
      const worktreePath = _deps.assertManagedWorktreePath(
        this.repoDir,
        createdPath,
        { branchName: branch },
      );
      this._created.set(key, {
        branch,
        path: worktreePath,
        committed: false,
        completed: false,
        commitOid: null,
        integration: emptyIntegrationState(),
        managedLinks: normalizeManagedLinks(
          created.symlinkedDirectories || [],
          key,
        ),
        cleanupPrepared: false,
        cleaned: false,
      });
      this._onWorktree?.({ key, branch, path: worktreePath, holder });
      if (typeof context.renew === "function") {
        const fence = await context.renew();
        if (!fence?.ok) {
          throw requireAdjudication(
            new Error(
              `task "${key}" lost its lease while creating its worktree`,
            ),
            "TEAM_WORKTREE_CREATE_ADJUDICATION_REQUIRED",
          );
        }
      }
      if (
        context.signal?.aborted ||
        context.budget?.reason?.() === "max-wall-ms"
      ) {
        throw requireAdjudication(
          new Error(`task "${key}" was cancelled before execution`),
          "TEAM_WORKTREE_EXECUTION_CANCELLED",
        );
      }
      let executionResult = null;
      try {
        if (typeof runInWorktree === "function") {
          executionResult = await runInWorktree({
            ...context,
            cwd: worktreePath,
          });
        } else {
          const command = task.metadata?.command || task?.command;
          if (!command) {
            throw new Error(
              `task "${key}" has no \`command\` to run in a worktree`,
            );
          }
          await _deps.runShell(command, worktreePath, {
            signal: context.signal || null,
          });
        }
      } catch (error) {
        if (task.metadata?.retrySafe === true) throw error;
        throw requireAdjudication(
          error,
          "TEAM_WORKTREE_EXECUTION_ADJUDICATION_REQUIRED",
        );
      }
      if (context.signal?.aborted) {
        throw requireAdjudication(
          new Error(`task "${key}" was cancelled before commit`),
          "TEAM_WORKTREE_COMMIT_CANCELLED",
        );
      }
      let committed;
      let commitOid;
      try {
        committed = _deps.commit(worktreePath, `team task ${key}`);
        commitOid = _deps.resolveGitRef(worktreePath, "HEAD");
      } catch (error) {
        throw requireAdjudication(
          error,
          "TEAM_WORKTREE_COMMIT_ADJUDICATION_REQUIRED",
        );
      }
      // Git commit/ref resolution are synchronous today. Yield once so a wall
      // timer, fatal peer failure, or cancellation that became ready while Git
      // held the event loop can fence this output before it is authorized.
      await new Promise((resolveYield) => setImmediate(resolveYield));
      if (context.signal?.aborted) {
        throw requireAdjudication(
          new Error(`task "${key}" was cancelled after commit`),
          "TEAM_WORKTREE_POST_COMMIT_ADJUDICATION_REQUIRED",
        );
      }
      if (typeof context.renew === "function") {
        const fence = await context.renew();
        if (!fence?.ok) {
          throw requireAdjudication(
            new Error(
              `task "${key}" lost its lease after committing worktree output`,
            ),
            "TEAM_WORKTREE_POST_COMMIT_ADJUDICATION_REQUIRED",
          );
        }
      }
      if (context.budget?.reason?.() === "max-wall-ms") {
        throw requireAdjudication(
          new Error(
            `task "${key}" exceeded the team wall-clock budget during commit`,
          ),
          "TEAM_WORKTREE_POST_COMMIT_ADJUDICATION_REQUIRED",
        );
      }
      const record = this._created.get(key);
      record.committed = committed;
      record.completed = true;
      record.commitOid = commitOid;
      return {
        branch,
        committed,
        ...(executionResult?.usage ? { usage: executionResult.usage } : {}),
        ...(executionResult?.provider
          ? { provider: executionResult.provider }
          : {}),
        ...(executionResult?.model ? { model: executionResult.model } : {}),
        ...(executionResult?.usageRecords
          ? { usageRecords: executionResult.usageRecords }
          : {}),
      };
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
    this._assertBaseTarget({ merge });
    const results = [];
    for (const [key, info] of this._created) {
      const target = this._assertBaseTarget({ merge });
      if (info.completed === false) {
        results.push({
          key,
          branch: info.branch,
          committed: false,
          clean: false,
          merged: false,
          conflicts: [],
          note: "task did not complete",
        });
        continue;
      }
      if (info.integration.merged) {
        try {
          if (
            !_deps.isGitAncestor(
              this.repoDir,
              info.commitOid,
              target.currentHead,
            )
          ) {
            throw new Error(
              `merged worktree commit for "${key}" is no longer in HEAD`,
            );
          }
          results.push({
            key,
            branch: info.branch,
            committed: info.committed,
            clean: true,
            merged: true,
            conflicts: [],
            recovered: true,
          });
        } catch (error) {
          results.push({
            key,
            branch: info.branch,
            committed: info.committed,
            clean: false,
            merged: false,
            conflicts: [],
            error: error instanceof Error ? error.message : String(error),
          });
        }
        continue;
      }
      const worktreeMissing = !_deps.pathExists(info.path);
      if (info.cleaned || (info.cleanupPrepared && worktreeMissing)) {
        try {
          const branchHead = _deps.resolveGitRef(this.repoDir, info.branch);
          if (branchHead !== info.commitOid) {
            throw new Error(
              `worktree branch "${info.branch}" moved after task settlement`,
            );
          }
          if (
            !info.integration.previewed ||
            info.integration.clean !== true ||
            (merge && info.committed) ||
            (info.committed &&
              info.integration.baseCommit !== target.currentHead)
          ) {
            throw new Error(
              `persisted merge preview for "${key}" is stale or incomplete`,
            );
          }
          results.push({
            key,
            branch: info.branch,
            committed: info.committed,
            clean: true,
            merged: false,
            conflicts: [],
            recovered: true,
            note: "reused persisted merge preview",
          });
        } catch (error) {
          results.push({
            key,
            branch: info.branch,
            committed: info.committed,
            clean: false,
            merged: false,
            conflicts: [],
            error: error instanceof Error ? error.message : String(error),
          });
        }
        continue;
      }
      let branchHead;
      let baseHead;
      try {
        branchHead = _deps.resolveGitRef(this.repoDir, info.branch);
        if (branchHead !== info.commitOid) {
          throw new Error(
            `worktree branch "${info.branch}" moved after task settlement`,
          );
        }
        if (worktreeMissing) {
          throw new Error(
            `worktree for "${key}" is missing before integration`,
          );
        }
        const worktreeHead = _deps.resolveGitRef(info.path, "HEAD");
        if (worktreeHead !== info.commitOid) {
          throw new Error(
            `worktree HEAD for "${key}" moved after task settlement`,
          );
        }
        if (!_deps.isWorktreeClean(info.path)) {
          throw new Error(
            `worktree "${key}" has unsettled tracked or untracked changes`,
          );
        }
        baseHead = target.currentHead;
      } catch (error) {
        results.push({
          key,
          branch: info.branch,
          committed: info.committed,
          clean: false,
          merged: false,
          conflicts: [],
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      if (!info.committed) {
        const recovered = info.integration.previewed === true;
        info.integration = {
          previewed: true,
          clean: true,
          merged: false,
          baseCommit: info.integration.baseCommit || baseHead,
          mergeCommit: null,
        };
        results.push({
          key,
          branch: info.branch,
          committed: false,
          clean: true,
          merged: false,
          conflicts: [],
          recovered,
          note: "no changes to merge",
        });
        continue;
      }
      // A crash may happen after Git merged a branch but before the updated
      // integration record was persisted. Prove ancestry and settle it without
      // replaying the merge.
      if (
        merge &&
        _deps.isGitAncestor(this.repoDir, info.commitOid, target.currentHead)
      ) {
        info.integration = {
          previewed: true,
          clean: true,
          merged: true,
          baseCommit: info.integration.baseCommit || baseHead,
          mergeCommit: baseHead,
        };
        results.push({
          key,
          branch: info.branch,
          committed: info.committed,
          clean: true,
          merged: true,
          conflicts: [],
          recovered: true,
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
      try {
        const postPreviewTarget = this._assertBaseTarget({ merge });
        const postPreviewBranch = _deps.resolveGitRef(
          this.repoDir,
          info.branch,
        );
        if (
          postPreviewTarget.currentHead !== baseHead ||
          postPreviewBranch !== info.commitOid
        ) {
          throw new Error(
            `Git refs moved while previewing worktree "${key}"; retry integration`,
          );
        }
      } catch (error) {
        results.push({
          key,
          branch: info.branch,
          committed: true,
          clean: false,
          merged: false,
          conflicts: [],
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      const clean = preview?.success === true;
      const conflicts = preview?.conflicts || [];
      info.integration = {
        previewed: true,
        clean,
        merged: false,
        baseCommit: baseHead,
        mergeCommit: null,
      };
      let merged = false;
      if (clean && merge) {
        // mergeWorktree does NOT throw on a failed merge — it catches internally
        // and RETURNS {success:false, conflicts?, message} (a conflict the clean
        // preview didn't predict, or any non-conflict git failure). The old
        // try/catch was dead for that path and set merged:true unconditionally,
        // reporting a real merge failure as success with empty conflicts. Inspect
        // the return value. (The try still catches assertSafeGitRef, the only
        // throw path — a malformed branch ref.)
        let mergeResult;
        try {
          this._assertBaseTarget({ merge: true });
          mergeResult = _deps.mergeWorktree(this.repoDir, info.commitOid, {
            message: `Merge team task ${key}`,
            deleteBranch: false,
          });
        } catch (err) {
          mergeResult = { success: false, message: err.message };
        }
        if (mergeResult?.success === true) {
          try {
            const mergedTarget = this._assertBaseTarget({ merge: true });
            const mergeCommit = mergedTarget.currentHead;
            if (
              !_deps.isGitAncestor(this.repoDir, info.commitOid, mergeCommit)
            ) {
              throw new Error(
                `merged worktree commit for "${key}" is not in HEAD`,
              );
            }
            merged = true;
            info.integration = {
              ...info.integration,
              merged: true,
              mergeCommit,
            };
          } catch (error) {
            info.integration.clean = false;
            results.push({
              key,
              branch: info.branch,
              committed: true,
              clean: false,
              merged: false,
              conflicts: [],
              error: error instanceof Error ? error.message : String(error),
            });
            continue;
          }
        } else {
          info.integration.clean = false;
          results.push({
            key,
            branch: info.branch,
            committed: true,
            clean: false,
            merged: false,
            conflicts: mergeResult?.conflicts?.length
              ? mergeResult.conflicts
              : conflicts,
            error: `merge failed: ${mergeResult?.message || "unknown error"}`,
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

  /**
   * Durable phase one of cleanup. The caller must persist the resulting
   * snapshot before deleting anything. A recovered `cleanupPrepared` record is
   * sufficient proof that a missing worktree may be finalized without rerunning
   * its task or replaying integration.
   */
  prepareCleanupAll({ requireMerged = false } = {}) {
    const results = [];
    for (const [key, info] of this._created) {
      if (info.cleaned || info.cleanupPrepared) {
        results.push({
          key,
          ok: true,
          alreadyPrepared: true,
        });
        continue;
      }
      if (!info.completed) {
        throw new Error(
          `refusing to prepare unfinished worktree "${key}" for cleanup`,
        );
      }
      if (!info.integration.previewed || info.integration.clean !== true) {
        throw new Error(
          `refusing to prepare worktree "${key}" before clean integration`,
        );
      }
      if (requireMerged && info.committed && !info.integration.merged) {
        throw new Error(
          `refusing to prepare unmerged worktree "${key}" for cleanup`,
        );
      }
      info.cleanupPrepared = true;
      results.push({ key, ok: true });
    }
    return results;
  }

  /**
   * Remove every worktree created for this run (branches left intact).
   * Failed removals remain in the recovery snapshot and are returned to the
   * caller; they are never hidden by clearing the entire in-memory manifest.
   */
  cleanupAll({ deleteBranch = false } = {}) {
    const results = [];
    for (const [key, info] of Array.from(this._created)) {
      if (info.cleaned) {
        results.push({
          key,
          ok: true,
          path: info.path,
          alreadyCleaned: true,
        });
        continue;
      }
      try {
        if (!info.cleanupPrepared) {
          throw new Error(
            `refusing to clean worktree "${key}" before durable preparation`,
          );
        }
        if (deleteBranch && info.committed && !info.integration.merged) {
          throw new Error(
            `refusing to delete unmerged worktree branch "${key}"`,
          );
        }
        const branchHead = _deps.resolveGitRef(this.repoDir, info.branch);
        if (branchHead !== info.commitOid) {
          throw new Error(
            `refusing to clean worktree "${key}" after its branch moved`,
          );
        }
        const worktreePath = _deps.assertManagedWorktreePath(
          this.repoDir,
          info.path,
          { branchName: info.branch },
        );
        if (_deps.pathExists(worktreePath)) {
          const worktreeHead = _deps.resolveGitRef(worktreePath, "HEAD");
          if (worktreeHead !== info.commitOid) {
            throw new Error(
              `refusing to clean worktree "${key}" after its HEAD moved`,
            );
          }
          _deps.removeManagedDependencyLinks(
            this.repoDir,
            worktreePath,
            info.managedLinks || [],
          );
          if (!_deps.isWorktreeClean(worktreePath, { includeIgnored: true })) {
            throw new Error(
              `refusing to clean worktree "${key}" with unsettled or ignored files`,
            );
          }
        }
        _deps.removeWorktree(this.repoDir, worktreePath, {
          deleteBranch,
          branchName: info.branch,
          expectedBranchOid: info.commitOid,
          force: false,
        });
        info.cleaned = true;
        results.push({ key, ok: true, path: worktreePath });
      } catch (error) {
        results.push({
          key,
          ok: false,
          path: info.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }

  branches() {
    return Array.from(this._created.values())
      .filter((info) => !info.cleaned)
      .map((info) => info.branch);
  }
}
