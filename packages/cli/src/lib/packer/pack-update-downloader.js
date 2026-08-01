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
  let committedPath = false;

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
    assertDownloadLockOwned(lock);
    try {
      assertPathMatchesDescriptor(
        partialPath,
        partialFd,
        "verified partial download",
      );
      fs.renameSync(partialPath, outputPath);
      committedPath = true;
      assertDownloadLockOwned(lock);
      assertPathMatchesDescriptor(outputPath, partialFd, "committed download");
      if (sha256Descriptor(partialFd) !== actualSha) {
        throw new DownloadError(
          "committed download bytes changed before final verification",
          "COMMIT_CHANGED",
        );
      }
      fsyncDirectory(path.dirname(outputPath));
      assertDownloadLockOwned(lock);
    } catch (err) {
      if (committedPath) {
        let lockStillOwned = false;
        try {
          assertDownloadLockOwned(lock);
          lockStillOwned = true;
        } catch {
          /* preserve any pathname now owned by a replacement lock holder */
        }
        if (lockStillOwned) {
          removeRegularFileIfPresent(outputPath);
        } else {
          removePathIfMatchesDescriptor(outputPath, partialFd);
        }
      }
      if (err instanceof DownloadError && err.code === "DOWNLOAD_LOCK_LOST") {
        throw err;
      }
      throw new DownloadError(
        `could not commit verified artifact: ${err.message}`,
        "FINALIZE_FAILED",
      );
    }

    fs.closeSync(partialFd);
    partialFd = null;

    return { outputPath, bytes, sha256: actualSha };
  } finally {
    if (partialFd !== null) {
      try {
        fs.closeSync(partialFd);
      } catch {
        /* best effort */
      }
    }
    removeRegularFileIfPresent(partialPath);
    releaseLock(lock);
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
  let pathStat;
  try {
    descriptorStat = fs.fstatSync(fd, { bigint: true });
    pathStat = fs.lstatSync(filePath, { bigint: true });
  } catch (error) {
    throw new DownloadError(
      `${label} identity could not be verified: ${error.message}`,
      "PARTIAL_REPLACED",
    );
  }
  if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
    throw new DownloadError(
      `${label} is no longer a regular file`,
      "PARTIAL_REPLACED",
    );
  }
  if (
    descriptorStat.dev !== pathStat.dev ||
    descriptorStat.ino !== pathStat.ino ||
    (descriptorStat.ino === 0n && descriptorStat.dev === 0n)
  ) {
    throw new DownloadError(
      `${label} pathname no longer identifies the verified file`,
      "PARTIAL_REPLACED",
    );
  }
}

function removePathIfMatchesDescriptor(filePath, fd) {
  try {
    const descriptorStat = fs.fstatSync(fd, { bigint: true });
    const pathStat = fs.lstatSync(filePath, { bigint: true });
    if (
      !pathStat.isSymbolicLink() &&
      pathStat.isFile() &&
      !(descriptorStat.ino === 0n && descriptorStat.dev === 0n) &&
      descriptorStat.dev === pathStat.dev &&
      descriptorStat.ino === pathStat.ino
    ) {
      fs.unlinkSync(filePath);
    }
  } catch {
    /* a missing or exchanged pathname must not be removed */
  }
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
    const pathBefore = fs.lstatSync(lock.lockPath, { bigint: true });
    const expected = Buffer.from(lock.token, "utf8");
    const actual = Buffer.alloc(expected.length + 1);
    const bytesRead = fs.readSync(lock.fd, actual, 0, actual.length, 0);
    const after = fs.fstatSync(lock.fd, { bigint: true });
    const pathAfter = fs.lstatSync(lock.lockPath, { bigint: true });
    const descriptorStable =
      before.isFile() &&
      after.isFile() &&
      before.nlink > 0n &&
      after.nlink > 0n &&
      !(before.dev === 0n && before.ino === 0n) &&
      before.dev === after.dev &&
      before.ino === after.ino &&
      before.size === after.size &&
      before.mtimeNs === after.mtimeNs &&
      before.ctimeNs === after.ctimeNs;
    const pathStillOwned =
      !pathBefore.isSymbolicLink() &&
      pathBefore.isFile() &&
      !pathAfter.isSymbolicLink() &&
      pathAfter.isFile() &&
      before.dev === pathBefore.dev &&
      before.ino === pathBefore.ino &&
      after.dev === pathAfter.dev &&
      after.ino === pathAfter.ino &&
      after.size === pathAfter.size &&
      after.mtimeNs === pathAfter.mtimeNs &&
      after.ctimeNs === pathAfter.ctimeNs;
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
  try {
    fs.closeSync(lock.fd);
  } catch {
    /* best effort */
  }
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
