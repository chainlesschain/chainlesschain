package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link TranscriptCap} layer. */
class TranscriptCapTest {

    private static final int CAP = 100;

    @Test
    void withinOrAtCapRemovesNothing() {
        assertEquals(0, TranscriptCap.removeCount(50, -1, false, CAP));
        assertEquals(0, TranscriptCap.removeCount(100, -1, false, CAP));
        assertEquals(0, TranscriptCap.removeCount(0, -1, false, CAP));
    }

    @Test
    void overCapWithNoRunTrimsExactlyTheExcess() {
        assertEquals(50, TranscriptCap.removeCount(150, -1, false, CAP));
    }

    @Test
    void duringRunNeverTrimsPastRunStart() {
        assertEquals(30, TranscriptCap.removeCount(150, 30, true, CAP));
        assertTrue(TranscriptCap.removeCount(150, 30, true, CAP) <= 30);
    }

    @Test
    void duringRunTrimsFullExcessWhenRunStartExceedsIt() {
        assertEquals(50, TranscriptCap.removeCount(150, 80, true, CAP));
    }

    @Test
    void runAtZeroLeavesNothingRemovable() {
        assertEquals(0, TranscriptCap.removeCount(150, 0, true, CAP));
    }

    @Test
    void staleRunStartIsIgnoredWhenNotInRun() {
        assertEquals(50, TranscriptCap.removeCount(150, 30, false, CAP));
    }

    @Test
    void degenerateCapsRemoveEverythingOverZero() {
        assertEquals(10, TranscriptCap.removeCount(10, -1, false, 0));
        assertEquals(10, TranscriptCap.removeCount(10, -1, false, -5));
    }

    @Test
    void defaultCapIsPositiveAndSelfConsistent() {
        assertTrue(TranscriptCap.DEFAULT_MAX_CHARS > 0);
        assertEquals(0, TranscriptCap.removeCount(
                TranscriptCap.DEFAULT_MAX_CHARS, -1, false, TranscriptCap.DEFAULT_MAX_CHARS));
    }

    @Test
    void sixtyFourMebibyteEntryKeepsBoundedHeadTailAndVisibleMarker() {
        TranscriptCap.BoundedEntry entry =
                new TranscriptCap.BoundedEntry(TranscriptCap.DEFAULT_MAX_CHARS);
        String mebibyte = "x".repeat(1024 * 1024);
        entry.append("HEAD");
        for (int i = 0; i < 64; i++) entry.append(mebibyte);
        entry.append("TAIL");

        assertTrue(entry.truncated());
        assertEquals(64L * 1024 * 1024 + 8, entry.totalChars());
        assertTrue(entry.omittedChars() > 63L * 1024 * 1024);
        assertTrue(entry.text().length() <= TranscriptCap.DEFAULT_MAX_CHARS);
        assertTrue(entry.text().startsWith("HEAD"));
        assertTrue(entry.text().contains("characters omitted"));
        assertTrue(entry.text().endsWith("TAIL"));
    }
}
