package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link DiffApplyGuard} — optimistic-concurrency + binary guards for the
 * diff apply path. Twin of the VS Code pure core (diff-apply-guard.js /
 * vscode-ext-diff-apply-guard.test.js): keep the semantics aligned.
 */
class DiffApplyGuardTest {

    // ---- safeToApply (optimistic concurrency) ----

    @Test
    void driftedDiskIsNotSafe() {
        assertFalse(DiffApplyGuard.safeToApply("baseline", "user concurrent edit"));
    }

    @Test
    void identicalBaselineAndDiskIsSafe() {
        assertTrue(DiffApplyGuard.safeToApply("same", "same"));
    }

    @Test
    void missingBaselineIsSafe_legacyCallersKeepTheirPath() {
        assertTrue(DiffApplyGuard.safeToApply(null, "anything"));
        assertTrue(DiffApplyGuard.safeToApply(null, null));
    }

    @Test
    void unreadableCurrentTextIsSafe_nothingToClobber() {
        assertTrue(DiffApplyGuard.safeToApply("baseline", null));
    }

    @Test
    void emptyVsNonEmptyIsDrift() {
        assertFalse(DiffApplyGuard.safeToApply("", "created during review"));
        assertFalse(DiffApplyGuard.safeToApply("had content", ""));
    }

    // ---- looksBinary (NUL sniff) ----

    @Test
    void nulCharInStringIsBinary() {
        assertTrue(DiffApplyGuard.looksBinary("PNG\0DATA"));
        assertTrue(DiffApplyGuard.looksBinary("\0"));
    }

    @Test
    void nulByteInBytesIsBinary() {
        assertTrue(DiffApplyGuard.looksBinary(new byte[] { (byte) 0x89, 0x50, 0x00, 0x47 }));
    }

    @Test
    void utf8ChineseTextIsNotBinary() {
        String cn = "中文注释：评审期间不误判为二进制 🚀";
        assertFalse(DiffApplyGuard.looksBinary(cn));
        assertFalse(DiffApplyGuard.looksBinary(cn.getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    void plainAndEmptyAndNullAreNotBinary() {
        assertFalse(DiffApplyGuard.looksBinary("plain ascii"));
        assertFalse(DiffApplyGuard.looksBinary(""));
        assertFalse(DiffApplyGuard.looksBinary((String) null));
        assertFalse(DiffApplyGuard.looksBinary((byte[]) null));
        assertFalse(DiffApplyGuard.looksBinary(new byte[0]));
    }

    @Test
    void reviewPayloadCountsUtf8BytesAcrossBothSides() {
        DiffApplyGuard.ReviewPayload payload =
                DiffApplyGuard.checkReviewPayload("文", "中", null, 6);
        assertTrue(payload.reviewable);
        assertEquals(6, payload.bytes);
        assertEquals(6, payload.limitBytes);
    }

    @Test
    void oversizedTextIsRejectedWithBoundedMetadata() {
        DiffApplyGuard.ReviewPayload payload =
                DiffApplyGuard.checkReviewPayload("5678", "1234", null, 7);
        assertFalse(payload.reviewable);
        assertEquals("large-file", payload.kind);
        assertEquals(DiffApplyGuard.REASON_LARGE_FILE_SKIPPED, payload.reason);
        assertEquals(8, payload.bytes);
        assertEquals(7, payload.limitBytes);
    }

    @Test
    void rawDiskBytesAreUsedWhenBaselineIsMissing() {
        DiffApplyGuard.ReviewPayload payload =
                DiffApplyGuard.checkReviewPayload(
                        "new", null, new byte[] { 1, 0, 2 }, 100);
        assertFalse(payload.reviewable);
        assertEquals("binary", payload.kind);
        assertEquals(DiffApplyGuard.REASON_BINARY_SKIPPED, payload.reason);
    }

    @Test
    void fullDiskSizeIsUsedWithOnlyABoundedProbe() {
        DiffApplyGuard.ReviewPayload payload =
                DiffApplyGuard.checkReviewPayload(
                        "new",
                        null,
                        "small probe".getBytes(StandardCharsets.UTF_8),
                        Long.valueOf(DiffApplyGuard.MAX_REVIEW_FILE_BYTES),
                        DiffApplyGuard.MAX_REVIEW_FILE_BYTES);
        assertFalse(payload.reviewable);
        assertEquals("large-file", payload.kind);
        assertEquals(DiffApplyGuard.MAX_REVIEW_FILE_BYTES + 3, payload.bytes);
    }

    // ---- shared reason strings (contract with the facade + VS twin) ----

    @Test
    void reasonStringsMatchTheVsCodeTwin() {
        assertEquals("disk-drifted", DiffApplyGuard.REASON_DISK_DRIFTED);
        assertEquals("binary file, skipped", DiffApplyGuard.REASON_BINARY_SKIPPED);
        assertEquals(
                "file too large for IDE diff review",
                DiffApplyGuard.REASON_LARGE_FILE_SKIPPED);
    }
}
