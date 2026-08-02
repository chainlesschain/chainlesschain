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
import { createHash, randomUUID } from "node:crypto";
import { getHomeDir } from "./paths.js";
import {
  sameFileStatIdentity,
  samePathHandleFileIdentity,
  withTrustedFileParentSync,
} from "./secure-file-identity.js";
import {
  ensurePrivateDirectory,
  inspectPrivatePaths,
  repairPrivatePaths,
} from "./secure-fs.js";

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
const RESTORE_SAFETY_PLAN_SCHEMA = "cc-copy-restore-safety-plan/v1";
const RESTORE_SAFETY_ARM_SCHEMA = "cc-copy-restore-safety-arm/v1";
const RESTORE_SAFETY_ARM_DIR = ".restore-safety-arms";
const RESTORE_SAFETY_NAMESPACE_DIR = ".restore-workspace";
const RESTORE_SAFETY_THREAT_BOUNDARY =
  "cooperative-workspace-lock+owner-private-staging/v1";
const RESTORE_SAFETY_QUARANTINE_POLICY = "non-authoritative-trash/v1";
const MAX_WORKSPACE_PATH_LENGTH = 32_768;
const MAX_RELATIVE_PATH_LENGTH = 4_096;
const MAX_CHECKPOINT_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_RESTORE_SAFETY_ARM_BYTES = 64 * 1024;
const SHA256_RE = /^[a-f0-9]{64}$/;
const SHA256_IDENTITY_RE = /^sha256:[a-f0-9]{64}$/;
const EMPTY_SHA256 = createHash("sha256").update(Buffer.alloc(0)).digest("hex");
const BIGINT_STAT_OPTIONS = Object.freeze({ bigint: true });

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
function syncDirectoryEntry(filePath) {
  let fd;
  try {
    fd = fs.openSync(path.dirname(filePath), "r");
    fs.fsyncSync(fd);
  } catch (error) {
    // Windows does not consistently permit opening/flushing a directory. The
    // temp file is flushed before rename; on platforms that support directory
    // fsync, an unexpected metadata-flush failure is a durability failure.
    if (
      process.platform !== "win32" ||
      !["EACCES", "EINVAL", "ENOTSUP", "EPERM"].includes(error?.code)
    ) {
      throw error;
    }
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}

function flushPublishedFile(filePath) {
  // The temp file was flushed before rename. Only the directory entry remains
  // to be synchronized here; reopening a renamed file read-only and calling
  // fsync is rejected by Windows even though the data is already durable.
  syncDirectoryEntry(filePath);
}

function atomicWriteFileSync(filePath, data, options = {}) {
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, data, {
      flag: "wx",
      ...(options.mode != null ? { mode: options.mode } : {}),
      ...(options.durable ? { flush: true } : {}),
    });
    const stagingIdentity = options.beforeRename
      ? createdFileIdentity(fs.lstatSync(tmp, { bigint: true }))
      : null;
    options.beforeRename?.({ stagingIdentity, tmp });
    fs.renameSync(tmp, filePath);
    if (options.durable) flushPublishedFile(filePath);
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

function pathsOverlap(left, right) {
  const leftKey = pathComparisonKey(left);
  const rightKey = pathComparisonKey(right);
  return (
    leftKey === rightKey ||
    leftKey.startsWith(`${rightKey}${path.sep}`) ||
    rightKey.startsWith(`${leftKey}${path.sep}`)
  );
}

const PRIVATE_AUTHORITY_OPTIONS = Object.freeze({
  applyWindowsAcl: true,
  failIfUnavailable: true,
});

function ensurePrivateAuthorityDirectories(paths) {
  const uniqueTargets = [...new Set(paths.map((entry) => path.resolve(entry)))];
  for (const target of uniqueTargets) {
    ensurePrivateDirectory(target, {
      ...PRIVATE_AUTHORITY_OPTIONS,
      applyWindowsAcl: false,
    });
  }
  repairPrivatePaths(uniqueTargets, PRIVATE_AUTHORITY_OPTIONS);
}

function createPrivateAuthorityDirectories(paths) {
  const uniqueTargets = [...new Set(paths.map((entry) => path.resolve(entry)))];
  for (const target of uniqueTargets) {
    ensurePrivateDirectory(target, {
      ...PRIVATE_AUTHORITY_OPTIONS,
      applyWindowsAcl: false,
    });
  }
  return uniqueTargets;
}

function ensurePrivateAuthorityFiles(paths) {
  const uniqueTargets = [...new Set(paths.map((entry) => path.resolve(entry)))];
  repairPrivatePaths(uniqueTargets, PRIVATE_AUTHORITY_OPTIONS);
}

function assertPrivateAuthorityPaths(manifest, targets) {
  const uniqueTargets = [
    ...new Set(targets.map((entry) => path.resolve(entry))),
  ];
  let inspected;
  try {
    inspected = inspectPrivatePaths(uniqueTargets);
  } catch (cause) {
    throw recoveryRequired(manifest, "private authority inspection failed", {
      cause,
    });
  }
  if (
    inspected.length !== uniqueTargets.length ||
    inspected.some((entry) => entry.exists !== true || entry.ok !== true)
  ) {
    const failed = inspected.find(
      (entry) => entry.exists !== true || entry.ok !== true,
    );
    throw recoveryRequired(
      manifest,
      `checkpoint authority is not owner-private: ${failed?.target || "unknown"}`,
      { privatePathInspection: failed || inspected },
    );
  }
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

/**
 * Identity fields that survive a same-filesystem temp-file rename. ctime is
 * intentionally excluded because rename changes it on some filesystems;
 * the filesystem object id prevents a later same-content file from being
 * mistaken for the file created by the restore.
 */
function createdFileIdentity(stat) {
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
  };
}

function isFilesystemObjectIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = ["dev", "ino", "mode", "nlink", "size", "mtimeNs"];
  return (
    Object.keys(value).length === keys.length &&
    keys.every(
      (key) => typeof value[key] === "string" && /^[0-9]+$/.test(value[key]),
    )
  );
}

function isCreatedFileIdentity(value, bytes) {
  if (!isFilesystemObjectIdentity(value)) return false;
  return value.nlink === "1" && value.size === String(bytes);
}

function sameDirectoryObjectIdentity(left, right) {
  return (
    isFilesystemObjectIdentity(left) &&
    isFilesystemObjectIdentity(right) &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode
  );
}

function sameReservedFileIdentity(left, right) {
  return (
    isFilesystemObjectIdentity(left) &&
    isFilesystemObjectIdentity(right) &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === "1" &&
    right.nlink === "1"
  );
}

function sameMovedTrashIdentity(left, right) {
  return (
    isFilesystemObjectIdentity(left) &&
    isFilesystemObjectIdentity(right) &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === "1" &&
    right.nlink === "1" &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs
  );
}

function sameStatIdentity(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function lstatOptional(filePath, runtimeFs = fs) {
  try {
    return runtimeFs.lstatSync(filePath, BIGINT_STAT_OPTIONS);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function isSingleLinkRegularFile(stat) {
  return Boolean(
    stat &&
    typeof stat.isSymbolicLink === "function" &&
    !stat.isSymbolicLink() &&
    typeof stat.isFile === "function" &&
    stat.isFile() &&
    stat.nlink === 1n,
  );
}

/**
 * Read a regular file while proving that both its pathname and opened handle
 * stay stable. Path snapshots and handle snapshots remain exact within their
 * own API domains. Only cross-domain comparisons use the narrow Windows
 * libuv 1.49/1.50 compatibility bridge, bound to the independently opened
 * parent volume/share device supplied by withTrustedFileParentSync.
 *
 * This does not provide handle-relative open semantics. Callers remain bound
 * by RESTORE_SAFETY_THREAT_BOUNDARY and its cooperative workspace lock.
 */
function readStablePlainFileSync(
  filePath,
  initialPathStat,
  reader,
  {
    runtimeFs = fs,
    runtime = undefined,
    secureFileParent = withTrustedFileParentSync,
  } = {},
) {
  if (typeof reader !== "function") {
    throw new TypeError("stable file reader must be a function");
  }
  return secureFileParent(
    runtimeFs,
    filePath,
    ({ canonicalPath, parentDevice }) => {
      if (!samePath(filePath, canonicalPath)) {
        throw new Error("file parent resolves to a different path");
      }

      const pathBefore = runtimeFs.lstatSync(
        canonicalPath,
        BIGINT_STAT_OPTIONS,
      );
      if (
        !isSingleLinkRegularFile(initialPathStat) ||
        !isSingleLinkRegularFile(pathBefore) ||
        !sameFileStatIdentity(initialPathStat, pathBefore)
      ) {
        throw new Error("file path changed before opening");
      }

      const readOnly = Number(
        runtimeFs.constants?.O_RDONLY ?? fs.constants.O_RDONLY,
      );
      const noFollow = Number(
        runtimeFs.constants?.O_NOFOLLOW ?? fs.constants.O_NOFOLLOW ?? 0,
      );
      let descriptor = null;
      try {
        descriptor = runtimeFs.openSync(canonicalPath, readOnly | noFollow);
        const handleBefore = runtimeFs.fstatSync(
          descriptor,
          BIGINT_STAT_OPTIONS,
        );
        if (
          !isSingleLinkRegularFile(handleBefore) ||
          !samePathHandleFileIdentity(
            pathBefore,
            handleBefore,
            parentDevice,
            runtime,
          )
        ) {
          throw new Error("file identity changed while opening");
        }

        const value = reader({
          descriptor,
          handleStat: handleBefore,
          pathStat: pathBefore,
        });
        const handleAfter = runtimeFs.fstatSync(
          descriptor,
          BIGINT_STAT_OPTIONS,
        );
        const pathAfter = runtimeFs.lstatSync(
          canonicalPath,
          BIGINT_STAT_OPTIONS,
        );
        if (
          !isSingleLinkRegularFile(handleAfter) ||
          !isSingleLinkRegularFile(pathAfter) ||
          !sameFileStatIdentity(handleBefore, handleAfter) ||
          !sameFileStatIdentity(pathBefore, pathAfter) ||
          !samePathHandleFileIdentity(
            pathAfter,
            handleAfter,
            parentDevice,
            runtime,
          )
        ) {
          throw new Error("file changed during read");
        }
        return { stat: handleAfter, value };
      } finally {
        if (descriptor !== null) runtimeFs.closeSync(descriptor);
      }
    },
    { runtime },
  );
}

function readBoundedPlainFile(filePath, maxBytes, identityOptions = {}) {
  const runtimeFs = identityOptions.runtimeFs || fs;
  const first = runtimeFs.lstatSync(filePath, BIGINT_STAT_OPTIONS);
  if (
    !isSingleLinkRegularFile(first) ||
    first.size < 0n ||
    first.size > BigInt(maxBytes)
  ) {
    throw new Error("file is not a bounded single-link regular file");
  }
  const { stat, value } = readStablePlainFileSync(
    filePath,
    first,
    ({ descriptor, handleStat }) => {
      const capacity = Math.min(maxBytes + 1, Number(handleStat.size) + 1);
      const buffer = Buffer.alloc(capacity);
      let total = 0;
      while (total < capacity) {
        const bytesRead = runtimeFs.readSync(
          descriptor,
          buffer,
          total,
          capacity - total,
          null,
        );
        if (bytesRead === 0) break;
        total += bytesRead;
      }
      return { buffer, total };
    },
    identityOptions,
  );
  if (value.total > maxBytes || BigInt(value.total) !== stat.size) {
    throw new Error("file changed during bounded read");
  }
  return value.buffer.subarray(0, value.total);
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

function inspectParentChain(workspaceRoot, targetPath, runtimeFs = fs) {
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
      first = lstatOptional(parentPath, runtimeFs);
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
      canonical = runtimeFs.realpathSync.native(parentPath);
      second = runtimeFs.lstatSync(parentPath, BIGINT_STAT_OPTIONS);
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

function inspectTarget(
  workspaceRoot,
  targetPath,
  normalizedRel,
  identityOptions = {},
) {
  const runtimeFs = identityOptions.runtimeFs || fs;
  const parentStates = inspectParentChain(workspaceRoot, targetPath, runtimeFs);
  let first;
  try {
    first = lstatOptional(targetPath, runtimeFs);
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
  if (!isSingleLinkRegularFile(first)) {
    throw checkpointWorkspaceError(
      "CHECKPOINT_WORKSPACE_SCOPE_INVALID",
      `checkpoint target is not a single-link regular file: ${normalizedRel}`,
    );
  }

  try {
    const { stat, value: content } = readStablePlainFileSync(
      targetPath,
      first,
      ({ descriptor }) => runtimeFs.readFileSync(descriptor),
      identityOptions,
    );
    if (!Buffer.isBuffer(content) || BigInt(content.length) !== stat.size) {
      throw checkpointWorkspaceError(
        "CHECKPOINT_WORKSPACE_UNSTABLE",
        `checkpoint target changed while inspecting: ${normalizedRel}`,
      );
    }
    const identity = statIdentity(stat);
    return {
      parentStates,
      prestate: {
        rel: normalizedRel,
        state: "present",
        sha256: sha256(content),
        identity,
        objectIdentity: createdFileIdentity(stat),
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
  }
}

function compareCanonical(left, right) {
  return (
    JSON.stringify(canonicalValue(left)) ===
    JSON.stringify(canonicalValue(right))
  );
}

function restoreSafetyPlanIdentity(plan) {
  return sha256Identity({
    schema: RESTORE_SAFETY_PLAN_SCHEMA,
    domain: "restore-safety-plan",
    sourceCheckpointId: plan.sourceCheckpointId,
    sourceCheckpointIdentity: plan.sourceCheckpointIdentity,
    workspaceRoot: plan.workspaceRoot,
    threatBoundary: plan.threatBoundary,
    quarantinePolicy: plan.quarantinePolicy,
    namespace: plan.namespace,
    mutations: plan.mutations,
    tombstones: plan.tombstones.map((entry) => ({
      rel: entry.rel,
      targetSha256: entry.targetSha256,
      targetBytes: entry.targetBytes,
    })),
  });
}

function invalidSafetyPlan(manifest, message, details = {}) {
  return checkpointWorkspaceError(
    "CHECKPOINT_SAFETY_PLAN_INVALID",
    `Invalid restore safety plan for ${manifest.id}: ${message}`,
    { checkpointId: manifest.id, ...details },
  );
}

function recoveryRequired(manifest, message, details = {}) {
  return checkpointWorkspaceError(
    "CHECKPOINT_RECOVERY_REQUIRED",
    `Restore safety requires manual recovery for ${manifest.id}: ${message}`,
    { checkpointId: manifest.id, ...details },
  );
}

function restoreSafetyArmPath(root, checkpointId, kind, rel) {
  const relHash = createHash("sha256")
    .update(`${kind}\0${rel}`, "utf8")
    .digest("hex");
  return path.join(
    root,
    checkpointId,
    RESTORE_SAFETY_ARM_DIR,
    `${relHash}.json`,
  );
}

function readRestoreSafetyArm(
  root,
  manifest,
  checkpointIdentity,
  plan,
  expected,
) {
  const armPath = restoreSafetyArmPath(
    root,
    manifest.id,
    expected.kind,
    expected.rel,
  );
  const armDir = path.dirname(armPath);
  const dirStat = lstatOptional(armDir);
  if (!dirStat) return null;
  if (
    dirStat.isSymbolicLink() ||
    !dirStat.isDirectory() ||
    (process.platform !== "win32" && (dirStat.mode & 0o077n) !== 0n)
  ) {
    throw invalidSafetyPlan(manifest, "arm store is not a plain directory");
  }
  let canonicalArmDir;
  try {
    canonicalArmDir = fs.realpathSync.native(armDir);
  } catch (cause) {
    throw invalidSafetyPlan(manifest, "arm store cannot be canonicalized", {
      cause,
    });
  }
  if (!samePath(armDir, canonicalArmDir)) {
    throw invalidSafetyPlan(manifest, "arm store aliases another directory");
  }
  const armStat = lstatOptional(armPath);
  if (!armStat) return null;
  if (
    armStat.isSymbolicLink() ||
    !armStat.isFile() ||
    armStat.nlink !== 1n ||
    (process.platform !== "win32" && (armStat.mode & 0o077n) !== 0n)
  ) {
    throw invalidSafetyPlan(
      manifest,
      `arm is not a plain file: ${expected.kind}:${expected.rel}`,
    );
  }
  let arm;
  try {
    arm = JSON.parse(
      readBoundedPlainFile(armPath, MAX_RESTORE_SAFETY_ARM_BYTES).toString(
        "utf8",
      ),
    );
  } catch (cause) {
    throw invalidSafetyPlan(
      manifest,
      `arm is unreadable: ${expected.kind}:${expected.rel}`,
      { cause },
    );
  }
  const armKeys = [
    "kind",
    "objectIdentity",
    "pathRel",
    "planIdentity",
    "rel",
    "safetyCheckpointId",
    "safetyCheckpointIdentity",
    "schema",
    "targetBytes",
    "targetSha256",
    "version",
  ];
  if (
    !arm ||
    typeof arm !== "object" ||
    Array.isArray(arm) ||
    Object.keys(arm).sort().join("\0") !== armKeys.sort().join("\0") ||
    arm.schema !== RESTORE_SAFETY_ARM_SCHEMA ||
    arm.version !== 1 ||
    arm.safetyCheckpointId !== manifest.id ||
    arm.safetyCheckpointIdentity !== checkpointIdentity ||
    arm.planIdentity !== plan.planIdentity ||
    arm.kind !== expected.kind ||
    arm.rel !== expected.rel ||
    arm.pathRel !== (expected.pathRel ?? null) ||
    arm.targetSha256 !== (expected.targetSha256 ?? null) ||
    arm.targetBytes !== (expected.targetBytes ?? null) ||
    !isFilesystemObjectIdentity(arm.objectIdentity)
  ) {
    throw invalidSafetyPlan(
      manifest,
      `arm binding is invalid: ${expected.kind}:${expected.rel}`,
    );
  }
  return arm;
}

function inspectPlannedRegularFile(
  manifest,
  filePath,
  { rel, targetSha256, targetBytes, expectedIdentity = null },
  identityOptions = {},
) {
  const runtimeFs = identityOptions.runtimeFs || fs;
  let first;
  try {
    first = runtimeFs.lstatSync(filePath, BIGINT_STAT_OPTIONS);
  } catch (cause) {
    throw invalidSafetyPlan(
      manifest,
      `planned file cannot be inspected: ${rel}`,
      {
        path: rel,
        cause,
      },
    );
  }
  if (!isSingleLinkRegularFile(first) || first.size !== BigInt(targetBytes)) {
    throw invalidSafetyPlan(manifest, `planned file is not plain: ${rel}`);
  }
  try {
    const { stat, value } = readStablePlainFileSync(
      filePath,
      first,
      ({ descriptor }) => {
        const hash = createHash("sha256");
        const buffer = Buffer.alloc(64 * 1024);
        let total = 0;
        while (total <= targetBytes) {
          const remaining = targetBytes + 1 - total;
          if (remaining <= 0) break;
          const bytesRead = runtimeFs.readSync(
            descriptor,
            buffer,
            0,
            Math.min(buffer.length, remaining),
            null,
          );
          if (bytesRead === 0) break;
          hash.update(buffer.subarray(0, bytesRead));
          total += bytesRead;
        }
        return { digest: hash.digest("hex"), total };
      },
      identityOptions,
    );
    const objectIdentity = createdFileIdentity(stat);
    if (
      value.total !== targetBytes ||
      value.digest !== targetSha256 ||
      (expectedIdentity != null &&
        !compareCanonical(expectedIdentity, objectIdentity))
    ) {
      throw new Error("planned file identity or content changed during read");
    }
    return objectIdentity;
  } catch (cause) {
    if (cause?.code === "CHECKPOINT_SAFETY_PLAN_INVALID") throw cause;
    throw invalidSafetyPlan(manifest, `planned file is unstable: ${rel}`, {
      path: rel,
      cause,
    });
  }
}

export const _fileCheckpointInternals = Object.freeze({
  inspectPlannedRegularFile,
  inspectTarget,
  readBoundedPlainFile,
  readStablePlainFileSync,
});

function resolveSafetyStorePath(root, checkpointId, rel) {
  const normalized = normalizedRelativePath(rel);
  if (normalized.normalized !== rel) {
    throw new Error(`non-canonical safety-store path: ${rel}`);
  }
  const checkpointDir = path.resolve(root, checkpointId);
  const resolved = path.resolve(checkpointDir, ...normalized.segments);
  if (
    samePath(checkpointDir, resolved) ||
    !pathComparisonKey(resolved).startsWith(
      `${pathComparisonKey(checkpointDir)}${path.sep}`,
    )
  ) {
    throw new Error(`safety-store path escapes checkpoint: ${rel}`);
  }
  return resolved;
}

function expectedMutationPath(plan, rel, suffix) {
  const relHash = createHash("sha256").update(rel, "utf8").digest("hex");
  return `${plan.namespace.rel}/${relHash}.${suffix}`;
}

function validatePlannedFileState(
  root,
  manifest,
  checkpointIdentity,
  plan,
  expected,
) {
  const filePath = resolveSafetyStorePath(root, manifest.id, expected.pathRel);
  const arm = readRestoreSafetyArm(
    root,
    manifest,
    checkpointIdentity,
    plan,
    expected,
  );
  const stat = lstatOptional(filePath);
  if (!stat) {
    if (
      arm &&
      expected.reservationIdentity &&
      !sameReservedFileIdentity(
        expected.reservationIdentity,
        arm.objectIdentity,
      )
    ) {
      throw invalidSafetyPlan(
        manifest,
        `arm escaped its immutable reservation: ${expected.kind}:${expected.rel}`,
      );
    }
    return {
      path: filePath,
      state: arm
        ? "consumed"
        : expected.reservationIdentity
          ? "reservation-missing"
          : "planned",
      arm,
    };
  }
  if (!arm) {
    if (expected.reservationIdentity) {
      if (!stat.isFile() || stat.size !== 0n) {
        return { path: filePath, state: "unarmed-present", arm: null };
      }
      const objectIdentity = inspectPlannedRegularFile(manifest, filePath, {
        rel: expected.pathRel,
        targetSha256: EMPTY_SHA256,
        targetBytes: 0,
      });
      if (
        !sameReservedFileIdentity(expected.reservationIdentity, objectIdentity)
      ) {
        throw invalidSafetyPlan(
          manifest,
          `stage reservation identity changed: ${expected.kind}:${expected.rel}`,
        );
      }
      return { path: filePath, state: "reserved", arm: null, objectIdentity };
    }
    return { path: filePath, state: "unarmed-present", arm: null };
  }
  if (
    expected.reservationIdentity &&
    !sameReservedFileIdentity(expected.reservationIdentity, arm.objectIdentity)
  ) {
    throw invalidSafetyPlan(
      manifest,
      `armed stage escaped its immutable reservation: ${expected.kind}:${expected.rel}`,
    );
  }
  const objectIdentity = inspectPlannedRegularFile(manifest, filePath, {
    rel: expected.pathRel,
    targetSha256: expected.targetSha256,
    targetBytes: expected.targetBytes,
    expectedIdentity: arm.objectIdentity,
  });
  return { path: filePath, state: "armed-present", arm, objectIdentity };
}

/**
 * A moved workspace predecessor is deliberately non-authoritative trash. Its
 * DACL and bytes may remain workspace-controlled after a same-volume rename,
 * so recovery must never read it or require it to remain private/intact. The
 * private arm authorizes the delete; private checkpoint blobs/tombstones are
 * the only recovery inputs.
 */
function validateUntrustedTrashState(
  root,
  manifest,
  checkpointIdentity,
  plan,
  expected,
) {
  const trashPath = resolveSafetyStorePath(root, manifest.id, expected.pathRel);
  const arm = readRestoreSafetyArm(
    root,
    manifest,
    checkpointIdentity,
    plan,
    expected,
  );
  const present = Boolean(lstatOptional(trashPath));
  return {
    path: trashPath,
    state: arm
      ? present
        ? "untrusted-trash-present"
        : "armed-trash-absent"
      : present
        ? "unarmed-trash-present"
        : "planned",
    arm,
  };
}

function validateRestoreSafetyPlan(
  manifest,
  workspaceRoot,
  root,
  checkpointIdentity,
) {
  const plan = manifest.restoreSafetyPlan;
  if (plan == null) return null;
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw invalidSafetyPlan(manifest, "plan must be an object");
  }
  const manifestPath = path.join(root, `${manifest.id}.json`);
  let manifestStat;
  let canonicalManifestPath;
  try {
    manifestStat = fs.lstatSync(manifestPath, { bigint: true });
    canonicalManifestPath = fs.realpathSync.native(manifestPath);
  } catch (cause) {
    throw invalidSafetyPlan(manifest, "manifest cannot be inspected", {
      cause,
    });
  }
  if (
    manifestStat.isSymbolicLink() ||
    !manifestStat.isFile() ||
    manifestStat.nlink !== 1n ||
    !samePath(manifestPath, canonicalManifestPath) ||
    (process.platform !== "win32" && (manifestStat.mode & 0o077n) !== 0n)
  ) {
    throw invalidSafetyPlan(
      manifest,
      "manifest is not an owner-private plain file",
    );
  }
  const planKeys = [
    "mutations",
    "namespace",
    "planIdentity",
    "quarantinePolicy",
    "schema",
    "sourceCheckpointId",
    "sourceCheckpointIdentity",
    "threatBoundary",
    "tombstones",
    "version",
    "workspaceRoot",
  ];
  if (
    plan.schema !== RESTORE_SAFETY_PLAN_SCHEMA ||
    plan.version !== 2 ||
    Object.keys(plan).sort().join("\0") !== planKeys.sort().join("\0") ||
    !isSafeCheckpointId(plan.sourceCheckpointId) ||
    !SHA256_IDENTITY_RE.test(plan.sourceCheckpointIdentity) ||
    !SHA256_IDENTITY_RE.test(plan.planIdentity) ||
    plan.threatBoundary !== RESTORE_SAFETY_THREAT_BOUNDARY ||
    plan.quarantinePolicy !== RESTORE_SAFETY_QUARANTINE_POLICY ||
    !plan.namespace ||
    typeof plan.namespace !== "object" ||
    Array.isArray(plan.namespace) ||
    !Array.isArray(plan.mutations) ||
    plan.mutations.length === 0 ||
    plan.mutations.length > DEFAULT_MAX_FILES ||
    !Array.isArray(plan.tombstones) ||
    plan.tombstones.length > DEFAULT_MAX_FILES ||
    typeof plan.workspaceRoot !== "string" ||
    !path.isAbsolute(plan.workspaceRoot) ||
    !samePath(plan.workspaceRoot, workspaceRoot)
  ) {
    throw invalidSafetyPlan(manifest, "plan metadata is invalid");
  }

  const namespaceKeys = ["objectIdentity", "rel", "token", "volumeIdentity"];
  if (
    Object.keys(plan.namespace).sort().join("\0") !==
      namespaceKeys.sort().join("\0") ||
    typeof plan.namespace.token !== "string" ||
    !/^[a-f0-9-]{36}$/.test(plan.namespace.token) ||
    typeof plan.namespace.volumeIdentity !== "string" ||
    !/^[0-9]+$/.test(plan.namespace.volumeIdentity) ||
    !isFilesystemObjectIdentity(plan.namespace.objectIdentity) ||
    plan.namespace.rel !==
      `${RESTORE_SAFETY_NAMESPACE_DIR}/${plan.namespace.token}`
  ) {
    throw invalidSafetyPlan(manifest, "namespace metadata is invalid");
  }
  let namespacePath;
  try {
    namespacePath = resolveSafetyStorePath(
      root,
      manifest.id,
      plan.namespace.rel,
    );
  } catch (cause) {
    throw invalidSafetyPlan(manifest, "namespace path is invalid", { cause });
  }
  const namespaceArm = readRestoreSafetyArm(
    root,
    manifest,
    checkpointIdentity,
    plan,
    {
      kind: "namespace",
      rel: plan.namespace.rel,
      pathRel: plan.namespace.rel,
      targetSha256: null,
      targetBytes: null,
    },
  );
  const namespaceStat = lstatOptional(namespacePath);
  let namespaceState = "planned";
  if (namespaceStat && !namespaceArm) {
    namespaceState = "unarmed-present";
  } else if (!namespaceStat && namespaceArm) {
    throw invalidSafetyPlan(manifest, "armed namespace disappeared");
  } else if (namespaceStat && namespaceArm) {
    let canonicalNamespace;
    try {
      canonicalNamespace = fs.realpathSync.native(namespacePath);
    } catch (cause) {
      throw invalidSafetyPlan(manifest, "namespace cannot be canonicalized", {
        cause,
      });
    }
    const actualIdentity = createdFileIdentity(namespaceStat);
    if (
      namespaceStat.isSymbolicLink() ||
      !namespaceStat.isDirectory() ||
      !samePath(namespacePath, canonicalNamespace) ||
      (process.platform !== "win32" && (namespaceStat.mode & 0o077n) !== 0n) ||
      String(namespaceStat.dev) !== plan.namespace.volumeIdentity ||
      !sameDirectoryObjectIdentity(
        plan.namespace.objectIdentity,
        actualIdentity,
      ) ||
      !sameDirectoryObjectIdentity(
        plan.namespace.objectIdentity,
        namespaceArm.objectIdentity,
      )
    ) {
      throw invalidSafetyPlan(manifest, "namespace identity changed");
    }
    namespaceState = "armed";
  }

  const tombstones = [];
  const seen = new Set();
  for (const entry of plan.tombstones) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw invalidSafetyPlan(manifest, "tombstone must be an object");
    }
    const entryKeys = ["rel", "targetBytes", "targetSha256"];
    if (Object.keys(entry).sort().join("\0") !== entryKeys.sort().join("\0")) {
      throw invalidSafetyPlan(manifest, "tombstone fields are invalid");
    }
    const rel = normalizedRelativePath(entry.rel);
    if (
      rel.normalized !== entry.rel ||
      !SHA256_RE.test(entry.targetSha256) ||
      !Number.isSafeInteger(entry.targetBytes) ||
      entry.targetBytes < 0
    ) {
      throw invalidSafetyPlan(manifest, `invalid tombstone: ${entry.rel}`);
    }
    const targetPath = path.resolve(workspaceRoot, ...rel.segments);
    assertStrictlyContained(workspaceRoot, targetPath, entry.rel);
    const key = pathComparisonKey(targetPath);
    if (seen.has(key)) {
      throw invalidSafetyPlan(manifest, `duplicate tombstone: ${entry.rel}`);
    }
    seen.add(key);
    const arm = readRestoreSafetyArm(root, manifest, checkpointIdentity, plan, {
      kind: "tombstone",
      rel: entry.rel,
      pathRel: null,
      targetSha256: entry.targetSha256,
      targetBytes: entry.targetBytes,
    });
    if (arm && !isCreatedFileIdentity(arm.objectIdentity, entry.targetBytes)) {
      throw invalidSafetyPlan(
        manifest,
        `tombstone object identity is invalid: ${entry.rel}`,
      );
    }
    tombstones.push({
      ...entry,
      state: arm ? "armed" : "planned",
      createdIdentity: arm?.objectIdentity || null,
      arm,
      targetPath,
    });
  }
  tombstones.sort((left, right) =>
    left.rel < right.rel ? -1 : left.rel > right.rel ? 1 : 0,
  );
  if (
    !compareCanonical(
      tombstones.map((entry) => ({
        rel: entry.rel,
        targetSha256: entry.targetSha256,
        targetBytes: entry.targetBytes,
      })),
      plan.tombstones,
    )
  ) {
    throw invalidSafetyPlan(manifest, "tombstones are not canonically ordered");
  }

  const mutations = [];
  const mutationSeen = new Set();
  for (const entry of plan.mutations) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw invalidSafetyPlan(manifest, "mutation must be an object");
    }
    const mutationKeys = [
      "forwardDeleteIdentity",
      "forwardOperation",
      "forwardStageIdentity",
      "forwardStagingRel",
      "forwardTargetBytes",
      "forwardTargetSha256",
      "quarantineRel",
      "recoveryOperation",
      "recoveryStageIdentity",
      "recoveryStagingRel",
      "recoveryTargetBytes",
      "recoveryTargetSha256",
      "rel",
    ];
    if (
      Object.keys(entry).sort().join("\0") !== mutationKeys.sort().join("\0")
    ) {
      throw invalidSafetyPlan(manifest, "mutation fields are invalid");
    }
    const rel = normalizedRelativePath(entry.rel);
    if (rel.normalized !== entry.rel || mutationSeen.has(entry.rel)) {
      throw invalidSafetyPlan(manifest, `invalid mutation: ${entry.rel}`);
    }
    mutationSeen.add(entry.rel);
    for (const direction of ["forward", "recovery"]) {
      const operation = entry[`${direction}Operation`];
      const targetSha256 = entry[`${direction}TargetSha256`];
      const targetBytes = entry[`${direction}TargetBytes`];
      const stagingRel = entry[`${direction}StagingRel`];
      const stageIdentity = entry[`${direction}StageIdentity`];
      if (!["write", "delete"].includes(operation)) {
        throw invalidSafetyPlan(
          manifest,
          `invalid ${direction} operation: ${entry.rel}`,
        );
      }
      if (operation === "write") {
        if (
          !SHA256_RE.test(targetSha256) ||
          !Number.isSafeInteger(targetBytes) ||
          targetBytes < 0 ||
          !isCreatedFileIdentity(stageIdentity, 0) ||
          stagingRel !==
            expectedMutationPath(plan, entry.rel, `${direction}.stage`)
        ) {
          throw invalidSafetyPlan(
            manifest,
            `invalid ${direction} write plan: ${entry.rel}`,
          );
        }
      } else if (
        targetSha256 !== null ||
        targetBytes !== null ||
        stagingRel !== null ||
        stageIdentity !== null
      ) {
        throw invalidSafetyPlan(
          manifest,
          `invalid ${direction} delete plan: ${entry.rel}`,
        );
      }
    }
    const hasDelete =
      entry.forwardOperation === "delete" ||
      entry.recoveryOperation === "delete";
    if (
      entry.quarantineRel !==
      (hasDelete ? expectedMutationPath(plan, entry.rel, "quarantine") : null)
    ) {
      throw invalidSafetyPlan(
        manifest,
        `invalid quarantine path: ${entry.rel}`,
      );
    }
    if (
      (entry.forwardOperation === "delete" &&
        !isCreatedFileIdentity(
          entry.forwardDeleteIdentity,
          entry.recoveryTargetBytes,
        )) ||
      (entry.forwardOperation !== "delete" &&
        entry.forwardDeleteIdentity !== null)
    ) {
      throw invalidSafetyPlan(
        manifest,
        `invalid forward delete identity: ${entry.rel}`,
      );
    }

    const stages = {};
    for (const direction of ["forward", "recovery"]) {
      if (entry[`${direction}Operation`] !== "write") continue;
      stages[direction] = validatePlannedFileState(
        root,
        manifest,
        checkpointIdentity,
        plan,
        {
          kind: `stage-${direction}`,
          rel: entry.rel,
          pathRel: entry[`${direction}StagingRel`],
          targetSha256: entry[`${direction}TargetSha256`],
          targetBytes: entry[`${direction}TargetBytes`],
          reservationIdentity: entry[`${direction}StageIdentity`],
        },
      );
    }
    let quarantine = null;
    if (entry.quarantineRel) {
      const expectedSha256 =
        entry.forwardOperation === "delete"
          ? entry.recoveryTargetSha256
          : entry.forwardTargetSha256;
      const expectedBytes =
        entry.forwardOperation === "delete"
          ? entry.recoveryTargetBytes
          : entry.forwardTargetBytes;
      quarantine = validateUntrustedTrashState(
        root,
        manifest,
        checkpointIdentity,
        plan,
        {
          kind: "quarantine",
          rel: entry.rel,
          pathRel: entry.quarantineRel,
          targetSha256: expectedSha256,
          targetBytes: expectedBytes,
        },
      );
    }
    mutations.push({ ...entry, stages, quarantine });
  }
  mutations.sort((left, right) =>
    left.rel < right.rel ? -1 : left.rel > right.rel ? 1 : 0,
  );
  if (
    !compareCanonical(
      mutations.map((entry) => ({
        rel: entry.rel,
        forwardOperation: entry.forwardOperation,
        forwardStageIdentity: entry.forwardStageIdentity,
        forwardTargetSha256: entry.forwardTargetSha256,
        forwardTargetBytes: entry.forwardTargetBytes,
        forwardStagingRel: entry.forwardStagingRel,
        forwardDeleteIdentity: entry.forwardDeleteIdentity,
        recoveryOperation: entry.recoveryOperation,
        recoveryStageIdentity: entry.recoveryStageIdentity,
        recoveryTargetSha256: entry.recoveryTargetSha256,
        recoveryTargetBytes: entry.recoveryTargetBytes,
        recoveryStagingRel: entry.recoveryStagingRel,
        quarantineRel: entry.quarantineRel,
      })),
      plan.mutations,
    )
  ) {
    throw invalidSafetyPlan(manifest, "mutations are not canonically ordered");
  }
  const mutationByRel = new Map(mutations.map((entry) => [entry.rel, entry]));
  for (const file of manifest.files) {
    const rel = normalizedRelativePath(file.rel).normalized;
    const mutation = mutationByRel.get(rel);
    if (
      !mutation ||
      mutation.recoveryOperation !== "write" ||
      mutation.recoveryTargetSha256 !== file.sha256 ||
      mutation.recoveryTargetBytes !== file.bytes
    ) {
      throw invalidSafetyPlan(
        manifest,
        `recovery write is not fully planned: ${file.rel}`,
      );
    }
  }
  for (const tombstone of tombstones) {
    const mutation = mutationByRel.get(tombstone.rel);
    if (mutation?.recoveryOperation !== "delete") {
      throw invalidSafetyPlan(
        manifest,
        `recovery delete is not fully planned: ${tombstone.rel}`,
      );
    }
    if (
      tombstone.state === "armed" &&
      !sameReservedFileIdentity(
        mutation.forwardStageIdentity,
        tombstone.createdIdentity,
      )
    ) {
      throw invalidSafetyPlan(
        manifest,
        `tombstone escaped its immutable stage reservation: ${tombstone.rel}`,
      );
    }
  }
  for (const mutation of mutations) {
    if (!mutation.quarantine?.arm) continue;
    const expectedIdentity =
      mutation.forwardOperation === "delete"
        ? mutation.forwardDeleteIdentity
        : tombstones.find((entry) => entry.rel === mutation.rel)
            ?.createdIdentity;
    if (
      !expectedIdentity ||
      !compareCanonical(
        expectedIdentity,
        mutation.quarantine.arm.objectIdentity,
      )
    ) {
      throw invalidSafetyPlan(
        manifest,
        `quarantine escaped its immutable delete authority: ${mutation.rel}`,
      );
    }
  }
  if (restoreSafetyPlanIdentity(plan) !== plan.planIdentity) {
    throw invalidSafetyPlan(manifest, "plan identity does not match its scope");
  }
  return {
    plan,
    namespace: {
      ...plan.namespace,
      path: namespacePath,
      state: namespaceState,
      arm: namespaceArm,
    },
    mutations,
    tombstones,
  };
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
  const restoreSafety = validateRestoreSafetyPlan(
    manifest,
    workspaceRoot,
    opts.root,
    checkpointIdentity,
  );
  if (
    !Array.isArray(manifest.files) ||
    manifest.files.length > DEFAULT_MAX_FILES ||
    !Number.isSafeInteger(manifest.fileCount) ||
    manifest.fileCount !== manifest.files.length ||
    manifest.files.length + (restoreSafety?.tombstones.length || 0) >
      DEFAULT_MAX_FILES
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

  const tombstones = [];
  for (const tombstone of restoreSafety?.tombstones || []) {
    const targetKey = pathComparisonKey(tombstone.targetPath);
    if (seenTargets.has(targetKey)) {
      throw invalidSafetyPlan(
        manifest,
        `tombstone aliases a snapshot target: ${tombstone.rel}`,
      );
    }
    seenTargets.add(targetKey);
    const inspected = inspectTarget(
      workspaceRoot,
      tombstone.targetPath,
      tombstone.rel,
    );
    if (
      tombstone.state === "planned" &&
      inspected.prestate.state !== "absent"
    ) {
      throw checkpointWorkspaceError(
        "CHECKPOINT_TOMBSTONE_UNARMED",
        `Refusing to delete an unarmed restore target: ${tombstone.rel}`,
        { checkpointId: manifest.id, path: tombstone.rel },
      );
    }
    if (
      tombstone.state === "armed" &&
      inspected.prestate.state === "present" &&
      (!compareCanonical(
        tombstone.createdIdentity,
        inspected.prestate.objectIdentity,
      ) ||
        tombstone.targetSha256 !== inspected.prestate.sha256 ||
        tombstone.targetBytes !== inspected.content.length)
    ) {
      throw checkpointWorkspaceError(
        "CHECKPOINT_TOMBSTONE_IDENTITY_MISMATCH",
        `Refusing to delete a successor at restore target: ${tombstone.rel}`,
        {
          checkpointId: manifest.id,
          path: tombstone.rel,
          expectedCreatedIdentity: tombstone.createdIdentity,
          actualCreatedIdentity: inspected.prestate.objectIdentity,
        },
      );
    }
    tombstones.push({
      ...tombstone,
      safetyMutation: restoreSafety?.mutations.find(
        (entry) => entry.rel === tombstone.rel,
      ),
      displayRel: tombstone.rel,
      ...inspected,
    });
  }

  entries.sort((left, right) =>
    left.rel < right.rel ? -1 : left.rel > right.rel ? 1 : 0,
  );
  const parentStateByRel = new Map();
  for (const entry of [...entries, ...tombstones]) {
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
  const targets = [
    ...entries.map((entry) => ({ rel: entry.rel, operation: "write" })),
    ...tombstones.map((entry) => ({ rel: entry.rel, operation: "delete" })),
  ].sort((left, right) =>
    left.rel < right.rel ? -1 : left.rel > right.rel ? 1 : 0,
  );
  const poststate = [
    ...entries.map((entry) => ({
      rel: entry.rel,
      state: "present",
      sha256: entry.targetSha256,
      bytes: entry.targetBytes,
    })),
    ...tombstones.map((entry) => ({ rel: entry.rel, state: "absent" })),
  ].sort((left, right) =>
    left.rel < right.rel ? -1 : left.rel > right.rel ? 1 : 0,
  );
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
    targets: [...entries, ...tombstones]
      .map((entry) => entry.prestate)
      .sort((left, right) =>
        left.rel < right.rel ? -1 : left.rel > right.rel ? 1 : 0,
      ),
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
    tombstones,
    restoreSafetyPlan: restoreSafety?.plan || null,
    restoreSafety,
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
    if (!fs.existsSync(blobPath)) {
      atomicWriteFileSync(blobPath, buf, {
        durable: opts.durable === true,
        ...(opts.mode != null ? { mode: opts.mode } : {}),
      });
    }
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
    {
      durable: opts.durable === true,
      ...(opts.mode != null ? { mode: opts.mode } : {}),
    },
  );
  return manifest;
}

/** Load a checkpoint manifest by id, or null. */
export function getCheckpoint(id, opts = {}) {
  if (!isSafeCheckpointId(id)) return null;
  const root = opts.root || defaultRoot();
  const file = path.join(root, `${id}.json`);
  try {
    return JSON.parse(
      readBoundedPlainFile(file, MAX_CHECKPOINT_MANIFEST_BYTES).toString(
        "utf8",
      ),
    );
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
 * @returns {{ id, checkpointIdentity:string, modified:[], unchanged:[], deleted:[] }}
 *   modified = content differs; deleted = file is gone now.
 */
export function diffCheckpoint(id, opts = {}) {
  const root = opts.root || defaultRoot();
  const m = getCheckpoint(id, { root });
  if (!m) throw new Error(`no such checkpoint: ${id}`);
  const checkpointIdentity = assertCheckpointIdentity(m, opts.expectedIdentity);
  if (
    opts.expectedSafetyPlanIdentity != null &&
    m.restoreSafetyPlan?.planIdentity !== opts.expectedSafetyPlanIdentity
  ) {
    throw checkpointWorkspaceError(
      "CHECKPOINT_SAFETY_PLAN_STALE",
      `Restore safety plan identity changed: ${id}`,
      {
        checkpointId: id,
        expectedSafetyPlanIdentity: opts.expectedSafetyPlanIdentity,
        actualSafetyPlanIdentity: m.restoreSafetyPlan?.planIdentity || null,
      },
    );
  }
  if (opts.cwd != null || m.restoreSafetyPlan != null) {
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
    for (const tombstone of computed.tombstones) {
      if (tombstone.prestate.state === "present") {
        modified.push(tombstone.displayRel);
      } else {
        unchanged.push(tombstone.displayRel);
      }
    }
    return {
      id,
      checkpointIdentity,
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
  return { id, checkpointIdentity, modified, unchanged, deleted };
}

function createRestoreSafetyCheckpoint({
  root,
  workspaceRoot,
  sourceCheckpointId,
  sourceCheckpointIdentity,
  existingPaths,
  tombstones,
  mutations,
}) {
  if (existingPaths.length === 0 && tombstones.length === 0) return null;

  ensurePrivateAuthorityDirectories([root]);
  const checkpointRoot = fs.realpathSync.native(root);
  const canonicalWorkspaceRoot = fs.realpathSync.native(workspaceRoot);
  if (pathsOverlap(checkpointRoot, canonicalWorkspaceRoot)) {
    throw checkpointWorkspaceError(
      "CHECKPOINT_SAFETY_STORE_OVERLAP",
      "Copy restore safety store must not overlap the workspace",
      { checkpointRoot, workspaceRoot: canonicalWorkspaceRoot },
    );
  }
  const checkpointRootStat = fs.lstatSync(checkpointRoot, { bigint: true });
  const workspaceStat = fs.lstatSync(canonicalWorkspaceRoot, { bigint: true });
  if (checkpointRootStat.dev !== workspaceStat.dev) {
    throw checkpointWorkspaceError(
      "CHECKPOINT_SAFETY_VOLUME_UNSUPPORTED",
      "Copy restore safety staging must be on the workspace filesystem",
      {
        checkpointVolume: String(checkpointRootStat.dev),
        workspaceVolume: String(workspaceStat.dev),
      },
    );
  }
  for (const mutation of mutations) {
    const parentStat = fs.lstatSync(path.dirname(mutation.targetPath), {
      bigint: true,
    });
    if (parentStat.dev !== checkpointRootStat.dev) {
      throw checkpointWorkspaceError(
        "CHECKPOINT_SAFETY_VOLUME_UNSUPPORTED",
        `Restore target is not on the safety staging filesystem: ${mutation.rel}`,
        { path: mutation.rel },
      );
    }
  }

  let manifest;
  if (existingPaths.length > 0) {
    manifest = createCheckpoint(existingPaths, {
      root,
      cwd: workspaceRoot,
      label: `auto-before-restore-${sourceCheckpointId}`,
      durable: true,
      mode: 0o600,
    });
  } else {
    const safetyId = newId();
    ensureDir(path.join(root, safetyId));
    manifest = {
      id: safetyId,
      label: `auto-before-restore-${sourceCheckpointId}`,
      createdAt: new Date().toISOString(),
      cwd: workspaceRoot,
      fileCount: 0,
      files: [],
    };
    ensureDir(root);
    atomicWriteFileSync(
      path.join(root, `${safetyId}.json`),
      JSON.stringify(manifest, null, 2),
      { durable: true, mode: 0o600 },
    );
  }

  const checkpointDir = fs.realpathSync.native(path.join(root, manifest.id));
  const checkpointDirStat = fs.lstatSync(checkpointDir, { bigint: true });
  if (checkpointDirStat.dev !== workspaceStat.dev) {
    throw checkpointWorkspaceError(
      "CHECKPOINT_SAFETY_VOLUME_UNSUPPORTED",
      "Copy restore safety staging must be on the workspace filesystem",
      {
        checkpointVolume: String(checkpointDirStat.dev),
        workspaceVolume: String(workspaceStat.dev),
      },
    );
  }
  const manifestPath = path.join(root, `${manifest.id}.json`);
  const safetyBlobPaths = [
    ...new Set(
      manifest.files.map((file) => path.join(root, manifest.id, file.sha256)),
    ),
  ];
  createPrivateAuthorityDirectories([checkpointDir]);

  const plannedTombstones = tombstones
    .map((entry) => ({
      rel: entry.rel,
      targetSha256: entry.targetSha256,
      targetBytes: entry.targetBytes,
    }))
    .sort((left, right) =>
      left.rel < right.rel ? -1 : left.rel > right.rel ? 1 : 0,
    );
  const namespaceToken = randomUUID();
  const restoreSafetyPlan = {
    schema: RESTORE_SAFETY_PLAN_SCHEMA,
    version: 2,
    sourceCheckpointId,
    sourceCheckpointIdentity,
    workspaceRoot: canonicalWorkspaceRoot,
    threatBoundary: RESTORE_SAFETY_THREAT_BOUNDARY,
    quarantinePolicy: RESTORE_SAFETY_QUARANTINE_POLICY,
    namespace: {
      rel: `${RESTORE_SAFETY_NAMESPACE_DIR}/${namespaceToken}`,
      token: namespaceToken,
      volumeIdentity: String(checkpointDirStat.dev),
      objectIdentity: null,
    },
    planIdentity: "",
    mutations: [],
    tombstones: plannedTombstones,
  };
  const safetyFiles = new Map(
    manifest.files.map((file) => [
      normalizedRelativePath(file.rel).normalized,
      file,
    ]),
  );
  restoreSafetyPlan.mutations = mutations
    .map((entry) => {
      const recoveryFile = safetyFiles.get(entry.rel);
      const recoveryOperation = recoveryFile ? "write" : "delete";
      const forwardOperation = entry.operation;
      return {
        rel: entry.rel,
        forwardOperation,
        forwardTargetSha256:
          forwardOperation === "write" ? entry.targetSha256 : null,
        forwardTargetBytes:
          forwardOperation === "write" ? entry.targetBytes : null,
        forwardStagingRel:
          forwardOperation === "write"
            ? expectedMutationPath(
                restoreSafetyPlan,
                entry.rel,
                "forward.stage",
              )
            : null,
        forwardStageIdentity: null,
        forwardDeleteIdentity:
          forwardOperation === "delete" ? entry.prestate.objectIdentity : null,
        recoveryOperation,
        recoveryTargetSha256: recoveryFile?.sha256 || null,
        recoveryTargetBytes: recoveryFile?.bytes ?? null,
        recoveryStagingRel:
          recoveryOperation === "write"
            ? expectedMutationPath(
                restoreSafetyPlan,
                entry.rel,
                "recovery.stage",
              )
            : null,
        recoveryStageIdentity: null,
        quarantineRel:
          forwardOperation === "delete" || recoveryOperation === "delete"
            ? expectedMutationPath(restoreSafetyPlan, entry.rel, "quarantine")
            : null,
      };
    })
    .sort((left, right) =>
      left.rel < right.rel ? -1 : left.rel > right.rel ? 1 : 0,
    );

  const armDir = path.join(root, manifest.id, RESTORE_SAFETY_ARM_DIR);
  const namespaceParent = path.join(
    root,
    manifest.id,
    RESTORE_SAFETY_NAMESPACE_DIR,
  );
  const namespacePath = resolveSafetyStorePath(
    root,
    manifest.id,
    restoreSafetyPlan.namespace.rel,
  );
  const pendingPrivateDirectories = createPrivateAuthorityDirectories([
    armDir,
    namespaceParent,
    namespacePath,
  ]);
  syncDirectoryEntry(armDir);
  syncDirectoryEntry(namespaceParent);
  syncDirectoryEntry(namespacePath);
  restoreSafetyPlan.namespace.objectIdentity = createdFileIdentity(
    fs.lstatSync(namespacePath, { bigint: true }),
  );

  const stageReservations = [];
  for (const mutation of restoreSafetyPlan.mutations) {
    for (const direction of ["forward", "recovery"]) {
      if (mutation[`${direction}Operation`] !== "write") continue;
      const stageRel = mutation[`${direction}StagingRel`];
      const stagePath = resolveSafetyStorePath(root, manifest.id, stageRel);
      let descriptor;
      try {
        descriptor = fs.openSync(stagePath, "wx", 0o600);
        fs.fsyncSync(descriptor);
      } finally {
        if (descriptor != null) fs.closeSync(descriptor);
      }
      stageReservations.push({ direction, mutation, stagePath, stageRel });
    }
  }
  const stageReservationPaths = stageReservations.map(
    (reservation) => reservation.stagePath,
  );
  if (stageReservationPaths.length > 0) syncDirectoryEntry(namespacePath);
  for (const reservation of stageReservations) {
    reservation.mutation[`${reservation.direction}StageIdentity`] =
      inspectPlannedRegularFile(manifest, reservation.stagePath, {
        rel: reservation.stageRel,
        targetSha256: EMPTY_SHA256,
        targetBytes: 0,
      });
  }

  restoreSafetyPlan.planIdentity = restoreSafetyPlanIdentity(restoreSafetyPlan);
  manifest = { ...manifest, restoreSafetyPlan };
  atomicWriteFileSync(manifestPath, JSON.stringify(manifest, null, 2), {
    durable: true,
    mode: 0o600,
  });
  const safety = {
    id: manifest.id,
    identity: computeCheckpointIdentity(manifest),
    manifest,
  };
  writeRestoreSafetyArm(safety, root, {
    kind: "namespace",
    rel: restoreSafetyPlan.namespace.rel,
    pathRel: restoreSafetyPlan.namespace.rel,
    targetSha256: null,
    targetBytes: null,
    objectIdentity: restoreSafetyPlan.namespace.objectIdentity,
  });

  // The root was repaired before any safety object was created. Everything
  // below it is now immutable and complete enough to repair in one bounded
  // operation, including the namespace arm. repairPrivatePaths verifies the
  // resulting POSIX modes / Windows DACLs and fails closed if it cannot.
  ensurePrivateAuthorityFiles([
    root,
    checkpointDir,
    manifestPath,
    ...safetyBlobPaths,
    ...pendingPrivateDirectories,
    ...stageReservationPaths,
    restoreSafetyArmPath(
      root,
      manifest.id,
      "namespace",
      restoreSafetyPlan.namespace.rel,
    ),
  ]);

  return safety;
}

function writeRestoreSafetyArm(safety, root, armFields) {
  if (!safety?.manifest?.restoreSafetyPlan) {
    throw checkpointWorkspaceError(
      "CHECKPOINT_SAFETY_PLAN_INVALID",
      `Restore safety plan is unavailable before arming ${armFields.rel}`,
      { checkpointId: safety?.id || null, path: armFields.rel },
    );
  }
  const current = getCheckpoint(safety.id, { root });
  if (!current) {
    throw checkpointWorkspaceError(
      "CHECKPOINT_SAFETY_PLAN_INVALID",
      `Restore safety checkpoint disappeared before arming ${armFields.rel}`,
      { checkpointId: safety.id, path: armFields.rel },
    );
  }
  assertCheckpointIdentity(current, safety.identity);
  if (
    restoreSafetyPlanIdentity(current.restoreSafetyPlan) !==
    current.restoreSafetyPlan.planIdentity
  ) {
    throw invalidSafetyPlan(
      current,
      `plan identity changed before arming ${armFields.rel}`,
    );
  }
  const arm = {
    schema: RESTORE_SAFETY_ARM_SCHEMA,
    version: 1,
    kind: armFields.kind,
    safetyCheckpointId: safety.id,
    safetyCheckpointIdentity: safety.identity,
    planIdentity: current.restoreSafetyPlan.planIdentity,
    rel: armFields.rel,
    pathRel: armFields.pathRel ?? null,
    targetSha256: armFields.targetSha256 ?? null,
    targetBytes: armFields.targetBytes ?? null,
    objectIdentity: armFields.objectIdentity,
  };
  if (!isFilesystemObjectIdentity(arm.objectIdentity)) {
    throw invalidSafetyPlan(current, `cannot arm ${arm.kind}:${arm.rel}`);
  }
  const armPath = restoreSafetyArmPath(root, safety.id, arm.kind, arm.rel);
  const armDir = path.dirname(armPath);
  const armDirStat = lstatOptional(armDir);
  if (!armDirStat) {
    throw invalidSafetyPlan(current, "arm store disappeared before arming");
  }
  if (
    armDirStat.isSymbolicLink() ||
    !armDirStat.isDirectory() ||
    (process.platform !== "win32" && (armDirStat.mode & 0o077n) !== 0n) ||
    !samePath(armDir, fs.realpathSync.native(armDir))
  ) {
    throw invalidSafetyPlan(current, "arm store is not a plain directory");
  }
  const existingArm = lstatOptional(armPath);
  if (existingArm) {
    const validated = readRestoreSafetyArm(
      root,
      current,
      safety.identity,
      current.restoreSafetyPlan,
      arm,
    );
    if (!compareCanonical(validated, arm)) {
      throw invalidSafetyPlan(
        current,
        `arm is not immutable: ${arm.kind}:${arm.rel}`,
      );
    }
    return;
  }
  atomicWriteFileSync(armPath, JSON.stringify(arm, null, 2), {
    durable: true,
    mode: 0o600,
    beforeRename: ({ stagingIdentity, tmp }) => {
      // A private parent DACL does not guarantee that a file created by an
      // elevated Windows token is owned by the token user: hosted runners can
      // assign BUILTIN\Administrators as the default owner. Repair and verify
      // the unique temp while it is still non-authoritative, then make sure
      // the repair did not replace the reserved filesystem object. Publishing
      // first and repairing armPath afterwards would leave a hard-kill window
      // containing a non-private recovery authority.
      ensurePrivateAuthorityFiles([tmp]);
      const privateStagingIdentity = createdFileIdentity(
        fs.lstatSync(tmp, { bigint: true }),
      );
      if (!compareCanonical(stagingIdentity, privateStagingIdentity)) {
        throw invalidSafetyPlan(
          current,
          `arm staging identity changed while securing ${arm.kind}:${arm.rel}`,
        );
      }
      const latest = getCheckpoint(safety.id, { root });
      if (!latest) {
        throw checkpointWorkspaceError(
          "CHECKPOINT_SAFETY_PLAN_INVALID",
          `Restore safety checkpoint disappeared while arming ${armFields.rel}`,
          { checkpointId: safety.id, path: armFields.rel },
        );
      }
      assertCheckpointIdentity(latest, safety.identity);
      if (lstatOptional(armPath)) {
        throw invalidSafetyPlan(
          latest,
          `arm already exists: ${arm.kind}:${arm.rel}`,
        );
      }
    },
  });
  // The published arm inherits the already-verified ACL and owner of its temp.
  // The caller's mandatory full-state check still batches the final path with
  // the rest of the authority chain before any workspace rename consumes it.
}

function armRestoreSafetyTombstone(safety, root, rel, stagingIdentity) {
  const current = getCheckpoint(safety.id, { root });
  if (!current) {
    throw recoveryRequired(safety.manifest, `manifest disappeared: ${rel}`);
  }
  assertCheckpointIdentity(current, safety.identity);
  const prior = current.restoreSafetyPlan?.tombstones.find(
    (entry) => entry.rel === rel,
  );
  const mutation = current.restoreSafetyPlan?.mutations.find(
    (entry) => entry.rel === rel,
  );
  if (
    !prior ||
    mutation?.recoveryOperation !== "delete" ||
    !isCreatedFileIdentity(stagingIdentity, prior.targetBytes) ||
    !sameReservedFileIdentity(mutation.forwardStageIdentity, stagingIdentity)
  ) {
    throw invalidSafetyPlan(current, `cannot arm tombstone: ${rel}`);
  }
  writeRestoreSafetyArm(safety, root, {
    kind: "tombstone",
    rel,
    pathRel: null,
    targetSha256: prior.targetSha256,
    targetBytes: prior.targetBytes,
    objectIdentity: stagingIdentity,
  });
}

function validateSafetyCheckpointBlobs(manifest, root) {
  for (const file of manifest.files) {
    if (
      !file ||
      typeof file !== "object" ||
      !SHA256_RE.test(file.sha256) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0
    ) {
      throw invalidSafetyPlan(manifest, "safety blob metadata is invalid");
    }
    inspectPlannedRegularFile(
      manifest,
      path.join(root, manifest.id, file.sha256),
      {
        rel: file.rel,
        targetSha256: file.sha256,
        targetBytes: file.bytes,
      },
    );
  }
}

function restoreSafetyPrivateAuthorityPaths(root, manifest, validated) {
  const checkpointDir = path.join(root, manifest.id);
  const armDir = path.join(checkpointDir, RESTORE_SAFETY_ARM_DIR);
  const paths = [
    root,
    checkpointDir,
    path.join(root, `${manifest.id}.json`),
    armDir,
    path.join(checkpointDir, RESTORE_SAFETY_NAMESPACE_DIR),
    validated.namespace.path,
    ...manifest.files.map((file) => path.join(checkpointDir, file.sha256)),
    restoreSafetyArmPath(
      root,
      manifest.id,
      "namespace",
      validated.namespace.rel,
    ),
  ];
  for (const tombstone of validated.tombstones) {
    if (tombstone.arm) {
      paths.push(
        restoreSafetyArmPath(root, manifest.id, "tombstone", tombstone.rel),
      );
    }
  }
  for (const mutation of validated.mutations) {
    for (const [direction, stage] of Object.entries(mutation.stages)) {
      if (lstatOptional(stage.path)) paths.push(stage.path);
      if (stage.arm) {
        paths.push(
          restoreSafetyArmPath(
            root,
            manifest.id,
            `stage-${direction}`,
            mutation.rel,
          ),
        );
      }
    }
    if (mutation.quarantine) {
      // The moved predecessor is non-authoritative trash and intentionally
      // keeps its workspace ACL. Only its delete-authorization arm belongs to
      // the private recovery authority chain.
      if (mutation.quarantine.arm) {
        paths.push(
          restoreSafetyArmPath(root, manifest.id, "quarantine", mutation.rel),
        );
      }
    }
  }
  return paths;
}

function assertDurableSafetyState(
  safety,
  root,
  workspaceRoot,
  { inspectPrivateAuthority = true } = {},
) {
  if (!safety) return null;
  const manifest = getCheckpoint(safety.id, { root });
  if (!manifest) {
    throw recoveryRequired(
      safety.manifest || { id: safety.id },
      "durable manifest is missing or unreadable",
    );
  }
  try {
    assertCheckpointIdentity(manifest, safety.identity);
  } catch (cause) {
    throw recoveryRequired(manifest, "manifest identity drifted", { cause });
  }
  const canonicalWorkspaceRoot = canonicalWorkspaceDirectory(
    workspaceRoot,
    "restore safety workspace",
  );
  const canonicalRoot = fs.realpathSync.native(root);
  if (pathsOverlap(canonicalRoot, canonicalWorkspaceRoot)) {
    throw recoveryRequired(manifest, "safety store overlaps workspace");
  }
  const validated = validateRestoreSafetyPlan(
    manifest,
    canonicalWorkspaceRoot,
    root,
    safety.identity,
  );
  if (!validated || validated.namespace.state !== "armed") {
    throw recoveryRequired(manifest, "staging namespace is not durably armed");
  }
  const workspaceStat = fs.lstatSync(canonicalWorkspaceRoot, { bigint: true });
  const namespaceStat = fs.lstatSync(validated.namespace.path, {
    bigint: true,
  });
  if (
    workspaceStat.dev !== namespaceStat.dev ||
    String(workspaceStat.dev) !== validated.namespace.volumeIdentity
  ) {
    throw recoveryRequired(manifest, "staging namespace changed filesystems");
  }
  if (inspectPrivateAuthority) {
    assertPrivateAuthorityPaths(
      manifest,
      restoreSafetyPrivateAuthorityPaths(root, manifest, validated),
    );
  }
  const tombstoneByRel = new Map(
    validated.tombstones.map((entry) => [entry.rel, entry]),
  );
  for (const mutation of validated.mutations) {
    if (
      Object.values(mutation.stages).some(
        (stage) =>
          stage.state === "unarmed-present" ||
          stage.state === "reservation-missing",
      ) ||
      mutation.quarantine?.state === "unarmed-trash-present"
    ) {
      throw recoveryRequired(
        manifest,
        `planned staging exists without a trustworthy arm: ${mutation.rel}`,
        { path: mutation.rel },
      );
    }
    if (mutation.recoveryOperation === "delete") {
      const tombstone = tombstoneByRel.get(mutation.rel);
      if (
        mutation.stages.forward?.state !== "reserved" &&
        tombstone?.state !== "armed"
      ) {
        throw recoveryRequired(
          manifest,
          `published create lost its monotonic tombstone arm: ${mutation.rel}`,
          { path: mutation.rel },
        );
      }
    }
  }
  validateSafetyCheckpointBlobs(manifest, root);
  safety.manifest = manifest;
  return { manifest, validated };
}

function safetyEvidenceFromManifest(manifest, root, validated = null) {
  const plan = manifest?.restoreSafetyPlan || null;
  const checkpointIdentity = manifest
    ? computeCheckpointIdentity(manifest)
    : null;
  let tombstones = [];
  let namespace = null;
  let mutations = [];
  if (plan) {
    const workspaceRoot = canonicalWorkspaceDirectory(
      manifest.cwd,
      "restore safety checkpoint cwd",
    );
    const state =
      validated ||
      validateRestoreSafetyPlan(
        manifest,
        workspaceRoot,
        root,
        checkpointIdentity,
      );
    tombstones = state.tombstones.map((entry) => ({
      rel: entry.rel,
      targetSha256: entry.targetSha256,
      targetBytes: entry.targetBytes,
      state: entry.state,
      createdIdentity: entry.createdIdentity,
    }));
    namespace = {
      rel: state.namespace.rel,
      state: state.namespace.state,
      volumeIdentity: state.namespace.volumeIdentity,
    };
    mutations = state.mutations.map((entry) => ({
      rel: entry.rel,
      forwardStageState: entry.stages.forward?.state || null,
      recoveryStageState: entry.stages.recovery?.state || null,
      quarantineRel: entry.quarantineRel,
      quarantineState: entry.quarantine?.state || null,
    }));
  }
  return {
    schema: RESTORE_SAFETY_PLAN_SCHEMA,
    durable: true,
    checkpointId: manifest?.id || null,
    checkpointIdentity,
    planIdentity: plan?.planIdentity || null,
    threatBoundary: plan?.threatBoundary || null,
    quarantinePolicy: plan?.quarantinePolicy || null,
    namespace,
    mutations,
    tombstones,
  };
}

function refreshSafetyState(safety, root, workspaceRoot) {
  if (!safety) return null;
  try {
    const state = assertDurableSafetyState(safety, root, workspaceRoot);
    return safetyEvidenceFromManifest(state.manifest, root, state.validated);
  } catch (error) {
    // This in-memory projection is diagnostic only. It must never authorize a
    // workspace mutation or be reported as complete rollback coverage.
    const plan = safety.manifest?.restoreSafetyPlan || null;
    return {
      schema: RESTORE_SAFETY_PLAN_SCHEMA,
      durable: false,
      checkpointId: safety.id,
      checkpointIdentity: safety.identity,
      planIdentity: plan?.planIdentity || null,
      threatBoundary: plan?.threatBoundary || null,
      quarantinePolicy: plan?.quarantinePolicy || null,
      namespace: plan?.namespace
        ? { rel: plan.namespace.rel, state: "unknown" }
        : null,
      mutations: (plan?.mutations || []).map((entry) => ({
        rel: entry.rel,
        forwardStageState: "unknown",
        recoveryStageState: "unknown",
        quarantineRel: entry.quarantineRel,
        quarantineState: entry.quarantineRel ? "unknown" : null,
      })),
      tombstones: (plan?.tombstones || []).map((entry) => ({
        ...entry,
        state: "unknown",
        createdIdentity: null,
      })),
      validationError: {
        code: error?.code || "CHECKPOINT_SAFETY_PLAN_INVALID",
        message: error?.message || String(error),
      },
    };
  }
}

function createdPathsFromSafetyEvidence(evidence, workspaceRoot) {
  const created = [];
  for (const tombstone of evidence?.tombstones || []) {
    if (tombstone.state !== "armed") continue;
    try {
      const rel = normalizedRelativePath(tombstone.rel);
      const targetPath = path.resolve(workspaceRoot, ...rel.segments);
      assertStrictlyContained(workspaceRoot, targetPath, tombstone.rel);
      const inspected = inspectTarget(workspaceRoot, targetPath, tombstone.rel);
      if (
        inspected.prestate.state === "present" &&
        compareCanonical(
          tombstone.createdIdentity,
          inspected.prestate.objectIdentity,
        ) &&
        tombstone.targetSha256 === inspected.prestate.sha256 &&
        tombstone.targetBytes === inspected.content.length
      ) {
        created.push(tombstone.rel);
      }
    } catch {
      // Evidence remains authoritative; diagnostics never guess that an
      // unsafe or unstable path was successfully created.
    }
  }
  return created;
}

function attachRestoreSafetyEvidence(
  error,
  {
    safety,
    root,
    workspaceRoot,
    createdPaths,
    safetyCoverage,
    restorePhase = "workspace-mutation",
  },
) {
  if (!error || typeof error !== "object") return;
  const evidence = refreshSafetyState(safety, root, workspaceRoot);
  const detected = createdPathsFromSafetyEvidence(evidence, workspaceRoot);
  const completeCreatedPaths = [...new Set([...createdPaths, ...detected])];
  error.safetyId = safety?.id || null;
  error.safetyIdentity =
    evidence?.checkpointIdentity || safety?.identity || null;
  error.safetyPlanIdentity = evidence?.planIdentity || null;
  error.safetyCoverage =
    evidence?.durable === false || error.coverageUnknown === true
      ? "unknown"
      : safetyCoverage;
  error.safetyEvidence = evidence;
  error.createdPaths = completeCreatedPaths;
  error.restorePhase = restorePhase;
}

function assertSynchronousRestoreHook(name, hook) {
  if (hook == null) return;
  if (
    typeof hook !== "function" ||
    hook.constructor?.name === "AsyncFunction"
  ) {
    throw checkpointWorkspaceError(
      "CHECKPOINT_RESTORE_HOOK_INVALID",
      `${name} must be a synchronous function`,
      { hook: name },
    );
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
    throw checkpointWorkspaceError(
      "CHECKPOINT_RESTORE_HOOK_INVALID",
      `${name} must not return a promise or thenable`,
      { hook: name },
    );
  }
}

function assertSourceCheckpointBlob(
  sourceManifest,
  root,
  checkpointIdentity,
  entry,
) {
  const current = getCheckpoint(sourceManifest.id, { root });
  if (!current) {
    throw checkpointWorkspaceError(
      "CHECKPOINT_BLOB_MISSING",
      `Checkpoint manifest disappeared before restore: ${sourceManifest.id}`,
      { checkpointId: sourceManifest.id, path: entry.canonicalRel },
    );
  }
  assertCheckpointIdentity(current, checkpointIdentity);
  const currentFile = current.files.find(
    (file) =>
      normalizedRelativePath(file.rel).normalized === entry.canonicalRel,
  );
  if (
    !currentFile ||
    currentFile.sha256 !== entry.targetSha256 ||
    currentFile.bytes !== entry.targetBytes
  ) {
    throw checkpointWorkspaceError(
      "CHECKPOINT_BLOB_CORRUPT",
      `Checkpoint blob binding changed before restore: ${entry.canonicalRel}`,
      { checkpointId: sourceManifest.id, path: entry.canonicalRel },
    );
  }
  inspectPlannedRegularFile(
    current,
    path.join(root, current.id, currentFile.sha256),
    {
      rel: entry.canonicalRel,
      targetSha256: currentFile.sha256,
      targetBytes: currentFile.bytes,
    },
  );
}

function assertTargetPrestate(workspaceRoot, entry) {
  const inspected = inspectTarget(
    workspaceRoot,
    entry.abs || entry.targetPath,
    entry.canonicalRel || entry.rel,
  );
  if (!compareCanonical(inspected.prestate, entry.initialPrestate)) {
    throw checkpointWorkspaceError(
      "CHECKPOINT_WORKSPACE_UNSTABLE",
      `checkpoint target changed before mutation: ${entry.canonicalRel || entry.rel}`,
      { path: entry.canonicalRel || entry.rel },
    );
  }
  return inspected;
}

function publishPlannedWorkspaceFile({
  activeSafety,
  root,
  workspaceRoot,
  direction,
  entry,
}) {
  let state = assertDurableSafetyState(activeSafety, root, workspaceRoot, {
    inspectPrivateAuthority: false,
  });
  let mutation = state.validated.mutations.find(
    (candidate) => candidate.rel === entry.canonicalRel,
  );
  if (!mutation || mutation[`${direction}Operation`] !== "write") {
    throw invalidSafetyPlan(
      state.manifest,
      `${direction} write is not planned: ${entry.canonicalRel}`,
    );
  }
  const stageRel = mutation[`${direction}StagingRel`];
  let stage = mutation.stages[direction];
  if (stage.state === "reserved") {
    fs.writeFileSync(stage.path, entry.blob, {
      flag: "r+",
      flush: true,
    });
    const stageIdentity = inspectPlannedRegularFile(
      state.manifest,
      stage.path,
      {
        rel: stageRel,
        targetSha256: entry.targetSha256,
        targetBytes: entry.targetBytes,
      },
    );
    if (
      !sameReservedFileIdentity(
        mutation[`${direction}StageIdentity`],
        stageIdentity,
      )
    ) {
      throw recoveryRequired(
        state.manifest,
        `write stage escaped its immutable reservation: ${entry.canonicalRel}`,
        { path: entry.canonicalRel },
      );
    }
    writeRestoreSafetyArm(activeSafety, root, {
      kind: `stage-${direction}`,
      rel: entry.canonicalRel,
      pathRel: stageRel,
      targetSha256: entry.targetSha256,
      targetBytes: entry.targetBytes,
      objectIdentity: stageIdentity,
    });
    if (direction === "forward" && mutation.recoveryOperation === "delete") {
      armRestoreSafetyTombstone(
        activeSafety,
        root,
        entry.canonicalRel,
        stageIdentity,
      );
    }
  }

  state = assertDurableSafetyState(activeSafety, root, workspaceRoot, {
    inspectPrivateAuthority: false,
  });
  mutation = state.validated.mutations.find(
    (candidate) => candidate.rel === entry.canonicalRel,
  );
  stage = mutation?.stages[direction];
  if (!stage || stage.state !== "armed-present") {
    throw recoveryRequired(
      state.manifest,
      `write stage is not durably armed: ${entry.canonicalRel}`,
      { path: entry.canonicalRel },
    );
  }
  assertTargetPrestate(workspaceRoot, entry);
  fs.renameSync(stage.path, entry.abs);
  syncDirectoryEntry(stage.path);
  flushPublishedFile(entry.abs);
  const published = inspectTarget(workspaceRoot, entry.abs, entry.canonicalRel);
  if (
    published.prestate.state !== "present" ||
    published.prestate.sha256 !== entry.targetSha256 ||
    published.content.length !== entry.targetBytes ||
    !compareCanonical(
      stage.arm.objectIdentity,
      published.prestate.objectIdentity,
    )
  ) {
    throw recoveryRequired(
      state.manifest,
      `published write identity is ambiguous: ${entry.canonicalRel}`,
      { path: entry.canonicalRel },
    );
  }
}

function selectUntrustedTrashPath(root, manifest, plannedRel) {
  const candidates = [
    plannedRel,
    ...Array.from({ length: 8 }, () => `${plannedRel}.${randomUUID()}.trash`),
  ];
  for (const rel of candidates) {
    const candidatePath = resolveSafetyStorePath(root, manifest.id, rel);
    if (!lstatOptional(candidatePath)) return { path: candidatePath, rel };
  }
  throw recoveryRequired(manifest, "no collision-free trash path is available");
}

function quarantinePlannedWorkspaceFile({
  activeSafety,
  root,
  workspaceRoot,
  direction,
  entry,
}) {
  let state = assertDurableSafetyState(activeSafety, root, workspaceRoot, {
    inspectPrivateAuthority: false,
  });
  let mutation = state.validated.mutations.find(
    (candidate) => candidate.rel === entry.rel,
  );
  if (!mutation || mutation[`${direction}Operation`] !== "delete") {
    throw invalidSafetyPlan(
      state.manifest,
      `${direction} delete is not planned: ${entry.rel}`,
    );
  }
  let quarantine = mutation.quarantine;
  const targetHash =
    direction === "forward"
      ? mutation.recoveryTargetSha256
      : mutation.forwardTargetSha256;
  const targetBytes =
    direction === "forward"
      ? mutation.recoveryTargetBytes
      : mutation.forwardTargetBytes;
  const expectedIdentity =
    direction === "forward"
      ? mutation.forwardDeleteIdentity
      : entry.createdIdentity;

  if (
    !expectedIdentity ||
    !isCreatedFileIdentity(expectedIdentity, targetBytes)
  ) {
    throw recoveryRequired(
      state.manifest,
      `delete identity is unavailable: ${entry.rel}`,
      { path: entry.rel },
    );
  }
  const inspected = inspectTarget(workspaceRoot, entry.targetPath, entry.rel);
  if (
    inspected.prestate.state !== "present" ||
    inspected.prestate.sha256 !== targetHash ||
    inspected.content.length !== targetBytes ||
    !compareCanonical(inspected.prestate.objectIdentity, expectedIdentity)
  ) {
    throw checkpointWorkspaceError(
      "CHECKPOINT_TOMBSTONE_IDENTITY_MISMATCH",
      `Refusing to quarantine a successor at restore target: ${entry.rel}`,
      { checkpointId: state.manifest.id, path: entry.rel },
    );
  }
  if (!quarantine.arm && quarantine.state === "planned") {
    writeRestoreSafetyArm(activeSafety, root, {
      kind: "quarantine",
      rel: entry.rel,
      pathRel: mutation.quarantineRel,
      targetSha256: targetHash,
      targetBytes,
      objectIdentity: expectedIdentity,
    });
  } else if (!quarantine.arm) {
    throw recoveryRequired(
      state.manifest,
      `trash path appeared before delete authorization: ${entry.rel}`,
      { path: entry.rel },
    );
  }

  state = assertDurableSafetyState(activeSafety, root, workspaceRoot, {
    inspectPrivateAuthority: false,
  });
  mutation = state.validated.mutations.find(
    (candidate) => candidate.rel === entry.rel,
  );
  quarantine = mutation?.quarantine;
  if (!quarantine?.arm) {
    throw recoveryRequired(
      state.manifest,
      `delete is not durably armed: ${entry.rel}`,
      { path: entry.rel },
    );
  }
  const latest = inspectTarget(workspaceRoot, entry.targetPath, entry.rel);
  if (
    latest.prestate.state !== "present" ||
    latest.prestate.sha256 !== targetHash ||
    latest.content.length !== targetBytes ||
    !compareCanonical(latest.prestate.objectIdentity, expectedIdentity)
  ) {
    throw checkpointWorkspaceError(
      "CHECKPOINT_TOMBSTONE_IDENTITY_MISMATCH",
      `Refusing to quarantine a successor at restore target: ${entry.rel}`,
      { checkpointId: state.manifest.id, path: entry.rel },
    );
  }
  const trash = selectUntrustedTrashPath(
    root,
    state.manifest,
    mutation.quarantineRel,
  );
  fs.renameSync(entry.targetPath, trash.path);
  syncDirectoryEntry(entry.targetPath);
  syncDirectoryEntry(trash.path);
  let movedIdentity;
  try {
    // This read only proves that this process moved the armed predecessor. The
    // trash object is never consulted by a later recovery process.
    movedIdentity = inspectPlannedRegularFile(state.manifest, trash.path, {
      rel: trash.rel,
      targetSha256: targetHash,
      targetBytes,
    });
  } catch (cause) {
    throw recoveryRequired(
      state.manifest,
      `moved trash does not match the armed predecessor: ${entry.rel}`,
      { path: entry.rel, quarantineRel: trash.rel, cause },
    );
  }
  if (
    !sameMovedTrashIdentity(expectedIdentity, movedIdentity) ||
    !sameMovedTrashIdentity(quarantine.arm.objectIdentity, movedIdentity)
  ) {
    throw recoveryRequired(
      state.manifest,
      `moved trash identity is ambiguous: ${entry.rel}`,
      { path: entry.rel, quarantineRel: trash.rel },
    );
  }
  if (lstatOptional(entry.targetPath)) {
    throw recoveryRequired(
      state.manifest,
      `a successor appeared after the armed delete: ${entry.rel}`,
      { path: entry.rel, quarantineRel: trash.rel },
    );
  }
  // Never unlink this object here. It is explicitly untrusted trash, retained
  // only for diagnostics/cleanup and excluded from all recovery authority.
  return {
    rel: entry.rel,
    quarantineRel: trash.rel,
    state: "retained-untrusted",
    authority: "none",
  };
}

function assertCompleteRestorePoststate({
  authorityManifest,
  workspaceRoot,
  files,
  tombstones,
  writtenEntries,
  validatedSafety,
  direction,
}) {
  const fail = (message, details = {}) => {
    throw recoveryRequired(authorityManifest, message, {
      ...details,
      coverageUnknown: true,
    });
  };
  for (const file of files) {
    let inspected;
    try {
      inspected = inspectTarget(
        workspaceRoot,
        file.abs || file.targetPath,
        file.canonicalRel || file.rel,
      );
    } catch (cause) {
      fail(
        `workspace poststate is unstable: ${file.canonicalRel || file.rel}`,
        {
          path: file.canonicalRel || file.rel,
          cause,
        },
      );
    }
    const expectedSha256 = file.sha256 || file.targetSha256;
    const expectedBytes = file.targetBytes ?? file.bytes;
    if (
      inspected.prestate.state !== "present" ||
      inspected.prestate.sha256 !== expectedSha256 ||
      (expectedBytes != null && inspected.content.length !== expectedBytes)
    ) {
      fail(
        `workspace write poststate changed: ${file.canonicalRel || file.rel}`,
        {
          path: file.canonicalRel || file.rel,
        },
      );
    }
  }
  for (const tombstone of tombstones || []) {
    if (lstatOptional(tombstone.targetPath)) {
      fail(`workspace delete poststate changed: ${tombstone.rel}`, {
        path: tombstone.rel,
      });
    }
  }
  if (!validatedSafety || !direction) return;
  const mutationByRel = new Map(
    validatedSafety.mutations.map((entry) => [entry.rel, entry]),
  );
  for (const entry of writtenEntries) {
    const mutation = mutationByRel.get(entry.canonicalRel);
    const stage = mutation?.stages[direction];
    if (!stage?.arm || stage.state !== "consumed") {
      fail(`workspace write lost its settlement arm: ${entry.canonicalRel}`, {
        path: entry.canonicalRel,
      });
    }
    const inspected = inspectTarget(
      workspaceRoot,
      entry.abs,
      entry.canonicalRel,
    );
    if (
      !compareCanonical(
        stage.arm.objectIdentity,
        inspected.prestate.objectIdentity,
      )
    ) {
      fail(`workspace write identity changed: ${entry.canonicalRel}`, {
        path: entry.canonicalRel,
      });
    }
  }
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
  for (const hookName of [
    "onSafetyReady",
    "onMutationStarted",
    "onTargetPublished",
    "onWorkspaceApplied",
  ]) {
    assertSynchronousRestoreHook(hookName, opts[hookName]);
  }

  const root = opts.root || defaultRoot();
  const m = getCheckpoint(id, { root });
  if (!m) throw new Error(`no such checkpoint: ${id}`);
  const checkpointIdentity = assertCheckpointIdentity(m, opts.expectedIdentity);
  if (
    opts.expectedSafetyPlanIdentity != null &&
    m.restoreSafetyPlan?.planIdentity !== opts.expectedSafetyPlanIdentity
  ) {
    throw checkpointWorkspaceError(
      "CHECKPOINT_SAFETY_PLAN_STALE",
      `Restore safety plan identity changed: ${id}`,
      {
        checkpointId: id,
        expectedSafetyPlanIdentity: opts.expectedSafetyPlanIdentity,
        actualSafetyPlanIdentity: m.restoreSafetyPlan?.planIdentity || null,
      },
    );
  }

  let strictWorkspace = null;
  if (
    opts.cwd != null ||
    opts.expectedWorkspaceBinding != null ||
    m.restoreSafetyPlan != null ||
    !opts.skipSafety
  ) {
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
  const toDelete = [];

  const filesToInspect = strictWorkspace
    ? strictWorkspace.entries.map((entry) => ({
        ...entry,
        abs: entry.targetPath,
        rel: entry.displayRel,
        canonicalRel: entry.rel,
        sha256: entry.targetSha256,
      }))
    : m.files;
  for (const f of filesToInspect) {
    if (strictWorkspace) {
      if (f.prestate.state === "present" && f.prestate.sha256 === f.sha256) {
        unchanged.push(f.rel);
        continue;
      }
      toWrite.push({
        abs: f.abs,
        rel: f.rel,
        canonicalRel: f.canonicalRel,
        blob: f.blob,
        targetSha256: f.targetSha256,
        targetBytes: f.targetBytes,
        wasMissing: f.prestate.state === "absent",
        parentStates: f.parentStates,
        initialPrestate: f.prestate,
      });
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
    toWrite.push({
      abs: f.abs,
      rel: f.rel,
      canonicalRel: f.rel,
      blob,
      targetSha256: f.sha256,
      targetBytes: blob.length,
      wasMissing: !fs.existsSync(f.abs),
      initialPrestate: null,
    });
  }
  for (const tombstone of strictWorkspace?.tombstones || []) {
    if (tombstone.prestate.state === "absent") {
      // An absent target is the complete delete poststate. Any predecessor
      // moved below quarantineRel is untrusted trash, not recovery evidence.
      unchanged.push(tombstone.displayRel);
      continue;
    }
    toDelete.push(tombstone);
  }

  if (opts.dryRun) {
    return {
      id,
      restored: [
        ...toWrite.map((entry) => entry.rel),
        ...toDelete.map((entry) => entry.displayRel),
      ],
      unchanged,
      missingBlob,
      safetyId: null,
      safetyIdentity: null,
      safetyPlanIdentity: null,
      dryRun: true,
    };
  }

  if (
    !opts.skipSafety &&
    toWrite.some((entry) =>
      entry.parentStates?.some((parent) => parent.state === "absent"),
    )
  ) {
    throw checkpointWorkspaceError(
      "CHECKPOINT_SAFETY_PARENT_CREATION_UNSUPPORTED",
      "Copy restore safety cannot create missing parent directories",
      { checkpointId: id },
    );
  }

  const workspaceRoot =
    strictWorkspace?.workspaceBinding.workspaceRoot || path.resolve(m.cwd);
  let safety = null;
  const createdPaths = [];
  const deletedPaths = [];
  const retainedQuarantines = [];
  const mutationCount = toWrite.length + toDelete.length;
  const safetyCoverage =
    mutationCount === 0
      ? m.restoreSafetyPlan
        ? "full"
        : "not-required"
      : !opts.skipSafety || m.restoreSafetyPlan
        ? "full"
        : "skipped";
  if (!opts.skipSafety && mutationCount > 0) {
    const existingPaths = [
      ...toWrite.filter((entry) => !entry.wasMissing).map((entry) => entry.abs),
      ...toDelete
        .filter((entry) => entry.prestate.state === "present")
        .map((entry) => entry.targetPath),
    ].filter(
      (value, index, values) =>
        values.findIndex((candidate) => samePath(candidate, value)) === index,
    );
    safety = createRestoreSafetyCheckpoint({
      root,
      workspaceRoot,
      sourceCheckpointId: id,
      sourceCheckpointIdentity: checkpointIdentity,
      existingPaths,
      tombstones: toWrite
        .filter((entry) => entry.wasMissing)
        .map((entry) => ({
          rel: entry.canonicalRel,
          targetSha256: entry.targetSha256,
          targetBytes: entry.targetBytes,
        })),
      mutations: [
        ...toWrite.map((entry) => ({
          rel: entry.canonicalRel,
          operation: "write",
          targetPath: entry.abs,
          targetSha256: entry.targetSha256,
          targetBytes: entry.targetBytes,
          prestate: entry.initialPrestate,
        })),
        ...toDelete.map((entry) => ({
          rel: entry.rel,
          operation: "delete",
          targetPath: entry.targetPath,
          targetSha256: null,
          targetBytes: null,
          prestate: entry.prestate,
        })),
      ],
    });
  }

  const activeSafety =
    safety ||
    (m.restoreSafetyPlan
      ? { id: m.id, identity: checkpointIdentity, manifest: m }
      : null);
  const safetyDirection = safety
    ? "forward"
    : m.restoreSafetyPlan
      ? "recovery"
      : null;

  let workspaceMutationStarted = false;
  let workspaceApplied = false;
  let finalSafetyEvidence = null;
  try {
    const initialSafetyState = activeSafety
      ? assertDurableSafetyState(activeSafety, root, workspaceRoot, {
          // A newly-created safety checkpoint was just repaired and verified
          // as one complete batch. Recovery of an older checkpoint has no such
          // in-process proof and must inspect its private chain immediately.
          inspectPrivateAuthority: !safety,
        })
      : null;
    if (safety) {
      const readyState = initialSafetyState;
      const readyEvidence = safetyEvidenceFromManifest(
        readyState.manifest,
        root,
        readyState.validated,
      );
      callSynchronousRestoreHook("onSafetyReady", opts.onSafetyReady, {
        safetyId: safety.id,
        safetyIdentity: safety.identity,
        safetyCoverage,
        safetyPlanIdentity: readyEvidence.planIdentity,
      });
      if (opts.onSafetyReady) {
        assertDurableSafetyState(activeSafety, root, workspaceRoot);
      }
    }

    if (mutationCount > 0) {
      callSynchronousRestoreHook("onMutationStarted", opts.onMutationStarted, {
        checkpointId: id,
        checkpointIdentity,
        safetyId: activeSafety?.id || null,
        safetyIdentity: activeSafety?.identity || null,
        safetyPlanIdentity:
          activeSafety?.manifest.restoreSafetyPlan?.planIdentity || null,
        mutationCount,
      });
      workspaceMutationStarted = true;
    }

    // Hooks are untrusted extension points. Re-read both durable safety state
    // and the complete workspace binding after they return, before the first
    // workspace mutation.
    if (activeSafety && mutationCount > 0) {
      assertDurableSafetyState(activeSafety, root, workspaceRoot, {
        inspectPrivateAuthority: Boolean(opts.onMutationStarted),
      });
    }
    if (strictWorkspace && mutationCount > 0) {
      const rebound = computeWorkspaceBinding(
        m,
        { ...opts, root, checkpointId: id },
        checkpointIdentity,
      );
      if (
        !compareCanonical(
          strictWorkspace.workspaceBinding,
          rebound.workspaceBinding,
        )
      ) {
        throw staleWorkspaceBinding(
          id,
          strictWorkspace.workspaceBinding,
          rebound.workspaceBinding,
        );
      }
    }

    let publishedIndex = 0;
    for (const entry of toWrite) {
      if (activeSafety) {
        assertSourceCheckpointBlob(m, root, checkpointIdentity, entry);
      }
      if (entry.wasMissing && lstatOptional(entry.abs)) {
        throw staleWorkspaceBinding(
          id,
          strictWorkspace?.workspaceBinding || null,
          null,
          checkpointWorkspaceError(
            "CHECKPOINT_WORKSPACE_UNSTABLE",
            `checkpoint target appeared before restore: ${entry.canonicalRel}`,
          ),
        );
      }
      if (strictWorkspace) {
        const parents = inspectParentChain(workspaceRoot, entry.abs);
        if (parents.some((parent) => parent.state !== "directory")) {
          throw checkpointWorkspaceError(
            "CHECKPOINT_WORKSPACE_UNSTABLE",
            `checkpoint target parent disappeared before restore: ${entry.canonicalRel}`,
            { checkpointId: id, path: entry.canonicalRel },
          );
        }
      } else {
        ensureDir(path.dirname(entry.abs));
      }
      if (activeSafety) {
        publishPlannedWorkspaceFile({
          activeSafety,
          root,
          workspaceRoot,
          direction: safetyDirection,
          entry,
        });
      } else {
        atomicWriteFileSync(entry.abs, entry.blob, { durable: true });
      }
      if (entry.wasMissing) createdPaths.push(entry.canonicalRel);
      restored.push(entry.rel);
      callSynchronousRestoreHook("onTargetPublished", opts.onTargetPublished, {
        checkpointId: id,
        rel: entry.canonicalRel,
        index: publishedIndex++,
        operation: "write",
        created: entry.wasMissing,
      });
      if (opts.onTargetPublished && activeSafety) {
        assertDurableSafetyState(activeSafety, root, workspaceRoot);
      }
    }

    for (const tombstone of toDelete) {
      if (!activeSafety || !safetyDirection) {
        throw checkpointWorkspaceError(
          "CHECKPOINT_SAFETY_PLAN_INVALID",
          `Delete is missing a durable quarantine plan: ${tombstone.rel}`,
          { checkpointId: id, path: tombstone.rel },
        );
      }
      const retained = quarantinePlannedWorkspaceFile({
        activeSafety,
        root,
        workspaceRoot,
        direction: safetyDirection,
        entry: tombstone,
      });
      retainedQuarantines.push(retained);
      deletedPaths.push(tombstone.rel);
      restored.push(tombstone.displayRel);
      callSynchronousRestoreHook("onTargetPublished", opts.onTargetPublished, {
        checkpointId: id,
        rel: tombstone.rel,
        index: publishedIndex++,
        operation: "delete",
        created: false,
      });
      if (opts.onTargetPublished) {
        assertDurableSafetyState(activeSafety, root, workspaceRoot);
      }
    }

    if (activeSafety && mutationCount > 0) {
      assertDurableSafetyState(activeSafety, root, workspaceRoot, {
        inspectPrivateAuthority: false,
      });
    }

    const residualPaths = [];
    for (const file of filesToInspect) {
      try {
        const inspected = strictWorkspace
          ? inspectTarget(workspaceRoot, file.abs, file.rel)
          : null;
        if (
          strictWorkspace
            ? inspected.prestate.state !== "present" ||
              inspected.prestate.sha256 !== file.sha256
            : !fs.existsSync(file.abs) ||
              sha256(fs.readFileSync(file.abs)) !== file.sha256
        ) {
          residualPaths.push(file.rel);
        }
      } catch {
        residualPaths.push(file.rel);
      }
    }
    for (const tombstone of strictWorkspace?.tombstones || []) {
      if (lstatOptional(tombstone.targetPath)) {
        residualPaths.push(tombstone.displayRel);
      }
    }
    if (residualPaths.length > 0) {
      const error = new Error(
        `Checkpoint restore did not settle at the target manifest: ${id}`,
      );
      error.code = "CHECKPOINT_RESTORE_INCOMPLETE";
      error.residualPaths = [...new Set(residualPaths)];
      throw error;
    }
    const finalState = activeSafety
      ? assertDurableSafetyState(activeSafety, root, workspaceRoot)
      : null;
    if (strictWorkspace) {
      assertCompleteRestorePoststate({
        authorityManifest: finalState?.manifest || m,
        workspaceRoot,
        files: filesToInspect,
        tombstones: strictWorkspace.tombstones,
        writtenEntries: toWrite,
        validatedSafety: finalState?.validated || null,
        direction: safetyDirection,
      });
    }
    const finalEvidence = finalState
      ? safetyEvidenceFromManifest(
          finalState.manifest,
          root,
          finalState.validated,
        )
      : null;
    workspaceApplied = true;
    callSynchronousRestoreHook("onWorkspaceApplied", opts.onWorkspaceApplied, {
      checkpointId: id,
      checkpointIdentity,
      restored: [...restored],
      createdPaths: [...createdPaths],
      deletedPaths: [...deletedPaths],
      retainedQuarantines: [...retainedQuarantines],
      safetyId: safety?.id || null,
      safetyIdentity: safety?.identity || null,
      safetyPlanIdentity: finalEvidence?.planIdentity || null,
    });
    const returnState =
      activeSafety && opts.onWorkspaceApplied
        ? assertDurableSafetyState(activeSafety, root, workspaceRoot)
        : finalState;
    if (strictWorkspace && opts.onWorkspaceApplied) {
      assertCompleteRestorePoststate({
        authorityManifest: returnState?.manifest || m,
        workspaceRoot,
        files: filesToInspect,
        tombstones: strictWorkspace.tombstones,
        writtenEntries: toWrite,
        validatedSafety: returnState?.validated || null,
        direction: safetyDirection,
      });
    }
    finalSafetyEvidence = returnState
      ? safetyEvidenceFromManifest(
          returnState.manifest,
          root,
          returnState.validated,
        )
      : null;
  } catch (error) {
    try {
      attachRestoreSafetyEvidence(error, {
        root,
        safety: activeSafety,
        workspaceRoot,
        createdPaths,
        safetyCoverage,
        restorePhase: workspaceApplied
          ? "workspace-applied"
          : workspaceMutationStarted
            ? "workspace-mutation"
            : "safety-ready",
      });
    } catch (evidenceError) {
      if (error && typeof error === "object") {
        error.safetyId = activeSafety?.id || null;
        error.safetyIdentity = activeSafety?.identity || null;
        error.safetyPlanIdentity =
          activeSafety?.manifest.restoreSafetyPlan?.planIdentity || null;
        error.safetyCoverage = "unknown";
        error.createdPaths = [...createdPaths];
        error.restorePhase = workspaceApplied
          ? "workspace-applied"
          : workspaceMutationStarted
            ? "workspace-mutation"
            : "safety-ready";
        error.safetyEvidenceError = evidenceError;
      }
    }
    throw error;
  }

  const safetyEvidence = finalSafetyEvidence;
  return {
    id,
    restored,
    unchanged,
    missingBlob,
    safetyId: safety?.id || null,
    safetyIdentity: safety?.identity || null,
    safetyPlanIdentity: safetyEvidence?.planIdentity || null,
    safetyEvidence,
    safetyCoverage,
    createdPaths,
    deletedPaths,
    retainedQuarantines,
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
