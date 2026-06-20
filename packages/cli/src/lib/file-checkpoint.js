/**
 * file-checkpoint — manual file-state snapshot / rewind for `cc checkpoint`.
 *
 * Claude-Code "rewind" parity at the CLI level: snapshot a set of files (or
 * directories) before a risky agentic run, then restore them if it goes wrong.
 * This is the standalone store + ops; auto-snapshotting inside the agent
 * tool-loop is a separate follow-up (it lives in the churn-prone agent-core).
 *
 * On-disk layout (under <home>/checkpoints, overridable via opts.root for tests):
 *   <root>/<id>.json        manifest { id, label, createdAt, cwd, files:[...] }
 *   <root>/<id>/<sha256>    raw bytes of each distinct file (content-addressed,
 *                           so duplicate contents are stored once)
 *
 * Distinct from `cc workflow checkpoint` (which snapshots workflow EXECUTION
 * state in the DB, not files).
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { getHomeDir } from "./paths.js";

/** Directories never walked into when a checkpoint path is a directory. */
export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".chainlesschain",
  ".next",
  ".cache",
  "coverage",
]);

/** Safety cap so `checkpoint create <huge-dir>` can't snapshot the universe. */
export const DEFAULT_MAX_FILES = 2000;

function defaultRoot() {
  return path.join(getHomeDir(), "checkpoints");
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Write a file atomically: write to a unique temp sibling, then rename over the
 * target. rename() is atomic within a filesystem, so a crash mid-write leaves
 * the previous file (or nothing) intact — never a half-written manifest/blob.
 * Without this, a checkpoint manifest truncated by a crash makes the whole
 * checkpoint unrecoverable (getCheckpoint's JSON.parse fails → null) while its
 * blobs are orphaned on disk. The temp lives in the SAME dir as the target so
 * the rename stays on one filesystem; on failure the temp is best-effort
 * removed. Temp names end in `.tmp` (never `.json`), so a leftover from a hard
 * crash is ignored by listCheckpoints.
 */
function atomicWriteFileSync(filePath, data) {
  const rand = Math.random().toString(36).slice(2, 8);
  const tmp = `${filePath}.${process.pid}.${rand}.tmp`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* best-effort temp cleanup */
    }
    throw err;
  }
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function newId() {
  // Date.now/random are fine here (plain CLI lib, not a resumable workflow).
  const rand = Math.random().toString(36).slice(2, 8);
  return `cp-${Date.now()}-${rand}`;
}

/**
 * A checkpoint id is interpolated into filesystem paths (root/<id>.json and the
 * blob dir root/<id>). The id comes from CLI args (`cc checkpoint show|delete
 * <id>`), so an id like "../../etc/passwd" would read outside the checkpoint
 * store, and "../../important" passed to delete would rmSync outside it. The git
 * engine guards this via sanitizeSession(); mirror it for the copy fallback by
 * restricting the id to a single safe path segment.
 */
function isSafeCheckpointId(id) {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    id !== "." &&
    id !== ".." &&
    !id.includes("/") &&
    !id.includes("\\") &&
    !id.includes(":") &&
    !id.includes("\0")
  );
}

/**
 * Recursively collect regular files under an absolute path, honoring SKIP_DIRS
 * and a running maxFiles budget. Symlinks are not followed.
 */
function collectFiles(abs, { maxFiles, acc }) {
  let stat;
  try {
    stat = fs.lstatSync(abs);
  } catch {
    return;
  }
  if (stat.isSymbolicLink()) return;
  if (stat.isFile()) {
    if (acc.length >= maxFiles) {
      throw new Error(
        `checkpoint exceeds ${maxFiles} files — narrow the paths or raise maxFiles`,
      );
    }
    acc.push(abs);
    return;
  }
  if (stat.isDirectory()) {
    if (SKIP_DIRS.has(path.basename(abs))) return;
    let entries;
    try {
      entries = fs.readdirSync(abs);
    } catch {
      return;
    }
    for (const name of entries) {
      collectFiles(path.join(abs, name), { maxFiles, acc });
    }
  }
}

/**
 * Create a checkpoint snapshotting the given paths (files and/or dirs).
 *
 * @param {string[]} paths
 * @param {object} [opts] { cwd, label, root, maxFiles }
 * @returns {{ id, label, createdAt, cwd, fileCount, files:Array }}
 */
export function createCheckpoint(paths, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const root = opts.root || defaultRoot();
  const maxFiles = Number.isFinite(opts.maxFiles)
    ? opts.maxFiles
    : DEFAULT_MAX_FILES;
  const list = Array.isArray(paths) ? paths : [paths];
  if (list.filter(Boolean).length === 0) {
    throw new Error("createCheckpoint requires at least one path");
  }

  const absFiles = [];
  for (const p of list) {
    if (!p) continue;
    const abs = path.resolve(cwd, p);
    if (!fs.existsSync(abs)) {
      throw new Error(`no such path: ${p}`);
    }
    collectFiles(abs, { maxFiles, acc: absFiles });
  }
  // De-dupe (overlapping paths) while preserving order.
  const uniqueAbs = [...new Set(absFiles)];

  const id = opts.id || newId();
  if (!isSafeCheckpointId(id)) {
    throw new Error(`Unsafe checkpoint id (path traversal): ${id}`);
  }
  const blobDir = path.join(root, id);
  ensureDir(blobDir);

  const files = [];
  for (const abs of uniqueAbs) {
    const buf = fs.readFileSync(abs);
    const hash = sha256(buf);
    const blobPath = path.join(blobDir, hash);
    if (!fs.existsSync(blobPath)) atomicWriteFileSync(blobPath, buf);
    files.push({
      rel: path.relative(cwd, abs) || path.basename(abs),
      abs,
      bytes: buf.length,
      sha256: hash,
    });
  }

  const manifest = {
    id,
    label: opts.label || "",
    createdAt: new Date().toISOString(),
    cwd,
    fileCount: files.length,
    files,
  };
  ensureDir(root);
  atomicWriteFileSync(
    path.join(root, `${id}.json`),
    JSON.stringify(manifest, null, 2),
  );
  return manifest;
}

/** Load a checkpoint manifest by id, or null. */
export function getCheckpoint(id, opts = {}) {
  if (!isSafeCheckpointId(id)) return null;
  const root = opts.root || defaultRoot();
  const file = path.join(root, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

/** List all checkpoint manifests, newest first. */
export function listCheckpoints(opts = {}) {
  const root = opts.root || defaultRoot();
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const name of fs.readdirSync(root)) {
    if (!name.endsWith(".json")) continue;
    const m = getCheckpoint(name.slice(0, -5), { root });
    if (m) {
      out.push({
        id: m.id,
        label: m.label,
        createdAt: m.createdAt,
        cwd: m.cwd,
        fileCount: m.fileCount,
      });
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * Compare the current on-disk state against a checkpoint.
 * @returns {{ id, modified:[], unchanged:[], deleted:[] }}
 *   modified = content differs; deleted = file is gone now.
 */
export function diffCheckpoint(id, opts = {}) {
  const root = opts.root || defaultRoot();
  const m = getCheckpoint(id, { root });
  if (!m) throw new Error(`no such checkpoint: ${id}`);
  const modified = [];
  const unchanged = [];
  const deleted = [];
  for (const f of m.files) {
    if (!fs.existsSync(f.abs)) {
      deleted.push(f.rel);
      continue;
    }
    const cur = sha256(fs.readFileSync(f.abs));
    if (cur === f.sha256) unchanged.push(f.rel);
    else modified.push(f.rel);
  }
  return { id, modified, unchanged, deleted };
}

/**
 * Restore files from a checkpoint to their original paths. By default a safety
 * checkpoint of the CURRENT contents is taken first, so a restore is itself
 * reversible. `dryRun` reports what would change without writing.
 *
 * @param {string} id
 * @param {object} [opts] { root, dryRun, skipSafety, cwd }
 * @returns {{ id, restored:[], unchanged:[], missingBlob:[], safetyId:string|null }}
 */
export function restoreCheckpoint(id, opts = {}) {
  const root = opts.root || defaultRoot();
  const m = getCheckpoint(id, { root });
  if (!m) throw new Error(`no such checkpoint: ${id}`);

  const restored = [];
  const unchanged = [];
  const missingBlob = [];
  const toWrite = [];

  for (const f of m.files) {
    const blobPath = path.join(root, id, f.sha256);
    if (!fs.existsSync(blobPath)) {
      missingBlob.push(f.rel);
      continue;
    }
    const blob = fs.readFileSync(blobPath);
    const cur = fs.existsSync(f.abs) ? fs.readFileSync(f.abs) : null;
    if (cur && sha256(cur) === f.sha256) {
      unchanged.push(f.rel);
      continue;
    }
    toWrite.push({ abs: f.abs, rel: f.rel, blob });
  }

  if (opts.dryRun) {
    return {
      id,
      restored: toWrite.map((w) => w.rel),
      unchanged,
      missingBlob,
      safetyId: null,
      dryRun: true,
    };
  }

  // Snapshot the current state of the files we're about to overwrite, so the
  // restore can itself be rewound. Only the files that actually change and
  // currently exist need protecting.
  let safetyId = null;
  if (!opts.skipSafety) {
    const existing = toWrite
      .filter((w) => fs.existsSync(w.abs))
      .map((w) => w.abs);
    if (existing.length > 0) {
      const safety = createCheckpoint(existing, {
        root,
        cwd: m.cwd,
        label: `auto-before-restore-${id}`,
      });
      safetyId = safety.id;
    }
  }

  for (const w of toWrite) {
    ensureDir(path.dirname(w.abs));
    atomicWriteFileSync(w.abs, w.blob);
    restored.push(w.rel);
  }

  return { id, restored, unchanged, missingBlob, safetyId };
}

/** Delete a checkpoint (manifest + blobs). Returns true if it existed. */
export function deleteCheckpoint(id, opts = {}) {
  if (!isSafeCheckpointId(id)) return false;
  const root = opts.root || defaultRoot();
  const file = path.join(root, `${id}.json`);
  const blobDir = path.join(root, id);
  let existed = false;
  if (fs.existsSync(file)) {
    fs.rmSync(file);
    existed = true;
  }
  if (fs.existsSync(blobDir)) {
    fs.rmSync(blobDir, { recursive: true, force: true });
    existed = true;
  }
  return existed;
}
