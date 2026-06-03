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

  return {
    secretPath,
    isAvailable,
    hasManagedPassphrase,
    getOrCreateManagedPassphrase,
    mintPassphrase,
    persistPassphrase,
  };
}

module.exports = {
  createDbSecretProvider,
  _resolveElectronSafeStorage,
};
