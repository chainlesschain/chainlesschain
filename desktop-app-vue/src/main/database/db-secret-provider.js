/**
 * db-secret-provider — safeStorage-backed master passphrase for the local DB.
 *
 * The desktop SQLite/SQLCipher key is derived via PBKDF2(passphrase, salt) where
 * the salt is persisted in plaintext metadata. Historically the passphrase was a
 * HARD-CODED "123456" (only overridable by env DEFAULT_PASSWORD), i.e. the sole
 * secret lived in public source — anyone with the DB file could re-derive the key.
 *
 * This module supplies a high-entropy RANDOM passphrase instead, persisted to disk
 * encrypted by Electron `safeStorage` (OS keychain: DPAPI on Windows, Keychain on
 * macOS, libsecret/kwallet on Linux). The passphrase plaintext never touches disk;
 * only its safeStorage ciphertext does, bound to the current OS user.
 *
 * Phase 0 scope (see docs/internal/db-master-key-hardening-design.md):
 * this only takes effect when DB encryption is ENABLED. The current packaged build
 * runs the DB unencrypted (NODE_ENV misdetection, design §1.0), so this provider is
 * dormant in production until encryption is turned on — it is groundwork that makes
 * the eventual "enable encryption" step use a managed key from day one rather than
 * "123456".
 *
 * @module database/db-secret-provider
 */

const realFs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { logger } = require("../utils/logger.js");

/**
 * Resolve Electron's safeStorage lazily. Returns null outside an Electron main
 * process (unit tests, headless scripts).
 * @returns {object|null}
 */
function _resolveElectronSafeStorage() {
  try {
    // eslint-disable-next-line global-require
    const electron = require("electron");
    return electron && electron.safeStorage ? electron.safeStorage : null;
  } catch (_err) {
    return null;
  }
}

/**
 * Create a DB secret provider bound to a specific on-disk secret file.
 *
 * @param {Object} options
 * @param {string} options.secretPath - absolute path to store the encrypted passphrase
 * @param {object} [options.fs] - fs impl (for tests); defaults to node fs
 * @param {object|null} [options.safeStorage] - safeStorage impl (for tests); defaults to electron
 * @returns {{
 *   secretPath: string,
 *   isAvailable: () => boolean,
 *   hasManagedPassphrase: () => boolean,
 *   getOrCreateManagedPassphrase: () => string,
 * }}
 */
function createDbSecretProvider(options = {}) {
  const secretPath = options.secretPath;
  const fs = options.fs || realFs;
  const safeStorage =
    options.safeStorage !== undefined
      ? options.safeStorage
      : _resolveElectronSafeStorage();

  /** @returns {boolean} OS keychain usable for encrypt/decrypt. */
  function isAvailable() {
    return !!(
      safeStorage &&
      typeof safeStorage.isEncryptionAvailable === "function" &&
      safeStorage.isEncryptionAvailable()
    );
  }

  /** @returns {boolean} whether a managed passphrase file already exists. */
  function hasManagedPassphrase() {
    if (!secretPath) {
      return false;
    }
    try {
      return fs.existsSync(secretPath);
    } catch (_err) {
      return false;
    }
  }

  /**
   * Mint a high-entropy passphrase WITHOUT persisting it. Used by the rekey flow
   * which must only commit the secret to disk AFTER the DB is successfully
   * rekeyed — otherwise a crash would leave db-secret.enc claiming "managed" while
   * the DB is still on the old key.
   * @returns {string}
   */
  function mintPassphrase() {
    return crypto.randomBytes(32).toString("base64");
  }

  /**
   * Persist a passphrase (safeStorage-encrypted). Idempotent overwrite.
   * @param {string} passphrase
   */
  function persistPassphrase(passphrase) {
    if (!secretPath) {
      throw new Error("[db-secret-provider] secretPath 未配置");
    }
    if (!isAvailable()) {
      throw new Error(
        "[db-secret-provider] safeStorage 不可用，无法托管 DB 口令",
      );
    }
    const encrypted = safeStorage.encryptString(passphrase);
    fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    // mode 0600 best-effort (largely ignored on Windows; safeStorage is the real guard).
    fs.writeFileSync(secretPath, Buffer.from(encrypted), { mode: 0o600 });
    logger.info("[db-secret-provider] DB 口令已托管落盘（safeStorage 加密）");
  }

  /**
   * Return the managed passphrase, generating + persisting one on first use.
   * Throws if safeStorage is unavailable (caller must fall back to legacy).
   * @returns {string}
   */
  function getOrCreateManagedPassphrase() {
    if (!secretPath) {
      throw new Error("[db-secret-provider] secretPath 未配置");
    }
    if (!isAvailable()) {
      throw new Error(
        "[db-secret-provider] safeStorage 不可用，无法托管 DB 口令",
      );
    }

    if (fs.existsSync(secretPath)) {
      const buf = fs.readFileSync(secretPath);
      const passphrase = safeStorage.decryptString(Buffer.from(buf));
      if (!passphrase) {
        throw new Error("[db-secret-provider] 托管口令解密为空");
      }
      return passphrase;
    }

    // First run: mint + persist.
    const passphrase = mintPassphrase();
    persistPassphrase(passphrase);
    return passphrase;
  }

  // ==========================================================================
  // Phase 3 (gated, default OFF) — U-Key escrow of the managed passphrase.
  // See docs/internal/db-master-key-hardening-design.md §4.5 (Method B).
  //
  // The DB key stays the stable safeStorage-managed passphrase; the U-Key does
  // NOT derive the DB key directly (that would force a full-DB rekey on every
  // plug/unplug). Instead it *wraps* a copy of the same passphrase, so U-Key
  // presence becomes an unlock factor without ever rekeying the database.
  //
  //   dual-escrow   : passphrase wrapped by BOTH safeStorage and U-Key; read
  //                   prefers U-Key, falls back to safeStorage (no lockout).
  //   hardware-only : passphrase wrapped by U-Key ONLY (+ a one-time backup
  //                   code for recovery); no safeStorage copy → true hardware
  //                   gating, fail-closed when the U-Key is absent.
  //
  // `uKey` is an injectable seam so the whole layer is unit-testable on Windows
  // without real SIMKey hardware:
  //   uKey = { isAvailable(): boolean,
  //            wrap(buf: Buffer): Promise<Buffer>,
  //            unwrap(buf: Buffer): Promise<Buffer> }
  // ==========================================================================
  const uKey = options.uKey || null;
  const secretDir = secretPath ? path.dirname(secretPath) : null;
  const uKeySecretPath =
    options.uKeySecretPath ||
    (secretDir ? path.join(secretDir, "db-secret-ukey.enc") : null);
  const backupSecretPath =
    options.backupSecretPath ||
    (secretDir ? path.join(secretDir, "db-secret-backup.enc") : null);

  /** @returns {boolean} whether a U-Key escrow blob already exists on disk. */
  function hasUKeyEscrow() {
    if (!uKeySecretPath) {
      return false;
    }
    try {
      return fs.existsSync(uKeySecretPath);
    } catch (_err) {
      return false;
    }
  }

  /** @returns {boolean} whether the U-Key seam is present and unlocked. */
  function isUKeyAvailable() {
    return !!(
      uKey &&
      typeof uKey.isAvailable === "function" &&
      uKey.isAvailable()
    );
  }

  /**
   * Wrap a passphrase with the U-Key and persist the ciphertext. Overwrites any
   * existing escrow. Throws if the U-Key is unavailable.
   * @param {string} passphrase
   * @returns {Promise<void>}
   */
  async function wrapPassphraseWithUKey(passphrase) {
    if (!uKeySecretPath) {
      throw new Error("[db-secret-provider] uKeySecretPath 未配置");
    }
    if (!isUKeyAvailable()) {
      throw new Error("[db-secret-provider] U-Key 不可用，无法包裹 DB 口令");
    }
    const cipher = await uKey.wrap(Buffer.from(passphrase, "utf8"));
    fs.mkdirSync(path.dirname(uKeySecretPath), { recursive: true });
    fs.writeFileSync(uKeySecretPath, Buffer.from(cipher), { mode: 0o600 });
    logger.info("[db-secret-provider] DB 口令已 U-Key 包裹落盘");
  }

  /**
   * Read + U-Key-unwrap the escrowed passphrase. Throws if absent/unavailable.
   * @returns {Promise<string>}
   */
  async function unwrapPassphraseFromUKey() {
    if (!hasUKeyEscrow()) {
      throw new Error("[db-secret-provider] 无 U-Key 托管口令");
    }
    if (!isUKeyAvailable()) {
      throw new Error("[db-secret-provider] U-Key 不可用，无法解包 DB 口令");
    }
    const cipher = fs.readFileSync(uKeySecretPath);
    const plain = await uKey.unwrap(Buffer.from(cipher));
    const passphrase = Buffer.from(plain).toString("utf8");
    if (!passphrase) {
      throw new Error("[db-secret-provider] U-Key 解包口令为空");
    }
    return passphrase;
  }

  /** @returns {boolean} whether a backup-code escrow blob exists. */
  function hasBackupEscrow() {
    if (!backupSecretPath) {
      return false;
    }
    try {
      return fs.existsSync(backupSecretPath);
    } catch (_err) {
      return false;
    }
  }

  /**
   * Export a passphrase under a user-chosen backup code (PBKDF2 + AES-256-GCM).
   * This is the offline recovery path for hardware-only mode — without it, a lost
   * U-Key would permanently brick the DB. The plaintext backup code is shown to
   * the user once and never persisted; only the encrypted blob touches disk.
   * @param {string} passphrase
   * @param {string} backupCode
   */
  function exportBackupEscrow(passphrase, backupCode) {
    if (!backupSecretPath) {
      throw new Error("[db-secret-provider] backupSecretPath 未配置");
    }
    if (!backupCode || backupCode.length < 6) {
      throw new Error("[db-secret-provider] 备份码过短（至少 6 位）");
    }
    const salt = crypto.randomBytes(16);
    const key = crypto.pbkdf2Sync(backupCode, salt, 200000, 32, "sha256");
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([
      cipher.update(passphrase, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    const blob = JSON.stringify({
      v: 1,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      ct: ct.toString("base64"),
    });
    fs.mkdirSync(path.dirname(backupSecretPath), { recursive: true });
    fs.writeFileSync(backupSecretPath, Buffer.from(blob, "utf8"), {
      mode: 0o600,
    });
    logger.info("[db-secret-provider] DB 口令已导出备份码 escrow");
  }

  /**
   * Recover a passphrase from the backup-code escrow. Throws on a wrong code
   * (AES-GCM auth-tag mismatch) or missing blob.
   * @param {string} backupCode
   * @returns {string}
   */
  function recoverFromBackupEscrow(backupCode) {
    if (!hasBackupEscrow()) {
      throw new Error("[db-secret-provider] 无备份码 escrow");
    }
    const blob = JSON.parse(fs.readFileSync(backupSecretPath).toString("utf8"));
    const salt = Buffer.from(blob.salt, "base64");
    const key = crypto.pbkdf2Sync(backupCode, salt, 200000, 32, "sha256");
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(blob.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(blob.ct, "base64")),
      decipher.final(), // throws if backupCode is wrong
    ]);
    return plain.toString("utf8");
  }

  /**
   * Resolve the DB passphrase under the given escrow mode. Returns the SAME
   * managed passphrase regardless of mode — so the caller's downstream DB key
   * derivation never changes and no full-DB rekey is triggered.
   *
   * @param {Object} [opts]
   * @param {'safestorage-only'|'dual-escrow'|'hardware-only'} [opts.mode]
   * @param {string} [opts.backupCode] - required for hardware-only first setup,
   *        and used to recover when the U-Key is absent.
   * @returns {Promise<string>}
   */
  async function resolvePassphrase(opts = {}) {
    const mode = opts.mode || "safestorage-only";
    const backupCode = opts.backupCode;

    if (mode === "safestorage-only") {
      return getOrCreateManagedPassphrase();
    }

    if (mode === "dual-escrow") {
      // Prefer the U-Key copy; fall back to safeStorage so a missing/failed
      // U-Key never locks the user out.
      if (isUKeyAvailable() && hasUKeyEscrow()) {
        try {
          return await unwrapPassphraseFromUKey();
        } catch (err) {
          logger.warn(
            "[db-secret-provider] U-Key 解包失败，回退 safeStorage:",
            err.message,
          );
        }
      }
      const passphrase = getOrCreateManagedPassphrase();
      // Opportunistically (re)create the U-Key escrow so the next boot can use
      // it. Best-effort: a failure here just keeps us safeStorage-only this run.
      if (isUKeyAvailable() && !hasUKeyEscrow()) {
        try {
          await wrapPassphraseWithUKey(passphrase);
        } catch (err) {
          logger.warn(
            "[db-secret-provider] U-Key escrow 创建失败，本次仅 safeStorage:",
            err.message,
          );
        }
      }
      return passphrase;
    }

    if (mode === "hardware-only") {
      // Established escrow: require the U-Key (fail-closed), else recover via
      // backup code if one is supplied.
      if (hasUKeyEscrow()) {
        if (isUKeyAvailable()) {
          return await unwrapPassphraseFromUKey();
        }
        if (backupCode && hasBackupEscrow()) {
          return recoverFromBackupEscrow(backupCode);
        }
        throw new Error(
          "[db-secret-provider] hardware-only：U-Key 不可用且无备份码，fail-closed",
        );
      }

      // First-time setup: must have an unlocked U-Key AND a backup code (so a
      // lost U-Key can never permanently brick the DB).
      if (!isUKeyAvailable()) {
        throw new Error(
          "[db-secret-provider] hardware-only 首次设置需要可用的 U-Key",
        );
      }
      if (!backupCode) {
        throw new Error(
          "[db-secret-provider] hardware-only 首次设置必须提供备份码以避免锁死",
        );
      }
      // Reuse an existing managed passphrase (e.g. migrating from dual-escrow /
      // safestorage-only) so the DB key is UNCHANGED — minting a fresh one would
      // re-key the passphrase and lock an already-encrypted DB out. Only mint
      // fresh for a brand-new DB with no prior passphrase.
      const passphrase =
        hasManagedPassphrase() && isAvailable()
          ? getOrCreateManagedPassphrase()
          : mintPassphrase();
      await wrapPassphraseWithUKey(passphrase);
      exportBackupEscrow(passphrase, backupCode);
      // Honor "no software escrow": drop any safeStorage copy so the passphrase
      // is genuinely gated behind the U-Key (+ offline backup code) only.
      if (secretPath && fs.existsSync(secretPath)) {
        try {
          fs.rmSync(secretPath, { force: true });
          logger.info(
            "[db-secret-provider] hardware-only：已移除 safeStorage 软件副本",
          );
        } catch (err) {
          logger.warn(
            "[db-secret-provider] 移除 safeStorage 副本失败:",
            err.message,
          );
        }
      }
      return passphrase;
    }

    throw new Error(`[db-secret-provider] 未知 escrow 模式: ${mode}`);
  }

  return {
    secretPath,
    uKeySecretPath,
    backupSecretPath,
    isAvailable,
    hasManagedPassphrase,
    getOrCreateManagedPassphrase,
    mintPassphrase,
    persistPassphrase,
    // Phase 3 — U-Key escrow (gated, default OFF)
    isUKeyAvailable,
    hasUKeyEscrow,
    wrapPassphraseWithUKey,
    unwrapPassphraseFromUKey,
    hasBackupEscrow,
    exportBackupEscrow,
    recoverFromBackupEscrow,
    resolvePassphrase,
  };
}

/**
 * Thin adapter turning a KeyManager's internal `ukeyManager` (which exposes async
 * encrypt/decrypt + isInitialized) into the `uKey` escrow seam consumed by
 * createDbSecretProvider. Hardware-dependent (Windows + SIMKey); not unit-tested
 * end-to-end — the provider layer above is tested with a fake seam instead.
 *
 * @param {{ isInitialized: boolean, encrypt: Function, decrypt: Function }} ukeyManager
 * @returns {{ isAvailable: () => boolean, wrap: Function, unwrap: Function }}
 */
function createUKeyEscrowAdapter(ukeyManager) {
  return {
    isAvailable: () => !!(ukeyManager && ukeyManager.isInitialized),
    wrap: async (buf) => Buffer.from(await ukeyManager.encrypt(buf)),
    unwrap: async (buf) => Buffer.from(await ukeyManager.decrypt(buf)),
  };
}

module.exports = {
  createDbSecretProvider,
  createUKeyEscrowAdapter,
  _resolveElectronSafeStorage,
};
