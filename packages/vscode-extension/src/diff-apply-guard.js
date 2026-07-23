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

/** Combined baseline + proposal budget for one native IDE diff. */
const MAX_REVIEW_FILE_BYTES = 2 * 1024 * 1024;

/** Result `reason` when a text diff is too large for a safe native review. */
const REASON_LARGE_FILE_SKIPPED = "file too large for IDE diff review";

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

function byteLength(input) {
  if (typeof input === "string") return Buffer.byteLength(input, "utf8");
  if (input instanceof Uint8Array) return input.byteLength;
  return 0;
}

/**
 * Classify one baseline/proposal pair before opening an IDE text diff.
 * Binary input is rejected first; otherwise the combined UTF-8 payload is
 * bounded so a host cannot be forced to materialize arbitrarily large editor
 * documents. When no explicit baseline is supplied, `currentBytes` is a
 * bounded binary probe and `currentSizeBytes` is the full on-disk size.
 */
function checkReviewPayload({
  modifiedText,
  originalText,
  currentBytes,
  currentSizeBytes,
  maxBytes = MAX_REVIEW_FILE_BYTES,
} = {}) {
  const baseline =
    typeof originalText === "string" ? originalText : currentBytes;
  const limit =
    Number.isSafeInteger(maxBytes) && maxBytes > 0
      ? maxBytes
      : MAX_REVIEW_FILE_BYTES;
  const baselineBytes =
    typeof originalText === "string"
      ? byteLength(originalText)
      : Number.isSafeInteger(currentSizeBytes) && currentSizeBytes >= 0
        ? currentSizeBytes
        : byteLength(baseline);
  const bytes = byteLength(modifiedText) + baselineBytes;
  if (looksBinary(modifiedText) || looksBinary(baseline)) {
    return {
      reviewable: false,
      kind: "binary",
      reason: REASON_BINARY_SKIPPED,
      bytes,
      limitBytes: limit,
    };
  }
  if (bytes > limit) {
    return {
      reviewable: false,
      kind: "large-file",
      reason: REASON_LARGE_FILE_SKIPPED,
      bytes,
      limitBytes: limit,
    };
  }
  return { reviewable: true, bytes, limitBytes: limit };
}

module.exports = {
  checkApplySafety,
  checkReviewPayload,
  looksBinary,
  MAX_REVIEW_FILE_BYTES,
  REASON_DISK_DRIFTED,
  REASON_BINARY_SKIPPED,
  REASON_LARGE_FILE_SKIPPED,
};
