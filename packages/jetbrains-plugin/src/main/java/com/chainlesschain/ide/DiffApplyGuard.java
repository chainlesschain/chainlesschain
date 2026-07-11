package com.chainlesschain.ide;

/**
 * Pure safety guards for applying a reviewed diff back to disk. SDK-free so
 * plain JUnit covers it; the IntelliJ glue lives in IntellijEditorFacade.
 *
 * <ul>
 *   <li>{@link #safeToApply}: optimistic-concurrency check. The reviewer
 *       decided against the baseline the agent proposed from
 *       ({@code originalText}); if the file changed during the review, a
 *       blind whole-file write would silently destroy those concurrent
 *       edits. No baseline (legacy callers diff against the live file) or no
 *       readable current text (nothing to clobber) → always safe, keeping
 *       the old call paths byte-identical.</li>
 *   <li>{@link #looksBinary}: NUL sniff (git's heuristic) so the text diff
 *       pipeline never round-trips a binary file through UTF-8 — that
 *       corrupts the bytes. Multi-byte UTF-8 text (中文 etc.) contains no
 *       NUL and is never misdetected.</li>
 * </ul>
 *
 * Twin: packages/vscode-extension/src/diff-apply-guard.js — keep semantics
 * in sync.
 */
public final class DiffApplyGuard {

    /** Result {@code reason} when a drifted disk blocks the apply. */
    public static final String REASON_DISK_DRIFTED = "disk-drifted";

    /** Result {@code reason} for a binary short-circuit. */
    public static final String REASON_BINARY_SKIPPED = "binary file, skipped";

    private DiffApplyGuard() {
    }

    /**
     * @param baselineText the baseline the review was proposed against
     *                     (openDiff's {@code originalText}); null → no
     *                     baseline → safe.
     * @param currentText  the file's current content; null (missing /
     *                     unreadable file) → nothing to clobber → safe.
     * @return whether a whole-file write may proceed without destroying
     *         concurrent edits.
     */
    public static boolean safeToApply(String baselineText, String currentText) {
        if (baselineText == null || currentText == null) return true;
        return baselineText.equals(currentText);
    }

    /** NUL-char sniff on text; null is "not binary". */
    public static boolean looksBinary(String text) {
        return text != null && text.indexOf('\0') >= 0;
    }

    /** NUL-byte sniff on raw bytes; null is "not binary". */
    public static boolean looksBinary(byte[] bytes) {
        if (bytes == null) return false;
        for (byte b : bytes) {
            if (b == 0) return true;
        }
        return false;
    }
}
