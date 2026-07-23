package com.chainlesschain.ide;

import java.nio.charset.StandardCharsets;

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

    /** Combined baseline + proposal budget for one native IDE diff. */
    public static final long MAX_REVIEW_FILE_BYTES = 2L * 1024L * 1024L;

    /** Result {@code reason} for an oversized text diff. */
    public static final String REASON_LARGE_FILE_SKIPPED =
            "file too large for IDE diff review";

    /** Bounded, content-free classification returned before an IDE diff opens. */
    public static final class ReviewPayload {
        public final boolean reviewable;
        public final String kind;
        public final String reason;
        public final long bytes;
        public final long limitBytes;

        ReviewPayload(
                boolean reviewable,
                String kind,
                String reason,
                long bytes,
                long limitBytes) {
            this.reviewable = reviewable;
            this.kind = kind;
            this.reason = reason;
            this.bytes = bytes;
            this.limitBytes = limitBytes;
        }
    }

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

    /**
     * Classify a baseline/proposal pair before creating native editor
     * documents. {@code currentBytes} is used only when no explicit baseline
     * was supplied.
     */
    public static ReviewPayload checkReviewPayload(
            String modifiedText,
            String originalText,
            byte[] currentBytes,
            long maxBytes) {
        return checkReviewPayload(
                modifiedText,
                originalText,
                currentBytes,
                currentBytes == null ? null : Long.valueOf(currentBytes.length),
                maxBytes);
    }

    public static ReviewPayload checkReviewPayload(
            String modifiedText,
            String originalText,
            byte[] currentBytes,
            Long currentSizeBytes,
            long maxBytes) {
        long limit = maxBytes > 0 ? maxBytes : MAX_REVIEW_FILE_BYTES;
        boolean explicitBaseline = originalText != null;
        long bytes = utf8Length(modifiedText)
                + (explicitBaseline
                        ? utf8Length(originalText)
                        : currentSizeBytes != null && currentSizeBytes >= 0
                                ? currentSizeBytes
                                : byteLength(currentBytes));
        boolean binary = looksBinary(modifiedText)
                || (explicitBaseline ? looksBinary(originalText) : looksBinary(currentBytes));
        if (binary) {
            return new ReviewPayload(
                    false, "binary", REASON_BINARY_SKIPPED, bytes, limit);
        }
        if (bytes > limit) {
            return new ReviewPayload(
                    false, "large-file", REASON_LARGE_FILE_SKIPPED, bytes, limit);
        }
        return new ReviewPayload(true, null, null, bytes, limit);
    }

    public static ReviewPayload checkReviewPayload(
            String modifiedText,
            String originalText,
            byte[] currentBytes) {
        return checkReviewPayload(
                modifiedText, originalText, currentBytes, MAX_REVIEW_FILE_BYTES);
    }

    private static long utf8Length(String text) {
        return text == null ? 0L : text.getBytes(StandardCharsets.UTF_8).length;
    }

    private static long byteLength(byte[] bytes) {
        return bytes == null ? 0L : bytes.length;
    }
}
