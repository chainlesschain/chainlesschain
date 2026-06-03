/**
 * legacy-rekey — rekey a legacy `.encrypted("123456")` DB onto a safeStorage-
 * managed random passphrase (Phase 2). In-place SQLCipher `PRAGMA rekey`, the
 * single most dangerous DB op here, so it is wrapped with: a lock, a pre-rekey
 * backup, an old-key open-check, a new-key reopen verify, and rollback.
 *
 * Crash-safety / commit ordering (the subtle part — to open a rekeyed DB you need
 * BOTH the managed passphrase AND the new salt, neither of which can be written
 * atomically with the re-encryption):
 *
 *   1. backup `.rekey-bak`  (data-identical, openable with the OLD "123456" key)
 *   2. rekey in place to newKey, verify reopen with newKey
 *   3. persist managed passphrase (db-secret.enc)
 *   4. persist new salt (metadata)
 *   5. ONLY NOW delete the backup  ← commit point
 *
 * If the process dies before step 5, `.rekey-bak` survives and recoverInterrupted
 * Rekey() at next boot decides: target opens with managed key (steps 3+4 done) →
 * delete stale backup; otherwise → restore backup + clear the managed secret,
 * reverting cleanly to the legacy state so the rekey can be retried. Either way
 * no data is lost (rekey never changes data, only the encryption key).
 *
 * Gated OFF by default (db-encryption-flag.isDbRekeyOptIn) — dormant until both
 * encryption is on AND rekey is explicitly opted in, then verified on a real
 * device (see docs/internal/db-encryption-phase1-realdevice-smoke.md §Phase 2).
 *
 * @module database/legacy-rekey
 */

const realFs = require("fs");
const { logger } = require("../utils/logger.js");
const { acquireLock, releaseLock } = require("./file-lock");

function _createEncryptedDatabase(deps) {
  return (
    deps.createEncryptedDatabase ||
    require("./sqlcipher-wrapper").createEncryptedDatabase
  );
}

/** Open `path` with `key` and run a sanity query (throws if key is wrong). */
function verifyOpen(path, key, createEncryptedDatabase) {
  let db;
  try {
    db = createEncryptedDatabase(path, key);
    db.open();
    const stmt = db.prepare("SELECT count(*) AS c FROM sqlite_master");
    stmt.get();
    if (stmt.free) {
      stmt.free();
    }
    return true;
  } finally {
    try {
      if (db) {
        db.close();
      }
    } catch (_e) {
      /* ignore */
    }
  }
}

/**
 * Core in-place rekey with backup + verify + rollback. On success the backup at
 * `<path>.rekey-bak` is RETAINED and its path returned — the caller must delete
 * it only after committing the managed secret + salt (see module doc).
 *
 * @returns {Promise<{success:boolean, skipped?:boolean, reason?:string, backupPath?:string}>}
 */
async function rekeyEncryptedDb(
  { encryptedDbPath, oldKey, newKey },
  deps = {},
) {
  const fs = deps.fs || realFs;
  const now = deps.now || (() => Date.now());
  const createEncryptedDatabase = _createEncryptedDatabase(deps);
  const lockPath = `${encryptedDbPath}.rekeying.lock`;
  const backupPath = `${encryptedDbPath}.rekey-bak`;

  if (!acquireLock(lockPath, fs, now)) {
    logger.warn("[legacy-rekey] 另一进程正在 rekey，跳过本次");
    return { success: false, skipped: true, reason: "locked" };
  }

  let backedUp = false;
  try {
    // 1. backup (pre-rekey state, still openable with oldKey)
    fs.copyFileSync(encryptedDbPath, backupPath);
    backedUp = true;

    // 2. open with oldKey (verifies the legacy key) then rekey in place
    const db = createEncryptedDatabase(encryptedDbPath, oldKey);
    db.open();
    try {
      db.prepare("SELECT count(*) AS c FROM sqlite_master").get(); // throws if oldKey wrong
      if (typeof db.rekey !== "function") {
        throw new Error("数据库实例不支持 rekey");
      }
      db.rekey(newKey);
    } finally {
      try {
        db.close();
      } catch (_e) {
        /* ignore */
      }
    }

    // 3. verify the rekeyed file opens fresh with newKey
    verifyOpen(encryptedDbPath, newKey, createEncryptedDatabase);

    logger.info("[legacy-rekey] rekey + 重开校验通过（备份保留待提交）");
    return { success: true, backupPath };
  } catch (err) {
    logger.error("[legacy-rekey] rekey 失败，回滚:", err.message);
    try {
      if (backedUp && fs.existsSync(backupPath)) {
        if (fs.existsSync(encryptedDbPath)) {
          fs.unlinkSync(encryptedDbPath);
        }
        fs.renameSync(backupPath, encryptedDbPath); // restore legacy DB
        logger.warn("[legacy-rekey] 已从备份恢复 legacy 加密库");
      }
    } catch (rbErr) {
      logger.error("[legacy-rekey] 回滚失败（备份仍在）:", rbErr.message);
    }
    throw err;
  } finally {
    releaseLock(lockPath, fs);
  }
}

/**
 * Orchestrate legacy→managed rekey: mint a managed passphrase, derive old/new
 * keys, rekey, then commit (persist secret, persist salt, drop backup).
 *
 * @param {Object} args
 * @param {string} args.encryptedDbPath
 * @param {string} args.legacyPassword - the old passphrase ("123456")
 * @param {Object} deps - { provider, deriveKey, loadMetadata, saveMetadata, fs, createEncryptedDatabase, rekeyEncryptedDb? }
 *   deriveKey(password, saltHexOrNull) -> Promise<{key, salt}>
 * @returns {Promise<{success:boolean, skipped?:boolean, reason?:string}>}
 */
async function rekeyLegacyDbToManaged(
  { encryptedDbPath, legacyPassword },
  deps = {},
) {
  const fs = deps.fs || realFs;
  const { provider, deriveKey, loadMetadata, saveMetadata } = deps;

  if (!provider || !provider.isAvailable()) {
    logger.warn("[legacy-rekey] safeStorage 不可用，跳过 rekey（保持 legacy）");
    return { success: false, skipped: true, reason: "no-safestorage" };
  }

  const meta = await loadMetadata();
  const oldSalt = meta && meta.salt;
  if (!oldSalt) {
    logger.warn("[legacy-rekey] 元数据缺少 legacy salt，无法派生旧 key，跳过");
    return { success: false, skipped: true, reason: "no-legacy-salt" };
  }

  const managed = provider.mintPassphrase(); // not persisted yet
  const oldKey = (await deriveKey(legacyPassword, oldSalt)).key;
  const derivedNew = await deriveKey(managed, null); // fresh salt

  const rekeyFn = deps.rekeyEncryptedDb || rekeyEncryptedDb;
  const res = await rekeyFn(
    { encryptedDbPath, oldKey, newKey: derivedNew.key },
    deps,
  );
  if (!res || res.skipped) {
    return res || { success: false, skipped: true, reason: "rekey-skipped" };
  }

  // Commit: secret → salt → drop backup. (Recovery handles a crash mid-commit.)
  provider.persistPassphrase(managed);
  await saveMetadata({
    method: "password",
    salt: derivedNew.salt,
    encryptionEnabled: true,
  });
  try {
    if (res.backupPath && fs.existsSync(res.backupPath)) {
      fs.unlinkSync(res.backupPath);
    }
  } catch (_e) {
    /* stale backup; recovery will reconcile */
  }

  logger.info("[legacy-rekey] legacy→managed rekey 完成并提交");
  return { success: true };
}

/**
 * Boot recovery for a rekey interrupted before commit. If `<path>.rekey-bak`
 * exists: if the target already opens with the managed key (commit finished),
 * drop the stale backup; otherwise restore the backup and clear the managed
 * secret, reverting to the legacy state for a clean retry.
 *
 * @param {Object} args - { encryptedDbPath, managedKeyResolver }
 *   managedKeyResolver() -> Promise<string|null> hex key, or null if no managed secret yet
 * @param {Object} deps - { fs, createEncryptedDatabase, provider }
 * @returns {Promise<{recovered:boolean, action?:string}>}
 */
async function recoverInterruptedRekey(
  { encryptedDbPath, managedKeyResolver },
  deps = {},
) {
  const fs = deps.fs || realFs;
  const createEncryptedDatabase = _createEncryptedDatabase(deps);
  const backupPath = `${encryptedDbPath}.rekey-bak`;

  if (!fs.existsSync(backupPath)) {
    return { recovered: false };
  }

  // Does the target already open with the managed key? -> commit finished.
  let managedKey = null;
  try {
    managedKey = managedKeyResolver ? await managedKeyResolver() : null;
  } catch (_e) {
    managedKey = null;
  }

  if (managedKey) {
    try {
      verifyOpen(encryptedDbPath, managedKey, createEncryptedDatabase);
      // Commit had finished; just drop the stale backup.
      fs.unlinkSync(backupPath);
      logger.info("[legacy-rekey] 恢复：rekey 已提交，清理陈旧备份");
      return { recovered: true, action: "drop-stale-backup" };
    } catch (_e) {
      /* managed key doesn't open target → commit incomplete, fall through */
    }
  }

  // Commit incomplete → restore the legacy backup, revert to pre-rekey state.
  try {
    if (fs.existsSync(encryptedDbPath)) {
      fs.unlinkSync(encryptedDbPath);
    }
    fs.renameSync(backupPath, encryptedDbPath);
    logger.warn("[legacy-rekey] 恢复：rekey 未提交，已回滚到 legacy 加密库");
    return { recovered: true, action: "restored-legacy" };
  } catch (err) {
    logger.error("[legacy-rekey] 恢复失败:", err.message);
    return { recovered: false, action: "restore-failed" };
  }
}

module.exports = {
  rekeyEncryptedDb,
  rekeyLegacyDbToManaged,
  recoverInterruptedRekey,
};
