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
  const commit = resolveCheckpoint(root, idOrRef, { session });
  const targetTree = git(["rev-parse", `${commit}^{tree}`], { cwd: root });
  const currentTree = snapshotTree(root, dir);
  return {
    modified: diffNames(root, targetTree, currentTree, "M"),
    added: diffNames(root, targetTree, currentTree, "A"),
    deleted: diffNames(root, targetTree, currentTree, "D"),
  };
}

/**
 * Restore the working tree to a checkpoint. Creates a safety checkpoint first
 * (unless dryRun / skipSafety).
 *
 * @param {object} [opts] { session, dryRun, skipSafety, now }
 * @returns {{ restored, dryRun, target, safetyId, modified, deleted, recreated }}
 */
export function rewindTo(cwd = process.cwd(), idOrRef, opts = {}) {
  const root = repoRoot(cwd);
  const dir = gitDir(root);
  const session = sanitizeSession(opts.session);
  const targetCommit = resolveCheckpoint(root, idOrRef, { session });
  const targetTree = git(["rev-parse", `${targetCommit}^{tree}`], {
    cwd: root,
  });

  // What will change, relative to a fresh snapshot of the current state.
  const currentTree = snapshotTree(root, dir);
  const modified = diffNames(root, targetTree, currentTree, "M");
  const added = diffNames(root, targetTree, currentTree, "A"); // → delete
  const recreated = diffNames(root, targetTree, currentTree, "D"); // → recreate

  if (opts.dryRun) {
    return {
      restored: false,
      dryRun: true,
      target: targetCommit,
      safetyId: null,
      modified: modified.length,
      deleted: added.length,
      recreated: recreated.length,
    };
  }

  // Safety net — snapshot the current state so this rewind is undoable.
  let safetyId = null;
  if (!opts.skipSafety) {
    safetyId = createCheckpoint(root, {
      session,
      label: `auto: before rewind to ${idOrRef}`,
      now: opts.now,
    }).id;
  }

  // Write the target tree over the working tree via a temp index.
  const tmpIndex = tempIndexPath(dir);
  const env = { GIT_INDEX_FILE: tmpIndex };
  try {
    git(["read-tree", targetTree], { cwd: root, env });
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

  return {
    restored: true,
    dryRun: false,
    target: targetCommit,
    safetyId,
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
  repoRoot,
  sanitizeSession,
  snapshotTree,
  tempIndexPath,
};
