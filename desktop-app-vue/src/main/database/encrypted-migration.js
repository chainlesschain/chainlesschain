/**
 * encrypted-migration — safe wrapper around the plaintext→.encrypted migration.
 *
 * The underlying DatabaseMigrator already: backs up the source, migrates schema
 * + data + indexes, verifies per-table row counts, deletes the partial target on
 * failure, and renames the source to ".old" only AFTER a successful verify (so a
 * failed migration leaves the original plaintext DB intact — no data loss).
 *
 * This wrapper adds the two safety properties Phase 1 needs on top:
 *   1. **Concurrency lock** — a lockfile next to the target prevents two app
 *      instances / parallel sessions from migrating the same DB simultaneously
 *      (which would race on the .encrypted file). Stale locks (crashed mid-run)
 *      are reclaimed after STALE_LOCK_MS.
 *   2. **Reopen-with-key verification** — after migration, the new .encrypted DB
 *      is opened FRESH with the managed key and a sanity query is run, proving
 *      the file is actually decryptable with that key (the in-process row-count
 *      verify alone doesn't prove a clean reopen).
 *
 * Dormant by default: the migration path only runs when DB encryption is opted
 * in (see db-encryption-flag.js), so this wrapper has no effect in the current
 * default-off build.
 *
 * @module database/encrypted-migration
 */

const realFs = require("fs");
const { logger } = require("../utils/logger.js");

const STALE_LOCK_MS = 10 * 60 * 1000; // 10 min

/**
 * @returns {boolean} true iff the lock was acquired.
 */
function acquireLock(lockPath, fs, now) {
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
          `[encrypted-migration] 回收陈旧迁移锁 (age=${Math.round(age / 1000)}s):`,
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

function releaseLock(lockPath, fs) {
  try {
    fs.unlinkSync(lockPath);
  } catch (_e) {
    /* already gone */
  }
}

/**
 * Open the freshly-migrated .encrypted DB with the key and run a sanity query.
 * Throws if the file can't be opened/decrypted with the key.
 */
function verifyReopen(targetPath, key, createEncryptedDatabase) {
  let db;
  try {
    db = createEncryptedDatabase(targetPath, key);
    db.open();
    const stmt = db.prepare("SELECT count(*) AS c FROM sqlite_master");
    // The query itself is the test: a wrong key throws on first read.
    stmt.get();
    if (stmt.free) {
      stmt.free();
    }
  } finally {
    try {
      if (db) {
        db.close();
      }
    } catch (_e) {
      /* ignore close errors */
    }
  }
}

/**
 * Run the plaintext→encrypted migration under a lock with reopen verification.
 *
 * @param {Object} options
 * @param {string} options.sourcePath - plaintext DB path
 * @param {string} options.targetPath - target .encrypted path
 * @param {string} options.encryptionKey - hex key
 * @param {Object} [deps] - injectable deps for testing
 * @returns {Promise<Object>} migration result (may be {skipped:true,...})
 */
async function migratePlaintextToEncrypted(options, deps = {}) {
  const fs = deps.fs || realFs;
  const now = deps.now || (() => Date.now());
  const migrateDatabase =
    deps.migrateDatabase || require("./database-migration").migrateDatabase;
  const createEncryptedDatabase =
    deps.createEncryptedDatabase ||
    require("./sqlcipher-wrapper").createEncryptedDatabase;

  const { sourcePath, targetPath, encryptionKey } = options;
  const lockPath = `${targetPath}.migrating.lock`;

  if (!acquireLock(lockPath, fs, now)) {
    logger.warn("[encrypted-migration] 另一进程正在迁移，跳过本次");
    return { success: false, skipped: true, reason: "locked" };
  }

  try {
    const result = await migrateDatabase({
      sourcePath,
      targetPath,
      encryptionKey,
    });

    // Nothing migrated (no source / target already exists) — no file to verify.
    if (result && result.skipped) {
      return result;
    }

    verifyReopen(targetPath, encryptionKey, createEncryptedDatabase);
    logger.info("[encrypted-migration] 迁移 + 重开校验通过");
    return result;
  } catch (err) {
    // migrateDatabase already removed any partial target and left the source
    // plaintext DB intact; a reopen-verify failure means the target is suspect.
    logger.error("[encrypted-migration] 迁移/校验失败:", err.message);
    try {
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
        logger.warn(
          "[encrypted-migration] 已删除可疑的目标加密库:",
          targetPath,
        );
      }
    } catch (_e) {
      /* best-effort cleanup */
    }
    throw err;
  } finally {
    releaseLock(lockPath, fs);
  }
}

module.exports = {
  migratePlaintextToEncrypted,
  STALE_LOCK_MS,
  // exported for targeted tests
  _acquireLock: acquireLock,
  _releaseLock: releaseLock,
};
