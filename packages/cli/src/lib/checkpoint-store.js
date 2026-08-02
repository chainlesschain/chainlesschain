/**
 * Checkpoint store — file-level snapshot + rewind via git plumbing.
 *
 * A checkpoint is a full working-tree snapshot captured as a "shadow commit"
 * under the `refs/cc-checkpoints/<session>/<id>` ref namespace. It is built with
 * a TEMPORARY index (GIT_INDEX_FILE) so the user's real index and working tree
 * are never touched on capture — safe to run alongside a normal `git` workflow
 * or a parallel session (see memory `plumbing_rebase_parallel_session`).
 *
 * Rewind restores the working tree to a checkpoint's tree (this DOES write the
 * working tree — that's the point), auto-creating a safety checkpoint first so
 * a rewind is itself undoable.
 *
 * Snapshots respect .gitignore (via `git add -A`), so node_modules / build
 * output are not captured — only the source the agent can meaningfully edit.
 *
 * Requires the cwd to be inside a git work tree; coding-agent cwd almost always
 * is. When it is not, callers should fall back / report unavailable.
 */

import { createHash } from "node:crypto";
import { realpathSync, rmSync } from "node:fs";
import path from "node:path";
import executionBroker from "./process-execution-broker/index.js";
import { credentialAgent } from "./process-execution-broker/credential-agent.js";

export const _deps = {
  spawnSync: (...args) => executionBroker.spawnSync(...args),
};

const REF_NS = "refs/cc-checkpoints";
// Publishing a checkpoint is an optimistic ref transaction. A busy session can
// move between the id/tip scan and the transaction, so retry from a fresh tip
// and rebuild the shadow commit. Keep the bound finite: a permanently locked
// or externally churned namespace must fail instead of spinning forever.
const MAX_REF_PUBLISH_ATTEMPTS = 16;
const WORKSPACE_BINDING_SCHEMA = "cc-checkpoint-workspace-binding/v1";
const WORKSPACE_BINDING_KEYS = Object.freeze([
  "engine",
  "prestateIdentity",
  "schema",
  "scopeIdentity",
  "targetPoststateIdentity",
  "version",
  "workspaceRoot",
  "writePlanIdentity",
]);
// Deterministic identity for shadow commits so `git commit-tree` never trips on
// a missing user.name / user.email config.
const CHECKPOINT_IDENTITY = Object.freeze({
  GIT_AUTHOR_NAME: "cc-checkpoint",
  GIT_AUTHOR_EMAIL: "checkpoint@chainlesschain.local",
  GIT_COMMITTER_NAME: "cc-checkpoint",
  GIT_COMMITTER_EMAIL: "checkpoint@chainlesschain.local",
});
const INTERNAL_GIT_ENV_KEYS = new Set([
  "GIT_INDEX_FILE",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
]);

function checkpointGitEnvironment(overrides = null) {
  const environment = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      !credentialAgent.isSensitiveKey(key) &&
      !credentialAgent.isReservedAgentKey(key)
    ) {
      environment[key] = value;
    }
  }
  for (const [key, value] of Object.entries(overrides || {})) {
    if (!INTERNAL_GIT_ENV_KEYS.has(key)) {
      throw new Error(`Unsupported checkpoint git environment key: ${key}`);
    }
    environment[key] = value;
  }
  return environment;
}

/**
 * Run git with an argv array (no shell → no quoting hazards). UTF-8 in/out.
 *
 * @param {string[]} args
 * @param {object} [opts] { cwd, env, input }
 * @returns {string} trimmed stdout
 * @throws {Error} with git's stderr when the command fails
 */
function git(args, { cwd, env, input } = {}) {
  const res = _deps.spawnSync("git", args, {
    origin: "checkpoint:git",
    scope: "checkpoint",
    policy: "allow",
    shell: false,
    cwd,
    input,
    encoding: "utf-8",
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
    // Local plumbing never needs provider/API credentials. Passing the whole
    // parent environment would mint short-lived credential references on every
    // git subprocess and can exhaust the Broker store during a long restore.
    env: checkpointGitEnvironment(env),
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const msg = (res.stderr || res.stdout || "").toString().trim();
    throw new Error(msg || `git ${args.join(" ")} failed (exit ${res.status})`);
  }
  return (res.stdout || "").toString().trim();
}

/** Best-effort: is this a usable git work tree (and is git on PATH)? */
export function isCheckpointAvailable(cwd = process.cwd()) {
  try {
    return git(["rev-parse", "--is-inside-work-tree"], { cwd }) === "true";
  } catch {
    return false;
  }
}

/** Absolute top-level of the work tree — all snapshots are repo-wide. */
function repoRoot(cwd) {
  return git(["rev-parse", "--show-toplevel"], { cwd });
}

/** Absolute .git dir, where temp index files live. */
function gitDir(root) {
  return path.resolve(root, git(["rev-parse", "--git-dir"], { cwd: root }));
}

function canonicalPath(target) {
  return path.normalize(realpathSync.native(path.resolve(target)));
}

function pathIdentity(target) {
  const canonical = canonicalPath(target);
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

function sha256Identity(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function commonGitDir(root) {
  return path.resolve(
    root,
    git(["rev-parse", "--git-common-dir"], { cwd: root }),
  );
}

function buildWorkspaceBinding(
  root,
  dir,
  { targetCommit, targetTree, currentTree },
) {
  const workspaceRoot = canonicalPath(root);
  const scopeIdentity = sha256Identity(
    JSON.stringify({
      schema: "cc-checkpoint-git-scope/v1",
      workspaceRoot: pathIdentity(workspaceRoot),
      gitDir: pathIdentity(dir),
      gitCommonDir: pathIdentity(commonGitDir(root)),
    }),
  );
  const writePlanIdentity = sha256Identity(
    JSON.stringify({
      schema: "cc-checkpoint-git-write-plan/v1",
      checkpointCommit: targetCommit,
      targetTree,
      currentTree,
      scopeIdentity,
    }),
  );
  return {
    schema: WORKSPACE_BINDING_SCHEMA,
    version: 1,
    engine: "git",
    workspaceRoot,
    scopeIdentity,
    prestateIdentity: `git-tree:${currentTree}`,
    writePlanIdentity,
    targetPoststateIdentity: `git-tree:${targetTree}`,
  };
}

function validWorkspaceBinding(binding) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    return false;
  }
  const keys = Object.keys(binding).sort();
  if (
    keys.length !== WORKSPACE_BINDING_KEYS.length ||
    keys.some((key, index) => key !== WORKSPACE_BINDING_KEYS[index])
  ) {
    return false;
  }
  const gitTreeIdentity = /^git-tree:(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
  return (
    binding.schema === WORKSPACE_BINDING_SCHEMA &&
    binding.version === 1 &&
    binding.engine === "git" &&
    typeof binding.workspaceRoot === "string" &&
    path.isAbsolute(binding.workspaceRoot) &&
    /^sha256:[a-f0-9]{64}$/.test(binding.scopeIdentity) &&
    gitTreeIdentity.test(binding.prestateIdentity) &&
    /^sha256:[a-f0-9]{64}$/.test(binding.writePlanIdentity) &&
    gitTreeIdentity.test(binding.targetPoststateIdentity)
  );
}

function workspaceBindingStaleError(
  idOrRef,
  expectedWorkspaceBinding,
  actualWorkspaceBinding,
  reason,
) {
  const error = new Error(
    `Checkpoint workspace changed before restore: ${idOrRef}`,
  );
  error.code = "CHECKPOINT_WORKSPACE_STALE";
  error.checkpointId = idOrRef;
  error.reason = reason;
  error.expectedWorkspaceBinding = expectedWorkspaceBinding;
  error.actualWorkspaceBinding = actualWorkspaceBinding;
  return error;
}

function assertWorkspaceBinding(
  idOrRef,
  expectedWorkspaceBinding,
  actualWorkspaceBinding,
) {
  if (!validWorkspaceBinding(expectedWorkspaceBinding)) {
    throw workspaceBindingStaleError(
      idOrRef,
      expectedWorkspaceBinding,
      actualWorkspaceBinding,
      "invalid-expected-binding",
    );
  }
  for (const key of WORKSPACE_BINDING_KEYS) {
    if (expectedWorkspaceBinding[key] !== actualWorkspaceBinding[key]) {
      throw workspaceBindingStaleError(
        idOrRef,
        expectedWorkspaceBinding,
        actualWorkspaceBinding,
        `mismatch:${key}`,
      );
    }
  }
}

function checkpointRestoreHookError(name, reason) {
  const error = new Error(`${name} ${reason}`);
  error.code = "CHECKPOINT_RESTORE_HOOK_INVALID";
  error.hook = name;
  return error;
}

function assertSynchronousRestoreHook(name, hook) {
  if (hook == null) return;
  if (
    typeof hook !== "function" ||
    hook.constructor?.name === "AsyncFunction"
  ) {
    throw checkpointRestoreHookError(name, "must be a synchronous function");
  }
}

function callSynchronousRestoreHook(name, hook, payload) {
  if (hook == null) return;
  const result = hook(Object.freeze(payload));
  if (
    result != null &&
    (typeof result === "object" || typeof result === "function") &&
    typeof result.then === "function"
  ) {
    throw checkpointRestoreHookError(
      name,
      "must not return a promise or thenable",
    );
  }
}

function checkpointSafetyStaleError(safety, reason, actualIdentity = null) {
  const error = new Error(
    `Checkpoint safety state changed before restore: ${safety.id}`,
  );
  error.code = "CHECKPOINT_SAFETY_STALE";
  error.checkpointId = safety.id;
  error.reason = reason;
  error.expectedIdentity = `git:${safety.commit}`;
  error.actualIdentity = actualIdentity;
  return error;
}

function assertDurableSafetyCheckpoint(root, safety, expectedTree) {
  const actualCommit = readRef(root, safety.ref);
  if (actualCommit !== safety.commit) {
    throw checkpointSafetyStaleError(
      safety,
      "ref-identity-changed",
      actualCommit ? `git:${actualCommit}` : null,
    );
  }

  let actualTree = null;
  try {
    actualTree = git(["rev-parse", `${actualCommit}^{tree}`], { cwd: root });
  } catch {
    throw checkpointSafetyStaleError(
      safety,
      "commit-unavailable",
      `git:${actualCommit}`,
    );
  }
  if (safety.tree !== expectedTree || actualTree !== expectedTree) {
    throw checkpointSafetyStaleError(
      safety,
      "prestate-tree-mismatch",
      `git:${actualCommit}`,
    );
  }
}

function assertRestoreWorkspacePrestate(
  root,
  dir,
  idOrRef,
  expectedWorkspaceBinding,
  { targetCommit, targetTree },
) {
  const observedTree = snapshotTree(root, dir);
  if (
    `git-tree:${observedTree}` === expectedWorkspaceBinding.prestateIdentity
  ) {
    return;
  }
  const actualWorkspaceBinding = buildWorkspaceBinding(root, dir, {
    targetCommit,
    targetTree,
    currentTree: observedTree,
  });
  throw workspaceBindingStaleError(
    idOrRef,
    expectedWorkspaceBinding,
    actualWorkspaceBinding,
    "mismatch:prestateIdentity",
  );
}

/**
 * Ref-safe session segment. Beyond the charset filter, enforce git's per-
 * component ref rules so a legit-looking name never makes every checkpoint op
 * throw: a component may not begin with `.`, contain `..`, or end with `.lock`
 * (`/` is already collapsed to `-`, so the session is always a single segment
 * and cannot traverse the ref namespace).
 */
function sanitizeSession(session) {
  let s = String(session || "default").replace(/[^A-Za-z0-9._-]/g, "-");
  s = s.replace(/\.{2,}/g, "."); // git forbids ".." in a refname
  s = s.replace(/^\.+/, ""); // a component may not begin with "."
  s = s.replace(/\.lock$/i, "-lock"); // nor end with ".lock"
  s = s.replace(/\.+$/, ""); // nor end with a dot
  return s || "default";
}

function sessionPrefix(session) {
  return `${REF_NS}/${sanitizeSession(session)}`;
}

function readRef(root, ref) {
  try {
    return (
      git(["rev-parse", "--verify", "--quiet", ref], { cwd: root }) || null
    );
  } catch {
    return null;
  }
}

function isRefTransactionConflict(error) {
  return /(?:cannot lock ref|unable to create .*\.lock|reference already exists|is at .* but expected)/i.test(
    String(error?.message || error || ""),
  );
}

/**
 * Atomically publish an immutable checkpoint id and advance the session tip.
 *
 * `checkpointRef` uses the all-zero old oid, so an id observed as free can
 * never overwrite a concurrently published checkpoint. `_tip` is updated with
 * the exact oid observed before `commit-tree`; the two updates share one Git
 * ref transaction. Consequently `_tip` is the head of a linear, atomically
 * published session chain, and every successful commit has the previous tip as
 * its parent. A transaction conflict publishes neither ref.
 */
function publishCheckpointRefs(
  root,
  { checkpointRef, tipRef, commit, expectedTip },
) {
  // Git accepts an all-zero old oid as "this ref must not exist". Match the
  // repository's object format (SHA-1 or SHA-256) via the new commit length.
  const zeroOid = "0".repeat(commit.length);
  const input = [
    "start",
    `update ${checkpointRef} ${commit} ${zeroOid}`,
    `update ${tipRef} ${commit} ${expectedTip || zeroOid}`,
    "prepare",
    "commit",
    "",
  ].join("\n");
  git(["update-ref", "--stdin"], { cwd: root, input });
}

// Monotonic per-process counter so two temp-index paths minted in the same
// millisecond never collide. pid disambiguates across processes; Date.now() +
// this counter disambiguate within one. A collision would mean two operations
// sharing one GIT_INDEX_FILE (corrupt snapshot) or one's cleanup deleting the
// other's live index.
let _indexSeq = 0;

/** Unique temp index path inside .git (never the real index). */
function tempIndexPath(dir) {
  _indexSeq = (_indexSeq + 1) >>> 0;
  return path.join(
    dir,
    `cc-checkpoint-index-${process.pid}-${Date.now()}-${_indexSeq}`,
  );
}

/**
 * rmSync that never throws. Used for best-effort teardown (temp index files,
 * created-since files) so a transient unlink failure — e.g. a Windows file
 * lock (EBUSY/EPERM) on the temp index — can't mask the operation's real
 * result. Without this, a `finally { rmSync(tmpIndex) }` could turn a
 * *successful* checkpoint into a thrown error, or replace the original git
 * error with the cleanup error.
 */
function rmQuiet(target) {
  try {
    rmSync(target, { force: true });
  } catch {
    /* best-effort cleanup — the operation's real result is what matters */
  }
}

/**
 * True if `abs` is the repo root or lives inside it (containment guard).
 * Both sides go through path.resolve so the comparison is robust to separator
 * style — `repoRoot()` comes from `git rev-parse --show-toplevel` with forward
 * slashes, while path.resolve yields native (backslash) paths on Windows.
 */
export function withinRoot(root, abs) {
  const r = path.resolve(root);
  const a = path.resolve(abs);
  if (a === r) return true;
  const prefix = r.endsWith(path.sep) ? r : r + path.sep;
  return a.startsWith(prefix);
}

/**
 * Snapshot the current working tree to a git tree object WITHOUT creating a
 * commit and WITHOUT touching the real index. Returns the tree sha.
 */
function snapshotTree(root, dir) {
  const tmpIndex = tempIndexPath(dir);
  const env = { GIT_INDEX_FILE: tmpIndex };
  try {
    try {
      git(["read-tree", "HEAD"], { cwd: root, env });
    } catch {
      /* fresh repo — empty temp index is fine */
    }
    git(["add", "-A"], { cwd: root, env });
    return git(["write-tree"], { cwd: root, env });
  } finally {
    rmQuiet(tmpIndex);
  }
}

/**
 * Capture the current working tree as a shadow commit.
 *
 * @param {string} cwd
 * @param {object} [opts] { session, label, now, skipIfUnchanged }
 *   skipIfUnchanged: when the work tree is identical to the last checkpoint in
 *   the session, reuse it instead of creating a duplicate ref (returns
 *   `{ ...prior, reused: true }`). Matters for per-tool auto-checkpointing.
 * @returns {{ id, ref, commit, tree, parent, label, session, createdAt, files, reused? }}
 */
export function createCheckpoint(cwd = process.cwd(), opts = {}) {
  const root = repoRoot(cwd);
  const dir = gitDir(root);
  const session = sanitizeSession(opts.session);
  const label = (opts.label || "").toString().replace(/\s+/g, " ").trim();
  const createdAt = (opts.now ? new Date(opts.now) : new Date()).toISOString();

  const tmpIndex = tempIndexPath(dir);
  const env = { GIT_INDEX_FILE: tmpIndex };
  try {
    // Seed the temp index from HEAD when there is one, so `add -A` only diffs
    // (faster on large repos). Harmless to skip in a fresh repo.
    try {
      git(["read-tree", "HEAD"], { cwd: root, env });
    } catch {
      /* no HEAD yet — empty temp index is fine */
    }
    git(["add", "-A"], { cwd: root, env });
    const tree = git(["write-tree"], { cwd: root, env });

    // Dedup: when nothing changed since the last checkpoint, reuse it instead of
    // piling up identical refs (per-tool auto-checkpointing relies on this).
    if (opts.skipIfUnchanged) {
      try {
        const tip = git(
          [
            "rev-parse",
            "--verify",
            "--quiet",
            `${sessionPrefix(session)}/_tip`,
          ],
          { cwd: root },
        );
        if (
          tip &&
          git(["rev-parse", `${tip}^{tree}`], { cwd: root }) === tree
        ) {
          const row = listRefs(root, session).find((r) => r.commit === tip);
          if (row) {
            return {
              id: row.id,
              ref: row.ref,
              commit: tip,
              tree,
              parent: null,
              label: row.label,
              session,
              createdAt: row.createdAt,
              files: 0,
              reused: true,
            };
          }
        }
      } catch {
        /* fall through to a normal checkpoint */
      }
    }

    const message = `cc-checkpoint${label ? `: ${label}` : ""}\n`;
    const prefix = sessionPrefix(session);
    const tipRef = `${prefix}/_tip`;
    let published = null;
    let lastConflict = null;

    for (let attempt = 1; attempt <= MAX_REF_PUBLISH_ATTEMPTS; attempt += 1) {
      // Chain onto the exact prior tip (or HEAD for the first checkpoint). Both
      // the id and tip are CAS-published below. If another creator wins first,
      // rebuild on its new tip so the session history remains linear.
      const expectedTip = readRef(root, tipRef);
      let parent = expectedTip;
      if (!parent) parent = readRef(root, "HEAD");

      const commitArgs = ["commit-tree", tree];
      if (parent) commitArgs.push("-p", parent);
      const commit = git(commitArgs, {
        cwd: root,
        input: message,
        env: { ...env, ...CHECKPOINT_IDENTITY },
      });
      const id = nextId(root, session);
      const ref = `${prefix}/${id}`;

      try {
        publishCheckpointRefs(root, {
          checkpointRef: ref,
          tipRef,
          commit,
          expectedTip,
        });
        published = { id, ref, commit, parent };
        break;
      } catch (error) {
        if (!isRefTransactionConflict(error)) throw error;
        lastConflict = error;
      }
    }

    if (!published) {
      const error = new Error(
        `Checkpoint refs changed during ${MAX_REF_PUBLISH_ATTEMPTS} publish attempts`,
        lastConflict ? { cause: lastConflict } : undefined,
      );
      error.code = "CHECKPOINT_REF_CONFLICT";
      error.attempts = MAX_REF_PUBLISH_ATTEMPTS;
      throw error;
    }

    const { id, ref, commit, parent } = published;

    // File count in the snapshot (cheap, informative).
    let files = 0;
    try {
      const out = git(["ls-tree", "-r", "--name-only", tree], { cwd: root });
      files = out ? out.split("\n").filter(Boolean).length : 0;
    } catch {
      /* non-critical */
    }

    // Bound the session's checkpoint history when asked. Auto-checkpointing
    // (one ref per mutating tool) passes a cap so a long agentic run can't
    // accumulate unbounded refs — which also keeps nextId's per-create
    // for-each-ref scan bounded. Best-effort: pruning never fails the
    // checkpoint, and the dropped commit objects stay reachable via newer
    // checkpoints' parent chain (only addressability by id is lost for the
    // oldest entries). Manual `cc checkpoint create` omits the cap → unbounded.
    if (Number.isFinite(opts.maxPerSession) && opts.maxPerSession > 0) {
      try {
        const rows = listRefs(root, session); // oldest-first (creatordate)
        const excess = rows.length - opts.maxPerSession;
        for (let i = 0; i < excess; i++) {
          try {
            git(["update-ref", "-d", rows[i].ref], { cwd: root });
          } catch {
            /* best-effort — a failed prune never affects the new checkpoint */
          }
        }
      } catch {
        /* pruning is entirely best-effort */
      }
    }

    return { id, ref, commit, tree, parent, label, session, createdAt, files };
  } finally {
    rmQuiet(tmpIndex);
  }
}

/** Next free sequential id (cp0001…) for a session. */
function nextId(root, session) {
  const existing = new Set(listRefs(root, session).map((r) => r.id));
  let n = existing.size + 1;
  let id = `cp${String(n).padStart(4, "0")}`;
  while (existing.has(id)) {
    n += 1;
    id = `cp${String(n).padStart(4, "0")}`;
  }
  return id;
}

/** Raw ref rows for a session (excludes the internal _tip pointer). */
function listRefs(root, session) {
  const prefix = sessionPrefix(session);
  let out = "";
  try {
    out = git(
      [
        "for-each-ref",
        "--sort=creatordate",
        "--format=%(refname)\t%(objectname)\t%(creatordate:iso-strict)\t%(contents:subject)",
        prefix,
      ],
      { cwd: root },
    );
  } catch {
    return [];
  }
  if (!out) return [];
  const rows = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [refname, commit, createdAt, subject = ""] = line.split("\t");
    const id = refname.slice(prefix.length + 1);
    if (id === "_tip") continue;
    const label = subject.replace(/^cc-checkpoint:?\s?/, "");
    rows.push({ id, ref: refname, commit, createdAt, label });
  }
  return rows;
}

/**
 * List checkpoints for a session, newest-first.
 *
 * @returns {Array<{ id, ref, commit, createdAt, label }>}
 */
export function listCheckpoints(cwd = process.cwd(), opts = {}) {
  const root = repoRoot(cwd);
  return listRefs(root, opts.session).reverse();
}

/**
 * Resolve a checkpoint id (cp0003), a ref, or a raw commit-ish to a commit sha.
 *
 * @throws {Error} when it cannot be resolved to a checkpoint commit
 */
export function resolveCheckpoint(cwd, idOrRef, opts = {}) {
  const root = repoRoot(cwd);
  const session = sanitizeSession(opts.session);
  const candidates = [
    `${sessionPrefix(session)}/${idOrRef}`, // bare id
    idOrRef, // full ref or sha
  ];
  for (const c of candidates) {
    try {
      return git(["rev-parse", "--verify", "--quiet", `${c}^{commit}`], {
        cwd: root,
      });
    } catch {
      /* try next */
    }
  }
  throw new Error(`Checkpoint not found: ${idOrRef}`);
}

function resolveExpectedCheckpoint(root, idOrRef, session, expectedIdentity) {
  const resolved = resolveCheckpoint(root, idOrRef, { session });
  if (expectedIdentity == null) return resolved;
  const match = /^git:([a-f0-9]{40}|[a-f0-9]{64})$/.exec(
    String(expectedIdentity),
  );
  if (!match || match[1] !== resolved) {
    const error = new Error(
      `Checkpoint identity changed before restore: ${idOrRef}`,
    );
    error.code = "CHECKPOINT_IDENTITY_STALE";
    error.checkpointId = idOrRef;
    error.expectedIdentity = String(expectedIdentity);
    error.actualIdentity = `git:${resolved}`;
    throw error;
  }
  // Use the captured immutable object even if the named ref changes after the
  // comparison. Git object ids bind the exact commit/tree that was previewed.
  return match[1];
}

/**
 * Compute what differs between a checkpoint and the current working tree.
 *
 * @returns {{ modified:string[], added:string[], deleted:string[] }}
 *   added   = exists now, not in the checkpoint (a rewind would delete it)
 *   deleted = in the checkpoint, gone now (a rewind would recreate it)
 */
export function statusAgainst(cwd = process.cwd(), idOrRef, opts = {}) {
  const root = repoRoot(cwd);
  const dir = gitDir(root);
  const session = sanitizeSession(opts.session);
  const commit = resolveExpectedCheckpoint(
    root,
    idOrRef,
    session,
    opts.expectedIdentity,
  );
  const targetTree = git(["rev-parse", `${commit}^{tree}`], { cwd: root });
  const currentTree = snapshotTree(root, dir);
  return {
    modified: diffNames(root, targetTree, currentTree, "M"),
    added: diffNames(root, targetTree, currentTree, "A"),
    deleted: diffNames(root, targetTree, currentTree, "D"),
    workspaceBinding: buildWorkspaceBinding(root, dir, {
      targetCommit: commit,
      targetTree,
      currentTree,
    }),
  };
}

/**
 * Restore the working tree to a checkpoint. Creates a safety checkpoint first
 * (unless dryRun / skipSafety).
 *
 * @param {object} [opts]
 *   { session, dryRun, skipSafety, now, expectedWorkspaceBinding,
 *     onSafetyReady, onMutationStarted, onWorkspaceApplied }
 * @returns {{ restored, dryRun, target, safetyId, safetyIdentity,
 *   safetyPlanIdentity?:string|null, safetyCoverage?:string,
 *   modified, deleted, recreated }}
 */
export function rewindTo(cwd = process.cwd(), idOrRef, opts = {}) {
  for (const hookName of [
    "onSafetyReady",
    "onMutationStarted",
    "onWorkspaceApplied",
  ]) {
    assertSynchronousRestoreHook(hookName, opts[hookName]);
  }

  const root = repoRoot(cwd);
  const dir = gitDir(root);
  const session = sanitizeSession(opts.session);
  const targetCommit = resolveExpectedCheckpoint(
    root,
    idOrRef,
    session,
    opts.expectedIdentity,
  );
  const targetTree = git(["rev-parse", `${targetCommit}^{tree}`], {
    cwd: root,
  });

  // What will change, relative to a fresh snapshot of the current state.
  const currentTree = snapshotTree(root, dir);
  const modified = diffNames(root, targetTree, currentTree, "M");
  const added = diffNames(root, targetTree, currentTree, "A"); // → delete
  const recreated = diffNames(root, targetTree, currentTree, "D"); // → recreate
  const mutationCount = modified.length + added.length + recreated.length;
  const workspaceBinding = buildWorkspaceBinding(root, dir, {
    targetCommit,
    targetTree,
    currentTree,
  });

  if (Object.hasOwn(opts, "expectedWorkspaceBinding")) {
    assertWorkspaceBinding(
      idOrRef,
      opts.expectedWorkspaceBinding,
      workspaceBinding,
    );
  }

  if (opts.dryRun) {
    return {
      restored: false,
      dryRun: true,
      target: targetCommit,
      safetyId: null,
      safetyIdentity: null,
      modified: modified.length,
      deleted: added.length,
      recreated: recreated.length,
    };
  }

  // Safety net — snapshot the current state so this rewind is undoable.
  let safetyId = null;
  let safetyIdentity = null;
  let safety = null;
  if (!opts.skipSafety) {
    safety = createCheckpoint(root, {
      session,
      label: `auto: before rewind to ${idOrRef}`,
      now: opts.now,
    });
    safetyId = safety.id;
    safetyIdentity = `git:${safety.commit}`;
  }

  const checkpointIdentity = `git:${targetCommit}`;
  const safetyPlanIdentity = workspaceBinding.writePlanIdentity;
  let restorePhase = "safety-ready";
  try {
    if (safety) {
      assertDurableSafetyCheckpoint(root, safety, currentTree);
    }

    // A zero-diff restore has no safety-ready or mutation-started boundary, but
    // it still has a verified workspace-applied settlement. Keep the historical
    // safety-checkpoint return behaviour and report that direct no-op boundary
    // without running checkout-index over an already-settled tree.
    if (mutationCount === 0) {
      restorePhase = "workspace-applied";
      callSynchronousRestoreHook(
        "onWorkspaceApplied",
        opts.onWorkspaceApplied,
        {
          checkpointId: idOrRef,
          checkpointIdentity,
          safetyId,
          safetyIdentity,
          safetyCoverage: safety ? "full" : "none",
          safetyPlanIdentity: safety ? safetyPlanIdentity : null,
          mutationCount: 0,
          appliedCount: 0,
          poststateIdentity: `git-tree:${currentTree}`,
        },
      );
      if (opts.onWorkspaceApplied) {
        if (safety) {
          assertDurableSafetyCheckpoint(root, safety, currentTree);
        }
        assertRestoreWorkspacePrestate(root, dir, idOrRef, workspaceBinding, {
          targetCommit,
          targetTree,
        });
      }
      return {
        restored: true,
        dryRun: false,
        target: targetCommit,
        safetyId,
        safetyIdentity,
        safetyPlanIdentity: safety ? safetyPlanIdentity : null,
        safetyCoverage: "checkpoint",
        modified: 0,
        deleted: 0,
        recreated: 0,
      };
    }

    if (safety) {
      callSynchronousRestoreHook("onSafetyReady", opts.onSafetyReady, {
        checkpointId: idOrRef,
        checkpointIdentity,
        safetyId,
        safetyIdentity,
        safetyCoverage: "full",
        safetyPlanIdentity,
        mutationCount,
      });
      // Hooks are extension points. They may not invalidate the durable undo
      // ref or change the exact workspace state that the write plan covers.
      assertDurableSafetyCheckpoint(root, safety, currentTree);
      assertRestoreWorkspacePrestate(root, dir, idOrRef, workspaceBinding, {
        targetCommit,
        targetTree,
      });
    }

    const tmpIndex = tempIndexPath(dir);
    const env = { GIT_INDEX_FILE: tmpIndex };
    try {
      git(["read-tree", targetTree], { cwd: root, env });

      callSynchronousRestoreHook("onMutationStarted", opts.onMutationStarted, {
        checkpointId: idOrRef,
        checkpointIdentity,
        safetyId,
        safetyIdentity,
        safetyCoverage: safety ? "full" : "none",
        safetyPlanIdentity: safety ? safetyPlanIdentity : null,
        mutationCount,
      });
      if (opts.onMutationStarted) {
        // The durable consumer has now recorded the mutation boundary. Treat
        // any subsequent uncertainty conservatively even though the checks
        // below still precede the first checkout-index write.
        restorePhase = "workspace-mutation";
      }
      if (safety) {
        assertDurableSafetyCheckpoint(root, safety, currentTree);
      }
      assertRestoreWorkspacePrestate(root, dir, idOrRef, workspaceBinding, {
        targetCommit,
        targetTree,
      });

      restorePhase = "workspace-mutation";
      git(["checkout-index", "-a", "-f"], { cwd: root, env });
    } finally {
      rmQuiet(tmpIndex);
    }

    // Remove files the target snapshot does not contain (created since). These
    // paths come from git's tree diff (repo-relative, git rejects `..` in tree
    // entries), but this is a force-delete over the user's working tree — guard
    // each resolved path against the repo root before unlinking, as
    // defense-in-depth, and keep it best-effort so one locked file can't abort
    // the whole rewind.
    for (const rel of added) {
      const abs = path.resolve(root, rel);
      if (!withinRoot(root, abs)) continue; // never delete outside the repo
      rmQuiet(abs);
    }
    const settledTree = snapshotTree(root, dir);
    if (settledTree !== targetTree) {
      const error = new Error(
        `Checkpoint restore did not settle at the target tree: ${idOrRef}`,
      );
      error.code = "CHECKPOINT_RESTORE_INCOMPLETE";
      error.residualPaths = [
        ...diffNames(root, targetTree, settledTree, "M"),
        ...diffNames(root, targetTree, settledTree, "A"),
        ...diffNames(root, targetTree, settledTree, "D"),
      ];
      throw error;
    }

    restorePhase = "workspace-applied";
    callSynchronousRestoreHook("onWorkspaceApplied", opts.onWorkspaceApplied, {
      checkpointId: idOrRef,
      checkpointIdentity,
      safetyId,
      safetyIdentity,
      safetyCoverage: safety ? "full" : "none",
      safetyPlanIdentity: safety ? safetyPlanIdentity : null,
      mutationCount,
      appliedCount: mutationCount,
      poststateIdentity: `git-tree:${settledTree}`,
    });

    // Do not return a successful restore if the completion hook invalidated
    // either the recovery ref or the just-verified poststate.
    if (opts.onWorkspaceApplied) {
      if (safety) {
        assertDurableSafetyCheckpoint(root, safety, currentTree);
      }
      const postHookTree = snapshotTree(root, dir);
      if (postHookTree !== targetTree) {
        const error = new Error(
          `Checkpoint restore did not remain at the target tree: ${idOrRef}`,
        );
        error.code = "CHECKPOINT_RESTORE_INCOMPLETE";
        error.residualPaths = [
          ...diffNames(root, targetTree, postHookTree, "M"),
          ...diffNames(root, targetTree, postHookTree, "A"),
          ...diffNames(root, targetTree, postHookTree, "D"),
        ];
        throw error;
      }
    }
  } catch (error) {
    if (error && typeof error === "object") {
      error.safetyId = safetyId;
      error.safetyIdentity = safetyIdentity;
      error.safetyPlanIdentity = safety ? safetyPlanIdentity : null;
      error.safetyCoverage = "checkpoint";
      error.restorePhase = restorePhase;
    }
    throw error;
  }

  return {
    restored: true,
    dryRun: false,
    target: targetCommit,
    safetyId,
    safetyIdentity,
    safetyPlanIdentity: safety ? safetyPlanIdentity : null,
    safetyCoverage: "checkpoint",
    modified: modified.length,
    deleted: added.length,
    recreated: recreated.length,
  };
}

/** name-only diff between two trees filtered by status (A/M/D…). */
function diffNames(root, treeA, treeB, filter) {
  try {
    const out = git(
      ["diff", "--name-only", `--diff-filter=${filter}`, treeA, treeB],
      { cwd: root },
    );
    return out ? out.split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Diff a checkpoint against the current working tree.
 *
 * @param {object} [opts] { session, stat }
 * @returns {string} git diff (stat or full patch)
 */
export function diffCheckpoint(cwd = process.cwd(), idOrRef, opts = {}) {
  const root = repoRoot(cwd);
  const dir = gitDir(root);
  const session = sanitizeSession(opts.session);
  const targetCommit = resolveCheckpoint(root, idOrRef, { session });
  const targetTree = git(["rev-parse", `${targetCommit}^{tree}`], {
    cwd: root,
  });
  // Snapshot current state so untracked files are included in the diff.
  const currentTree = snapshotTree(root, dir);
  const args = [
    "diff",
    opts.stat ? "--stat" : null,
    targetTree,
    currentTree,
  ].filter(Boolean);
  return git(args, { cwd: root });
}

/**
 * Inspect a checkpoint: metadata + the files it captured (with sizes).
 *
 * @returns {{ id, commit, createdAt, label, fileCount, files:Array<{rel,bytes}> }}
 */
export function showCheckpoint(cwd = process.cwd(), idOrRef, opts = {}) {
  const root = repoRoot(cwd);
  const session = sanitizeSession(opts.session);
  const commit = resolveCheckpoint(root, idOrRef, { session });
  const tree = git(["rev-parse", `${commit}^{tree}`], { cwd: root });
  const meta = listRefs(root, session).find((r) => r.commit === commit) || {};
  const files = [];
  try {
    // `-l` adds the blob size as the 4th whitespace-delimited field.
    const out = git(["ls-tree", "-r", "-l", tree], { cwd: root });
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      const [head, rel] = line.split("\t"); // "<mode> <type> <sha> <size>\t<path>"
      const bytes = parseInt(head.trim().split(/\s+/)[3], 10) || 0;
      files.push({ rel, bytes });
    }
  } catch {
    /* non-critical */
  }
  return {
    id: meta.id || idOrRef,
    commit,
    createdAt: meta.createdAt || null,
    label: meta.label || "",
    fileCount: files.length,
    files,
  };
}

/**
 * Delete a single checkpoint ref.
 *
 * @returns {boolean} true if it existed and was removed
 */
export function deleteCheckpoint(cwd = process.cwd(), idOrRef, opts = {}) {
  const root = repoRoot(cwd);
  const session = sanitizeSession(opts.session);
  let commit;
  try {
    commit = resolveCheckpoint(root, idOrRef, { session });
  } catch {
    return false;
  }
  const row = listRefs(root, session).find((r) => r.commit === commit);
  const ref = row ? row.ref : `${sessionPrefix(session)}/${idOrRef}`;
  try {
    git(["update-ref", "-d", ref], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete all checkpoints for a session (including the _tip pointer).
 *
 * @returns {number} count of checkpoint refs removed (excludes _tip)
 */
export function clearCheckpoints(cwd = process.cwd(), opts = {}) {
  const root = repoRoot(cwd);
  const session = sanitizeSession(opts.session);
  const rows = listRefs(root, session);
  for (const r of rows) {
    try {
      git(["update-ref", "-d", r.ref], { cwd: root });
    } catch {
      /* best-effort */
    }
  }
  try {
    git(["update-ref", "-d", `${sessionPrefix(session)}/_tip`], { cwd: root });
  } catch {
    /* _tip may not exist */
  }
  return rows.length;
}

// Exposed for unit tests / advanced callers.
export const _internals = {
  git,
  MAX_REF_PUBLISH_ATTEMPTS,
  publishCheckpointRefs,
  repoRoot,
  sanitizeSession,
  snapshotTree,
  tempIndexPath,
};
