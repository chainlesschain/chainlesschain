/**
 * db-encryption-migrate-worker.js — child process for the L2 G7 two-process
 * concurrent-migration test. Runs ONE real plaintext→.encrypted migration and
 * reports its outcome on stdout behind a sentinel (so logger noise is ignored).
 *
 * Spawned via Electron-as-Node (ABI 140) by db-encryption.native.js; not a test
 * itself. argv: [node, this, sourcePath, targetPath, keyHex].
 */

/* eslint-disable no-console */
const { migratePlaintextToEncrypted } = require("../../encrypted-migration");

const [, , sourcePath, targetPath, encryptionKey] = process.argv;

(async () => {
  let payload;
  try {
    const res = await migratePlaintextToEncrypted({
      sourcePath,
      targetPath,
      encryptionKey,
    });
    let outcome;
    if (res && res.reason === "locked") {
      outcome = "locked"; // file-lock held by the other process
    } else if (res && res.skipped) {
      outcome = "skipped-exists"; // target already migrated (no double-write)
    } else if (res && res.success) {
      outcome = "migrated"; // this process did the real migration
    } else {
      outcome = "unknown";
    }
    payload = { outcome };
  } catch (e) {
    payload = { outcome: "error", error: e.message };
  }
  // Sentinel line; the parent greps for this and ignores all logger output.
  process.stdout.write("\nWORKER_RESULT " + JSON.stringify(payload) + "\n");
  process.exit(0);
})();
