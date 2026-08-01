import fs from "node:fs";
import path from "node:path";

export const NATIVE_UPDATE_LINEAGE_SCHEMA =
  "chainlesschain.native-update-lineage.v1";
export const NATIVE_UPDATE_RESULT_SCHEMA =
  "chainlesschain.native-update-result.v1";
export const SHA256_HEX = /^[0-9a-f]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESULT_STATUS = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class NativeUpdateStateError extends Error {
  constructor(message, code = "UNSAFE_PATH") {
    super(message);
    this.name = "NativeUpdateStateError";
    this.code = code;
  }
}

export function lstatOrNull(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function normalizedRealPath(filePath, platform = process.platform) {
  const normalized = path.normalize(path.resolve(filePath));
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

/**
 * Reject every existing symlink/junction ancestor, not just the leaf. Node
 * reports Windows junctions as symbolic links; the realpath comparison also
 * catches filesystem redirectors that lstat does not classify that way.
 */
export function assertSafePathAncestors(filePath, options = {}) {
  const {
    label = "path",
    platform = process.platform,
    leaf = "any",
    allowMissingLeaf = true,
  } = options;
  const resolved = path.resolve(filePath);
  const parsed = path.parse(resolved);
  const relative = path.relative(parsed.root, resolved);
  const components = relative ? relative.split(path.sep).filter(Boolean) : [];
  let current = parsed.root;

  for (let index = 0; index < components.length; index++) {
    current = path.join(current, components[index]);
    const isLeaf = index === components.length - 1;
    const stat = lstatOrNull(current);
    if (!stat) {
      if (isLeaf && !allowMissingLeaf) {
        throw new NativeUpdateStateError(
          `${label} does not exist: ${current}`,
          "PATH_MISSING",
        );
      }
      continue;
    }
    if (stat.isSymbolicLink()) {
      throw new NativeUpdateStateError(
        `${label} contains a symbolic link or reparse point: ${current}`,
      );
    }
    if (!isLeaf && !stat.isDirectory()) {
      throw new NativeUpdateStateError(
        `${label} ancestor is not a directory: ${current}`,
      );
    }
    if (!isLeaf && stat.isDirectory()) {
      let real;
      try {
        real = fs.realpathSync.native(current);
      } catch (error) {
        throw new NativeUpdateStateError(
          `could not resolve ${label} ancestor ${current}: ${error.message}`,
        );
      }
      if (
        normalizedRealPath(real, platform) !==
        normalizedRealPath(current, platform)
      ) {
        throw new NativeUpdateStateError(
          `${label} ancestor resolves through a link or reparse point: ${current}`,
        );
      }
    }
    if (isLeaf && leaf === "file" && !stat.isFile()) {
      throw new NativeUpdateStateError(
        `${label} must be a regular file: ${current}`,
      );
    }
    if (isLeaf && leaf === "directory" && !stat.isDirectory()) {
      throw new NativeUpdateStateError(
        `${label} must be a directory: ${current}`,
      );
    }
  }

  return resolved;
}

export function assertSafeRegularFile(filePath, options = {}) {
  return assertSafePathAncestors(filePath, {
    ...options,
    leaf: "file",
  });
}

/** Resolve the canonical executable and its managed short alias. */
export function resolveNativeLayout(
  targetExePath,
  platform = process.platform,
) {
  const requestedPath = path.resolve(targetExePath);
  const directory = path.dirname(requestedPath);
  const basename = path.basename(requestedPath).toLowerCase();
  if (
    platform === "win32" &&
    (basename === "chainlesschain.exe" || basename === "cc.exe")
  ) {
    return {
      requestedPath,
      canonicalPath: path.join(directory, "chainlesschain.exe"),
      aliasPath: path.join(directory, "cc.exe"),
    };
  }
  return { requestedPath, canonicalPath: requestedPath, aliasPath: null };
}

export function nativeUpdatePaths(canonicalPath) {
  return {
    backupPath: `${canonicalPath}.previous`,
    lockPath: `${canonicalPath}.update.lock`,
    lineagePath: `${canonicalPath}.update-lineage.json`,
    resultPath: `${canonicalPath}.update-result.json`,
    lastResultPath: `${canonicalPath}.update-result.last.json`,
  };
}

export function validateLineage(value) {
  if (!value || value.schema !== NATIVE_UPDATE_LINEAGE_SCHEMA) return false;
  if (typeof value.transactionId !== "string" || !value.transactionId) {
    return false;
  }
  if (!SHA256_HEX.test(value.currentSha256 || "")) return false;
  if (
    value.previousSha256 !== null &&
    !SHA256_HEX.test(value.previousSha256 || "")
  ) {
    return false;
  }
  return ["install", "update", "rescue", "rolled-back"].includes(
    value.operation,
  );
}

export function readNativeLineage(lineagePath) {
  assertSafeRegularFile(lineagePath, {
    label: "native update lineage",
    allowMissingLeaf: false,
  });
  let value;
  try {
    value = JSON.parse(fs.readFileSync(lineagePath, "utf8"));
  } catch (error) {
    throw new NativeUpdateStateError(
      `could not parse native update lineage: ${error.message}`,
      "LINEAGE_INVALID",
    );
  }
  if (!validateLineage(value)) {
    throw new NativeUpdateStateError(
      `native update lineage has an invalid schema: ${lineagePath}`,
      "LINEAGE_INVALID",
    );
  }
  return value;
}

export function validateNativeUpdateResult(value) {
  if (!value || value.schema !== NATIVE_UPDATE_RESULT_SCHEMA) return false;
  if (!UUID.test(value.transactionId || "")) return false;
  if (!["install", "update", "rescue"].includes(value.operation)) return false;
  if (!RESULT_STATUS.test(value.status || "")) return false;
  if (!Number.isInteger(value.exitCode) || ![0, 1].includes(value.exitCode)) {
    return false;
  }
  return value.status === "success"
    ? value.exitCode === 0
    : value.exitCode === 1;
}

export function readNativeUpdateResult(resultPath, options = {}) {
  assertSafeRegularFile(resultPath, {
    label: options.label || "native update result",
    allowMissingLeaf: false,
    platform: options.platform || process.platform,
  });
  let value;
  try {
    value = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  } catch (error) {
    throw new NativeUpdateStateError(
      `could not parse native update result: ${error.message}`,
      "RESULT_INVALID",
    );
  }
  if (!validateNativeUpdateResult(value)) {
    throw new NativeUpdateStateError(
      "native update result has an invalid schema",
      "RESULT_INVALID",
    );
  }
  return value;
}

export function nativeResultRequiresRecovery(value) {
  return Boolean(
    value &&
    typeof value.status === "string" &&
    value.status.endsWith("rollback-failed"),
  );
}

/**
 * Consume the detached Windows sidecar result on the next packed invocation.
 * The consumed record is atomically retained as `.last.json` for diagnostics.
 */
export function reportPendingNativeUpdateResult(options = {}) {
  const {
    targetExePath = process.execPath,
    platform = process.platform,
    packed = Boolean(process.pkg),
    force = false,
    stderr = process.stderr,
  } = options;
  if (!force && !packed) return null;

  const { canonicalPath } = resolveNativeLayout(targetExePath, platform);
  const { resultPath, lastResultPath } = nativeUpdatePaths(canonicalPath);
  const resultStat = lstatOrNull(resultPath);
  if (!resultStat) return null;

  try {
    assertSafeRegularFile(resultPath, {
      label: "native update result",
      allowMissingLeaf: false,
      platform,
    });
    assertSafeRegularFile(lastResultPath, {
      label: "consumed native update result",
      allowMissingLeaf: true,
      platform,
    });
    const value = readNativeUpdateResult(resultPath, { platform });
    fs.renameSync(resultPath, lastResultPath);
    const ok = value.status === "success" && value.exitCode === 0;
    const prefix = ok ? "Native update completed" : "Native update failed";
    stderr.write(
      `${prefix}: status=${value.status}, transaction=${value.transactionId}` +
        `${value.operation ? `, operation=${value.operation}` : ""}\n`,
    );
    return { ...value, consumedPath: lastResultPath };
  } catch (error) {
    stderr.write(
      `Native update result could not be consumed: ${error.message}\n`,
    );
    return { status: "result-invalid", error: error.message, resultPath };
  }
}
