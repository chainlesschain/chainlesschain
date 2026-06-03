/**
 * db-encryption-flag — master opt-in switch for DB-at-rest encryption (Phase 1).
 *
 * The packaged build currently runs the DB unencrypted (NODE_ENV misdetection,
 * see docs/internal/db-master-key-hardening-design.md §1.0). Phase 1 enables
 * encryption + a plaintext→.encrypted migration, which carries data-loss risk
 * and must be verified on a real device before becoming the default.
 *
 * This flag keeps Phase 1 **OFF by default**: nothing changes for existing users
 * until someone explicitly opts in (e.g. on a test device). Once verified on real
 * hardware, the default can be flipped in a follow-up by making this return true
 * (ideally keyed on app.isPackaged rather than NODE_ENV).
 *
 * Enable via: CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION=1
 *
 * @module database/db-encryption-flag
 */

/**
 * @returns {boolean} whether DB encryption + migration is opted in. Default false.
 */
function isDbEncryptionOptIn() {
  const v = process.env.CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION;
  return v === "1" || v === "true";
}

module.exports = { isDbEncryptionOptIn };
