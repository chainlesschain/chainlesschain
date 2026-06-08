/**
 * db-encryption-flag — master switch for DB-at-rest encryption (Phase 1 / 1.5).
 *
 * The packaged build historically ran the DB unencrypted (NODE_ENV misdetection,
 * see docs/internal/db-master-key-hardening-design.md §1.0). Enabling encryption
 * triggers a plaintext→.encrypted migration that carries data-loss risk and must
 * be verified on a real device before becoming the default.
 *
 * Resolution order in isDbEncryptionOptIn():
 *   1. Env override (highest priority):
 *        CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION=1|true  → force ON
 *        CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION=0|false → force OFF (kill-switch)
 *   2. Otherwise the GATED default:
 *        - PHASE_1_5_DEFAULT_ON === false → OFF everywhere.
 *        - PHASE_1_5_DEFAULT_ON === true (current) → ON in packaged builds
 *          (app.isPackaged), OFF in dev/test.
 *
 * Phase 1.5 flip procedure: complete EVERY item in the pre-flip checklist
 * (docs/internal/db-encryption-preflip-checklist.md) — L1+L2+L3 automated tests
 * AND the L4 real-device smoke — THEN change PHASE_1_5_DEFAULT_ON to `true` (one
 * reviewed line). That turns encryption on by default for packaged users while
 * leaving dev/test plaintext and keeping the `=0` env kill-switch as an emergency
 * off. Do NOT flip it before the checklist is fully signed off.
 *
 * @module database/db-encryption-flag
 */

/**
 * GATE — FLIPPED ON 2026-06-08 after the pre-flip checklist was fully signed off
 * (docs/internal/db-encryption-preflip-checklist.md: A L1+L3 45 + L2 7 + B.1 6
 * automated green, B.2 manual GUI smoke — install-old→upgrade migration & real
 * power-loss — signed off on real device, C rollback verified).
 *
 * Effect: packaged production builds now encrypt the DB by default and migrate
 * existing plaintext libraries to `.encrypted` on first launch.
 *
 * Emergency rollback: set CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION=0 to force-off
 * (the kill-switch overrides this gate); or revert this line to `false`.
 */
const PHASE_1_5_DEFAULT_ON = true;

/**
 * @returns {boolean} whether this is a packaged Electron build. Falls back to
 * false outside Electron (unit tests, headless scripts).
 */
function _resolveIsPackaged() {
  try {
    // eslint-disable-next-line global-require
    const { app } = require("electron");
    return !!(app && app.isPackaged);
  } catch (_e) {
    return false;
  }
}

/**
 * @param {Object} [opts] - test seams
 * @param {boolean} [opts.isPackaged] - override packaged detection
 * @param {boolean} [opts.defaultOn] - override the PHASE_1_5_DEFAULT_ON gate
 * @returns {boolean} whether DB encryption + migration is enabled.
 */
function isDbEncryptionOptIn(opts = {}) {
  const env = process.env.CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION;
  if (env === "1" || env === "true") {
    return true; // explicit force-on
  }
  if (env === "0" || env === "false") {
    return false; // explicit kill-switch
  }

  const defaultOn =
    opts.defaultOn !== undefined ? opts.defaultOn : PHASE_1_5_DEFAULT_ON;
  if (!defaultOn) {
    return false; // gate closed → off everywhere
  }

  const isPackaged =
    opts.isPackaged !== undefined ? opts.isPackaged : _resolveIsPackaged();
  return !!isPackaged; // gate open → on only in packaged prod
}

/**
 * Phase 2 (legacy rekey) opt-in — separate, independently gated from Phase 1/1.5.
 *
 * Rekeys a rare legacy `.encrypted` DB that was created with the hard-coded
 * "123456" passphrase onto a safeStorage-managed random one (in-place SQLCipher
 * rekey with backup/verify/rollback). OFF by default — only runs when explicitly
 * opted in, and even then only when DB encryption itself is on.
 *
 * Enable via: CHAINLESSCHAIN_ENABLE_DB_REKEY=1
 *
 * @returns {boolean} whether legacy→managed rekey is opted in. Default false.
 */
function isDbRekeyOptIn() {
  const v = process.env.CHAINLESSCHAIN_ENABLE_DB_REKEY;
  return v === "1" || v === "true";
}

module.exports = {
  isDbEncryptionOptIn,
  isDbRekeyOptIn,
  PHASE_1_5_DEFAULT_ON,
  _resolveIsPackaged,
};
