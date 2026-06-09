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

import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

const REF_NS = "refs/cc-checkpoints";
// Deterministic identity for shadow commits so `git commit-tree` never trips on
// a missing user.name / user.email config.
const CHECKPOINT_IDENTITY = Object.freeze({
  GIT_AUTHOR_NAME: "cc-checkpoint",
  GIT_AUTHOR_EMAIL: "checkpoint@chainlesschain.local",
  GIT_COMMITTER_NAME: "cc-checkpoint",
  GIT_COMMITTER_EMAIL: "checkpoint@chainlesschain.local",
});

/**
 * Run git with an argv array (no shell → no quoting hazards). UTF-8 in/out.
 *
 * @param {string[]} args
 * @param {object} [opts] { cwd, env, input }
 * @returns {string} trimmed stdout
 * @throws {Error} with git's stderr when the command fails
 */
function git(args, { cwd, env, input } = {}) {
  const res = spawnSync("git", args, {
    cwd,
    input,
    encoding: "utf-8",
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
    env: env ? { ...process.env, ...env } : process.env,
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

/** Ref-safe session segment. */
function sanitizeSession(session) {
  const s = String(session || "default").replace(/[^A-Za-z0-9._-]/g, "-");
  return s || "default";
}

function sessionPrefix(session) {
  return `${REF_NS}/${sanitizeSession(session)}`;
}

/** Unique temp index path inside .git (never the real index). */
function tempIndexPath(dir) {
  return path.join(dir, `cc-checkpoint-index-${process.pid}-${Date.now()}`);
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
    rmSync(tmpIndex, { force: true });
  }
}

/**
 * Capture the current working tree as a shadow commit.
 *
 * @param {string} cwd
 * @param {object} [opts] { session, label, now }
 * @returns {{ id, ref, commit, tree, parent, label, session, createdAt, files }}
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

    // Chain onto the prior tip (or HEAD) so checkpoints form a readable history.
    let parent = null;
    try {
      parent = git(
        ["rev-parse", "--verify", "--quiet", `${sessionPrefix(session)}/_tip`],
        {
          cwd: root,
        },
      );
    } catch {
      /* no tip yet */
    }
    if (!parent) {
      try {
        parent = git(["rev-parse", "--verify", "--quiet", "HEAD"], {
          cwd: root,
        });
      } catch {
        /* fresh repo, root commit */
      }
    }

    const message = `cc-checkpoint${label ? `: ${label}` : ""}\n`;
    const commitArgs = ["commit-tree", tree];
    if (parent) commitArgs.push("-p", parent);
    const commit = git(commitArgs, {
      cwd: root,
      input: message,
      env: { ...env, ...CHECKPOINT_IDENTITY },
    });

    const id = nextId(root, session);
    const ref = `${sessionPrefix(session)}/${id}`;
    git(["update-ref", ref, commit], { cwd: root });
    git(["update-ref", `${sessionPrefix(session)}/_tip`, commit], {
      cwd: root,
    });

    // File count in the snapshot (cheap, informative).
    let files = 0;
    try {
      const out = git(["ls-tree", "-r", "--name-only", tree], { cwd: root });
      files = out ? out.split("\n").filter(Boolean).length : 0;
    } catch {
      /* non-critical */
    }

    return { id, ref, commit, tree, parent, label, session, createdAt, files };
  } finally {
    rmSync(tmpIndex, { force: true });
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

/**
 * Restore the working tree to a checkpoint. Creates a safety checkpoint first.
 *
 * @returns {{ restored, target, safetyId, modified, deleted }}
 */
export function rewindTo(cwd = process.cwd(), idOrRef, opts = {}) {
  const root = repoRoot(cwd);
  const dir = gitDir(root);
  const session = sanitizeSession(opts.session);
  const targetCommit = resolveCheckpoint(root, idOrRef, { session });
  const targetTree = git(["rev-parse", `${targetCommit}^{tree}`], {
    cwd: root,
  });

  // 1) Safety net — snapshot the current state so this rewind is undoable.
  const safety = createCheckpoint(root, {
    session,
    label: `auto: before rewind to ${idOrRef}`,
    now: opts.now,
  });
  const currentTree = safety.tree;

  // 2) Count what will change, for the report.
  const modified = diffNames(root, targetTree, currentTree, "M").length;
  // Files present now but absent in the target = created since → delete them.
  const added = diffNames(root, targetTree, currentTree, "A");

  // 3) Write the target tree over the working tree via a temp index.
  const tmpIndex = tempIndexPath(dir);
  const env = { GIT_INDEX_FILE: tmpIndex };
  try {
    git(["read-tree", targetTree], { cwd: root, env });
    git(["checkout-index", "-a", "-f"], { cwd: root, env });
  } finally {
    rmSync(tmpIndex, { force: true });
  }

  // 4) Remove files that the target snapshot does not contain.
  for (const rel of added) {
    rmSync(path.resolve(root, rel), { force: true });
  }

  return {
    restored: true,
    target: targetCommit,
    safetyId: safety.id,
    modified,
    deleted: added.length,
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

  // Snapshot current state to a throwaway tree so untracked files are included.
  const tmpIndex = tempIndexPath(dir);
  const env = { GIT_INDEX_FILE: tmpIndex };
  try {
    try {
      git(["read-tree", "HEAD"], { cwd: root, env });
    } catch {
      /* fresh repo */
    }
    git(["add", "-A"], { cwd: root, env });
    const currentTree = git(["write-tree"], { cwd: root, env });
    const args = [
      "diff",
      opts.stat ? "--stat" : null,
      targetTree,
      currentTree,
    ].filter(Boolean);
    return git(args, { cwd: root });
  } finally {
    rmSync(tmpIndex, { force: true });
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
export const _internals = { git, repoRoot, sanitizeSession };
