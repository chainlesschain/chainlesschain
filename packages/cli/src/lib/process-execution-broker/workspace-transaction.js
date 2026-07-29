/**
 * Durable workspace transactions for ProcessExecutionBroker.
 *
 * A transaction takes a content-addressed snapshot before a managed process
 * runs, holds an exclusive cross-process workspace lock for the whole task,
 * records the final write set, and can restore the exact pre-task file tree.
 *
 * This module intentionally uses only node:fs/path/crypto. In particular it
 * does not call checkpoint-store (which calls ProcessExecutionBroker for git)
 * and therefore cannot recurse through the broker while preparing evidence.
 *
 * "full" file coverage means every regular workspace-content entry was
 * snapshotted with no writable exclusion. Partial transactions may declare
 * explicit uncovered paths. Symlinks/reparse points, hardlinks, special files,
 * resource-limit overflow, and snapshot races fail closed before execution.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { withFileLock } from "../with-file-lock.js";
import {
  fileStatIdentity as statIdentity,
  sameFileStatIdentity as sameStatIdentity,
  samePathHandleDirectoryIdentity,
  samePathHandleFileIdentity as samePathHandleIdentity,
  withTrustedFileParentSync,
} from "../secure-file-identity.js";

export const WORKSPACE_TRANSACTION_VERSION = 1;

export const WORKSPACE_TRANSACTION_STATE = Object.freeze({
  PREPARING: "preparing",
  PREPARED: "prepared",
  RUNNING: "running",
  ROLLBACK_REQUIRED: "rollback_required",
  COMMITTED: "committed",
  ROLLED_BACK: "rolled_back",
  ROLLBACK_FAILED: "rollback_failed",
  RESTORING: "restoring",
  RESTORED: "restored",
  RESTORE_FAILED: "restore_failed",
  ABORTED: "aborted",
});

export const WORKSPACE_TRANSACTION_COVERAGE = Object.freeze({
  FULL: "full",
  PARTIAL: "partial",
  NONE: "none",
});

export const WORKSPACE_TRANSACTION_ERROR = Object.freeze({
  INVALID_ARGUMENT: "WORKSPACE_TRANSACTION_INVALID_ARGUMENT",
  INVALID_PATH: "WORKSPACE_TRANSACTION_INVALID_PATH",
  PATH_ESCAPE: "WORKSPACE_TRANSACTION_PATH_ESCAPE",
  UNSAFE_ENTRY: "WORKSPACE_TRANSACTION_UNSAFE_ENTRY",
  RESOURCE_LIMIT: "WORKSPACE_TRANSACTION_RESOURCE_LIMIT",
  SNAPSHOT_RACE: "WORKSPACE_TRANSACTION_SNAPSHOT_RACE",
  LOCKED: "WORKSPACE_TRANSACTION_LOCKED",
  RECOVERY_REQUIRED: "WORKSPACE_TRANSACTION_RECOVERY_REQUIRED",
  LOCK_CORRUPT: "WORKSPACE_TRANSACTION_LOCK_CORRUPT",
  LOCK_OWNERSHIP_LOST: "WORKSPACE_TRANSACTION_LOCK_OWNERSHIP_LOST",
  STATE_CORRUPT: "WORKSPACE_TRANSACTION_STATE_CORRUPT",
  INVALID_TRANSITION: "WORKSPACE_TRANSACTION_INVALID_TRANSITION",
  ROLLBACK_FAILED: "WORKSPACE_TRANSACTION_ROLLBACK_FAILED",
  EVIDENCE_MISMATCH: "WORKSPACE_TRANSACTION_EVIDENCE_MISMATCH",
  WRITERS_ACTIVE: "WORKSPACE_TRANSACTION_WRITERS_ACTIVE",
  DETACHED_PROCESS: "WORKSPACE_TRANSACTION_DETACHED_PROCESS_DENIED",
  OVERLAPPING_WORKSPACE: "WORKSPACE_TRANSACTION_OVERLAPPING_WORKSPACE",
  WRITER_ISOLATION_REQUIRED: "WORKSPACE_TRANSACTION_WRITER_ISOLATION_REQUIRED",
  RESTORE_CONFLICT: "WORKSPACE_TRANSACTION_RESTORE_CONFLICT",
  RESTORE_FAILED: "WORKSPACE_TRANSACTION_RESTORE_FAILED",
});

/**
 * Defaults are intentionally finite. Callers may tighten or explicitly raise
 * them for a known workspace, but cannot get an unbounded snapshot by accident.
 */
export const DEFAULT_WORKSPACE_TRANSACTION_LIMITS = Object.freeze({
  maxEntries: 50_000,
  maxFiles: 40_000,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
  maxFileBytes: 256 * 1024 * 1024,
  maxManifestBytes: 32 * 1024 * 1024,
  maxProcesses: 4_096,
  maxFailureEvidence: 32,
});

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/;
const TERMINAL_STATES = new Set([
  WORKSPACE_TRANSACTION_STATE.COMMITTED,
  WORKSPACE_TRANSACTION_STATE.ROLLED_BACK,
  WORKSPACE_TRANSACTION_STATE.RESTORED,
  WORKSPACE_TRANSACTION_STATE.ABORTED,
]);
const RECOVERABLE_STATES = new Set([
  WORKSPACE_TRANSACTION_STATE.PREPARED,
  WORKSPACE_TRANSACTION_STATE.RUNNING,
  WORKSPACE_TRANSACTION_STATE.ROLLBACK_REQUIRED,
  WORKSPACE_TRANSACTION_STATE.ROLLBACK_FAILED,
]);

function codedError(code, message, details = {}, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.name = "WorkspaceTransactionError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
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

export function canonicalWorkspaceEvidence(value) {
  return JSON.stringify(canonicalValue(value));
}

export function digestWorkspaceEvidence(value) {
  return `sha256:${createHash("sha256")
    .update(canonicalWorkspaceEvidence(value))
    .digest("hex")}`;
}

function hashBuffer(value) {
  return createHash("sha256").update(value).digest("hex");
}

function pathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(left, right) {
  return pathKey(left) === pathKey(right);
}

export function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function isStrictlyInside(root, candidate) {
  return !samePath(root, candidate) && isPathInside(root, candidate);
}

function realpath(value) {
  const implementation = fs.realpathSync.native || fs.realpathSync;
  return implementation(value);
}

function canonicalPathThroughExistingAncestor(value, label) {
  const requested = path.resolve(value);
  const missingSegments = [];
  let ancestor = requested;

  for (;;) {
    try {
      return path.resolve(realpath(ancestor), ...missingSegments);
    } catch (cause) {
      if (cause?.code !== "ENOENT") {
        throw codedError(
          WORKSPACE_TRANSACTION_ERROR.INVALID_PATH,
          `${label} cannot be resolved through a stable ancestor: ${requested}`,
          { path: requested, ancestor },
          cause,
        );
      }
      const parent = path.dirname(ancestor);
      if (samePath(parent, ancestor)) {
        throw codedError(
          WORKSPACE_TRANSACTION_ERROR.INVALID_PATH,
          `${label} has no resolvable filesystem ancestor: ${requested}`,
          { path: requested },
          cause,
        );
      }
      missingSegments.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }
}

function pathsOverlap(left, right) {
  return (
    samePath(left, right) ||
    isStrictlyInside(left, right) ||
    isStrictlyInside(right, left)
  );
}

function canonicalProcessCwd(cwd) {
  const requested = path.resolve(cwd || process.cwd());
  try {
    return { requested, canonical: realpath(requested) };
  } catch (cause) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.INVALID_PATH,
      `managed process cwd cannot be resolved: ${requested}`,
      { cwd: requested },
      cause,
    );
  }
}

function assertSafeDirectory(value, label, { create = false } = {}) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.includes("\0")
  ) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.INVALID_PATH,
      `${label} must be a non-empty path without NUL bytes`,
    );
  }
  const requested = path.resolve(value);
  if (create) fs.mkdirSync(requested, { recursive: true, mode: 0o700 });
  let entry;
  try {
    entry = fs.lstatSync(requested);
  } catch (cause) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.INVALID_PATH,
      `${label} is unavailable: ${requested}`,
      { path: requested },
      cause,
    );
  }
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.UNSAFE_ENTRY,
      `${label} must be a real, non-symlink directory: ${requested}`,
      { path: requested },
    );
  }
  const canonical = realpath(requested);
  const canonicalEntry = fs.lstatSync(canonical);
  if (canonicalEntry.isSymbolicLink() || !canonicalEntry.isDirectory()) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.UNSAFE_ENTRY,
      `${label} canonical path is not a safe directory: ${canonical}`,
      { path: canonical },
    );
  }
  return canonical;
}

function assertNotFilesystemRoot(root) {
  const parsed = path.parse(root);
  if (samePath(root, parsed.root)) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.INVALID_PATH,
      "workspace root cannot be a filesystem root",
      { workspaceRoot: root },
    );
  }
}

function normalizeBoundedText(value, label, max = 256) {
  if (typeof value !== "string") {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.INVALID_ARGUMENT,
      `${label} must be a string`,
    );
  }
  const result = value.trim();
  if (!result || result.length > max || result.includes("\0")) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.INVALID_ARGUMENT,
      `${label} must contain 1-${max} characters without NUL bytes`,
    );
  }
  return result;
}

function normalizeId(value, label = "transaction id") {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.INVALID_ARGUMENT,
      `${label} is not a safe path segment`,
    );
  }
  return value;
}

function positiveInteger(value, fallback, label) {
  const resolved = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.INVALID_ARGUMENT,
      `${label} must be a positive safe integer`,
    );
  }
  return resolved;
}

function normalizeLimits(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.INVALID_ARGUMENT,
      "workspace transaction limits must be an object",
    );
  }
  const out = {};
  for (const [key, fallback] of Object.entries(
    DEFAULT_WORKSPACE_TRANSACTION_LIMITS,
  )) {
    out[key] = positiveInteger(raw[key], fallback, `limits.${key}`);
  }
  if (out.maxFiles > out.maxEntries) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.INVALID_ARGUMENT,
      "limits.maxFiles cannot exceed limits.maxEntries",
    );
  }
  if (out.maxFileBytes > out.maxTotalBytes) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.INVALID_ARGUMENT,
      "limits.maxFileBytes cannot exceed limits.maxTotalBytes",
    );
  }
  return out;
}

function normalizeExclusions(raw = []) {
  if (!Array.isArray(raw)) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.INVALID_ARGUMENT,
      "workspace transaction exclusions must be an array",
    );
  }
  const normalized = [];
  for (const value of raw) {
    if (
      typeof value !== "string" ||
      value.trim() === "" ||
      value.includes("\0") ||
      path.isAbsolute(value) ||
      /^[A-Za-z]:/.test(value)
    ) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.INVALID_PATH,
        "workspace exclusion must be a repository-relative path",
        { exclusion: value },
      );
    }
    const pieces = value.replaceAll("\\", "/").split("/");
    if (
      pieces.some(
        (piece) =>
          !piece || piece === "." || piece === ".." || piece.includes(":"),
      )
    ) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.PATH_ESCAPE,
        "workspace exclusion contains an unsafe path segment",
        { exclusion: value },
      );
    }
    normalized.push(pieces.join("/"));
  }
  return [...new Set(normalized)].sort();
}

function pathIsExcluded(relative, exclusions) {
  const canonical = manifestPath(relative);
  return exclusions.some(
    (excluded) =>
      canonical === excluded || canonical.startsWith(`${excluded}/`),
  );
}

function linkedGitMetadata(root) {
  const dotGit = path.join(root, ".git");
  let entry;
  try {
    entry = fs.lstatSync(dotGit);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (entry.isSymbolicLink()) {
    return {
      kind: "symlink",
      workspacePath: ".git",
      external: true,
    };
  }
  if (!entry.isFile()) return null;
  if (Number(entry.size) > 64 * 1024) return null;
  const text = fs.readFileSync(dotGit, "utf8");
  const match = /^gitdir:\s*(.+)\s*$/im.exec(text);
  if (!match) return null;
  const target = path.resolve(root, match[1].trim());
  return {
    kind: "gitdir-file",
    workspacePath: ".git",
    external: !isPathInside(root, target),
    // Do not persist the host path; the evidence only needs to state that the
    // metadata authority is outside the captured workspace.
    targetClass: isPathInside(root, target)
      ? "workspace"
      : "external-git-metadata",
  };
}

function ensurePrivateDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const entry = fs.lstatSync(dir);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.UNSAFE_ENTRY,
      `transaction path must be a real directory: ${dir}`,
      { path: dir },
    );
  }
  if (process.platform !== "win32") fs.chmodSync(dir, 0o700);
}

function assertPrivateRegularFile(filePath, { maxBytes } = {}) {
  const entry = fs.lstatSync(filePath);
  if (entry.isSymbolicLink() || !entry.isFile() || Number(entry.nlink) !== 1) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.STATE_CORRUPT,
      `transaction state must be a regular, single-link file: ${filePath}`,
      { path: filePath },
    );
  }
  if (Number.isSafeInteger(maxBytes) && Number(entry.size) > Number(maxBytes)) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.RESOURCE_LIMIT,
      `transaction state exceeds ${maxBytes} bytes: ${filePath}`,
      { path: filePath, bytes: Number(entry.size), maxBytes },
    );
  }
  if (process.platform !== "win32" && (Number(entry.mode) & 0o077) !== 0) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.STATE_CORRUPT,
      `transaction state permissions are not private: ${filePath}`,
      { path: filePath },
    );
  }
  return entry;
}

function fsyncDirectory(dir) {
  if (process.platform === "win32") return;
  let descriptor = null;
  try {
    descriptor = fs.openSync(dir, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch {
    // The file itself is fsync'd. Some filesystems do not permit directory
    // fsync; lack of that additive guarantee does not make the file torn.
  } finally {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Best effort after a completed atomic rename.
      }
    }
  }
}

function atomicWrite(filePath, contents, { maxBytes = Infinity } = {}) {
  const body = Buffer.isBuffer(contents)
    ? contents
    : Buffer.from(String(contents), "utf8");
  if (body.byteLength > maxBytes) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.RESOURCE_LIMIT,
      `transaction manifest exceeds ${maxBytes} bytes`,
      { path: filePath, bytes: body.byteLength, maxBytes },
    );
  }
  ensurePrivateDirectory(path.dirname(filePath));
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let descriptor = null;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, body);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, filePath);
    if (process.platform !== "win32") fs.chmodSync(filePath, 0o600);
    assertPrivateRegularFile(filePath, { maxBytes });
    fsyncDirectory(path.dirname(filePath));
  } catch (error) {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the primary write failure.
      }
    }
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // Preserve the primary write failure.
    }
    throw error;
  }
}

function atomicWriteJson(filePath, value, limits) {
  atomicWrite(filePath, `${canonicalWorkspaceEvidence(value)}\n`, {
    maxBytes: limits.maxManifestBytes,
  });
}

function readJson(filePath, limits) {
  assertPrivateRegularFile(filePath, {
    maxBytes: limits.maxManifestBytes,
  });
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (cause) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.STATE_CORRUPT,
      `transaction JSON is corrupt: ${filePath}`,
      { path: filePath },
      cause,
    );
  }
}

function normalizedMtimeMs(stat) {
  const value = Number(stat?.mtimeMs);
  if (!Number.isFinite(value)) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.STATE_CORRUPT,
      "filesystem entry has an invalid modification timestamp",
    );
  }
  // Node's utimes API cannot reproduce sub-millisecond timestamps reliably on
  // every supported filesystem. Persist and verify the portable millisecond
  // precision that rollback can actually restore.
  return Math.trunc(value);
}

function workspaceRootIdentity(stat) {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
  };
}

function sameWorkspaceRootIdentity(left, right) {
  return (
    left != null &&
    right != null &&
    String(left.dev) === String(right.dev) &&
    String(left.ino) === String(right.ino)
  );
}

function inspectWorkspaceRoot(root, expectedIdentity = null) {
  let canonical;
  try {
    canonical = realpath(root);
  } catch (cause) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.SNAPSHOT_RACE,
      `workspace root cannot be resolved: ${root}`,
      { workspaceRoot: root },
      cause,
    );
  }
  if (!samePath(root, canonical)) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.PATH_ESCAPE,
      `workspace root resolves to a different path: ${root}`,
      { workspaceRoot: root, resolvedPath: canonical },
    );
  }
  let entry;
  let opened;
  try {
    ({ entry, opened } = withTrustedFileParentSync(
      fs,
      path.join(root, ".__cc_workspace_root_identity_probe__"),
      ({ parentPath, parentDescriptor, parentDevice }) => {
        if (!samePath(root, parentPath)) {
          throw codedError(
            WORKSPACE_TRANSACTION_ERROR.PATH_ESCAPE,
            `workspace root resolves to a different path: ${root}`,
            { workspaceRoot: root, resolvedPath: parentPath },
          );
        }
        const pathEntry = fs.lstatSync(parentPath, { bigint: true });
        const handleEntry = fs.fstatSync(parentDescriptor, { bigint: true });
        if (
          pathEntry.isSymbolicLink() ||
          !pathEntry.isDirectory() ||
          !handleEntry.isDirectory() ||
          !samePathHandleDirectoryIdentity(pathEntry, handleEntry, parentDevice)
        ) {
          throw codedError(
            WORKSPACE_TRANSACTION_ERROR.SNAPSHOT_RACE,
            "workspace root identity changed while opening it",
            { workspaceRoot: root },
          );
        }
        return { entry: pathEntry, opened: handleEntry };
      },
    ));
  } catch (cause) {
    if (cause?.code === WORKSPACE_TRANSACTION_ERROR.PATH_ESCAPE) throw cause;
    if (cause?.code === WORKSPACE_TRANSACTION_ERROR.SNAPSHOT_RACE) throw cause;
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.SNAPSHOT_RACE,
      `workspace root cannot be opened safely: ${root}`,
      { workspaceRoot: root },
      cause,
    );
  }
  const identity = workspaceRootIdentity(opened);
  if (
    expectedIdentity &&
    !sameWorkspaceRootIdentity(identity, expectedIdentity)
  ) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.SNAPSHOT_RACE,
      "workspace root identity changed after checkpoint preparation",
      {
        workspaceRoot: root,
        expectedIdentity: deepClone(expectedIdentity),
        actualIdentity: identity,
      },
    );
  }
  return {
    entry,
    descriptor: {
      type: "directory",
      mode: Number(entry.mode) & 0o7777,
      mtimeMs: normalizedMtimeMs(entry),
      bytes: 0,
      sha256: null,
      identity,
    },
  };
}

function assertWorkspaceRootIdentity(root, expectedIdentity) {
  return inspectWorkspaceRoot(root, expectedIdentity).descriptor;
}

function manifestPath(relative) {
  return relative.split(path.sep).join("/");
}

function nativePath(relative) {
  if (typeof relative !== "string" || relative.includes("\0")) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.STATE_CORRUPT,
      "manifest contains an invalid path",
      { relative },
    );
  }
  const pieces = relative.split("/");
  if (
    pieces.length === 0 ||
    pieces.some(
      (piece) =>
        !piece ||
        piece === "." ||
        piece === ".." ||
        piece.includes("\\") ||
        piece.includes(":"),
    )
  ) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.PATH_ESCAPE,
      `manifest path is unsafe: ${relative}`,
      { relative },
    );
  }
  return path.join(...pieces);
}

function descriptorForUnsafe(stat, type) {
  return {
    type,
    mode: Number(stat.mode) & 0o7777,
    mtimeMs: normalizedMtimeMs(stat),
    bytes: 0,
    sha256: null,
    unsafe: true,
  };
}

function writeBlob(blobDir, hash, body, limits) {
  const blobPath = path.join(blobDir, hash);
  if (fs.existsSync(blobPath)) {
    assertPrivateRegularFile(blobPath, { maxBytes: limits.maxFileBytes });
    const existing = fs.readFileSync(blobPath);
    if (
      existing.byteLength !== body.byteLength ||
      hashBuffer(existing) !== hash
    ) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.EVIDENCE_MISMATCH,
        `checkpoint blob does not match its digest: ${hash}`,
        { hash },
      );
    }
    return;
  }
  atomicWrite(blobPath, body, { maxBytes: limits.maxFileBytes });
  if (hashBuffer(fs.readFileSync(blobPath)) !== hash) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.EVIDENCE_MISMATCH,
      `checkpoint blob verification failed: ${hash}`,
      { hash },
    );
  }
}

function readStableRegularFile(
  abs,
  initialStat,
  limits,
  expectedWorkspaceDevice,
) {
  const size = Number(initialStat.size);
  if (size > limits.maxFileBytes) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.RESOURCE_LIMIT,
      `file exceeds ${limits.maxFileBytes} bytes: ${abs}`,
      { path: abs, bytes: size, maxBytes: limits.maxFileBytes },
    );
  }
  let descriptor = null;
  try {
    const noFollow = Number(fs.constants.O_NOFOLLOW || 0);
    descriptor = fs.openSync(abs, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (
      !opened.isFile() ||
      Number(opened.nlink) !== 1 ||
      !samePathHandleIdentity(initialStat, opened, expectedWorkspaceDevice)
    ) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.SNAPSHOT_RACE,
        `file identity changed while opening checkpoint input: ${abs}`,
        { path: abs },
      );
    }
    const body = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (
      body.byteLength !== size ||
      !sameStatIdentity(statIdentity(opened), statIdentity(after))
    ) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.SNAPSHOT_RACE,
        `file changed while checkpointing: ${abs}`,
        { path: abs },
      );
    }
    return body;
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function assertEntryRealpath(root, abs, relative) {
  let canonical;
  try {
    canonical = realpath(abs);
  } catch (cause) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.SNAPSHOT_RACE,
      `workspace entry disappeared while checkpointing: ${relative}`,
      { path: relative },
      cause,
    );
  }
  if (!isPathInside(root, canonical)) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.PATH_ESCAPE,
      `workspace entry resolves outside the workspace: ${relative}`,
      { path: relative, resolvedPath: canonical },
    );
  }
}

/** Enumerate the workspace tree under an explicit coverage contract. */
function scanWorkspace(
  root,
  {
    limits,
    blobDir = null,
    allowUnsafe = false,
    exclusions = [],
    gitMetadataPolicy = "capture",
    expectedRootIdentity = null,
  },
) {
  const rootBefore = inspectWorkspaceRoot(root, expectedRootIdentity);
  const entries = [];
  const unsafe = [];
  const dynamicExclusions = [...exclusions];
  const uncoveredPaths = [...exclusions];
  let files = 0;
  let totalBytes = 0;

  const consumeEntry = () => {
    if (entries.length >= limits.maxEntries) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.RESOURCE_LIMIT,
        `workspace exceeds ${limits.maxEntries} entries`,
        { maxEntries: limits.maxEntries },
      );
    }
  };

  const walk = (abs, relative) => {
    if (path.basename(relative) === ".git") {
      const rel = manifestPath(relative);
      if (gitMetadataPolicy === "deny") {
        throw codedError(
          WORKSPACE_TRANSACTION_ERROR.WRITER_ISOLATION_REQUIRED,
          `full file coverage cannot safely restore Git metadata: ${rel}`,
          { path: rel },
        );
      }
      if (gitMetadataPolicy === "exclude") {
        if (!dynamicExclusions.includes(rel)) dynamicExclusions.push(rel);
        if (!uncoveredPaths.includes(rel)) uncoveredPaths.push(rel);
        return;
      }
    }
    if (pathIsExcluded(relative, exclusions)) return;
    let initial;
    try {
      initial = fs.lstatSync(abs, { bigint: true });
    } catch (cause) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.SNAPSHOT_RACE,
        `workspace entry disappeared during scan: ${relative}`,
        { path: relative },
        cause,
      );
    }
    const rel = manifestPath(relative);
    consumeEntry();

    if (initial.isSymbolicLink()) {
      if (!allowUnsafe) {
        throw codedError(
          WORKSPACE_TRANSACTION_ERROR.UNSAFE_ENTRY,
          `symlink/reparse points are not allowed in full checkpoints: ${rel}`,
          { path: rel, entryType: "symlink" },
        );
      }
      const descriptor = descriptorForUnsafe(initial, "symlink");
      entries.push({ path: rel, ...descriptor });
      unsafe.push({ path: rel, type: descriptor.type });
      return;
    }

    if (initial.isFile() && Number(initial.nlink) > 1) {
      if (!allowUnsafe) {
        throw codedError(
          WORKSPACE_TRANSACTION_ERROR.UNSAFE_ENTRY,
          `hardlinks are not allowed in full checkpoints: ${rel}`,
          { path: rel, entryType: "hardlink", nlink: Number(initial.nlink) },
        );
      }
      const descriptor = descriptorForUnsafe(initial, "hardlink");
      entries.push({ path: rel, ...descriptor });
      unsafe.push({ path: rel, type: descriptor.type });
      return;
    }

    if (initial.isDirectory()) {
      assertEntryRealpath(root, abs, rel);
      entries.push({
        path: rel,
        type: "directory",
        mode: Number(initial.mode) & 0o7777,
        mtimeMs: normalizedMtimeMs(initial),
        bytes: 0,
        sha256: null,
      });
      let names;
      try {
        names = fs.readdirSync(abs).sort();
      } catch (cause) {
        throw codedError(
          WORKSPACE_TRANSACTION_ERROR.SNAPSHOT_RACE,
          `workspace directory could not be read: ${rel}`,
          { path: rel },
          cause,
        );
      }
      for (const name of names) {
        walk(path.join(abs, name), path.join(relative, name));
      }
      const after = fs.lstatSync(abs, { bigint: true });
      if (
        !after.isDirectory() ||
        after.isSymbolicLink() ||
        !sameStatIdentity(statIdentity(initial), statIdentity(after))
      ) {
        throw codedError(
          WORKSPACE_TRANSACTION_ERROR.SNAPSHOT_RACE,
          `workspace directory identity changed during scan: ${rel}`,
          { path: rel },
        );
      }
      return;
    }

    if (initial.isFile()) {
      assertEntryRealpath(root, abs, rel);
      files += 1;
      if (files > limits.maxFiles) {
        throw codedError(
          WORKSPACE_TRANSACTION_ERROR.RESOURCE_LIMIT,
          `workspace exceeds ${limits.maxFiles} files`,
          { maxFiles: limits.maxFiles },
        );
      }
      totalBytes += Number(initial.size);
      if (totalBytes > limits.maxTotalBytes) {
        throw codedError(
          WORKSPACE_TRANSACTION_ERROR.RESOURCE_LIMIT,
          `workspace exceeds ${limits.maxTotalBytes} checkpoint bytes`,
          {
            bytes: totalBytes,
            maxBytes: limits.maxTotalBytes,
          },
        );
      }
      const body = readStableRegularFile(
        abs,
        initial,
        limits,
        rootBefore.descriptor.identity.dev,
      );
      const hash = hashBuffer(body);
      if (blobDir) writeBlob(blobDir, hash, body, limits);
      entries.push({
        path: rel,
        type: "file",
        mode: Number(initial.mode) & 0o7777,
        mtimeMs: normalizedMtimeMs(initial),
        bytes: body.byteLength,
        sha256: hash,
      });
      return;
    }

    if (!allowUnsafe) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.UNSAFE_ENTRY,
        `special filesystem entries are not allowed in full checkpoints: ${rel}`,
        { path: rel, entryType: "special" },
      );
    }
    const descriptor = descriptorForUnsafe(initial, "special");
    entries.push({ path: rel, ...descriptor });
    unsafe.push({ path: rel, type: descriptor.type });
  };

  const rootNames = fs.readdirSync(root).sort();
  for (const name of rootNames) {
    walk(path.join(root, name), name);
  }
  const rootAfter = inspectWorkspaceRoot(root, rootBefore.descriptor.identity);
  if (
    !sameStatIdentity(
      statIdentity(rootBefore.entry),
      statIdentity(rootAfter.entry),
    )
  ) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.SNAPSHOT_RACE,
      "workspace root changed while checkpointing",
      { workspaceRoot: root },
    );
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return {
    version: WORKSPACE_TRANSACTION_VERSION,
    workspaceRoot: root,
    root: rootBefore.descriptor,
    exclusions: [...dynamicExclusions].sort(),
    uncoveredPaths: [...uncoveredPaths].sort(),
    entries,
    stats: {
      entries: entries.length,
      files,
      bytes: totalBytes,
    },
    unsafe,
  };
}

function descriptorEqual(left, right) {
  return (
    left?.type === right?.type &&
    left?.mode === right?.mode &&
    left?.mtimeMs === right?.mtimeMs &&
    left?.bytes === right?.bytes &&
    left?.sha256 === right?.sha256
  );
}

function descriptorView(entry) {
  if (!entry) return null;
  return {
    type: entry.type,
    mode: entry.mode,
    mtimeMs: entry.mtimeMs,
    bytes: entry.bytes,
    sha256: entry.sha256,
    ...(entry.unsafe === true ? { unsafe: true } : {}),
  };
}

function buildWriteManifest(baseline, current) {
  const before = new Map(baseline.entries.map((entry) => [entry.path, entry]));
  const after = new Map(current.entries.map((entry) => [entry.path, entry]));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const writes = [];
  if (!descriptorEqual(baseline.root, current.root)) {
    writes.push({
      path: ".",
      operation: "modified",
      before: descriptorView(baseline.root),
      after: descriptorView(current.root),
    });
  }
  for (const relative of paths) {
    const prior = before.get(relative) || null;
    const next = after.get(relative) || null;
    if (descriptorEqual(prior, next)) continue;
    writes.push({
      path: relative,
      operation: prior ? (next ? "modified" : "deleted") : "added",
      before: descriptorView(prior),
      after: descriptorView(next),
    });
  }
  const manifest = {
    version: WORKSPACE_TRANSACTION_VERSION,
    writes,
    summary: {
      added: writes.filter((entry) => entry.operation === "added").length,
      modified: writes.filter((entry) => entry.operation === "modified").length,
      deleted: writes.filter((entry) => entry.operation === "deleted").length,
      unsafe: current.unsafe.length,
    },
    unsafe: current.unsafe,
  };
  return {
    ...manifest,
    digest: digestWorkspaceEvidence(manifest),
  };
}

function expectedPostTaskSnapshot(baseline, writeManifest) {
  let root = deepClone(baseline.root);
  const entries = new Map(
    baseline.entries.map((entry) => [entry.path, deepClone(entry)]),
  );
  for (const write of writeManifest.writes || []) {
    if (write.path === ".") {
      if (write.operation !== "modified" || !write.after) {
        throw codedError(
          WORKSPACE_TRANSACTION_ERROR.STATE_CORRUPT,
          "write manifest contains an invalid workspace-root operation",
        );
      }
      root = {
        ...deepClone(write.after),
        identity: deepClone(baseline.root.identity),
      };
      continue;
    }
    if (write.operation === "deleted") {
      entries.delete(write.path);
      continue;
    }
    if (!write.after) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.STATE_CORRUPT,
        `write manifest is missing its after descriptor: ${write.path}`,
      );
    }
    entries.set(write.path, {
      path: write.path,
      ...deepClone(write.after),
    });
  }
  return {
    version: WORKSPACE_TRANSACTION_VERSION,
    workspaceRoot: baseline.workspaceRoot,
    root,
    exclusions: [...(baseline.exclusions || [])],
    uncoveredPaths: [...(baseline.uncoveredPaths || [])],
    entries: [...entries.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    unsafe: [],
  };
}

function assertBaselineDocument(document, transaction) {
  if (
    !document ||
    typeof document !== "object" ||
    Array.isArray(document) ||
    document.version !== WORKSPACE_TRANSACTION_VERSION ||
    document.checkpointId !== transaction.checkpointId ||
    document.workspaceRoot !== transaction.workspaceRoot ||
    !document.root ||
    document.root.type !== "directory" ||
    !sameWorkspaceRootIdentity(
      document.root.identity,
      transaction.workspaceRootIdentity,
    ) ||
    !Array.isArray(document.entries) ||
    typeof document.digest !== "string"
  ) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.STATE_CORRUPT,
      "workspace checkpoint baseline has an invalid shape",
      { transactionId: transaction.id },
    );
  }
  const unsigned = { ...document };
  delete unsigned.digest;
  const expected = digestWorkspaceEvidence(unsigned);
  if (expected !== document.digest) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.EVIDENCE_MISMATCH,
      "workspace checkpoint baseline digest does not match",
      { transactionId: transaction.id },
    );
  }
  return document;
}

function checkpointDocument(id, scan, createdAt) {
  const unsigned = {
    version: WORKSPACE_TRANSACTION_VERSION,
    checkpointId: id,
    workspaceRoot: scan.workspaceRoot,
    root: scan.root,
    createdAt,
    exclusions: scan.exclusions,
    uncoveredPaths: scan.uncoveredPaths,
    entries: scan.entries,
    stats: scan.stats,
  };
  return {
    ...unsigned,
    digest: digestWorkspaceEvidence(unsigned),
  };
}

function stateDigest(state) {
  const unsigned = { ...state };
  delete unsigned.stateDigest;
  return digestWorkspaceEvidence(unsigned);
}

function assertStateDocument(state, id = null) {
  if (
    !state ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    state.version !== WORKSPACE_TRANSACTION_VERSION ||
    typeof state.id !== "string" ||
    !SAFE_ID.test(state.id) ||
    (id && state.id !== id) ||
    typeof state.workspaceRoot !== "string" ||
    !state.workspaceRootIdentity ||
    typeof state.workspaceRootIdentity.dev !== "string" ||
    typeof state.workspaceRootIdentity.ino !== "string" ||
    (state.lockAuthority !== "canonical" &&
      state.lockAuthority !== "test-injected") ||
    typeof state.checkpointId !== "string" ||
    !Object.values(WORKSPACE_TRANSACTION_STATE).includes(state.state) ||
    typeof state.stateDigest !== "string"
  ) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.STATE_CORRUPT,
      "workspace transaction state has an invalid shape",
      { transactionId: id },
    );
  }
  if (stateDigest(state) !== state.stateDigest) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.EVIDENCE_MISMATCH,
      "workspace transaction state digest does not match",
      { transactionId: state.id },
    );
  }
  return state;
}

function defaultStateDir() {
  return path.join(os.homedir(), ".chainlesschain", "workspace-transactions");
}

function defaultLockDir() {
  const identity = `${os.homedir()}\0${
    typeof process.getuid === "function"
      ? process.getuid()
      : os.userInfo().username
  }`;
  const suffix = hashBuffer(Buffer.from(identity, "utf8")).slice(0, 24);
  return path.join(
    os.tmpdir(),
    `chainlesschain-workspace-transaction-locks-${suffix}`,
  );
}

function assertOwnedPrivateDirectory(dir, label) {
  const entry = fs.lstatSync(dir);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.UNSAFE_ENTRY,
      `${label} must be a real directory`,
      { path: dir },
    );
  }
  if (
    process.platform !== "win32" &&
    typeof process.getuid === "function" &&
    Number(entry.uid) !== process.getuid()
  ) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.UNSAFE_ENTRY,
      `${label} is owned by another user`,
      { path: dir, ownerUid: Number(entry.uid) },
    );
  }
  if (process.platform !== "win32") {
    fs.chmodSync(dir, 0o700);
    const secured = fs.lstatSync(dir);
    if ((Number(secured.mode) & 0o077) !== 0) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.UNSAFE_ENTRY,
        `${label} permissions are not private`,
        { path: dir },
      );
    }
  }
  return dir;
}

function ownerIsValid(owner) {
  return !!(
    owner &&
    typeof owner === "object" &&
    !Array.isArray(owner) &&
    Number.isSafeInteger(owner.pid) &&
    owner.pid > 0 &&
    Number.isFinite(owner.startedAt) &&
    typeof owner.token === "string" &&
    /^[A-Za-z0-9-]{16,128}$/.test(owner.token) &&
    typeof owner.transactionId === "string" &&
    SAFE_ID.test(owner.transactionId) &&
    typeof owner.workspaceRoot === "string" &&
    path.isAbsolute(owner.workspaceRoot) &&
    owner.identityPolicy === "pid-only-fail-closed"
  );
}

function readLockOwner(lockPath) {
  const ownerPath = path.join(lockPath, "owner.json");
  try {
    const entry = fs.lstatSync(ownerPath);
    if (
      entry.isSymbolicLink() ||
      !entry.isFile() ||
      Number(entry.nlink) !== 1 ||
      (process.platform !== "win32" && (Number(entry.mode) & 0o077) !== 0)
    ) {
      return null;
    }
    const owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
    return ownerIsValid(owner) ? owner : null;
  } catch {
    return null;
  }
}

function sameOwner(left, right) {
  return (
    ownerIsValid(left) &&
    ownerIsValid(right) &&
    left.pid === right.pid &&
    left.startedAt === right.startedAt &&
    left.token === right.token &&
    left.transactionId === right.transactionId &&
    samePath(left.workspaceRoot, right.workspaceRoot) &&
    left.identityPolicy === right.identityPolicy
  );
}

function workspaceLockName(workspaceRoot) {
  return hashBuffer(Buffer.from(pathKey(workspaceRoot), "utf8"));
}

class WorkspaceLifetimeLock {
  constructor(lockPath, owner, isProcessAlive) {
    this.lockPath = lockPath;
    this.owner = owner;
    this._isProcessAlive = isProcessAlive;
    this._released = false;
  }

  static acquire(
    lockRoot,
    workspaceRoot,
    transactionId,
    {
      isProcessAlive,
      now,
      ownerToken,
      reclaimDead = false,
      expectedDeadOwner = null,
    },
  ) {
    ensurePrivateDirectory(lockRoot);
    const lockPath = path.join(lockRoot, workspaceLockName(workspaceRoot));
    const ownerPath = path.join(lockPath, "owner.json");
    const owner = {
      pid: process.pid,
      startedAt: now(),
      token: ownerToken(),
      transactionId,
      workspaceRoot,
      // A live PID with an unavailable creation-time proof is never reclaimed.
      // This may require manual recovery after PID reuse, but cannot kill or
      // roll back underneath an unrelated process.
      identityPolicy: "pid-only-fail-closed",
    };

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        fs.mkdirSync(lockPath, { mode: 0o700 });
        atomicWrite(ownerPath, `${canonicalWorkspaceEvidence(owner)}\n`, {
          maxBytes: 16 * 1024,
        });
        return new WorkspaceLifetimeLock(lockPath, owner, isProcessAlive);
      } catch (error) {
        if (error?.code !== "EEXIST") {
          try {
            if (fs.existsSync(lockPath) && !fs.existsSync(ownerPath)) {
              fs.rmSync(lockPath, { recursive: true, force: true });
            }
          } catch {
            // Preserve the lock acquisition failure.
          }
          throw error;
        }
        const incumbent = readLockOwner(lockPath);
        if (!incumbent) {
          throw codedError(
            WORKSPACE_TRANSACTION_ERROR.LOCK_CORRUPT,
            `workspace transaction lock is corrupt: ${workspaceRoot}`,
            { workspaceRoot, lockPath },
          );
        }
        if (isProcessAlive(incumbent.pid)) {
          throw codedError(
            WORKSPACE_TRANSACTION_ERROR.LOCKED,
            `workspace already has an active transaction: ${workspaceRoot}`,
            {
              workspaceRoot,
              ownerPid: incumbent.pid,
              ownerTransactionId: incumbent.transactionId,
            },
          );
        }
        if (
          !reclaimDead ||
          (expectedDeadOwner && !sameOwner(expectedDeadOwner, incumbent))
        ) {
          throw codedError(
            WORKSPACE_TRANSACTION_ERROR.RECOVERY_REQUIRED,
            `workspace has a crashed transaction requiring recovery: ${workspaceRoot}`,
            {
              workspaceRoot,
              ownerPid: incumbent.pid,
              ownerTransactionId: incumbent.transactionId,
            },
          );
        }
        WorkspaceLifetimeLock._reclaim(lockPath, incumbent, isProcessAlive);
      }
    }
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.LOCKED,
      `could not acquire workspace transaction lock: ${workspaceRoot}`,
      { workspaceRoot },
    );
  }

  static _reclaim(lockPath, observed, isProcessAlive) {
    const marker = path.join(lockPath, `.reclaim-${observed.token}`);
    atomicWrite(marker, `${canonicalWorkspaceEvidence(observed)}\n`, {
      maxBytes: 16 * 1024,
    });
    const current = readLockOwner(lockPath);
    if (!sameOwner(current, observed) || isProcessAlive(observed.pid)) {
      try {
        fs.rmSync(marker, { force: true });
      } catch {
        // A failed reclaim remains a locked workspace.
      }
      return false;
    }
    fs.rmSync(lockPath, { recursive: true, force: true });
    return true;
  }

  assertOwned() {
    if (
      this._released ||
      !sameOwner(readLockOwner(this.lockPath), this.owner)
    ) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.LOCK_OWNERSHIP_LOST,
        "workspace transaction lock ownership is unavailable",
        { transactionId: this.owner.transactionId },
      );
    }
    return true;
  }

  release() {
    if (this._released) return false;
    this.assertOwned();
    const marker = path.join(this.lockPath, `.release-${this.owner.token}`);
    atomicWrite(marker, `${canonicalWorkspaceEvidence(this.owner)}\n`, {
      maxBytes: 16 * 1024,
    });
    if (!sameOwner(readLockOwner(this.lockPath), this.owner)) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.LOCK_OWNERSHIP_LOST,
        "workspace transaction lock ownership changed during release",
        { transactionId: this.owner.transactionId },
      );
    }
    fs.rmSync(this.lockPath, { recursive: true, force: true });
    this._released = true;
    return true;
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function workspacesOverlap(left, right) {
  return isPathInside(left, right) || isPathInside(right, left);
}

function assertNoOverlappingWorkspaceLock(
  lockDir,
  workspaceRoot,
  isProcessAlive,
) {
  ensurePrivateDirectory(lockDir);
  for (const name of fs.readdirSync(lockDir).sort()) {
    if (name === "coordination.lock") continue;
    const candidate = path.join(lockDir, name);
    let entry;
    try {
      entry = fs.lstatSync(candidate);
    } catch {
      continue;
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.LOCK_CORRUPT,
        `workspace lock registry contains an unsafe entry: ${candidate}`,
        { path: candidate },
      );
    }
    const owner = readLockOwner(candidate);
    if (!owner) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.LOCK_CORRUPT,
        `workspace lock registry contains corrupt ownership: ${candidate}`,
        { path: candidate },
      );
    }
    if (!workspacesOverlap(owner.workspaceRoot, workspaceRoot)) continue;
    const alive = isProcessAlive(owner.pid);
    throw codedError(
      alive
        ? WORKSPACE_TRANSACTION_ERROR.OVERLAPPING_WORKSPACE
        : WORKSPACE_TRANSACTION_ERROR.RECOVERY_REQUIRED,
      alive
        ? `workspace overlaps an active transaction: ${owner.workspaceRoot}`
        : `workspace overlaps a crashed transaction requiring recovery: ${owner.workspaceRoot}`,
      {
        workspaceRoot,
        ownerWorkspaceRoot: owner.workspaceRoot,
        ownerTransactionId: owner.transactionId,
        ownerPid: owner.pid,
        ownerIdentityPolicy: owner.identityPolicy,
      },
    );
  }
}

function safeCurrentEntry(root, relative, expectedRootIdentity) {
  assertWorkspaceRootIdentity(root, expectedRootIdentity);
  const native = nativePath(relative);
  const abs = path.resolve(root, native);
  if (!isStrictlyInside(root, abs)) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.PATH_ESCAPE,
      `rollback path escapes the workspace: ${relative}`,
      { path: relative },
    );
  }
  const segments = native.split(path.sep);
  let parent = root;
  for (const segment of segments.slice(0, -1)) {
    parent = path.join(parent, segment);
    if (!fs.existsSync(parent)) return { abs, entry: null };
    const entry = fs.lstatSync(parent);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.PATH_ESCAPE,
        `rollback parent is not a real directory: ${relative}`,
        { path: relative, parent },
      );
    }
    const canonical = realpath(parent);
    if (!isPathInside(root, canonical)) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.PATH_ESCAPE,
        `rollback parent resolves outside the workspace: ${relative}`,
        { path: relative, parent: canonical },
      );
    }
  }
  let entry = null;
  try {
    entry = fs.lstatSync(abs, { bigint: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return { abs, entry };
}

function removeEntryForRollback(root, relative, expectedRootIdentity) {
  const { abs, entry } = safeCurrentEntry(root, relative, expectedRootIdentity);
  if (!entry) return;
  if (entry.isDirectory() && !entry.isSymbolicLink()) {
    fs.rmdirSync(abs);
  } else {
    fs.unlinkSync(abs);
  }
}

function ensureRollbackDirectory(root, relative, mode, expectedRootIdentity) {
  const { abs, entry } = safeCurrentEntry(root, relative, expectedRootIdentity);
  if (entry && (entry.isSymbolicLink() || !entry.isDirectory())) {
    if (entry.isDirectory()) fs.rmdirSync(abs);
    else fs.unlinkSync(abs);
  }
  if (!fs.existsSync(abs)) fs.mkdirSync(abs, { mode: mode & 0o777 });
  const after = fs.lstatSync(abs);
  if (after.isSymbolicLink() || !after.isDirectory()) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.PATH_ESCAPE,
      `rollback directory could not be created safely: ${relative}`,
      { path: relative },
    );
  }
  if (process.platform !== "win32") fs.chmodSync(abs, mode & 0o7777);
}

function restoreEntryMetadata(abs, descriptor) {
  const current = fs.lstatSync(abs);
  if (current.isSymbolicLink()) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.PATH_ESCAPE,
      `rollback metadata target is a symbolic link: ${abs}`,
      { path: abs },
    );
  }
  if (process.platform !== "win32") {
    fs.chmodSync(abs, descriptor.mode & 0o7777);
  }
  fs.utimesSync(
    abs,
    new Date(Number(current.atimeMs)),
    new Date(Number(descriptor.mtimeMs)),
  );
}

function restoreFile(
  root,
  relative,
  descriptor,
  blobDir,
  limits,
  expectedRootIdentity,
) {
  const blobPath = path.join(blobDir, descriptor.sha256);
  try {
    assertPrivateRegularFile(blobPath, { maxBytes: limits.maxFileBytes });
  } catch (cause) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.EVIDENCE_MISMATCH,
      `checkpoint blob is unavailable or unsafe: ${relative}`,
      { path: relative, hash: descriptor.sha256 },
      cause,
    );
  }
  const body = fs.readFileSync(blobPath);
  if (
    body.byteLength !== descriptor.bytes ||
    hashBuffer(body) !== descriptor.sha256
  ) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.EVIDENCE_MISMATCH,
      `checkpoint blob is missing or corrupt: ${relative}`,
      { path: relative, hash: descriptor.sha256 },
    );
  }
  const { abs, entry } = safeCurrentEntry(root, relative, expectedRootIdentity);
  if (entry) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      fs.rmdirSync(abs);
    } else {
      fs.unlinkSync(abs);
    }
  }
  const temporary = path.join(
    path.dirname(abs),
    `.${path.basename(abs)}.${process.pid}.${randomUUID()}.rollback`,
  );
  let descriptorFd = null;
  try {
    descriptorFd = fs.openSync(temporary, "wx", descriptor.mode & 0o777);
    fs.writeFileSync(descriptorFd, body);
    fs.fsyncSync(descriptorFd);
    fs.closeSync(descriptorFd);
    descriptorFd = null;
    fs.renameSync(temporary, abs);
    assertWorkspaceRootIdentity(root, expectedRootIdentity);
    restoreEntryMetadata(abs, descriptor);
  } catch (error) {
    if (descriptorFd !== null) {
      try {
        fs.closeSync(descriptorFd);
      } catch {
        // Preserve the restore failure.
      }
    }
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // Preserve the restore failure.
    }
    throw error;
  }
}

function restoreBaseline(root, baseline, blobDir, limits) {
  const expectedRootIdentity = baseline.root?.identity;
  assertWorkspaceRootIdentity(root, expectedRootIdentity);
  const current = scanWorkspace(root, {
    limits,
    allowUnsafe: true,
    exclusions: baseline.exclusions || [],
    expectedRootIdentity,
  });
  const writeManifest = buildWriteManifest(baseline, current);
  const baselinePaths = new Set(baseline.entries.map((entry) => entry.path));
  const added = current.entries
    .filter((entry) => !baselinePaths.has(entry.path))
    .sort(
      (left, right) =>
        right.path.split("/").length - left.path.split("/").length ||
        right.path.localeCompare(left.path),
    );
  for (const entry of added) {
    removeEntryForRollback(root, entry.path, expectedRootIdentity);
  }

  const directories = baseline.entries
    .filter((entry) => entry.type === "directory")
    .sort(
      (left, right) =>
        left.path.split("/").length - right.path.split("/").length ||
        left.path.localeCompare(right.path),
    );
  for (const entry of directories) {
    ensureRollbackDirectory(root, entry.path, entry.mode, expectedRootIdentity);
  }

  const files = baseline.entries
    .filter((entry) => entry.type === "file")
    .sort((left, right) => left.path.localeCompare(right.path));
  for (const entry of files) {
    const currentEntry = safeCurrentEntry(
      root,
      entry.path,
      expectedRootIdentity,
    ).entry;
    let alreadyRestored = false;
    if (
      currentEntry?.isFile() &&
      !currentEntry.isSymbolicLink() &&
      Number(currentEntry.nlink) === 1 &&
      Number(currentEntry.size) === entry.bytes
    ) {
      const body = readStableRegularFile(
        path.join(root, nativePath(entry.path)),
        currentEntry,
        limits,
        expectedRootIdentity.dev,
      );
      alreadyRestored =
        hashBuffer(body) === entry.sha256 &&
        (process.platform === "win32" ||
          (Number(currentEntry.mode) & 0o7777) === entry.mode);
    }
    if (!alreadyRestored) {
      restoreFile(
        root,
        entry.path,
        entry,
        blobDir,
        limits,
        expectedRootIdentity,
      );
    } else {
      restoreEntryMetadata(path.join(root, nativePath(entry.path)), entry);
    }
  }

  for (const entry of [...directories].reverse()) {
    const { abs } = safeCurrentEntry(root, entry.path, expectedRootIdentity);
    restoreEntryMetadata(abs, entry);
  }
  assertWorkspaceRootIdentity(root, expectedRootIdentity);
  restoreEntryMetadata(root, baseline.root);

  const verified = scanWorkspace(root, {
    limits,
    allowUnsafe: false,
    exclusions: baseline.exclusions || [],
    expectedRootIdentity,
  });
  const verification = buildWriteManifest(baseline, verified);
  if (verification.writes.length !== 0) {
    throw codedError(
      WORKSPACE_TRANSACTION_ERROR.ROLLBACK_FAILED,
      "workspace differs from its checkpoint after rollback",
      {
        remainingWrites: verification.writes,
        verificationDigest: verification.digest,
      },
    );
  }
  return { writeManifest, verificationDigest: verification.digest };
}

function errorEvidence(error, now, phase, extra = {}) {
  return {
    at: new Date(now).toISOString(),
    phase,
    code: error?.code || "WORKSPACE_TRANSACTION_ERROR",
    message: String(error?.message || error).slice(0, 2_000),
    ...extra,
  };
}

export class WorkspaceTransaction {
  constructor(manager, state, baseline, lock) {
    this.manager = manager;
    this.id = state.id;
    this.checkpointId = state.checkpointId;
    this.workspaceRoot = state.workspaceRoot;
    this.transactionDir = path.join(manager.transactionsDir, state.id);
    this.statePath = path.join(this.transactionDir, "transaction.json");
    this.baselinePath = path.join(this.transactionDir, "baseline.json");
    this.writesPath = path.join(this.transactionDir, "writes.json");
    this.blobDir = path.join(this.transactionDir, "blobs");
    this._state = state;
    this._baseline = baseline;
    this._lock = lock;
  }

  get state() {
    return this._state.state;
  }

  snapshot() {
    return deepClone(this._state);
  }

  evidence() {
    return deepClone(this._state.evidence || null);
  }

  _persist() {
    if (fs.existsSync(this.statePath)) {
      const persisted = assertStateDocument(
        readJson(this.statePath, this._state.limits),
        this.id,
      );
      if (persisted.stateDigest !== this._state.stateDigest) {
        throw codedError(
          WORKSPACE_TRANSACTION_ERROR.EVIDENCE_MISMATCH,
          "workspace transaction state changed concurrently or was tampered",
          {
            transactionId: this.id,
            expectedStateDigest: this._state.stateDigest,
            actualStateDigest: persisted.stateDigest,
          },
        );
      }
    }
    this._state.updatedAt = new Date(this.manager._now()).toISOString();
    this._state.stateDigest = stateDigest(this._state);
    atomicWriteJson(this.statePath, this._state, this._state.limits);
  }

  _verifyDurableCheckpoint() {
    const baseline = assertBaselineDocument(
      readJson(this.baselinePath, this._state.limits),
      this._state,
    );
    if (baseline.digest !== this._baseline.digest) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.EVIDENCE_MISMATCH,
        "durable checkpoint changed after transaction preparation",
        { transactionId: this.id },
      );
    }
    assertWorkspaceRootIdentity(
      this.workspaceRoot,
      this._state.workspaceRootIdentity,
    );
    this._lock?.assertOwned();
    return baseline;
  }

  _assertWorkspaceRootIdentity() {
    return assertWorkspaceRootIdentity(
      this.workspaceRoot,
      this._state.workspaceRootIdentity,
    );
  }

  _appendFailure(error, phase, extra = {}) {
    const failures = Array.isArray(this._state.failureEvidence)
      ? this._state.failureEvidence
      : [];
    failures.push(errorEvidence(error, this.manager._now(), phase, extra));
    this._state.failureEvidence = failures.slice(
      -this._state.limits.maxFailureEvidence,
    );
  }

  markRunning() {
    this._assertWorkspaceRootIdentity();
    if (this._state.state === WORKSPACE_TRANSACTION_STATE.RUNNING) {
      return this.snapshot();
    }
    if (this._state.state !== WORKSPACE_TRANSACTION_STATE.PREPARED) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.INVALID_TRANSITION,
        `cannot start workspace transaction from ${this._state.state}`,
        { transactionId: this.id, state: this._state.state },
      );
    }
    this._verifyDurableCheckpoint();
    this._state.state = WORKSPACE_TRANSACTION_STATE.RUNNING;
    this._state.startedAt = new Date(this.manager._now()).toISOString();
    this._persist();
    return this.snapshot();
  }

  recordExecution(entry) {
    this._assertWorkspaceRootIdentity();
    if (TERMINAL_STATES.has(this._state.state)) return false;
    if (this._state.state === WORKSPACE_TRANSACTION_STATE.PREPARED) {
      this.markRunning();
    }
    const executions = Array.isArray(this._state.executions)
      ? this._state.executions
      : [];
    if (executions.some((item) => item.executionId === entry.executionId)) {
      return false;
    }
    if (executions.length >= this._state.limits.maxProcesses) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.RESOURCE_LIMIT,
        `workspace transaction exceeds ${this._state.limits.maxProcesses} processes`,
        { transactionId: this.id },
      );
    }
    executions.push({
      executionId: String(entry.executionId),
      origin: String(entry.origin || "unknown").slice(0, 256),
      scope: String(entry.scope || "default").slice(0, 256),
      cwd: path.resolve(entry.cwd || this.workspaceRoot),
      commandDigest: digestWorkspaceEvidence({
        command: String(entry.command || ""),
        args: Array.isArray(entry.args) ? entry.args.map(String) : [],
      }),
      status: "prepared",
      pid: null,
      processIdentity: null,
      treeGuarantee:
        Array.isArray(entry.sandboxGuarantees) &&
        entry.sandboxGuarantees.includes("process-tree")
          ? "process-tree"
          : "unproven",
      detached: entry.detached === true,
      recordedAt: new Date(this.manager._now()).toISOString(),
    });
    this._state.executions = executions;
    this._persist();
    return true;
  }

  hasExecution(executionId) {
    return (this._state.executions || []).some(
      (entry) => entry.executionId === executionId,
    );
  }

  bindExecution(executionId, processInfo = {}) {
    const execution = (this._state.executions || []).find(
      (entry) => entry.executionId === executionId,
    );
    if (!execution) return false;
    if (execution.status === "settled") return false;
    const pid = Number(processInfo.pid);
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.WRITERS_ACTIVE,
        "managed process did not expose a trustworthy pid",
        { transactionId: this.id, executionId },
      );
    }
    execution.status = "running";
    execution.pid = pid;
    execution.processIdentity = {
      pid,
      observedAt: new Date(this.manager._now()).toISOString(),
      policy: "pid-only-fail-closed",
    };
    execution.treeGuarantee =
      processInfo.treeGuarantee === true ? "process-tree" : "unproven";
    this._persist();
    return true;
  }

  updateExecutionGuarantees(executionId, processInfo = {}) {
    const execution = (this._state.executions || []).find(
      (entry) => entry.executionId === executionId,
    );
    if (!execution) return false;
    if (
      processInfo.treeGuarantee !== true ||
      execution.treeGuarantee === "process-tree"
    ) {
      return false;
    }
    execution.treeGuarantee = "process-tree";
    execution.treeGuaranteeVerifiedAt = new Date(
      this.manager._now(),
    ).toISOString();
    this._persist();
    return true;
  }

  settleExecution(executionId, outcome = {}) {
    const execution = (this._state.executions || []).find(
      (entry) => entry.executionId === executionId,
    );
    if (!execution) return false;
    if (execution.status === "settled") return false;
    execution.status = "settled";
    execution.exitCode = Number.isInteger(outcome.exitCode)
      ? outcome.exitCode
      : null;
    execution.signal =
      typeof outcome.signal === "string" ? outcome.signal : null;
    execution.error =
      outcome.error == null ? null : String(outcome.error).slice(0, 2_000);
    execution.closedAt = new Date(this.manager._now()).toISOString();
    this._persist();
    return true;
  }

  _assertQuiescent(phase) {
    const unsettled = (this._state.executions || [])
      .filter(
        (entry) =>
          entry.status !== "settled" || entry.treeGuarantee !== "process-tree",
      )
      .map((entry) => ({
        executionId: entry.executionId,
        status: entry.status,
        pid: entry.pid,
        processIdentity: entry.processIdentity,
        treeGuarantee: entry.treeGuarantee,
        detached: entry.detached,
      }));
    if (unsettled.length > 0) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.WRITERS_ACTIVE,
        `workspace transaction cannot ${phase} while managed writers are not closed`,
        { transactionId: this.id, unsettled },
      );
    }
  }

  _writeEvidence(manifest, outcome, extra = {}) {
    atomicWriteJson(this.writesPath, manifest, this._state.limits);
    const unsigned = {
      version: WORKSPACE_TRANSACTION_VERSION,
      transactionId: this.id,
      checkpointId: this.checkpointId,
      checkpointDigest: this._baseline.digest,
      writeManifestDigest: manifest.digest,
      fileCoverage: this._state.requestedCoverage,
      coverage:
        this._state.requestedCoverage === WORKSPACE_TRANSACTION_COVERAGE.FULL &&
        !this._state.externalSideEffects
          ? WORKSPACE_TRANSACTION_COVERAGE.FULL
          : WORKSPACE_TRANSACTION_COVERAGE.PARTIAL,
      externalSideEffects: this._state.externalSideEffects,
      outcome,
      executions: (this._state.executions || []).map(
        (entry) => entry.executionId,
      ),
      exclusions: [...this._baseline.exclusions],
      uncoveredPaths: [...(this._baseline.uncoveredPaths || [])],
      ...extra,
    };
    const evidence = {
      ...unsigned,
      evidenceDigest: digestWorkspaceEvidence(unsigned),
    };
    this._state.writeManifest = {
      path: "writes.json",
      digest: manifest.digest,
      summary: manifest.summary,
    };
    this._state.fileCoverage = evidence.fileCoverage;
    this._state.coverage = evidence.coverage;
    this._state.evidence = evidence;
    return evidence;
  }

  accept() {
    if (this._state.state === WORKSPACE_TRANSACTION_STATE.COMMITTED) {
      return this.evidence();
    }
    if (
      this._state.state !== WORKSPACE_TRANSACTION_STATE.PREPARED &&
      this._state.state !== WORKSPACE_TRANSACTION_STATE.RUNNING
    ) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.INVALID_TRANSITION,
        `cannot commit workspace transaction from ${this._state.state}`,
        { transactionId: this.id, state: this._state.state },
      );
    }
    let current;
    try {
      this._verifyDurableCheckpoint();
      this._assertQuiescent("commit");
      current = scanWorkspace(this.workspaceRoot, {
        limits: this._state.limits,
        allowUnsafe: true,
        exclusions: this._baseline.exclusions || [],
        expectedRootIdentity: this._state.workspaceRootIdentity,
      });
      const manifest = buildWriteManifest(this._baseline, current);
      if (current.unsafe.length > 0) {
        this._writeEvidence(manifest, "rollback_required", {
          unsafe: current.unsafe,
        });
        this._state.state = WORKSPACE_TRANSACTION_STATE.ROLLBACK_REQUIRED;
        this._appendFailure(
          codedError(
            WORKSPACE_TRANSACTION_ERROR.UNSAFE_ENTRY,
            "task introduced an unsafe filesystem entry",
          ),
          "accept",
          { unsafe: current.unsafe },
        );
        this._persist();
        throw codedError(
          WORKSPACE_TRANSACTION_ERROR.UNSAFE_ENTRY,
          "workspace transaction cannot commit unsafe filesystem entries",
          { transactionId: this.id, unsafe: current.unsafe },
        );
      }
      const evidence = this._writeEvidence(manifest, "committed");
      this._state.state = WORKSPACE_TRANSACTION_STATE.COMMITTED;
      this._state.committedAt = new Date(this.manager._now()).toISOString();
      this._persist();
      this._lock.release();
      this.manager._active.delete(this.id);
      return deepClone(evidence);
    } catch (error) {
      if (this._state.state !== WORKSPACE_TRANSACTION_STATE.ROLLBACK_REQUIRED) {
        this._appendFailure(error, "accept");
        this._state.state = WORKSPACE_TRANSACTION_STATE.ROLLBACK_REQUIRED;
        if (error?.code === WORKSPACE_TRANSACTION_ERROR.WRITERS_ACTIVE) {
          this._state.fileCoverage = WORKSPACE_TRANSACTION_COVERAGE.NONE;
          this._state.coverage = WORKSPACE_TRANSACTION_COVERAGE.NONE;
        }
        this._persist();
      }
      throw error;
    }
  }

  rollback({ reason = "task interrupted" } = {}) {
    if (this._state.state === WORKSPACE_TRANSACTION_STATE.ROLLED_BACK) {
      return this.evidence();
    }
    if (this._state.state === WORKSPACE_TRANSACTION_STATE.COMMITTED) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.INVALID_TRANSITION,
        "a committed workspace transaction cannot be rolled back automatically",
        { transactionId: this.id },
      );
    }
    if (!RECOVERABLE_STATES.has(this._state.state)) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.INVALID_TRANSITION,
        `cannot roll back workspace transaction from ${this._state.state}`,
        { transactionId: this.id, state: this._state.state },
      );
    }
    try {
      this._verifyDurableCheckpoint();
      this._assertQuiescent("roll back");
      const result = restoreBaseline(
        this.workspaceRoot,
        this._baseline,
        this.blobDir,
        this._state.limits,
      );
      const evidence = this._writeEvidence(
        result.writeManifest,
        "rolled_back",
        {
          rollbackReason: String(reason).slice(0, 1_000),
          verificationDigest: result.verificationDigest,
        },
      );
      this._state.state = WORKSPACE_TRANSACTION_STATE.ROLLED_BACK;
      this._state.rolledBackAt = new Date(this.manager._now()).toISOString();
      this._persist();
      this._lock.release();
      this.manager._active.delete(this.id);
      return deepClone(evidence);
    } catch (error) {
      this._appendFailure(error, "rollback", {
        rollbackReason: String(reason).slice(0, 1_000),
        priorEvidenceDigest: this._state.evidence?.evidenceDigest || null,
      });
      const writersActive =
        error?.code === WORKSPACE_TRANSACTION_ERROR.WRITERS_ACTIVE;
      this._state.state = writersActive
        ? WORKSPACE_TRANSACTION_STATE.ROLLBACK_REQUIRED
        : WORKSPACE_TRANSACTION_STATE.ROLLBACK_FAILED;
      if (writersActive) {
        this._state.fileCoverage = WORKSPACE_TRANSACTION_COVERAGE.NONE;
        this._state.coverage = WORKSPACE_TRANSACTION_COVERAGE.NONE;
      }
      try {
        this._persist();
      } catch (persistError) {
        error.rollbackPersistenceError = String(
          persistError?.message || persistError,
        );
      }
      const failure = codedError(
        writersActive
          ? WORKSPACE_TRANSACTION_ERROR.WRITERS_ACTIVE
          : WORKSPACE_TRANSACTION_ERROR.ROLLBACK_FAILED,
        writersActive
          ? `workspace checkpoint rollback requires writer shutdown: ${error.message}`
          : `workspace checkpoint rollback failed: ${error.message}`,
        {
          transactionId: this.id,
          failureEvidence: deepClone(this._state.failureEvidence),
        },
        error,
      );
      throw failure;
    }
  }

  /**
   * Explicitly rewind a sealed/committed checkpoint.
   *
   * This is deliberately separate from automatic task-failure rollback.
   * Restore binds the human decision to the committed evidence digest, refuses
   * unacknowledged post-commit conflicts, snapshots a durable safety checkpoint
   * first, and only then rewrites the workspace.
   */
  restore({
    expectedEvidenceDigest,
    force = false,
    reason = "explicit checkpoint restore",
  } = {}) {
    if (this._state.state === WORKSPACE_TRANSACTION_STATE.RESTORED) {
      return deepClone(this._state.restoreEvidence || null);
    }
    if (this._state.state !== WORKSPACE_TRANSACTION_STATE.COMMITTED) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.INVALID_TRANSITION,
        `cannot explicitly restore workspace transaction from ${this._state.state}`,
        { transactionId: this.id, state: this._state.state },
      );
    }
    if (
      typeof expectedEvidenceDigest !== "string" ||
      expectedEvidenceDigest !== this._state.evidence?.evidenceDigest
    ) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.EVIDENCE_MISMATCH,
        "explicit restore must bind the committed evidence digest",
        {
          transactionId: this.id,
          expectedEvidenceDigest,
          actualEvidenceDigest: this._state.evidence?.evidenceDigest || null,
        },
      );
    }

    const lock = this.manager._acquireWorkspaceLock(
      this.workspaceRoot,
      this.id,
    );
    this._lock = lock;
    this.manager._active.set(this.id, this);
    const restoreId = normalizeId(
      `restore-${this.manager._uuid()}`,
      "restore id",
    );
    this._state.state = WORKSPACE_TRANSACTION_STATE.RESTORING;
    this._state.owner = deepClone(lock.owner);
    this._state.restoreContext = {
      id: restoreId,
      phase: "validating",
      expectedEvidenceDigest,
      force: force === true,
      reason: String(reason).slice(0, 1_000),
      startedAt: new Date(this.manager._now()).toISOString(),
    };
    this._persist();

    let workspaceMutationStarted = false;
    try {
      this._verifyDurableCheckpoint();
      const writeManifest = readJson(this.writesPath, this._state.limits);
      if (
        writeManifest?.digest !== this._state.writeManifest?.digest ||
        digestWorkspaceEvidence({
          version: writeManifest.version,
          writes: writeManifest.writes,
          summary: writeManifest.summary,
          unsafe: writeManifest.unsafe,
        }) !== writeManifest.digest
      ) {
        throw codedError(
          WORKSPACE_TRANSACTION_ERROR.EVIDENCE_MISMATCH,
          "committed write manifest digest does not match",
          { transactionId: this.id },
        );
      }
      const current = scanWorkspace(this.workspaceRoot, {
        limits: this._state.limits,
        allowUnsafe: true,
        exclusions: this._baseline.exclusions || [],
        expectedRootIdentity: this._state.workspaceRootIdentity,
      });
      const expected = expectedPostTaskSnapshot(this._baseline, writeManifest);
      const conflicts = buildWriteManifest(expected, current);
      if (
        (conflicts.writes.length > 0 || current.unsafe.length > 0) &&
        force !== true
      ) {
        const attempt = {
          id: restoreId,
          outcome: "conflict",
          at: new Date(this.manager._now()).toISOString(),
          expectedEvidenceDigest,
          conflictDigest: conflicts.digest,
          conflicts: conflicts.writes,
          unsafe: current.unsafe,
        };
        this._state.restoreAttempts = [
          ...(this._state.restoreAttempts || []),
          attempt,
        ].slice(-this._state.limits.maxFailureEvidence);
        this._state.state = WORKSPACE_TRANSACTION_STATE.COMMITTED;
        this._state.restoreContext = null;
        this._persist();
        lock.release();
        this.manager._active.delete(this.id);
        throw codedError(
          WORKSPACE_TRANSACTION_ERROR.RESTORE_CONFLICT,
          "workspace changed after checkpoint commit; explicit force is required",
          {
            transactionId: this.id,
            restoreId,
            conflictDigest: conflicts.digest,
            conflicts: conflicts.writes,
            unsafe: current.unsafe,
          },
        );
      }
      if (current.unsafe.length > 0) {
        throw codedError(
          WORKSPACE_TRANSACTION_ERROR.UNSAFE_ENTRY,
          "explicit restore cannot create a safety checkpoint with unsafe entries",
          {
            transactionId: this.id,
            restoreId,
            unsafe: current.unsafe,
          },
        );
      }

      const restoreDir = path.join(this.transactionDir, "restores", restoreId);
      const safetyBlobDir = path.join(restoreDir, "blobs");
      ensurePrivateDirectory(safetyBlobDir);
      const safetyScan = scanWorkspace(this.workspaceRoot, {
        limits: this._state.limits,
        blobDir: safetyBlobDir,
        allowUnsafe: false,
        exclusions: this._baseline.exclusions || [],
        expectedRootIdentity: this._state.workspaceRootIdentity,
      });
      const safetyCheckpointId = normalizeId(
        `safety-${this.manager._uuid()}`,
        "safety checkpoint id",
      );
      const safety = checkpointDocument(
        safetyCheckpointId,
        safetyScan,
        new Date(this.manager._now()).toISOString(),
      );
      atomicWriteJson(
        path.join(restoreDir, "baseline.json"),
        safety,
        this._state.limits,
      );
      this._state.restoreContext = {
        ...this._state.restoreContext,
        phase: "safety_ready",
        safetyCheckpoint: {
          id: safetyCheckpointId,
          path: manifestPath(
            path.relative(
              this.transactionDir,
              path.join(restoreDir, "baseline.json"),
            ),
          ),
          digest: safety.digest,
          entries: safety.stats.entries,
          files: safety.stats.files,
          bytes: safety.stats.bytes,
        },
      };
      this._persist();

      workspaceMutationStarted = true;
      const restored = restoreBaseline(
        this.workspaceRoot,
        this._baseline,
        this.blobDir,
        this._state.limits,
      );
      const unsigned = {
        version: WORKSPACE_TRANSACTION_VERSION,
        transactionId: this.id,
        restoreId,
        outcome: "restored",
        restoredCheckpointId: this.checkpointId,
        restoredCheckpointDigest: this._baseline.digest,
        sourceEvidenceDigest: expectedEvidenceDigest,
        safetyCheckpoint: this._state.restoreContext.safetyCheckpoint,
        conflictDigest: conflicts.digest,
        forced: force === true,
        reason: String(reason).slice(0, 1_000),
        verificationDigest: restored.verificationDigest,
        fileCoverage: this._state.requestedCoverage,
        uncoveredPaths: [...(this._baseline.uncoveredPaths || [])],
      };
      const evidence = {
        ...unsigned,
        evidenceDigest: digestWorkspaceEvidence(unsigned),
      };
      this._state.restoreEvidence = evidence;
      this._state.restores = [...(this._state.restores || []), evidence].slice(
        -this._state.limits.maxFailureEvidence,
      );
      this._state.restoreContext = null;
      this._state.state = WORKSPACE_TRANSACTION_STATE.RESTORED;
      this._state.restoredAt = new Date(this.manager._now()).toISOString();
      this._persist();
      lock.release();
      this.manager._active.delete(this.id);
      return deepClone(evidence);
    } catch (error) {
      if (
        error?.code === WORKSPACE_TRANSACTION_ERROR.RESTORE_CONFLICT &&
        this._state.state === WORKSPACE_TRANSACTION_STATE.COMMITTED
      ) {
        throw error;
      }
      this._appendFailure(error, "restore", {
        restoreId,
        workspaceMutationStarted,
        safetyCheckpoint: this._state.restoreContext?.safetyCheckpoint || null,
      });
      this._state.state = workspaceMutationStarted
        ? WORKSPACE_TRANSACTION_STATE.RESTORE_FAILED
        : WORKSPACE_TRANSACTION_STATE.COMMITTED;
      if (!workspaceMutationStarted) {
        this._state.restoreContext = null;
      }
      try {
        this._persist();
      } catch (persistError) {
        error.restorePersistenceError = String(
          persistError?.message || persistError,
        );
      }
      if (!workspaceMutationStarted) {
        try {
          lock.release();
          this.manager._active.delete(this.id);
        } catch {
          // Lost ownership is itself fail-closed and retained in state.
        }
      }
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.RESTORE_FAILED,
        `explicit checkpoint restore failed: ${error.message}`,
        {
          transactionId: this.id,
          restoreId,
          workspaceMutationStarted,
          safetyCheckpoint:
            this._state.restoreContext?.safetyCheckpoint || null,
          failureEvidence: deepClone(this._state.failureEvidence),
        },
        error,
      );
    }
  }

  /**
   * Undo a completed explicit restore by restoring its durable safety
   * checkpoint. The restore evidence digest is mandatory authority.
   */
  undoRestore({
    expectedRestoreEvidenceDigest,
    force = false,
    reason = "undo checkpoint restore",
  } = {}) {
    if (
      this._state.state === WORKSPACE_TRANSACTION_STATE.COMMITTED &&
      this._state.undoRestoreEvidence?.sourceRestoreEvidenceDigest ===
        expectedRestoreEvidenceDigest
    ) {
      return deepClone(this._state.undoRestoreEvidence);
    }
    if (this._state.state !== WORKSPACE_TRANSACTION_STATE.RESTORED) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.INVALID_TRANSITION,
        `cannot undo restore from ${this._state.state}`,
        { transactionId: this.id, state: this._state.state },
      );
    }
    const restoreEvidence = this._state.restoreEvidence;
    if (
      typeof expectedRestoreEvidenceDigest !== "string" ||
      expectedRestoreEvidenceDigest !== restoreEvidence?.evidenceDigest
    ) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.EVIDENCE_MISMATCH,
        "undo restore must bind the restore evidence digest",
        {
          transactionId: this.id,
          expectedRestoreEvidenceDigest,
          actualRestoreEvidenceDigest: restoreEvidence?.evidenceDigest || null,
        },
      );
    }
    const safetyRelative = restoreEvidence?.safetyCheckpoint?.path;
    const safetyNative = nativePath(safetyRelative);
    const safetyPath = path.resolve(this.transactionDir, safetyNative);
    if (!isStrictlyInside(this.transactionDir, safetyPath)) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.PATH_ESCAPE,
        "safety checkpoint path escapes its transaction",
        { transactionId: this.id, path: safetyRelative },
      );
    }
    const safety = assertBaselineDocument(
      readJson(safetyPath, this._state.limits),
      {
        id: this.id,
        checkpointId: restoreEvidence.safetyCheckpoint.id,
        workspaceRoot: this.workspaceRoot,
        workspaceRootIdentity: this._state.workspaceRootIdentity,
      },
    );
    if (safety.digest !== restoreEvidence.safetyCheckpoint.digest) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.EVIDENCE_MISMATCH,
        "safety checkpoint digest does not match restore evidence",
        { transactionId: this.id },
      );
    }

    const lock = this.manager._acquireWorkspaceLock(
      this.workspaceRoot,
      this.id,
    );
    this._lock = lock;
    this.manager._active.set(this.id, this);
    const undoId = normalizeId(
      `undo-${this.manager._uuid()}`,
      "undo restore id",
    );
    this._state.state = WORKSPACE_TRANSACTION_STATE.RESTORING;
    this._state.owner = deepClone(lock.owner);
    this._state.restoreContext = {
      id: undoId,
      phase: "undo_validating",
      expectedRestoreEvidenceDigest,
      force: force === true,
      reason: String(reason).slice(0, 1_000),
      startedAt: new Date(this.manager._now()).toISOString(),
    };
    this._persist();
    let workspaceMutationStarted = false;
    try {
      this._verifyDurableCheckpoint();
      const current = scanWorkspace(this.workspaceRoot, {
        limits: this._state.limits,
        allowUnsafe: true,
        exclusions: this._baseline.exclusions || [],
        expectedRootIdentity: this._state.workspaceRootIdentity,
      });
      const conflicts = buildWriteManifest(this._baseline, current);
      if (
        (conflicts.writes.length > 0 || current.unsafe.length > 0) &&
        force !== true
      ) {
        this._state.state = WORKSPACE_TRANSACTION_STATE.RESTORED;
        this._state.restoreContext = null;
        this._persist();
        lock.release();
        this.manager._active.delete(this.id);
        throw codedError(
          WORKSPACE_TRANSACTION_ERROR.RESTORE_CONFLICT,
          "workspace changed after restore; undo requires explicit force",
          {
            transactionId: this.id,
            undoId,
            conflicts: conflicts.writes,
            unsafe: current.unsafe,
          },
        );
      }
      if (current.unsafe.length > 0) {
        throw codedError(
          WORKSPACE_TRANSACTION_ERROR.UNSAFE_ENTRY,
          "undo restore cannot proceed with unsafe filesystem entries",
          { transactionId: this.id, unsafe: current.unsafe },
        );
      }
      workspaceMutationStarted = true;
      const restored = restoreBaseline(
        this.workspaceRoot,
        safety,
        path.join(path.dirname(safetyPath), "blobs"),
        this._state.limits,
      );
      const unsigned = {
        version: WORKSPACE_TRANSACTION_VERSION,
        transactionId: this.id,
        undoId,
        outcome: "restore_undone",
        sourceRestoreEvidenceDigest: expectedRestoreEvidenceDigest,
        safetyCheckpointId: safety.checkpointId,
        safetyCheckpointDigest: safety.digest,
        reason: String(reason).slice(0, 1_000),
        forced: force === true,
        verificationDigest: restored.verificationDigest,
        fileCoverage: this._state.requestedCoverage,
        uncoveredPaths: [...(safety.uncoveredPaths || [])],
      };
      const evidence = {
        ...unsigned,
        evidenceDigest: digestWorkspaceEvidence(unsigned),
      };
      this._state.undoRestoreEvidence = evidence;
      this._state.restoreContext = null;
      this._state.state = WORKSPACE_TRANSACTION_STATE.COMMITTED;
      this._persist();
      lock.release();
      this.manager._active.delete(this.id);
      return deepClone(evidence);
    } catch (error) {
      if (
        error?.code === WORKSPACE_TRANSACTION_ERROR.RESTORE_CONFLICT &&
        this._state.state === WORKSPACE_TRANSACTION_STATE.RESTORED
      ) {
        throw error;
      }
      this._appendFailure(error, "undo_restore", {
        undoId,
        workspaceMutationStarted,
        safetyCheckpointId: safety.checkpointId,
      });
      this._state.state = workspaceMutationStarted
        ? WORKSPACE_TRANSACTION_STATE.RESTORE_FAILED
        : WORKSPACE_TRANSACTION_STATE.RESTORED;
      if (!workspaceMutationStarted) this._state.restoreContext = null;
      try {
        this._persist();
      } catch (persistError) {
        error.restorePersistenceError = String(
          persistError?.message || persistError,
        );
      }
      if (!workspaceMutationStarted) {
        try {
          lock.release();
          this.manager._active.delete(this.id);
        } catch {
          // Preserve fail-closed ownership evidence.
        }
      }
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.RESTORE_FAILED,
        `undo checkpoint restore failed: ${error.message}`,
        {
          transactionId: this.id,
          undoId,
          workspaceMutationStarted,
          failureEvidence: deepClone(this._state.failureEvidence),
        },
        error,
      );
    }
  }
}

export class WorkspaceTransactionManager {
  constructor(options = {}) {
    this.stateDir = path.resolve(options.stateDir || defaultStateDir());
    this.transactionsDir = path.join(this.stateDir, "transactions");
    const canonicalLockDir = path.resolve(defaultLockDir());
    const requestedLockDir = path.resolve(options.lockDir || canonicalLockDir);
    const testLockInjection =
      options.allowNonCanonicalLockDirForTests === true &&
      process.env.NODE_ENV === "test";
    if (!samePath(requestedLockDir, canonicalLockDir) && !testLockInjection) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.INVALID_ARGUMENT,
        "workspace transaction lock authority is canonical and cannot be caller-selected",
        {
          requestedLockDir,
          canonicalLockDir,
        },
      );
    }
    this.lockDir = requestedLockDir;
    this.lockAuthority = testLockInjection ? "test-injected" : "canonical";
    this._now = options.now || (() => Date.now());
    this._uuid = options.uuid || (() => randomUUID());
    this._ownerToken = options.ownerToken || (() => randomUUID());
    this._isProcessAlive = options.isProcessAlive || processAlive;
    this._active = new Map();
  }

  _preflightLockRoot(workspaceRoot = null) {
    const requestedLockDir = path.resolve(this.lockDir);
    const projectedLockDir = canonicalPathThroughExistingAncestor(
      requestedLockDir,
      "lock directory",
    );
    if (workspaceRoot && pathsOverlap(projectedLockDir, workspaceRoot)) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.INVALID_PATH,
        "workspace transaction lock directory must be disjoint from the workspace",
        {
          workspaceRoot,
          lockDir: requestedLockDir,
          resolvedLockDir: projectedLockDir,
        },
      );
    }
    return { requestedLockDir, projectedLockDir };
  }

  _ensureLockRoot(workspaceRoot = null) {
    this._preflightLockRoot(workspaceRoot);
    this.lockDir = assertSafeDirectory(this.lockDir, "lock directory", {
      create: true,
    });
    if (workspaceRoot && pathsOverlap(this.lockDir, workspaceRoot)) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.INVALID_PATH,
        "workspace transaction lock directory must be disjoint from the workspace",
        { workspaceRoot, lockDir: this.lockDir },
      );
    }
    assertOwnedPrivateDirectory(this.lockDir, "lock directory");
    return this.lockDir;
  }

  _acquireWorkspaceLock(workspaceRoot, transactionId) {
    this._ensureLockRoot(workspaceRoot);
    let lock = null;
    withFileLock(
      path.join(this.lockDir, "coordination"),
      () => {
        assertNoOverlappingWorkspaceLock(
          this.lockDir,
          workspaceRoot,
          this._isProcessAlive,
        );
        lock = WorkspaceLifetimeLock.acquire(
          this.lockDir,
          workspaceRoot,
          transactionId,
          {
            isProcessAlive: this._isProcessAlive,
            now: this._now,
            ownerToken: this._ownerToken,
          },
        );
      },
      {
        failIfUnavailable: true,
        timeoutMs: 5_000,
      },
    );
    return lock;
  }

  _preflightStateRoot(workspaceRoot = null) {
    const requestedStateDir = path.resolve(this.stateDir);
    const projectedStateDir = canonicalPathThroughExistingAncestor(
      requestedStateDir,
      "state directory",
    );
    if (
      workspaceRoot &&
      (samePath(projectedStateDir, workspaceRoot) ||
        isStrictlyInside(workspaceRoot, projectedStateDir))
    ) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.INVALID_PATH,
        "workspace transaction state directory must be outside the workspace",
        {
          workspaceRoot,
          stateDir: requestedStateDir,
          resolvedStateDir: projectedStateDir,
        },
      );
    }
    return { requestedStateDir, projectedStateDir };
  }

  _ensureStateRoot(workspaceRoot = null) {
    this._preflightStateRoot(workspaceRoot);
    const stateDir = assertSafeDirectory(this.stateDir, "state directory", {
      create: true,
    });
    if (
      workspaceRoot &&
      (samePath(stateDir, workspaceRoot) ||
        isStrictlyInside(workspaceRoot, stateDir))
    ) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.INVALID_PATH,
        "workspace transaction state directory must be outside the workspace",
        { workspaceRoot, stateDir },
      );
    }
    this.stateDir = stateDir;
    this.transactionsDir = path.join(stateDir, "transactions");
    ensurePrivateDirectory(this.transactionsDir);
    return stateDir;
  }

  begin(options = {}) {
    const workspaceRoot = assertSafeDirectory(
      options.workspaceRoot,
      "workspace root",
    );
    assertNotFilesystemRoot(workspaceRoot);
    // Reject canonical aliases (macOS /var -> /private/var, Windows 8.3, and
    // symlink/junction paths) before state or lock setup creates anything.
    this._preflightLockRoot(workspaceRoot);
    this._preflightStateRoot(workspaceRoot);
    this._ensureStateRoot(workspaceRoot);
    this._ensureLockRoot(workspaceRoot);
    const runId = normalizeBoundedText(options.runId, "runId");
    const taskKey = normalizeBoundedText(options.taskKey, "taskKey");
    const limits = normalizeLimits(options.limits);
    const externalSideEffects = options.externalSideEffects !== false;
    const coverageTarget =
      options.coverageTarget || WORKSPACE_TRANSACTION_COVERAGE.PARTIAL;
    if (
      coverageTarget !== WORKSPACE_TRANSACTION_COVERAGE.FULL &&
      coverageTarget !== WORKSPACE_TRANSACTION_COVERAGE.PARTIAL
    ) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.INVALID_ARGUMENT,
        "coverageTarget must be full or partial",
      );
    }
    let exclusions = normalizeExclusions(options.exclusions || []);
    const gitMetadata = linkedGitMetadata(workspaceRoot);
    const writerIsolation =
      options.writerIsolation === "exclusive-workspace"
        ? "exclusive-workspace"
        : "unknown";
    if (
      coverageTarget === WORKSPACE_TRANSACTION_COVERAGE.FULL &&
      writerIsolation !== "exclusive-workspace"
    ) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.WRITER_ISOLATION_REQUIRED,
        "full file coverage requires an exclusive-workspace writer contract",
        { workspaceRoot },
      );
    }
    if (
      coverageTarget === WORKSPACE_TRANSACTION_COVERAGE.FULL &&
      exclusions.length > 0
    ) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.WRITER_ISOLATION_REQUIRED,
        "full file coverage cannot exclude writable workspace paths",
        { workspaceRoot, exclusions },
      );
    }
    if (
      coverageTarget === WORKSPACE_TRANSACTION_COVERAGE.FULL &&
      gitMetadata?.external
    ) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.WRITER_ISOLATION_REQUIRED,
        "full file coverage cannot capture linked worktree Git metadata",
        {
          workspaceRoot,
          gitMetadata: gitMetadata.targetClass,
        },
      );
    }
    const uncoveredPaths = [...exclusions];
    if (
      coverageTarget === WORKSPACE_TRANSACTION_COVERAGE.PARTIAL &&
      gitMetadata?.external
    ) {
      if (!exclusions.includes(".git")) {
        exclusions = [...exclusions, ".git"].sort();
      }
      if (!uncoveredPaths.includes(".git")) uncoveredPaths.push(".git");
      uncoveredPaths.push("@external-git-metadata");
    }
    const id = normalizeId(
      options.id || `wcp-${this._uuid()}`,
      "transaction id",
    );
    const checkpointId = normalizeId(`checkpoint-${id}`, "checkpoint id");
    const transactionDir = path.join(this.transactionsDir, id);
    if (fs.existsSync(transactionDir)) {
      throw codedError(
        WORKSPACE_TRANSACTION_ERROR.INVALID_ARGUMENT,
        `workspace transaction already exists: ${id}`,
        { transactionId: id },
      );
    }
    const lock = this._acquireWorkspaceLock(workspaceRoot, id);
    let state = null;
    try {
      const pinnedRoot = inspectWorkspaceRoot(workspaceRoot);
      ensurePrivateDirectory(transactionDir);
      const blobDir = path.join(transactionDir, "blobs");
      ensurePrivateDirectory(blobDir);
      const createdAt = new Date(this._now()).toISOString();
      state = {
        version: WORKSPACE_TRANSACTION_VERSION,
        id,
        checkpointId,
        state: WORKSPACE_TRANSACTION_STATE.PREPARING,
        runId,
        taskKey,
        workspaceRoot,
        workspaceRootIdentity: deepClone(pinnedRoot.descriptor.identity),
        stateDir: this.stateDir,
        lockAuthority: this.lockAuthority,
        createdAt,
        updatedAt: createdAt,
        owner: deepClone(lock.owner),
        limits,
        externalSideEffects,
        writerIsolation,
        exclusions,
        uncoveredPaths: [...uncoveredPaths],
        gitMetadata: gitMetadata
          ? {
              kind: gitMetadata.kind,
              external: gitMetadata.external,
              targetClass: gitMetadata.targetClass || null,
            }
          : null,
        requestedCoverage: coverageTarget,
        fileCoverage: WORKSPACE_TRANSACTION_COVERAGE.NONE,
        coverage: WORKSPACE_TRANSACTION_COVERAGE.NONE,
        executions: [],
        failureEvidence: [],
        checkpoint: null,
        writeManifest: null,
        evidence: null,
      };
      state.stateDigest = stateDigest(state);
      atomicWriteJson(
        path.join(transactionDir, "transaction.json"),
        state,
        limits,
      );
      const scan = scanWorkspace(workspaceRoot, {
        limits,
        blobDir,
        allowUnsafe: false,
        exclusions,
        expectedRootIdentity: pinnedRoot.descriptor.identity,
        gitMetadataPolicy:
          coverageTarget === WORKSPACE_TRANSACTION_COVERAGE.FULL
            ? "deny"
            : "exclude",
      });
      scan.uncoveredPaths = [
        ...new Set([...scan.uncoveredPaths, ...uncoveredPaths]),
      ].sort();
      state.exclusions = [...scan.exclusions];
      state.uncoveredPaths = [...scan.uncoveredPaths];
      const baseline = checkpointDocument(checkpointId, scan, createdAt);
      atomicWriteJson(
        path.join(transactionDir, "baseline.json"),
        baseline,
        limits,
      );
      state.state = WORKSPACE_TRANSACTION_STATE.PREPARED;
      state.fileCoverage = coverageTarget;
      state.coverage =
        coverageTarget === WORKSPACE_TRANSACTION_COVERAGE.FULL &&
        !externalSideEffects
          ? WORKSPACE_TRANSACTION_COVERAGE.FULL
          : WORKSPACE_TRANSACTION_COVERAGE.PARTIAL;
      state.checkpoint = {
        id: checkpointId,
        path: "baseline.json",
        digest: baseline.digest,
        entries: baseline.stats.entries,
        files: baseline.stats.files,
        bytes: baseline.stats.bytes,
      };
      state.updatedAt = new Date(this._now()).toISOString();
      state.stateDigest = stateDigest(state);
      atomicWriteJson(
        path.join(transactionDir, "transaction.json"),
        state,
        limits,
      );
      const transaction = new WorkspaceTransaction(this, state, baseline, lock);
      this._active.set(id, transaction);
      return transaction;
    } catch (error) {
      if (state) {
        try {
          state.state = WORKSPACE_TRANSACTION_STATE.ABORTED;
          state.fileCoverage = WORKSPACE_TRANSACTION_COVERAGE.NONE;
          state.coverage = WORKSPACE_TRANSACTION_COVERAGE.NONE;
          state.failureEvidence = [
            errorEvidence(error, this._now(), "prepare"),
          ];
          state.updatedAt = new Date(this._now()).toISOString();
          state.stateDigest = stateDigest(state);
          atomicWriteJson(
            path.join(transactionDir, "transaction.json"),
            state,
            limits,
          );
        } catch {
          // The original fail-closed preparation error remains authoritative.
        }
      }
      try {
        lock.release();
      } catch {
        // A lost lock only tightens the failure: no task transaction is returned.
      }
      throw error;
    }
  }

  get(id) {
    normalizeId(id);
    return this._active.get(id) || null;
  }

  /**
   * Return a detached, fully validated durable state document. Baseline
   * entries and content blobs remain private to the transaction store.
   */
  inspect(id) {
    return deepClone(this._loadTransaction(id).state);
  }

  /**
   * List validated transaction summaries. Corrupt transaction state is not
   * skipped: _loadTransaction throws so callers cannot mistake an incomplete
   * listing for authoritative recovery state.
   */
  list(options = {}) {
    this._ensureStateRoot();
    const requestedRoot = options.workspaceRoot
      ? assertSafeDirectory(options.workspaceRoot, "workspace root")
      : null;
    const summaries = [];
    for (const name of fs.readdirSync(this.transactionsDir).sort()) {
      if (!SAFE_ID.test(name)) continue;
      const { state } = this._loadTransaction(name);
      if (requestedRoot && !samePath(requestedRoot, state.workspaceRoot)) {
        continue;
      }
      summaries.push({
        id: state.id,
        checkpointId: state.checkpointId,
        state: state.state,
        workspaceRoot: state.workspaceRoot,
        runId: state.runId,
        taskKey: state.taskKey,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
        coverage: state.coverage,
        fileCoverage: state.fileCoverage,
        requestedCoverage: state.requestedCoverage,
        externalSideEffects: state.externalSideEffects,
        writerIsolation: state.writerIsolation,
        uncoveredPaths: deepClone(state.uncoveredPaths || []),
        evidence: deepClone(state.evidence || null),
        restoreEvidence: deepClone(state.restoreEvidence || null),
        undoRestoreEvidence: deepClone(state.undoRestoreEvidence || null),
        executionCount: (state.executions || []).length,
        failureCount: (state.failureEvidence || []).length,
      });
    }
    return summaries.sort(
      (left, right) =>
        String(right.updatedAt).localeCompare(String(left.updatedAt)) ||
        left.id.localeCompare(right.id),
    );
  }

  restore(id, options = {}) {
    const loaded = this._loadTransaction(id);
    const transaction = new WorkspaceTransaction(
      this,
      loaded.state,
      loaded.baseline,
      null,
    );
    return transaction.restore(options);
  }

  undoRestore(id, options = {}) {
    const loaded = this._loadTransaction(id);
    const transaction = new WorkspaceTransaction(
      this,
      loaded.state,
      loaded.baseline,
      null,
    );
    return transaction.undoRestore(options);
  }

  /**
   * Called by ProcessExecutionBroker before a child is spawned. Every active
   * transaction whose canonical workspace contains the child's cwd records the
   * process before execution, so evidence persistence failure denies the spawn.
   */
  activeWorkspaceMembershipForCwd(cwd) {
    const active = [...this._active.values()].filter(
      (transaction) => !TERMINAL_STATES.has(transaction.state),
    );
    if (active.length === 0) return null;
    const { requested, canonical } = canonicalProcessCwd(cwd);
    for (const transaction of active) {
      const requestedInside = isPathInside(
        transaction.workspaceRoot,
        requested,
      );
      const canonicalInside = isPathInside(
        transaction.workspaceRoot,
        canonical,
      );
      if (requestedInside && !canonicalInside) {
        throw codedError(
          WORKSPACE_TRANSACTION_ERROR.PATH_ESCAPE,
          "managed process cwd resolves outside its workspace transaction",
          {
            cwd: requested,
            resolvedCwd: canonical,
            transactionId: transaction.id,
          },
        );
      }
      if (canonicalInside) {
        return {
          workspaceRoot: transaction.workspaceRoot,
          cwd: canonical,
        };
      }
    }
    return null;
  }

  hasActiveTransactionForCwd(cwd) {
    return this.activeWorkspaceMembershipForCwd(cwd) !== null;
  }

  activeWorkspaceRootForCwd(cwd) {
    return this.activeWorkspaceMembershipForCwd(cwd)?.workspaceRoot || null;
  }

  prepareSpawn(entry) {
    const matches = [];
    const active = [...this._active.values()].filter(
      (transaction) => !TERMINAL_STATES.has(transaction.state),
    );
    if (active.length === 0) return matches;
    const { requested, canonical } = canonicalProcessCwd(entry.cwd);
    for (const transaction of active) {
      const requestedInside = isPathInside(
        transaction.workspaceRoot,
        requested,
      );
      const canonicalInside = isPathInside(
        transaction.workspaceRoot,
        canonical,
      );
      if (requestedInside && !canonicalInside) {
        throw codedError(
          WORKSPACE_TRANSACTION_ERROR.PATH_ESCAPE,
          "managed process cwd resolves outside its workspace transaction",
          {
            cwd: requested,
            resolvedCwd: canonical,
            transactionId: transaction.id,
          },
        );
      }
      if (!canonicalInside) continue;
      transaction._assertWorkspaceRootIdentity();
      if (entry.detached === true) {
        throw codedError(
          WORKSPACE_TRANSACTION_ERROR.DETACHED_PROCESS,
          "detached/background processes are denied inside a workspace transaction",
          {
            transactionId: transaction.id,
            executionId: entry.executionId,
            cwd: canonical,
          },
        );
      }
      transaction.recordExecution({ ...entry, cwd: canonical });
      matches.push(transaction.id);
    }
    return matches;
  }

  bindProcess(entry, proc) {
    const bound = [];
    for (const transaction of this._active.values()) {
      if (!transaction.hasExecution(entry.executionId)) continue;
      transaction.bindExecution(entry.executionId, {
        pid: proc?.pid,
        treeGuarantee: Array.isArray(entry.sandboxGuarantees)
          ? entry.sandboxGuarantees.includes("process-tree")
          : false,
      });
      let settled = false;
      const settle = (outcome = {}) => {
        if (settled) return;
        settled = true;
        try {
          transaction.settleExecution(entry.executionId, outcome);
        } catch {
          // Persistence failure deliberately leaves the execution unsettled;
          // accept/rollback will then fail closed.
        }
      };
      if (typeof proc?.once === "function") {
        proc.once("close", (exitCode, signal) => settle({ exitCode, signal }));
      } else if (typeof proc?.onExit === "function") {
        proc.onExit((event = {}) =>
          settle({
            exitCode: event.exitCode,
            signal: event.signal,
          }),
        );
      } else {
        throw codedError(
          WORKSPACE_TRANSACTION_ERROR.WRITERS_ACTIVE,
          "managed process does not expose a close/exit observation API",
          {
            transactionId: transaction.id,
            executionId: entry.executionId,
          },
        );
      }
      bound.push(transaction.id);
    }
    return bound;
  }

  updateProcessGuarantees(entry) {
    for (const transaction of this._active.values()) {
      if (!transaction.hasExecution(entry.executionId)) continue;
      transaction.updateExecutionGuarantees(entry.executionId, {
        treeGuarantee: Array.isArray(entry.sandboxGuarantees)
          ? entry.sandboxGuarantees.includes("process-tree")
          : false,
      });
    }
  }

  settleSpawn(entry, outcome = {}) {
    for (const transaction of this._active.values()) {
      if (!transaction.hasExecution(entry.executionId)) continue;
      transaction.settleExecution(entry.executionId, outcome);
    }
  }

  _loadTransaction(id) {
    normalizeId(id);
    this._ensureStateRoot();
    const transactionDir = path.join(this.transactionsDir, id);
    const statePath = path.join(transactionDir, "transaction.json");
    assertPrivateRegularFile(statePath, {
      // A corrupt state file must not cause an unbounded read before its
      // persisted configurable limit can itself be validated.
      maxBytes: 256 * 1024 * 1024,
    });
    const provisional = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const limits = normalizeLimits(provisional?.limits);
    const state = assertStateDocument(readJson(statePath, limits), id);
    const baseline = assertBaselineDocument(
      readJson(path.join(transactionDir, "baseline.json"), limits),
      state,
    );
    return { state, baseline, transactionDir };
  }

  recoverPending(options = {}) {
    this._ensureStateRoot();
    this._ensureLockRoot();
    const requestedRoot = options.workspaceRoot
      ? assertSafeDirectory(options.workspaceRoot, "workspace root")
      : null;
    const results = [];
    const names = fs.readdirSync(this.transactionsDir).sort();
    for (const name of names) {
      if (!SAFE_ID.test(name)) continue;
      let loaded;
      try {
        loaded = this._loadTransaction(name);
      } catch (error) {
        results.push({
          id: name,
          status: "corrupt",
          error: error.message,
          code: error.code,
        });
        continue;
      }
      const { state, baseline } = loaded;
      if (requestedRoot && !samePath(requestedRoot, state.workspaceRoot)) {
        continue;
      }
      if (TERMINAL_STATES.has(state.state)) {
        const terminalLock = readLockOwner(
          path.join(this.lockDir, workspaceLockName(state.workspaceRoot)),
        );
        results.push({
          id: name,
          status: terminalLock
            ? "terminal_lock_recovery_required"
            : state.state,
          ...(terminalLock
            ? {
                code: WORKSPACE_TRANSACTION_ERROR.RECOVERY_REQUIRED,
                ownerPid: terminalLock.pid,
                manualRecoveryRequired: true,
              }
            : {}),
        });
        continue;
      }
      if (this._isProcessAlive(state.owner?.pid)) {
        results.push({
          id: name,
          status: "active_unverified",
          ownerPid: state.owner.pid,
          ownerIdentityPolicy:
            state.owner.identityPolicy || "pid-only-fail-closed",
          manualRecoveryRequired: true,
        });
        continue;
      }
      if (
        state.state === WORKSPACE_TRANSACTION_STATE.RESTORING ||
        state.state === WORKSPACE_TRANSACTION_STATE.RESTORE_FAILED
      ) {
        results.push({
          id: name,
          status: "restore_recovery_required",
          code: WORKSPACE_TRANSACTION_ERROR.RECOVERY_REQUIRED,
          fileCoverage: WORKSPACE_TRANSACTION_COVERAGE.NONE,
          manualRecoveryRequired: true,
          restoreContext: deepClone(state.restoreContext || null),
          failureEvidence: deepClone(state.failureEvidence || []),
        });
        continue;
      }
      const unclosedExecutions = (state.executions || []).filter(
        (entry) =>
          entry.status !== "settled" || entry.treeGuarantee !== "process-tree",
      );
      if (unclosedExecutions.length > 0) {
        results.push({
          id: name,
          status: "recovery_required",
          code: WORKSPACE_TRANSACTION_ERROR.WRITERS_ACTIVE,
          fileCoverage: WORKSPACE_TRANSACTION_COVERAGE.NONE,
          manualRecoveryRequired: true,
          executions: unclosedExecutions.map((entry) => ({
            executionId: entry.executionId,
            status: entry.status,
            pid: entry.pid,
            processIdentity: entry.processIdentity,
            treeGuarantee: entry.treeGuarantee,
          })),
        });
        continue;
      }
      const lockPath = path.join(
        this.lockDir,
        workspaceLockName(state.workspaceRoot),
      );
      const deadOwner = readLockOwner(lockPath);
      if (!sameOwner(deadOwner, state.owner)) {
        results.push({
          id: name,
          status: "lock_mismatch",
          code: WORKSPACE_TRANSACTION_ERROR.LOCK_CORRUPT,
        });
        continue;
      }
      let lock;
      try {
        lock = WorkspaceLifetimeLock.acquire(
          this.lockDir,
          state.workspaceRoot,
          state.id,
          {
            isProcessAlive: this._isProcessAlive,
            now: this._now,
            ownerToken: this._ownerToken,
            reclaimDead: true,
            expectedDeadOwner: deadOwner,
          },
        );
        state.owner = deepClone(lock.owner);
        state.updatedAt = new Date(this._now()).toISOString();
        state.stateDigest = stateDigest(state);
        atomicWriteJson(
          path.join(loaded.transactionDir, "transaction.json"),
          state,
          state.limits,
        );
        if (state.state === WORKSPACE_TRANSACTION_STATE.PREPARING) {
          state.state = WORKSPACE_TRANSACTION_STATE.ABORTED;
          state.failureEvidence = [
            ...(state.failureEvidence || []),
            {
              at: new Date(this._now()).toISOString(),
              phase: "recover",
              code: "PREPARATION_CRASHED",
              message:
                "transaction crashed before task execution was authorized",
            },
          ].slice(-state.limits.maxFailureEvidence);
          state.updatedAt = new Date(this._now()).toISOString();
          state.stateDigest = stateDigest(state);
          atomicWriteJson(
            path.join(loaded.transactionDir, "transaction.json"),
            state,
            state.limits,
          );
          lock.release();
          results.push({ id: name, status: "aborted" });
          continue;
        }
        const transaction = new WorkspaceTransaction(
          this,
          state,
          baseline,
          lock,
        );
        this._active.set(name, transaction);
        const evidence = transaction.rollback({
          reason: options.reason || "crash recovery",
        });
        results.push({
          id: name,
          status: "rolled_back",
          evidenceDigest: evidence.evidenceDigest,
        });
      } catch (error) {
        results.push({
          id: name,
          status: "rollback_failed",
          code: error.code,
          error: error.message,
        });
      }
    }
    return results;
  }
}
