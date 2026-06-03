/**
 * file-lock — tiny advisory cross-process lockfile for one-shot DB operations
 * (plaintext→encrypted migration, legacy rekey). Prevents two app instances /
 * parallel sessions from running the same destructive op on the same DB file.
 *
 * Exclusive-create (`wx`) semantics; a lock left by a crashed process is
 * reclaimed after STALE_LOCK_MS. Not a general-purpose mutex — only safe for
 * the short, idempotent-on-retry DB operations it guards.
 *
 * @module database/file-lock
 */

const realFs = require("fs");
const { logger } = require("../utils/logger.js");

const STALE_LOCK_MS = 10 * 60 * 1000; // 10 min

/**
 * @returns {boolean} true iff the lock was acquired.
 */
function acquireLock(lockPath, fs = realFs, now = () => Date.now()) {
  try {
    const fd = fs.openSync(lockPath, "wx"); // exclusive create; throws EEXIST if held
    try {
      fs.writeSync(fd, String(now()));
    } finally {
      fs.closeSync(fd);
    }
    return true;
  } catch (err) {
    if (err.code !== "EEXIST") {
      throw err;
    }
    // Lock held — reclaim if stale.
    try {
      const stat = fs.statSync(lockPath);
      const age = now() - stat.mtimeMs;
      if (age > STALE_LOCK_MS) {
        logger.warn(
          `[file-lock] 回收陈旧锁 (age=${Math.round(age / 1000)}s):`,
          lockPath,
        );
        fs.unlinkSync(lockPath);
        const fd = fs.openSync(lockPath, "wx");
        fs.closeSync(fd);
        return true;
      }
    } catch (_e) {
      // Another process likely handled it; treat as locked.
    }
    return false;
  }
}

function releaseLock(lockPath, fs = realFs) {
  try {
    fs.unlinkSync(lockPath);
  } catch (_e) {
    /* already gone */
  }
}

module.exports = { acquireLock, releaseLock, STALE_LOCK_MS };
