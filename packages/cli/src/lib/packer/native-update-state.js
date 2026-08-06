import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const NATIVE_UPDATE_LINEAGE_SCHEMA =
  "chainlesschain.native-update-lineage.v1";
export const NATIVE_UPDATE_RESULT_SCHEMA =
  "chainlesschain.native-update-result.v1";
export const NATIVE_GENERATION_TRANSACTION_SCHEMA =
  "chainlesschain.native-install-transaction.v1";
export const SHA256_HEX = /^[0-9a-f]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NATIVE_LOCK_TOKEN = new RegExp(
  `^([1-9][0-9]*):(?:[0-9a-f]{32}|${UUID.source.slice(1, -1)})$`,
  "i",
);
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
    journalPath: `${canonicalPath}.update-transaction.json`,
    lastJournalPath: `${canonicalPath}.update-transaction.json.last`,
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

const GENERATION_PHASES = new Set([
  "prepared",
  "target-committed",
  "backup-committed",
  "alias-committed",
  "verified",
  "lineage-committed",
  "committed",
]);

function readStableRegular(filePath, options = {}) {
  const { capture = false, maxBytes = 1024 * 1024 } = options;
  assertSafeRegularFile(filePath, {
    label: options.label || "native generation state",
    allowMissingLeaf: false,
    platform: options.platform || process.platform,
  });
  const fd = fs.openSync(filePath, "r");
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    const pathBefore = fs.lstatSync(filePath, { bigint: true });
    const hash = crypto.createHash("sha256");
    const chunks = [];
    let capturedBytes = 0;
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    for (;;) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, offset);
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      offset += bytesRead;
      if (capture) {
        capturedBytes += bytesRead;
        if (capturedBytes > maxBytes) {
          throw new NativeUpdateStateError(
            `${options.label || "native generation state"} is oversized`,
            "TRANSACTION_INVALID",
          );
        }
        chunks.push(Buffer.from(chunk));
      }
    }
    const after = fs.fstatSync(fd, { bigint: true });
    const pathAfter = fs.lstatSync(filePath, { bigint: true });
    const stable =
      before.isFile() &&
      pathBefore.isFile() &&
      after.isFile() &&
      pathAfter.isFile() &&
      before.nlink > 0n &&
      before.dev === pathBefore.dev &&
      before.ino === pathBefore.ino &&
      before.dev === after.dev &&
      before.ino === after.ino &&
      after.dev === pathAfter.dev &&
      after.ino === pathAfter.ino &&
      before.size === after.size &&
      before.mtimeNs === after.mtimeNs &&
      before.ctimeNs === after.ctimeNs;
    if (!stable) {
      throw new NativeUpdateStateError(
        `${options.label || "native generation state"} changed while read`,
        "TRANSACTION_CHANGED",
      );
    }
    return {
      bytes: capture ? Buffer.concat(chunks) : null,
      sha256: hash.digest("hex"),
      stat: after,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function fsyncNativeDirectory(directoryPath) {
  let fd;
  try {
    fd = fs.openSync(directoryPath, "r");
    fs.fsyncSync(fd);
  } catch (error) {
    if (
      !["EACCES", "EBADF", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(
        error?.code,
      )
    ) {
      throw error;
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function fsyncNativeFileDescriptor(fd) {
  try {
    fs.fsyncSync(fd);
  } catch (error) {
    if (!["EBADF", "EINVAL", "ENOTSUP", "EPERM"].includes(error?.code)) {
      throw error;
    }
  }
}

function parseGenerationJournal(journalPath, platform) {
  const { bytes } = readStableRegular(journalPath, {
    capture: true,
    label: "native generation transaction journal",
    platform,
  });
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new NativeUpdateStateError(
      `native generation transaction journal is corrupt: ${error.message}`,
      "TRANSACTION_INVALID",
    );
  }
  const validBefore = (present, digest) =>
    typeof present === "boolean" &&
    (present ? SHA256_HEX.test(digest || "") : digest === null);
  const valid =
    value?.schema === NATIVE_GENERATION_TRANSACTION_SCHEMA &&
    UUID.test(value.transactionId || "") &&
    ["install", "update", "rescue"].includes(value.operation) &&
    GENERATION_PHASES.has(value.phase) &&
    ["rollback", "commit"].includes(value.decision) &&
    (value.phase === "committed") === (value.decision === "commit") &&
    SHA256_HEX.test(value.expectedSha256 || "") &&
    validBefore(value.hadTarget, value.targetBeforeSha256) &&
    validBefore(value.hadBackup, value.backupBeforeSha256) &&
    validBefore(value.hadAlias, value.aliasBeforeSha256) &&
    validBefore(value.hadLineage, value.lineageBeforeSha256);
  if (!valid) {
    throw new NativeUpdateStateError(
      "native generation transaction journal failed schema validation",
      "TRANSACTION_INVALID",
    );
  }
  return value;
}

function stableRegularShaOrNull(filePath, platform, label) {
  const stat = lstatOrNull(filePath);
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new NativeUpdateStateError(`${label} has an unsafe file type`);
  }
  return readStableRegular(filePath, { label, platform }).sha256;
}

function stableAliasShaOrNull(aliasPath) {
  if (!lstatOrNull(aliasPath)) return null;
  const before = fs.lstatSync(aliasPath, { bigint: true });
  if (!before.isSymbolicLink()) {
    throw new NativeUpdateStateError(
      "native generation alias has an unsafe file type",
    );
  }
  const rawTarget = fs.readlinkSync(aliasPath);
  const after = fs.lstatSync(aliasPath, { bigint: true });
  if (
    !after.isSymbolicLink() ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs
  ) {
    throw new NativeUpdateStateError(
      "native generation alias changed while read",
      "TRANSACTION_CHANGED",
    );
  }
  return crypto
    .createHash("sha256")
    .update(Buffer.from(rawTarget))
    .digest("hex");
}

function restoreRegularGeneration(
  sourcePath,
  destinationPath,
  expectedSha,
  transactionId,
  platform,
  label,
) {
  if (
    stableRegularShaOrNull(sourcePath, platform, `${label} snapshot`) !==
    expectedSha
  ) {
    throw new NativeUpdateStateError(
      `${label} recovery snapshot is missing or changed`,
      "RECOVERY_FAILED",
    );
  }
  const stagingPath = `${destinationPath}.restart-recovery-${transactionId}`;
  if (lstatOrNull(stagingPath)) {
    throw new NativeUpdateStateError(
      `${label} recovery staging path already exists`,
      "RECOVERY_FAILED",
    );
  }
  try {
    fs.copyFileSync(sourcePath, stagingPath, fs.constants.COPYFILE_EXCL);
    try {
      fs.chmodSync(stagingPath, fs.statSync(sourcePath).mode);
    } catch {
      /* mode preservation is best effort on filesystems without POSIX modes */
    }
    const fd = fs.openSync(stagingPath, "r");
    try {
      fsyncNativeFileDescriptor(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (
      stableRegularShaOrNull(
        stagingPath,
        platform,
        `${label} recovery staging`,
      ) !== expectedSha
    ) {
      throw new NativeUpdateStateError(
        `${label} recovery staging changed`,
        "RECOVERY_FAILED",
      );
    }
    fs.renameSync(stagingPath, destinationPath);
    fsyncNativeDirectory(path.dirname(destinationPath));
    if (
      stableRegularShaOrNull(destinationPath, platform, label) !== expectedSha
    ) {
      throw new NativeUpdateStateError(
        `${label} recovery verification failed`,
        "RECOVERY_FAILED",
      );
    }
  } finally {
    try {
      const stat = fs.lstatSync(stagingPath);
      if (stat.isFile() && !stat.isSymbolicLink()) fs.unlinkSync(stagingPath);
    } catch {
      /* absent or unsafe staging is retained */
    }
  }
}

function retireKnownRegular(
  filePath,
  allowedHashes,
  transactionId,
  platform,
  label,
) {
  const current = stableRegularShaOrNull(filePath, platform, label);
  if (current === null) return;
  if (!allowedHashes.filter(Boolean).includes(current)) {
    throw new NativeUpdateStateError(
      `${label} has an unknown generation`,
      "RECOVERY_FAILED",
    );
  }
  const retiredPath = `${filePath}.restart-retired-${transactionId}`;
  if (lstatOrNull(retiredPath)) {
    throw new NativeUpdateStateError(
      `${label} retirement path already exists`,
      "RECOVERY_FAILED",
    );
  }
  fs.renameSync(filePath, retiredPath);
  fsyncNativeDirectory(path.dirname(filePath));
}

function lineageMatchesGeneration(
  lineagePath,
  transactionId,
  expectedSha,
  platform,
) {
  if (
    stableRegularShaOrNull(lineagePath, platform, "native update lineage") ===
    null
  ) {
    return false;
  }
  let value;
  try {
    value = JSON.parse(
      readStableRegular(lineagePath, {
        capture: true,
        label: "native update lineage",
        platform,
      }).bytes.toString("utf8"),
    );
  } catch {
    return false;
  }
  return (
    value?.schema === NATIVE_UPDATE_LINEAGE_SCHEMA &&
    value.transactionId === transactionId &&
    value.currentSha256 === expectedSha
  );
}

function acquireGenerationRecoveryLock(lockPath, platform) {
  const current = lstatOrNull(lockPath);
  if (current) {
    const { bytes, stat } = readStableRegular(lockPath, {
      capture: true,
      maxBytes: 128,
      label: "stale native update lock",
      platform,
    });
    const token = bytes.toString("utf8");
    const match = NATIVE_LOCK_TOKEN.exec(token);
    if (!match) {
      throw new NativeUpdateStateError(
        "stale native update lock token is invalid",
        "RECOVERY_LOCK_INVALID",
      );
    }
    try {
      process.kill(Number(match[1]), 0);
      throw new NativeUpdateStateError(
        `native update lock owner PID ${match[1]} is still live`,
        "RECOVERY_LOCK_LIVE",
      );
    } catch (error) {
      if (error instanceof NativeUpdateStateError) throw error;
      if (error?.code !== "ESRCH") {
        throw new NativeUpdateStateError(
          `could not prove stale native update lock ownership: ${error.message}`,
          "RECOVERY_LOCK_LIVE",
        );
      }
    }
    const orphanPath = `${lockPath}.orphaned-${crypto.randomUUID()}`;
    fs.renameSync(lockPath, orphanPath);
    const orphan = fs.lstatSync(orphanPath, { bigint: true });
    if (orphan.dev !== stat.dev || orphan.ino !== stat.ino) {
      throw new NativeUpdateStateError(
        "stale native update lock changed during quarantine",
        "RECOVERY_LOCK_CHANGED",
      );
    }
    fsyncNativeDirectory(path.dirname(lockPath));
  }
  const token = `${process.pid}:${crypto.randomUUID()}`;
  const fd = fs.openSync(lockPath, "wx+", 0o600);
  try {
    fs.writeFileSync(fd, token, "utf8");
    fsyncNativeFileDescriptor(fd);
    return { fd, lockPath, token };
  } catch (error) {
    try {
      const owned = fs.fstatSync(fd, { bigint: true });
      const currentLock = fs.lstatSync(lockPath, { bigint: true });
      if (
        currentLock.isFile() &&
        !currentLock.isSymbolicLink() &&
        owned.dev === currentLock.dev &&
        owned.ino === currentLock.ino
      ) {
        fs.unlinkSync(lockPath);
        fsyncNativeDirectory(path.dirname(lockPath));
      }
    } catch {
      /* retain ambiguous ownership evidence and fail closed */
    }
    try {
      fs.closeSync(fd);
    } catch {
      /* the original persistence error is authoritative */
    }
    throw error;
  }
}

function releaseGenerationRecoveryLock(lock, success) {
  fs.closeSync(lock.fd);
  if (!success) return;
  const stat = lstatOrNull(lock.lockPath);
  if (
    stat?.isFile() &&
    !stat.isSymbolicLink() &&
    fs.readFileSync(lock.lockPath, "utf8") === lock.token
  ) {
    fs.unlinkSync(lock.lockPath);
    fsyncNativeDirectory(path.dirname(lock.lockPath));
  }
}

/**
 * Resolve a durable POSIX installer/OTA generation decision before normal CLI
 * startup. Windows executable replacement remains sidecar-owned because a
 * running PE image cannot safely replace itself.
 */
export function recoverPendingNativeGeneration(options = {}) {
  const {
    targetExePath = process.execPath,
    platform = process.platform,
    packed = Boolean(process.pkg),
    force = false,
    stderr = process.stderr,
  } = options;
  if (!force && !packed) return null;
  const normalizedPlatform = platform === "win32" ? "win32" : "posix";
  const { canonicalPath } = resolveNativeLayout(
    targetExePath,
    normalizedPlatform,
  );
  const statePaths = nativeUpdatePaths(canonicalPath);
  if (!lstatOrNull(statePaths.journalPath)) return null;
  if (normalizedPlatform === "win32") {
    throw new NativeUpdateStateError(
      `a Windows native generation requires installer/sidecar recovery: ${statePaths.journalPath}`,
      "WINDOWS_RECOVERY_REQUIRED",
    );
  }

  const journal = parseGenerationJournal(
    statePaths.journalPath,
    normalizedPlatform,
  );
  const directory = path.dirname(canonicalPath);
  const aliasPath = path.join(directory, "cc");
  const transactionId = journal.transactionId;
  const priorTarget = path.join(
    directory,
    `.chainlesschain.target-prior-${transactionId}`,
  );
  const priorBackup = path.join(
    directory,
    `.chainlesschain.backup-prior-${transactionId}`,
  );
  const priorAlias = path.join(directory, `.cc.prior-${transactionId}`);
  const priorLineage = path.join(
    directory,
    `.chainlesschain.lineage-prior-${transactionId}`,
  );
  const canonicalAliasSha = crypto
    .createHash("sha256")
    .update(Buffer.from("chainlesschain"))
    .digest("hex");
  const lock = acquireGenerationRecoveryLock(
    statePaths.lockPath,
    normalizedPlatform,
  );
  let success = false;
  try {
    const targetSha = stableRegularShaOrNull(
      canonicalPath,
      normalizedPlatform,
      "native target",
    );
    if (journal.decision === "commit") {
      if (targetSha !== journal.expectedSha256) {
        throw new NativeUpdateStateError(
          "committed native target does not match its durable decision",
          "RECOVERY_FAILED",
        );
      }
      const expectedBackup = journal.hadTarget
        ? journal.targetBeforeSha256
        : null;
      if (
        stableRegularShaOrNull(
          statePaths.backupPath,
          normalizedPlatform,
          "native backup",
        ) !== expectedBackup
      ) {
        throw new NativeUpdateStateError(
          "committed native backup does not match its durable decision",
          "RECOVERY_FAILED",
        );
      }
      if (
        journal.operation === "install" &&
        stableAliasShaOrNull(aliasPath) !== canonicalAliasSha
      ) {
        throw new NativeUpdateStateError(
          "committed native alias does not match its durable decision",
          "RECOVERY_FAILED",
        );
      }
      if (
        !lineageMatchesGeneration(
          statePaths.lineagePath,
          transactionId,
          journal.expectedSha256,
          normalizedPlatform,
        )
      ) {
        throw new NativeUpdateStateError(
          "committed native lineage does not match its durable decision",
          "RECOVERY_FAILED",
        );
      }
    } else {
      if (journal.hadTarget) {
        if (
          ![journal.targetBeforeSha256, journal.expectedSha256, null].includes(
            targetSha,
          )
        ) {
          throw new NativeUpdateStateError(
            "interrupted native target has an unknown generation",
            "RECOVERY_FAILED",
          );
        }
        if (targetSha !== journal.targetBeforeSha256) {
          restoreRegularGeneration(
            priorTarget,
            canonicalPath,
            journal.targetBeforeSha256,
            transactionId,
            normalizedPlatform,
            "native target",
          );
        }
      } else {
        retireKnownRegular(
          canonicalPath,
          [journal.expectedSha256],
          transactionId,
          normalizedPlatform,
          "fresh native target",
        );
      }

      const backupSha = stableRegularShaOrNull(
        statePaths.backupPath,
        normalizedPlatform,
        "native backup",
      );
      if (journal.hadBackup) {
        if (
          ![
            journal.backupBeforeSha256,
            journal.targetBeforeSha256,
            null,
          ].includes(backupSha)
        ) {
          throw new NativeUpdateStateError(
            "interrupted native backup has an unknown generation",
            "RECOVERY_FAILED",
          );
        }
        if (backupSha !== journal.backupBeforeSha256) {
          restoreRegularGeneration(
            priorBackup,
            statePaths.backupPath,
            journal.backupBeforeSha256,
            transactionId,
            normalizedPlatform,
            "native backup",
          );
        }
      } else {
        retireKnownRegular(
          statePaths.backupPath,
          [journal.targetBeforeSha256],
          transactionId,
          normalizedPlatform,
          "fresh native backup",
        );
      }

      if (journal.operation === "install") {
        const aliasSha = stableAliasShaOrNull(aliasPath);
        if (journal.hadAlias) {
          if (
            ![journal.aliasBeforeSha256, canonicalAliasSha, null].includes(
              aliasSha,
            )
          ) {
            throw new NativeUpdateStateError(
              "interrupted native alias has an unknown generation",
              "RECOVERY_FAILED",
            );
          }
          if (aliasSha !== journal.aliasBeforeSha256) {
            const rawTarget = fs.readlinkSync(priorAlias);
            const stagingAlias = `${aliasPath}.restart-recovery-${transactionId}`;
            fs.symlinkSync(rawTarget, stagingAlias);
            fs.renameSync(stagingAlias, aliasPath);
            fsyncNativeDirectory(directory);
          }
        } else if (aliasSha !== null) {
          if (aliasSha !== canonicalAliasSha) {
            throw new NativeUpdateStateError(
              "fresh native alias has an unknown generation",
              "RECOVERY_FAILED",
            );
          }
          const retiredAlias = `${aliasPath}.restart-retired-${transactionId}`;
          fs.renameSync(aliasPath, retiredAlias);
          fsyncNativeDirectory(directory);
        }
      }

      const lineageSha = stableRegularShaOrNull(
        statePaths.lineagePath,
        normalizedPlatform,
        "native lineage",
      );
      if (journal.hadLineage) {
        if (lineageSha !== journal.lineageBeforeSha256) {
          if (
            lineageSha !== null &&
            !lineageMatchesGeneration(
              statePaths.lineagePath,
              transactionId,
              journal.expectedSha256,
              normalizedPlatform,
            )
          ) {
            throw new NativeUpdateStateError(
              "interrupted native lineage has an unknown generation",
              "RECOVERY_FAILED",
            );
          }
          restoreRegularGeneration(
            priorLineage,
            statePaths.lineagePath,
            journal.lineageBeforeSha256,
            transactionId,
            normalizedPlatform,
            "native lineage",
          );
        }
      } else if (lineageSha !== null) {
        if (
          !lineageMatchesGeneration(
            statePaths.lineagePath,
            transactionId,
            journal.expectedSha256,
            normalizedPlatform,
          )
        ) {
          throw new NativeUpdateStateError(
            "fresh native lineage has an unknown generation",
            "RECOVERY_FAILED",
          );
        }
        retireKnownRegular(
          statePaths.lineagePath,
          [lineageSha],
          transactionId,
          normalizedPlatform,
          "fresh native lineage",
        );
      }
    }

    assertSafeRegularFile(statePaths.lastJournalPath, {
      label: "retired native generation journal",
      allowMissingLeaf: true,
      platform: normalizedPlatform,
    });
    fs.renameSync(statePaths.journalPath, statePaths.lastJournalPath);
    fsyncNativeDirectory(directory);
    success = true;
    const outcome = journal.decision === "commit" ? "committed" : "rolled-back";
    stderr.write(
      `Recovered interrupted native generation: ${outcome}, transaction=${transactionId}\n`,
    );
    return { outcome, transactionId, journal };
  } finally {
    releaseGenerationRecoveryLock(lock, success);
  }
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
