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
     * Bounded head/tail accumulator for one oversized transcript entry. It
     * counts the complete logical input but never retains the omitted middle.
     */
    public static final class BoundedEntry {
        private final int cap;
        private String prefix = "";
        private String suffix = "";
        private String marker = "";
        private long totalChars;
        private boolean truncated;

        public BoundedEntry(int maximumChars) {
            cap = Math.max(0, maximumChars);
        }

        public void append(String value) {
            String chunk = value == null ? "" : value;
            String oldHead = prefix;
            String oldTail = truncated ? suffix : prefix;
            totalChars += chunk.length();
            if (!truncated && totalChars <= cap) {
                prefix += chunk;
                return;
            }

            long omitted = Math.max(0L, totalChars - cap);
            marker = marker(omitted);
            for (int iteration = 0; iteration < 3; iteration++) {
                int dataBudget = Math.max(0, cap - marker.length());
                omitted = Math.max(0L, totalChars - dataBudget);
                marker = marker(omitted);
            }
            if (marker.length() >= cap) {
                marker = marker.substring(0, cap);
                prefix = "";
                suffix = "";
                truncated = true;
                return;
            }

            int dataBudget = cap - marker.length();
            int headBudget = (dataBudget + 1) / 2;
            int tailBudget = dataBudget - headBudget;
            prefix = oldHead.length() >= headBudget
                    ? oldHead.substring(0, headBudget)
                    : oldHead + chunk.substring(
                            0, Math.min(chunk.length(), headBudget - oldHead.length()));
            suffix = chunk.length() >= tailBudget
                    ? chunk.substring(chunk.length() - tailBudget)
                    : oldTail.substring(
                            Math.max(0, oldTail.length() - (tailBudget - chunk.length())))
                            + chunk;
            truncated = true;
        }

        public boolean truncated() {
            return truncated;
        }

        public long totalChars() {
            return totalChars;
        }

        public long omittedChars() {
            return truncated
                    ? Math.max(0L, totalChars - prefix.length() - suffix.length())
                    : 0L;
        }

        public String text() {
            return truncated ? prefix + marker + suffix : prefix;
        }

        private static String marker(long omitted) {
            return "\n\n… [" + omitted
                    + " characters omitted from oversized transcript entry] …\n\n";
        }
    }

    /** Bound one complete entry and include the same visible omission marker. */
    public static String boundEntry(String value, int maximumChars) {
        BoundedEntry entry = new BoundedEntry(maximumChars);
        entry.append(value);
        return entry.text();
    }

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
