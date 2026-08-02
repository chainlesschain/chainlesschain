/**
 * Stream a packed executable to a unique sibling file, verify its SHA-256,
 * and atomically commit it to `outputPath`.
 *
 * The active output is never unlinked before the rename. Concurrent writers
 * are serialized by an exclusive sibling lock, and a crashed writer's lock
 * is deliberately left fail-closed for an operator to inspect.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  hasPreciseFileIdentity,
  pathMatchesOpenedFileIdentitySync,
  sameOpenedFileIdentity,
} from "./file-identity.js";
import {
  assertSafeRegularFile as assertStateSafeRegularFile,
  assertSafePathAncestors,
} from "./native-update-state.js";

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * @param {object} ctx
 * @param {string} ctx.url
 * @param {string} ctx.sha256
 * @param {string} ctx.outputPath
 * @param {typeof fetch} [ctx.fetchImpl]
 * @param {(p:{bytes:number,total:number|null})=>void} [ctx.onProgress]
 * @param {number} [ctx.timeoutMs]
 * @returns {Promise<{outputPath:string,bytes:number,sha256:string}>}
 */
export async function downloadAndVerify(ctx) {
  const {
    url,
    sha256,
    outputPath,
    fetchImpl = fetch,
    onProgress,
    timeoutMs = 300_000,
  } = ctx;

  if (!url || typeof url !== "string") {
    throw new DownloadError("url is required", "NO_URL");
  }
  if (!sha256 || !SHA256_HEX.test(sha256)) {
    throw new DownloadError(
      `sha256 must be a 64-char lowercase hex string (got ${JSON.stringify(sha256)})`,
      "BAD_SHA256",
    );
  }
  if (!outputPath || typeof outputPath !== "string") {
    throw new DownloadError("outputPath is required", "NO_OUTPUT");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new DownloadError(
      "timeoutMs must be a positive safe integer",
      "BAD_TIMEOUT",
    );
  }

  const abortController = new AbortController();
  const deadline = Date.now() + timeoutMs;

  assertSafeDownloadPath(outputPath, "output path", true);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  assertSafeDownloadPath(outputPath, "output path", true);
  assertSafeFileOrMissing(outputPath, "output path");

  const lockPath = `${outputPath}.lock`;
  const lock = acquireLock(lockPath);
  const partialPath = `${outputPath}.partial-${process.pid}-${crypto.randomUUID()}`;
  let partialFd = null;
  let partialIdentity = null;
  let committedPath = false;
  let previousOutput = null;
  let retainLockForRecovery = false;
  const assertOwnedDownloadLock = () => {
    try {
      assertDownloadLockOwned(lock);
    } catch (error) {
      if (error?.code === "DOWNLOAD_LOCK_LOST") {
        // The pathname may already belong to another writer. From this point
        // onward, cleanup may close our old descriptor but must never inspect,
        // restore, delete, or otherwise mutate the current lock pathname.
        retainLockForRecovery = true;
      }
      throw error;
    }
  };

  try {
    // Re-check the complete ancestor chain after lock acquisition. This
    // closes the practical junction/symlink replacement window between the
    // initial validation and opening the same-directory partial file.
    assertSafeDownloadPath(outputPath, "output path", true);
    assertSafeFileOrMissing(outputPath, "output path");
    assertSafeDownloadPath(partialPath, "partial download path", true);
    let response;
    try {
      response = await awaitBeforeDeadline(
        fetchImpl(url, {
          headers: { Accept: "*/*" },
          signal: abortController.signal,
        }),
        { deadline, abortController, label: "artifact response" },
      );
    } catch (err) {
      if (err instanceof DownloadError) throw err;
      throw new DownloadError(
        `fetch failed: ${err.message}`,
        err?.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR",
      );
    }
    if (!response.ok) {
      throw new DownloadError(
        `artifact fetch failed: HTTP ${response.status}`,
        "FETCH_FAILED",
      );
    }

    const totalRaw = response.headers?.get?.("content-length");
    const total = totalRaw ? Number(totalRaw) : null;
    const body = response.body;
    if (!body) {
      throw new DownloadError(
        "response has no body stream (fetch impl returned no body)",
        "NO_BODY",
      );
    }

    // Network I/O can take arbitrarily long. Revalidate after the response is
    // available and immediately before opening the lexical partial path.
    assertSafeDownloadPath(outputPath, "output path", true);
    assertSafeFileOrMissing(outputPath, "output path");
    assertSafeDownloadPath(partialPath, "partial download path", true);

    const hasher = crypto.createHash("sha256");
    let bytes = 0;

    try {
      // Keep a read/write descriptor open through the rename. The pathname can
      // be exchanged by another same-user process even while the download lock
      // is held; descriptor/path identity checks on both sides of the commit
      // bind the verified bytes to the file that actually becomes outputPath.
      partialFd = fs.openSync(partialPath, "wx+", 0o600);
      partialIdentity = snapshotDescriptorIdentity(partialFd);
      const iterator = body[Symbol.asyncIterator]();
      while (true) {
        const { value: chunk, done } = await awaitBeforeDeadline(
          iterator.next(),
          { deadline, abortController, label: "artifact body" },
        );
        if (done) break;
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        hasher.update(buf);
        bytes += buf.length;
        writeAllSync(partialFd, buf);
        if (typeof onProgress === "function") {
          try {
            onProgress({ bytes, total: Number.isFinite(total) ? total : null });
          } catch {
            /* progress callback errors must not interrupt the download */
          }
        }
      }
      fs.fsyncSync(partialFd);
    } catch (err) {
      if (partialFd !== null) {
        try {
          fs.closeSync(partialFd);
        } catch {
          /* best effort */
        }
        partialFd = null;
      }
      if (err instanceof DownloadError) throw err;
      throw new DownloadError(`stream aborted: ${err.message}`, "STREAM_ERROR");
    }

    const actualSha = hasher.digest("hex");
    if (actualSha !== sha256.toLowerCase()) {
      throw new DownloadError(
        `SHA-256 mismatch: expected ${sha256}, got ${actualSha}`,
        "SHA_MISMATCH",
      );
    }

    assertPathMatchesDescriptor(
      partialPath,
      partialFd,
      "verified partial download",
    );
    if (sha256Descriptor(partialFd) !== actualSha) {
      throw new DownloadError(
        "partial download bytes changed after streaming verification",
        "PARTIAL_CHANGED",
      );
    }

    // Re-check immediately before the commit point. renameSync atomically
    // replaces an existing regular file; there is deliberately no unlink gap.
    assertSafeFileOrMissing(outputPath, "output path");
    assertOwnedDownloadLock();
    previousOutput = snapshotExistingOutput(outputPath);
    try {
      assertPathMatchesDescriptor(
        partialPath,
        partialFd,
        "verified partial download",
      );
      assertOutputMatchesSnapshotForCommit(outputPath, previousOutput);
      // Snapshotting and hashing the previous output can take long enough for
      // lock ownership to change. Keep the final ownership check adjacent to
      // the commit point so a lock already known to be foreign is never
      // followed by an output mutation.
      assertOwnedDownloadLock();
      fs.renameSync(partialPath, outputPath);
      committedPath = true;
      assertOwnedDownloadLock();
      assertPathMatchesDescriptor(outputPath, partialFd, "committed download");
      if (sha256Descriptor(partialFd) !== actualSha) {
        throw new DownloadError(
          "committed download bytes changed before final verification",
          "COMMIT_CHANGED",
        );
      }
      fsyncDirectory(path.dirname(outputPath));
      assertOwnedDownloadLock();
      if (previousOutput) {
        discardPreviousOutputSnapshot(previousOutput);
        previousOutput = null;
      }
    } catch (err) {
      let recoveryError = null;
      let manualRecoveryError = null;
      if (err instanceof DownloadError && err.code === "DOWNLOAD_LOCK_LOST") {
        if (previousOutput) previousOutput.retained = true;
        retainLockForRecovery = true;
        if (committedPath) {
          throw createOutputRecoveryRequiredError({
            cause: err,
            outputPath,
            snapshot: previousOutput,
          });
        }
        throw err;
      }
      if (!committedPath && err?.retainDownloadLock === true) {
        if (previousOutput) previousOutput.retained = true;
        retainLockForRecovery = true;
        throw err;
      }
      if (
        committedPath &&
        err?.code === "OUTPUT_RECOVERY_CLEANUP_SYNC_FAILED" &&
        err?.recoveryArtifactRemoved === true
      ) {
        // The verified output is committed and the recovery name is gone in
        // the live namespace, but the unlink could not be made durable. There
        // is no safe rollback source anymore, so preserve the output and lock.
        previousOutput = null;
        retainLockForRecovery = true;
        throw err;
      }
      if (committedPath) {
        if (previousOutput) {
          try {
            assertOwnedDownloadLock();
            const committedOutput = snapshotOpenFile(
              outputPath,
              partialFd,
              "committed download before recovery",
            );
            fs.closeSync(partialFd);
            partialFd = null;
            restorePreviousOutput({
              snapshot: previousOutput,
              outputPath,
              committedOutput,
              assertLockOwned: assertOwnedDownloadLock,
            });
            previousOutput = null;
            committedPath = false;
          } catch (restoreError) {
            retainLockForRecovery = true;
            if (restoreError?.code === "DOWNLOAD_LOCK_LOST") {
              previousOutput.retained = true;
              manualRecoveryError = createOutputRecoveryRequiredError({
                cause: restoreError,
                outputPath,
                snapshot: previousOutput,
              });
            } else if (
              restoreError?.code === "OUTPUT_RECOVERY_CLEANUP_SYNC_FAILED" &&
              restoreError?.recoveryArtifactRemoved === true &&
              restoreError?.outputRestored === true
            ) {
              previousOutput = null;
              committedPath = false;
              recoveryError = restoreError;
            } else {
              previousOutput.retained = true;
              recoveryError = restoreError;
            }
          }
        } else {
          let lockStillOwned = false;
          let lockOwnershipError = null;
          try {
            assertOwnedDownloadLock();
            lockStillOwned = true;
          } catch (error) {
            lockOwnershipError = error;
          }
          if (lockOwnershipError?.code === "DOWNLOAD_LOCK_LOST") {
            manualRecoveryError = createOutputRecoveryRequiredError({
              cause: lockOwnershipError,
              outputPath,
              snapshot: null,
            });
          } else if (lockStillOwned) {
            removeRegularFileIfPresent(outputPath);
          } else {
            removePathIfMatchesDescriptor(outputPath, partialFd);
          }
        }
      }
      if (manualRecoveryError) throw manualRecoveryError;
      if (!committedPath && previousOutput && !previousOutput.retained) {
        try {
          discardPreviousOutputSnapshot(previousOutput);
          previousOutput = null;
        } catch (cleanupError) {
          retainLockForRecovery = true;
          if (cleanupError?.recoveryArtifactRemoved === true) {
            previousOutput = null;
          } else {
            previousOutput.retained = true;
          }
          recoveryError ||= cleanupError;
        }
      }
      if (recoveryError) {
        if (
          recoveryError?.code === "OUTPUT_RECOVERY_CLEANUP_SYNC_FAILED" &&
          recoveryError?.recoveryArtifactRemoved === true
        ) {
          throw recoveryError;
        }
        throw new DownloadError(
          `could not restore the previous output after commit failure (${err.code || err.message}): ${recoveryError.message}; recovery artifact retained at ${previousOutput?.recoveryPath || "unknown"}`,
          "OUTPUT_RECOVERY_FAILED",
        );
      }
      if (err instanceof DownloadError && err.code === "DOWNLOAD_LOCK_LOST") {
        throw err;
      }
      throw new DownloadError(
        `could not commit verified artifact: ${err.message}`,
        "FINALIZE_FAILED",
      );
    }

    try {
      fs.closeSync(partialFd);
    } catch {
      /* committed bytes and transaction state are already verified */
    }
    partialFd = null;
    return { outputPath, bytes, sha256: actualSha };
  } catch (error) {
    if (
      error?.code === "DOWNLOAD_LOCK_LOST" ||
      error?.retainDownloadLock === true
    ) {
      retainLockForRecovery = true;
    }
    throw error;
  } finally {
    if (partialFd !== null) {
      try {
        fs.closeSync(partialFd);
      } catch {
        /* best effort */
      }
    }
    if (!committedPath && partialIdentity) {
      removePathIfMatchesIdentity(partialPath, partialIdentity);
    }
    if (retainLockForRecovery) retainLock(lock);
    else releaseLock(lock);
  }
}

async function awaitBeforeDeadline(
  promise,
  { deadline, abortController, label },
) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    abortController.abort();
    throw new DownloadError(`${label} timed out`, "TIMEOUT");
  }
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          abortController.abort();
          reject(new DownloadError(`${label} timed out`, "TIMEOUT"));
        }, remaining);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function assertPathMatchesDescriptor(filePath, fd, label) {
  let descriptorStat;
  try {
    descriptorStat = fs.fstatSync(fd, { bigint: true });
  } catch (error) {
    throw new DownloadError(
      `${label} identity could not be verified: ${error.message}`,
      "PARTIAL_REPLACED",
    );
  }
  if (!pathMatchesOpenedFileIdentitySync(filePath, descriptorStat)) {
    throw new DownloadError(
      `${label} pathname no longer identifies the verified file`,
      "PARTIAL_REPLACED",
    );
  }
}

function removePathIfMatchesDescriptor(filePath, fd) {
  try {
    const descriptorStat = fs.fstatSync(fd, { bigint: true });
    if (pathMatchesOpenedFileIdentitySync(filePath, descriptorStat)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch {
    /* a missing or exchanged pathname must not be removed */
  }
  return false;
}

function snapshotDescriptorIdentity(fd) {
  const stat = fs.fstatSync(fd, { bigint: true });
  if (!stat.isFile() || !hasPreciseFileIdentity(stat)) {
    throw new DownloadError(
      "partial download descriptor has no stable file identity",
      "PARTIAL_REPLACED",
    );
  }
  return { dev: stat.dev, ino: stat.ino };
}

function removePathIfMatchesIdentity(filePath, identity) {
  try {
    if (pathMatchesOpenedFileIdentitySync(filePath, identity)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch {
    /* a missing or exchanged pathname must not be removed */
  }
  return false;
}

function createOutputRecoveryRequiredError({ cause, outputPath, snapshot }) {
  const recoveryPath = snapshot?.recoveryPath || null;
  const retained = recoveryPath
    ? `the verified previous output is retained at ${recoveryPath}`
    : "no previous output snapshot exists";
  const error = new DownloadError(
    `download lock ownership was lost after the output commit (${cause?.message || "unknown"}); ${outputPath} was left untouched and ${retained}; inspect the output and recovery artifact manually`,
    "OUTPUT_RECOVERY_REQUIRED",
  );
  error.recoveryPath = recoveryPath;
  error.retainDownloadLock = true;
  return error;
}

function createRecoveryCleanupSyncError(recoveryPath, cause) {
  const error = new DownloadError(
    `the recovery artifact was removed but its directory entry could not be synchronized (${cause?.message || "unknown"}); inspect ${path.dirname(recoveryPath)} before retrying`,
    "OUTPUT_RECOVERY_CLEANUP_SYNC_FAILED",
  );
  error.recoveryPath = recoveryPath;
  error.recoveryArtifactRemoved = true;
  error.retainDownloadLock = true;
  return error;
}

function createSnapshotRecoveryRequiredError(recoveryPath, cause) {
  const retained = recoveryPath
    ? `a recovery artifact was retained at ${recoveryPath}`
    : "no verified recovery artifact exists";
  const error = new DownloadError(
    `the existing output changed while its recovery snapshot was being created (${cause?.code || cause?.message || "unknown"}); ${retained} and the download lock was retained for manual inspection`,
    "OUTPUT_SNAPSHOT_RECOVERY_REQUIRED",
  );
  error.recoveryPath = recoveryPath;
  error.retainDownloadLock = true;
  return error;
}

function snapshotExistingOutput(outputPath) {
  if (!lstatOrNull(outputPath)) return null;

  const recoveryPath = `${outputPath}.recovery-${process.pid}-${crypto.randomUUID()}`;
  assertSafeDownloadPath(recoveryPath, "output recovery path", true);
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  let fd = null;
  let linked = false;
  let snapshot = null;
  try {
    fd = fs.openSync(outputPath, fs.constants.O_RDONLY | noFollow);
    const recorded = snapshotOpenFile(outputPath, fd, "existing output");
    snapshot = {
      recoveryPath,
      ...recorded,
      retained: false,
    };
    fs.closeSync(fd);
    fd = null;

    // Windows cannot replace a pathname while the old inode has an open
    // handle. Close the verifier first, then bind a sibling hard link to the
    // recorded inode and re-open both names to close the exchange window.
    fs.linkSync(outputPath, recoveryPath);
    linked = true;
    try {
      assertPathMatchesSnapshot(outputPath, snapshot, "existing output");
      assertPathMatchesSnapshot(
        recoveryPath,
        snapshot,
        "existing output recovery snapshot",
      );
    } catch (validationError) {
      snapshot.retained = true;
      throw createSnapshotRecoveryRequiredError(recoveryPath, validationError);
    }
    fsyncDirectory(path.dirname(outputPath));
    return snapshot;
  } catch (error) {
    let cleanupError = null;
    if (error?.code === "OUTPUT_SNAPSHOT_RECOVERY_REQUIRED") {
      cleanupError = error;
    } else if (linked && snapshot) {
      if (removePathIfMatchesSnapshot(recoveryPath, snapshot)) {
        try {
          fsyncDirectory(path.dirname(recoveryPath));
        } catch (syncError) {
          cleanupError = createRecoveryCleanupSyncError(
            recoveryPath,
            syncError,
          );
        }
      } else {
        cleanupError = createSnapshotRecoveryRequiredError(recoveryPath, error);
      }
    }
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* best effort */
      }
    }
    if (cleanupError) throw cleanupError;
    if (error instanceof DownloadError) throw error;
    throw new DownloadError(
      `could not snapshot the existing output: ${error.message}`,
      "OUTPUT_SNAPSHOT_FAILED",
    );
  }
}

function assertOutputMatchesSnapshotForCommit(outputPath, snapshot) {
  if (!snapshot) {
    if (lstatOrNull(outputPath)) {
      throw createSnapshotRecoveryRequiredError(
        null,
        new DownloadError(
          "output appeared after the no-output snapshot",
          "OUTPUT_RECOVERY_CHANGED",
        ),
      );
    }
    return;
  }

  try {
    assertPathMatchesSnapshot(
      outputPath,
      snapshot,
      "existing output before commit",
    );
  } catch (error) {
    snapshot.retained = true;
    throw createSnapshotRecoveryRequiredError(snapshot.recoveryPath, error);
  }
}

function snapshotOpenFile(filePath, fd, label) {
  assertPathMatchesDescriptor(filePath, fd, label);
  const before = fs.fstatSync(fd, { bigint: true });
  const sha256 = sha256Descriptor(fd);
  const after = fs.fstatSync(fd, { bigint: true });
  if (!sameSnapshotState(before, after)) {
    throw new DownloadError(
      `${label} changed while it was being hashed`,
      "OUTPUT_RECOVERY_CHANGED",
    );
  }
  assertPathMatchesDescriptor(filePath, fd, label);
  return {
    sha256,
    dev: after.dev,
    ino: after.ino,
    size: after.size,
    mode: after.mode,
    mtimeNs: after.mtimeNs,
  };
}

function sameSnapshotState(first, second) {
  return (
    first.isFile() &&
    second.isFile() &&
    sameOpenedFileIdentity(first, second, ["size", "mode", "mtimeNs"])
  );
}

function assertPreviousOutputSnapshot(snapshot) {
  assertPathMatchesSnapshot(
    snapshot.recoveryPath,
    snapshot,
    "existing output recovery snapshot",
  );
}

function restorePreviousOutput({
  snapshot,
  outputPath,
  committedOutput,
  assertLockOwned,
}) {
  const restorePath = `${outputPath}.restore-${process.pid}-${crypto.randomUUID()}`;
  assertSafeDownloadPath(restorePath, "output restore path", true);
  try {
    assertLockOwned();
    assertPathMatchesSnapshot(
      outputPath,
      committedOutput,
      "committed download before recovery",
    );
    assertPreviousOutputSnapshot(snapshot);
    fs.linkSync(snapshot.recoveryPath, restorePath);
    assertPathMatchesSnapshot(
      restorePath,
      snapshot,
      "output restore candidate",
    );
    assertPathMatchesSnapshot(
      outputPath,
      committedOutput,
      "committed download before recovery",
    );
    assertLockOwned();
    fs.renameSync(restorePath, outputPath);
    assertPathMatchesSnapshot(outputPath, snapshot, "restored previous output");
    fsyncDirectory(path.dirname(outputPath));
    try {
      discardPreviousOutputSnapshot(snapshot);
    } catch (error) {
      if (error?.recoveryArtifactRemoved === true) {
        error.outputRestored = true;
      }
      throw error;
    }
  } finally {
    removePathIfMatchesSnapshot(restorePath, snapshot);
  }
}

function discardPreviousOutputSnapshot(snapshot) {
  assertPathMatchesSnapshot(
    snapshot.recoveryPath,
    snapshot,
    "existing output recovery snapshot",
  );
  if (!removePathIfMatchesSnapshot(snapshot.recoveryPath, snapshot)) {
    throw new DownloadError(
      "existing output recovery snapshot could not be removed safely",
      "OUTPUT_RECOVERY_CLEANUP_FAILED",
    );
  }
  try {
    fsyncDirectory(path.dirname(snapshot.recoveryPath));
  } catch (error) {
    throw createRecoveryCleanupSyncError(snapshot.recoveryPath, error);
  }
}

function assertPathMatchesSnapshot(filePath, snapshot, label) {
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  let fd = null;
  try {
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
    assertPathMatchesDescriptor(filePath, fd, label);
    const before = fs.fstatSync(fd, { bigint: true });
    const sha256 = sha256Descriptor(fd);
    const after = fs.fstatSync(fd, { bigint: true });
    if (
      !sameSnapshotState(before, after) ||
      after.dev !== snapshot.dev ||
      after.ino !== snapshot.ino ||
      after.size !== snapshot.size ||
      after.mode !== snapshot.mode ||
      after.mtimeNs !== snapshot.mtimeNs ||
      sha256 !== snapshot.sha256
    ) {
      throw new DownloadError(
        `${label} changed before it could be used safely`,
        "OUTPUT_RECOVERY_CHANGED",
      );
    }
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function removePathIfMatchesSnapshot(filePath, snapshot) {
  try {
    assertPathMatchesSnapshot(filePath, snapshot, "output recovery artifact");
    if (pathMatchesOpenedFileIdentitySync(filePath, snapshot)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch {
    /* exchanged or missing recovery paths are retained */
  }
  return false;
}

function sha256Descriptor(fd) {
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  while (true) {
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest("hex");
}

function writeAllSync(fd, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    offset += fs.writeSync(fd, buffer, offset, buffer.length - offset);
  }
}

function lstatOrNull(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

function assertSafeFileOrMissing(filePath, label) {
  try {
    assertStateSafeRegularFile(filePath, {
      label,
      allowMissingLeaf: true,
    });
  } catch (error) {
    throw new DownloadError(error.message, "UNSAFE_PATH");
  }
}

function assertSafeDownloadPath(filePath, label, allowMissingLeaf) {
  try {
    assertSafePathAncestors(filePath, { label, allowMissingLeaf });
  } catch (error) {
    throw new DownloadError(error.message, "UNSAFE_PATH");
  }
}

function acquireLock(lockPath) {
  assertSafeDownloadPath(lockPath, "download lock", true);
  const existing = lstatOrNull(lockPath);
  if (existing?.isSymbolicLink() || (existing && !existing.isFile())) {
    throw new DownloadError(
      `download lock is not a regular file: ${lockPath}`,
      "UNSAFE_PATH",
    );
  }

  const token = `${process.pid}:${crypto.randomUUID()}`;
  let fd;
  try {
    fd = fs.openSync(lockPath, "wx+", 0o600);
  } catch (err) {
    if (err?.code === "EEXIST") {
      throw new DownloadError(
        `another download is already using ${outputFromLock(lockPath)}`,
        "DOWNLOAD_LOCKED",
      );
    }
    throw new DownloadError(
      `could not acquire download lock: ${err.message}`,
      "LOCK_FAILED",
    );
  }

  try {
    fs.writeFileSync(fd, token, { encoding: "utf8" });
    fs.fsyncSync(fd);
  } catch (err) {
    releaseLock({ fd, lockPath, token });
    throw new DownloadError(
      `could not initialize download lock: ${err.message}`,
      "LOCK_FAILED",
    );
  }
  return { fd, lockPath, token };
}

function assertDownloadLockOwned(lock) {
  try {
    const before = fs.fstatSync(lock.fd, { bigint: true });
    const pathOwnedBefore = pathMatchesOpenedFileIdentitySync(
      lock.lockPath,
      before,
      { stateFields: ["size", "mtimeNs", "ctimeNs"] },
    );
    const expected = Buffer.from(lock.token, "utf8");
    const actual = Buffer.alloc(expected.length + 1);
    const bytesRead = fs.readSync(lock.fd, actual, 0, actual.length, 0);
    const after = fs.fstatSync(lock.fd, { bigint: true });
    const pathOwnedAfter = pathMatchesOpenedFileIdentitySync(
      lock.lockPath,
      after,
      { stateFields: ["size", "mtimeNs", "ctimeNs"] },
    );
    const descriptorStable =
      before.isFile() &&
      after.isFile() &&
      before.nlink > 0n &&
      after.nlink > 0n &&
      sameOpenedFileIdentity(before, after, ["size", "mtimeNs", "ctimeNs"]);
    const pathStillOwned = pathOwnedBefore && pathOwnedAfter;
    const tokenMatches =
      bytesRead === expected.length &&
      actual.subarray(0, bytesRead).equals(expected);
    if (!descriptorStable || !pathStillOwned || !tokenMatches) {
      throw new Error("lock pathname, descriptor, or token changed");
    }
  } catch (error) {
    throw new DownloadError(
      `download lock ownership was lost: ${error.message}`,
      "DOWNLOAD_LOCK_LOST",
    );
  }
}

function outputFromLock(lockPath) {
  return lockPath.endsWith(".lock") ? lockPath.slice(0, -5) : lockPath;
}

function releaseLock(lock) {
  if (!lock) return;
  closeLockHandle(lock);
  try {
    const stat = fs.lstatSync(lock.lockPath);
    if (stat.isSymbolicLink() || !stat.isFile()) return;
    if (fs.readFileSync(lock.lockPath, "utf8") === lock.token) {
      fs.unlinkSync(lock.lockPath);
    }
  } catch {
    /* best effort; a stale lock fails closed on the next attempt */
  }
}

function retainLock(lock) {
  closeLockHandle(lock);
}

function closeLockHandle(lock) {
  if (!lock || lock.fd === null) return;
  try {
    fs.closeSync(lock.fd);
  } catch {
    /* best effort */
  }
  lock.fd = null;
}

function removeRegularFileIfPresent(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isFile() && !stat.isSymbolicLink()) fs.unlinkSync(filePath);
  } catch {
    /* missing or unsafe paths are intentionally left alone */
  }
}

function fsyncDirectory(directoryPath) {
  let fd;
  try {
    fd = fs.openSync(directoryPath, "r");
    fs.fsyncSync(fd);
  } catch (err) {
    // Windows and a few filesystems do not expose directory fsync. The file
    // itself was already fsynced, so only ignore known unsupported cases.
    if (!["EACCES", "EBADF", "EINVAL", "EISDIR", "EPERM"].includes(err?.code)) {
      throw err;
    }
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* best effort */
      }
    }
  }
}

/** Typed error with a stable, machine-readable code. */
export class DownloadError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "DownloadError";
    this.code = code;
  }
}
