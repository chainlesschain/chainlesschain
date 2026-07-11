/**
 * Pure safety guards for applying a reviewed diff back to disk. No `vscode`:
 * unit-testable, injected into the facade like diff-hunks / multi-diff.
 *
 *  - checkApplySafety: optimistic-concurrency check. The reviewer decided
 *    against the baseline the agent proposed from (`originalText`); if the
 *    on-disk file changed during the review, a blind whole-file write would
 *    silently destroy those concurrent edits. When no baseline was provided
 *    (older callers diff against the live file) the answer is always "safe"
 *    so the legacy path stays byte-identical.
 *
 *  - looksBinary: NUL-byte sniff (git's heuristic) so the text diff pipeline
 *    never round-trips a binary file through UTF-8 — that corrupts the bytes.
 *    Multi-byte UTF-8 text (中文 etc.) never contains a NUL and is not
 *    misdetected.
 *
 * Twin: packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/
 * DiffApplyGuard.java — keep the semantics in sync.
 */

/** Reason string for a drifted-disk verdict (shared with the JB twin). */
const REASON_DISK_DRIFTED = "disk-drifted";

/** Result `reason` for a binary short-circuit (shared with the JB twin). */
const REASON_BINARY_SKIPPED = "binary file, skipped";

/**
 * @param {object} args
 * @param {string} [args.baselineText] the baseline the review was proposed
 *   against (openDiff's `originalText`); non-string → no baseline → safe.
 * @param {string} [args.currentDiskText] the file's current on-disk content;
 *   non-string (unreadable / missing file) → nothing to clobber → safe.
 * @returns {{safe: true} | {safe: false, reason: string}}
 */
function checkApplySafety({ baselineText, currentDiskText } = {}) {
  if (typeof baselineText !== "string" || typeof currentDiskText !== "string") {
    return { safe: true };
  }
  return baselineText === currentDiskText
    ? { safe: true }
    : { safe: false, reason: REASON_DISK_DRIFTED };
}

/**
 * NUL-byte binary sniff. Accepts a string, Buffer or Uint8Array; anything
 * else (null/undefined included) is "not binary".
 * @returns {boolean}
 */
function looksBinary(input) {
  if (typeof input === "string") {
    return input.includes("\u0000");
  }
  if (input instanceof Uint8Array) {
    // Buffer extends Uint8Array; indexOf(0) is a native byte scan.
    return input.indexOf(0) !== -1;
  }
  return false;
}

module.exports = {
  checkApplySafety,
  looksBinary,
  REASON_DISK_DRIFTED,
  REASON_BINARY_SKIPPED,
};
