/**
 * did-keystore — at-rest protection for DID private-key material.
 *
 * A DID identity's `private_key_ref` column holds the Ed25519 signing secret
 * key, the X25519 encryption secret key and (optionally) the BIP39 mnemonic.
 * Historically these were written to the SQLite `identities` table as PLAINTEXT
 * base64 JSON. Because the desktop DB can run unencrypted (dev Better-SQLite3 /
 * sql.js fallback) or under a hard-coded SQLCipher password, that meant fully
 * recoverable identity keys on disk — directly at odds with the product's
 * hardware-security (U-Key/SIMKey) positioning.
 *
 * This module wraps Electron `safeStorage` (OS-managed keychain: DPAPI on
 * Windows, Keychain on macOS, libsecret/kwallet on Linux) to encrypt the column
 * value before persistence and decrypt it on read — independent of which DB
 * backend is active. The key never leaves the OS keychain and is bound to the
 * current OS user, so a stolen DB file alone is no longer enough to recover the
 * identity's private keys.
 *
 * Wire format: encrypted values are tagged `dks:v1:` + base64(ciphertext) so a
 * read can distinguish ciphertext from legacy plaintext rows. Legacy plaintext
 * rows decrypt as-is and are re-encrypted lazily by DIDManager's startup
 * migration once safeStorage is available.
 *
 * @module did-keystore
 */

const { logger } = require("../utils/logger.js");

const ENC_PREFIX = "dks:v1:";

// Lazy electron handle + test seam (mirrors did-manager's _setNaclForTesting).
// `undefined` = not yet resolved, `null` = resolved-but-unavailable, object = real.
let _safeStorage;
let _warnedPlaintext = false;

/**
 * Resolve Electron's safeStorage lazily. Returns null outside an Electron main
 * process (unit tests, headless scripts, migration tools run via plain node).
 * @returns {object|null}
 */
function _getSafeStorage() {
  if (_safeStorage !== undefined) {
    return _safeStorage;
  }
  try {
    // eslint-disable-next-line global-require
    const electron = require("electron");
    _safeStorage =
      electron && electron.safeStorage ? electron.safeStorage : null;
  } catch (_err) {
    _safeStorage = null;
  }
  return _safeStorage;
}

/**
 * Test seam: inject a fake safeStorage (or null to force the unavailable path).
 * Pass `undefined` to reset back to lazy electron resolution.
 * @param {object|null|undefined} impl
 */
function _setSafeStorageForTesting(impl) {
  _safeStorage = impl;
  _warnedPlaintext = false;
}

/**
 * @returns {boolean} true iff the OS keychain is usable for encrypt/decrypt.
 */
function isEncryptionAvailable() {
  const ss = _getSafeStorage();
  return !!(
    ss &&
    typeof ss.isEncryptionAvailable === "function" &&
    ss.isEncryptionAvailable()
  );
}

/**
 * @param {*} value
 * @returns {boolean} true iff `value` is a did-keystore ciphertext string.
 */
function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(ENC_PREFIX);
}

/**
 * Encrypt key material for at-rest storage.
 *
 * - safeStorage available → returns `dks:v1:<base64 ciphertext>`.
 * - already-encrypted input → returned unchanged (idempotent; guards against
 *   accidental double-encryption on re-save).
 * - safeStorage unavailable + NODE_ENV==='production' → throws (fail-closed:
 *   we never silently write plaintext private keys in a packaged app).
 * - safeStorage unavailable otherwise (dev/test/headless) → returns plaintext
 *   with a one-time warning.
 *
 * @param {string} plaintext - the JSON string to protect
 * @returns {string}
 */
function encrypt(plaintext) {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    return plaintext;
  }
  if (isEncrypted(plaintext)) {
    return plaintext;
  }
  const ss = _getSafeStorage();
  if (ss && isEncryptionAvailable()) {
    const buf = ss.encryptString(plaintext);
    return ENC_PREFIX + Buffer.from(buf).toString("base64");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[did-keystore] safeStorage 不可用，拒绝以明文持久化 DID 私钥（fail-closed）",
    );
  }
  if (!_warnedPlaintext) {
    logger.warn(
      "[did-keystore] safeStorage 不可用（非生产环境），DID 私钥将以明文存储 — 切勿用于生产数据",
    );
    _warnedPlaintext = true;
  }
  return plaintext;
}

/**
 * Decrypt a stored value. Legacy plaintext (no `dks:v1:` tag) and null/non-string
 * values are returned unchanged. Encrypted values require safeStorage; if it is
 * unavailable the call throws (fail-closed — better than handing back garbage).
 *
 * @param {string} stored
 * @returns {string}
 */
function decrypt(stored) {
  if (!isEncrypted(stored)) {
    return stored;
  }
  const ss = _getSafeStorage();
  if (!ss || !isEncryptionAvailable()) {
    throw new Error(
      "[did-keystore] safeStorage 不可用，无法解密 DID 私钥（密文由其它设备/用户写入？）",
    );
  }
  const buf = Buffer.from(stored.slice(ENC_PREFIX.length), "base64");
  return ss.decryptString(buf);
}

module.exports = {
  ENC_PREFIX,
  encrypt,
  decrypt,
  isEncrypted,
  isEncryptionAvailable,
  _setSafeStorageForTesting,
};
