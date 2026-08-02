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

const WORKSPACE_BINDING_SCHEMA = "cc-checkpoint-workspace-binding/v1";
const MAX_WORKSPACE_PATH_LENGTH = 32_768;
const MAX_RELATIVE_PATH_LENGTH = 4_096;
const SHA256_RE = /^[a-f0-9]{64}$/;

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

function sha256Identity(value) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)), "utf8")
    .digest("hex")}`;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = canonicalValue(value[key]);
    }
    return out;
  }
  return value;
}

export function computeCheckpointIdentity(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new TypeError("checkpoint manifest is required");
  }
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalValue(manifest)), "utf8")
    .digest("hex")}`;
}

function assertCheckpointIdentity(manifest, expectedIdentity) {
  const actualIdentity = computeCheckpointIdentity(manifest);
  if (expectedIdentity != null && expectedIdentity !== actualIdentity) {
    const error = new Error(
      `Checkpoint identity changed before restore: ${manifest.id}`,
    );
    error.code = "CHECKPOINT_IDENTITY_STALE";
    error.checkpointId = manifest.id;
    error.expectedIdentity = String(expectedIdentity);
    error.actualIdentity = actualIdentity;
    throw error;
  }
  return actualIdentity;
}

function checkpointWorkspaceError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function pathComparisonKey(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(left, right) {
  return pathComparisonKey(left) === pathComparisonKey(right);
}

function canonicalWorkspaceDirectory(value, label, { absolute = true } = {}) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_WORKSPACE_PATH_LENGTH ||
    value.includes("\0") ||
    (absolute && !path.isAbsolute(value))
  ) {
    throw checkpointWorkspaceError(
      "CHECKPOINT_WORKSPACE_SCOPE_INVALID",
      `${label} must be a bounded absolute workspace directory`,
    );
  }

  const resolved = path.resolve(value);
  let stat;
  let canonical;
  try {
    stat = fs.lstatSync(resolved, { bigint: true });
    canonical = fs.realpathSync.native(resolved);
  } catch (cause) {
    throw checkpointWorkspaceError(
      "CHECKPOINT_WORKSPACE_SCOPE_INVALID",
      `${label} is not an accessible workspace directory`,
      { cause },
    );
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw checkpointWorkspaceError(
      "CHECKPOINT_WORKSPACE_SCOPE_INVALID",
      `${label} must not be a symlink, junction, or reparse alias`,
    );
  }
  const workspaceRoot = path.resolve(canonical);
  if (samePath(workspaceRoot, path.parse(workspaceRoot).root)) {
    throw checkpointWorkspaceError(
      "CHECKPOINT_WORKSPACE_SCOPE_INVALID",
      `${label} must not be a filesystem root`,
    );
  }
  return workspaceRoot;
}

function statIdentity(stat) {
  const ns = (field, fallback) => {
    if (stat[field] != null) return String(stat[field]);
    return String(Math.trunc(Number(stat[fallback] || 0) * 1_000_000));
  };
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    mode: String(stat.mode),
    nlink: String(stat.nlink),
    size: String(stat.size),
    mtimeNs: ns("mtimeNs", "mtimeMs"),
    ctimeNs: ns("ctimeNs", "ctimeMs"),
  };
}

function sameStatIdentity(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function lstatOptional(filePath) {
  try {
    return fs.lstatSync(filePath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function normalizedRelativePath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_RELATIVE_PATH_LENGTH ||
    value.includes("\0") ||
    path.isAbsolute(value) ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value)
  ) {
    throw checkpointWorkspaceError(
      "CHECKPOINT_WORKSPACE_SCOPE_INVALID",
      "checkpoint path must be a bounded relative path",
    );
  }
  const segments = value.split(/[\\/]/);
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        (process.platform === "win32" &&
          (segment.includes(":") || /[. ]$/.test(segment))),
    )
  ) {
    throw checkpointWorkspaceError(
      "CHECKPOINT_WORKSPACE_SCOPE_INVALID",
      `checkpoint path is not canonical: ${value}`,
    );
  }
  return { segments, normalized: segments.join("/") };
}

function assertStrictlyContained(workspaceRoot, targetPath, rel) {
  const relative = path.relative(workspaceRoot, targetPath);
  if (
    relative.length === 0 ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw checkpointWorkspaceError(
      "CHECKPOINT_WORKSPACE_SCOPE_INVALID",
      `checkpoint target escapes the workspace: ${rel}`,
    );
  }
}

function inspectParentChain(workspaceRoot, targetPath) {
  const states = [];
  let current = workspaceRoot;
  const relativeParent = path.relative(workspaceRoot, path.dirname(targetPath));
  const segments = relativeParent ? relativeParent.split(path.sep) : [];
  const chain = [workspaceRoot];
  for (const segment of segments) {
    current = path.join(current, segment);
    chain.push(current);
  }

  for (const parentPath of chain) {
    let first;
    try {
      first = lstatOptional(parentPath);
    } catch (cause) {
      throw checkpointWorkspaceError(
        "CHECKPOINT_WORKSPACE_SCOPE_INVALID",
        `cannot inspect checkpoint target parent: ${parentPath}`,
        { cause },
      );
    }
    const rel = samePath(parentPath, workspaceRoot)
      ? "."
      : path.relative(workspaceRoot, parentPath).split(path.sep).join("/");
    if (!first) {
      states.push({ rel, state: "absent" });
      continue;
    }
    if (first.isSymbolicLink() || !first.isDirectory()) {
      throw checkpointWorkspaceError(
        "CHECKPOINT_WORKSPACE_SCOPE_INVALID",
        `checkpoint target parent is not a plain directory: ${rel}`,
      );
    }
    let canonical;
    let second;
    try {
      canonical = fs.realpathSync.native(parentPath);
      second = fs.lstatSync(parentPath, { bigint: true });
    } catch (cause) {
      throw checkpointWorkspaceError(
        "CHECKPOINT_WORKSPACE_UNSTABLE",
        `checkpoint target parent changed while inspecting: ${rel}`,
        { cause },
      );
    }
    const firstIdentity = statIdentity(first);
    const secondIdentity = statIdentity(second);
    if (
      second.isSymbolicLink() ||
      !second.isDirectory() ||
      !samePath(parentPath, canonical) ||
      !sameStatIdentity(firstIdentity, secondIdentity)
    ) {
      throw checkpointWorkspaceError(
        "CHECKPOINT_WORKSPACE_UNSTABLE",
        `checkpoint target parent changed or aliases another path: ${rel}`,
      );
    }
    states.push({ rel, state: "directory", identity: secondIdentity });
  }
  return states;
}

function inspectTarget(workspaceRoot, targetPath, normalizedRel) {
  const parentStates = inspectParentChain(workspaceRoot, targetPath);
  let first;
  try {
    first = lstatOptional(targetPath);
  } catch (cause) {
    throw checkpointWorkspaceError(
      "CHECKPOINT_WORKSPACE_SCOPE_INVALID",
      `cannot inspect checkpoint target: ${normalizedRel}`,
      { cause },
    );
  }
  if (!first) {
    return {
      parentStates,
      prestate: { rel: normalizedRel, state: "absent" },
      content: null,
    };
  }
  if (first.isSymbolicLink() || !first.isFile() || first.nlink !== 1n) {
    throw checkpointWorkspaceError(
      "CHECKPOINT_WORKSPACE_SCOPE_INVALID",
      `checkpoint target is not a single-link regular file: ${normalizedRel}`,
    );
  }

  let fd;
  try {
    fd = fs.openSync(targetPath, "r");
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n) {
      throw checkpointWorkspaceError(
        "CHECKPOINT_WORKSPACE_SCOPE_INVALID",
        `checkpoint target is not a single-link regular file: ${normalizedRel}`,
      );
    }
    const content = fs.readFileSync(fd);
    const after = fs.fstatSync(fd, { bigint: true });
    const finalPathStat = fs.lstatSync(targetPath, { bigint: true });
    const firstIdentity = statIdentity(first);
    const beforeIdentity = statIdentity(before);
    const afterIdentity = statIdentity(after);
    const finalIdentity = statIdentity(finalPathStat);
    if (
      finalPathStat.isSymbolicLink() ||
      !finalPathStat.isFile() ||
      finalPathStat.nlink !== 1n ||
      !sameStatIdentity(firstIdentity, beforeIdentity) ||
      !sameStatIdentity(beforeIdentity, afterIdentity) ||
      !sameStatIdentity(afterIdentity, finalIdentity) ||
      BigInt(content.length) !== after.size
    ) {
      throw checkpointWorkspaceError(
        "CHECKPOINT_WORKSPACE_UNSTABLE",
        `checkpoint target changed while inspecting: ${normalizedRel}`,
      );
    }
    return {
      parentStates,
      prestate: {
        rel: normalizedRel,
        state: "present",
        sha256: sha256(content),
        identity: afterIdentity,
      },
      content,
    };
  } catch (error) {
    if (error?.code?.startsWith("CHECKPOINT_")) throw error;
    throw checkpointWorkspaceError(
      "CHECKPOINT_WORKSPACE_UNSTABLE",
      `checkpoint target changed while inspecting: ${normalizedRel}`,
      { cause: error },
    );
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}

function compareCanonical(left, right) {
  return (
    JSON.stringify(canonicalValue(left)) ===
    JSON.stringify(canonicalValue(right))
  );
}

/**
 * Validate an untrusted copy-checkpoint manifest and bind its complete mutation
 * scope to the current workspace state. This is deliberately stricter than the
 * legacy direct-restore path: timeline confirmation must never trust manifest
 * `abs` paths or follow filesystem aliases.
 */
function computeWorkspaceBinding(manifest, opts, checkpointIdentity) {
  if (!isSafeCheckpointId(manifest.id) || manifest.id !== opts.checkpointId) {
    throw checkpointWorkspaceError(
      "CHECKPOINT_WORKSPACE_SCOPE_INVALID",
      "checkpoint manifest id does not match the requested checkpoint",
    );
  }
  const workspaceRoot = canonicalWorkspaceDirectory(
    manifest.cwd,
    "checkpoint manifest cwd",
  );
  const declaredWorkspaceRoot = path.resolve(manifest.cwd);
  if (opts.cwd != null) {
    const requestedRoot = canonicalWorkspaceDirectory(opts.cwd, "restore cwd", {
      absolute: false,
    });
    if (!samePath(workspaceRoot, requestedRoot)) {
      throw checkpointWorkspaceError(
        "CHECKPOINT_WORKSPACE_SCOPE_INVALID",
        "checkpoint workspace does not match the requested cwd",
        { workspaceRoot, requestedRoot },
      );
    }
  }
  if (
    !Array.isArray(manifest.files) ||
    manifest.files.length > DEFAULT_MAX_FILES ||
    !Number.isSafeInteger(manifest.fileCount) ||
    manifest.fileCount !== manifest.files.length
  ) {
    throw checkpointWorkspaceError(
      "CHECKPOINT_WORKSPACE_SCOPE_INVALID",
      `checkpoint manifest file list is invalid or exceeds ${DEFAULT_MAX_FILES}`,
    );
  }

  const seenTargets = new Set();
  const blobCache = new Map();
  const entries = [];
  for (const file of manifest.files) {
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      throw checkpointWorkspaceError(
        "CHECKPOINT_WORKSPACE_SCOPE_INVALID",
        "checkpoint manifest contains an invalid file entry",
      );
    }
    const rel = normalizedRelativePath(file.rel);
    const targetPath = path.resolve(workspaceRoot, ...rel.segments);
    const declaredTargetPath = path.resolve(
      declaredWorkspaceRoot,
      ...rel.segments,
    );
    assertStrictlyContained(workspaceRoot, targetPath, file.rel);
    assertStrictlyContained(
      declaredWorkspaceRoot,
      declaredTargetPath,
      file.rel,
    );
    if (
      typeof file.abs !== "string" ||
      file.abs.length === 0 ||
      file.abs.length > MAX_WORKSPACE_PATH_LENGTH ||
      file.abs.includes("\0") ||
      !path.isAbsolute(file.abs) ||
      !samePath(path.resolve(file.abs), declaredTargetPath)
    ) {
      throw checkpointWorkspaceError(
        "CHECKPOINT_WORKSPACE_SCOPE_INVALID",
        `checkpoint abs/rel paths disagree: ${file.rel}`,
      );
    }
    const targetKey = pathComparisonKey(targetPath);
    if (seenTargets.has(targetKey)) {
      throw checkpointWorkspaceError(
        "CHECKPOINT_WORKSPACE_SCOPE_INVALID",
        `checkpoint contains a duplicate target alias: ${file.rel}`,
      );
    }
    seenTargets.add(targetKey);
    if (
      typeof file.sha256 !== "string" ||
      !SHA256_RE.test(file.sha256) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0
    ) {
      throw checkpointWorkspaceError(
        "CHECKPOINT_WORKSPACE_SCOPE_INVALID",
        `checkpoint blob metadata is invalid: ${file.rel}`,
      );
    }

    let blob = blobCache.get(file.sha256);
    if (!blob) {
      const blobPath = path.join(opts.root, manifest.id, file.sha256);
      let blobStat;
      try {
        blobStat = fs.lstatSync(blobPath, { bigint: true });
        if (blobStat.isSymbolicLink() || !blobStat.isFile()) {
          throw new Error("blob is not a regular file");
        }
        blob = fs.readFileSync(blobPath);
      } catch (cause) {
        throw checkpointWorkspaceError(
          "CHECKPOINT_BLOB_MISSING",
          `checkpoint blob is missing: ${file.rel}`,
          { checkpointId: manifest.id, path: file.rel, cause },
        );
      }
      if (sha256(blob) !== file.sha256 || blob.length !== file.bytes) {
        throw checkpointWorkspaceError(
          "CHECKPOINT_BLOB_CORRUPT",
          `checkpoint blob is corrupt: ${file.rel}`,
          { checkpointId: manifest.id, path: file.rel },
        );
      }
      blobCache.set(file.sha256, blob);
    } else if (blob.length !== file.bytes) {
      throw checkpointWorkspaceError(
        "CHECKPOINT_BLOB_CORRUPT",
        `checkpoint blob metadata is inconsistent: ${file.rel}`,
        { checkpointId: manifest.id, path: file.rel },
      );
    }

    const inspected = inspectTarget(workspaceRoot, targetPath, rel.normalized);
    entries.push({
      displayRel: file.rel,
      rel: rel.normalized,
      targetPath,
      targetSha256: file.sha256,
      targetBytes: file.bytes,
      blob,
      ...inspected,
    });
  }

  entries.sort((left, right) =>
    left.rel < right.rel ? -1 : left.rel > right.rel ? 1 : 0,
  );
  const parentStateByRel = new Map();
  for (const entry of entries) {
    for (const parentState of entry.parentStates) {
      const prior = parentStateByRel.get(parentState.rel);
      if (prior && !compareCanonical(prior, parentState)) {
        throw checkpointWorkspaceError(
          "CHECKPOINT_WORKSPACE_UNSTABLE",
          `checkpoint target parent changed while inspecting: ${parentState.rel}`,
        );
      }
      parentStateByRel.set(parentState.rel, parentState);
    }
  }
  const parentStates = [...parentStateByRel.values()].sort((left, right) =>
    left.rel < right.rel ? -1 : left.rel > right.rel ? 1 : 0,
  );
  const targets = entries.map((entry) => ({ rel: entry.rel }));
  const poststate = entries.map((entry) => ({
    rel: entry.rel,
    sha256: entry.targetSha256,
    bytes: entry.targetBytes,
  }));
  const scopeIdentity = sha256Identity({
    schema: WORKSPACE_BINDING_SCHEMA,
    domain: "scope",
    workspaceRoot,
    targets,
  });
  const prestateIdentity = sha256Identity({
    schema: WORKSPACE_BINDING_SCHEMA,
    domain: "prestate",
    scopeIdentity,
    parents: parentStates,
    targets: entries.map((entry) => entry.prestate),
  });
  const targetPoststateIdentity = sha256Identity({
    schema: WORKSPACE_BINDING_SCHEMA,
    domain: "target-poststate",
    scopeIdentity,
    targets: poststate,
  });
  const writePlanIdentity = sha256Identity({
    schema: WORKSPACE_BINDING_SCHEMA,
    domain: "write-plan",
    checkpointIdentity,
    scopeIdentity,
    prestateIdentity,
    targetPoststateIdentity,
    targets: poststate,
  });

  return {
    entries,
    workspaceBinding: {
      schema: WORKSPACE_BINDING_SCHEMA,
      version: 1,
      engine: "copy",
      workspaceRoot,
      scopeIdentity,
      prestateIdentity,
      writePlanIdentity,
      targetPoststateIdentity,
    },
  };
}

function staleWorkspaceBinding(id, expected, actual, cause) {
  return checkpointWorkspaceError(
    "CHECKPOINT_WORKSPACE_STALE",
    `Checkpoint workspace changed after preview: ${id}`,
    {
      checkpointId: id,
      expectedWorkspaceBinding: expected,
      actualWorkspaceBinding: actual,
      ...(cause ? { cause } : {}),
    },
  );
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
        identity: computeCheckpointIdentity(m),
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
  const checkpointIdentity = assertCheckpointIdentity(m, opts.expectedIdentity);
  if (opts.cwd != null) {
    const computed = computeWorkspaceBinding(
      m,
      { ...opts, root, checkpointId: id },
      checkpointIdentity,
    );
    const modified = [];
    const unchanged = [];
    const deleted = [];
    for (const entry of computed.entries) {
      if (entry.prestate.state === "absent") {
        deleted.push(entry.displayRel);
      } else if (entry.prestate.sha256 === entry.targetSha256) {
        unchanged.push(entry.displayRel);
      } else {
        modified.push(entry.displayRel);
      }
    }
    return {
      id,
      modified,
      unchanged,
      deleted,
      workspaceBinding: computed.workspaceBinding,
    };
  }
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
  const checkpointIdentity = assertCheckpointIdentity(m, opts.expectedIdentity);

  let strictWorkspace = null;
  if (opts.cwd != null || opts.expectedWorkspaceBinding != null) {
    try {
      strictWorkspace = computeWorkspaceBinding(
        m,
        { ...opts, root, checkpointId: id },
        checkpointIdentity,
      );
    } catch (error) {
      if (
        opts.expectedWorkspaceBinding != null &&
        (error?.code === "CHECKPOINT_WORKSPACE_SCOPE_INVALID" ||
          error?.code === "CHECKPOINT_WORKSPACE_UNSTABLE")
      ) {
        throw staleWorkspaceBinding(
          id,
          opts.expectedWorkspaceBinding,
          null,
          error,
        );
      }
      throw error;
    }
    if (
      opts.expectedWorkspaceBinding != null &&
      !compareCanonical(
        opts.expectedWorkspaceBinding,
        strictWorkspace.workspaceBinding,
      )
    ) {
      throw staleWorkspaceBinding(
        id,
        opts.expectedWorkspaceBinding,
        strictWorkspace.workspaceBinding,
      );
    }
  }

  const restored = [];
  const unchanged = [];
  const missingBlob = [];
  const toWrite = [];

  const filesToInspect = strictWorkspace
    ? strictWorkspace.entries.map((entry) => ({
        ...entry,
        abs: entry.targetPath,
        rel: entry.displayRel,
        sha256: entry.targetSha256,
      }))
    : m.files;
  for (const f of filesToInspect) {
    if (strictWorkspace) {
      if (f.prestate.state === "present" && f.prestate.sha256 === f.sha256) {
        unchanged.push(f.rel);
        continue;
      }
      toWrite.push({ abs: f.abs, rel: f.rel, blob: f.blob });
      continue;
    }
    const blobPath = path.join(root, id, f.sha256);
    if (!fs.existsSync(blobPath)) {
      if (opts.expectedIdentity != null) {
        const error = new Error(`checkpoint blob is missing: ${f.rel}`);
        error.code = "CHECKPOINT_BLOB_MISSING";
        error.checkpointId = id;
        error.path = f.rel;
        throw error;
      }
      missingBlob.push(f.rel);
      continue;
    }
    const blob = fs.readFileSync(blobPath);
    if (sha256(blob) !== f.sha256) {
      if (opts.expectedIdentity != null) {
        const error = new Error(`checkpoint blob is corrupt: ${f.rel}`);
        error.code = "CHECKPOINT_BLOB_CORRUPT";
        error.checkpointId = id;
        error.path = f.rel;
        throw error;
      }
      missingBlob.push(f.rel);
      continue;
    }
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
      safetyIdentity: null,
      dryRun: true,
    };
  }

  // Snapshot the current state of the files we're about to overwrite, so the
  // restore can itself be rewound. Only the files that actually change and
  // currently exist need protecting.
  let safetyId = null;
  let safetyIdentity = null;
  let safetyCoverage = "full";
  const createdPaths = [];
  if (!opts.skipSafety) {
    const existing = toWrite
      .filter((w) => fs.existsSync(w.abs))
      .map((w) => w.abs);
    if (existing.length > 0) {
      const safety = createCheckpoint(existing, {
        root,
        cwd: strictWorkspace?.workspaceBinding.workspaceRoot || m.cwd,
        label: `auto-before-restore-${id}`,
      });
      safetyId = safety.id;
      safetyIdentity = computeCheckpointIdentity(safety);
    }
    if (existing.length !== toWrite.length) safetyCoverage = "partial";
  }

  try {
    for (const w of toWrite) {
      const pathWasMissing = !fs.existsSync(w.abs);
      ensureDir(path.dirname(w.abs));
      atomicWriteFileSync(w.abs, w.blob);
      if (pathWasMissing) createdPaths.push(w.rel);
      restored.push(w.rel);
    }
    const residualPaths = filesToInspect
      .filter(
        (file) =>
          !fs.existsSync(file.abs) ||
          sha256(fs.readFileSync(file.abs)) !== file.sha256,
      )
      .map((file) => file.rel);
    if (residualPaths.length > 0) {
      const error = new Error(
        `Checkpoint restore did not settle at the target manifest: ${id}`,
      );
      error.code = "CHECKPOINT_RESTORE_INCOMPLETE";
      error.residualPaths = residualPaths;
      throw error;
    }
  } catch (error) {
    if (error && typeof error === "object") {
      error.safetyId = safetyId;
      error.safetyIdentity = safetyIdentity;
      error.safetyCoverage = safetyCoverage;
      error.createdPaths = createdPaths;
      error.restorePhase = "workspace-mutation";
    }
    throw error;
  }

  return {
    id,
    restored,
    unchanged,
    missingBlob,
    safetyId,
    safetyIdentity,
    safetyCoverage,
    createdPaths,
  };
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
