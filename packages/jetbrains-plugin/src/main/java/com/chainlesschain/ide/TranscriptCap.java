package com.chainlesschain.ide;

/**
 * Pure cap arithmetic for the chat transcript document, mirroring the VS Code
 * panel's node cap (chainlesschain-ide 0.36.5): a long session must not grow the
 * transcript without bound. The view trims the OLDEST characters from the front
 * of its StyledDocument, but never into the currently-streaming assistant run —
 * whose absolute offset (assistantRunStart) would otherwise break. This class
 * holds only the arithmetic (how many leading chars to drop) so it is unit
 * testable without the IntelliJ SDK or a live Swing document.
 */
public final class TranscriptCap {
    private TranscriptCap() {}

    /** Default cap (characters): ~200k keeps a long scrollback yet stays bounded. */
    public static final int DEFAULT_MAX_CHARS = 200_000;

    /**
     * How many characters to remove from the FRONT of a transcript of {@code len}
     * chars to bring it under {@code cap}, without trimming into an active
     * assistant run.
     *
     * @param len      current document length
     * @param runStart absolute offset where the active assistant run began, or &lt;0 if none
     * @param inRun    whether an assistant run is currently streaming
     * @param cap      maximum characters to retain
     * @return number of leading chars to remove (0 when already within cap)
     */
    public static int removeCount(int len, int runStart, boolean inRun, int cap) {
        if (cap < 0) cap = 0;
        if (len <= cap) return 0;
        int excess = len - cap;
        // Don't trim into the run that is still streaming; everything before its
        // start is safe history. When no run is active, the whole prefix is free.
        int safeLimit = (inRun && runStart >= 0) ? runStart : len;
        int removeLen = Math.min(excess, safeLimit);
        return removeLen > 0 ? removeLen : 0;
    }
}
