package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Line-level diff → pickable hunks, for openDiff's hunk-level partial accept —
 * the Java twin of the VS Code extension's diff-hunks.js.
 *
 * {@link #computeHunks} returns contiguous change blocks; the reviewer picks a
 * subset and {@link #applyHunks} rebuilds the file with ONLY those blocks
 * applied. Invariants (smoke-tested):
 * <pre>
 *   applyHunks(o, hunks, all)  == modified
 *   applyHunks(o, hunks, none) == original
 * </pre>
 *
 * Pure JDK, no IntelliJ SDK. LCS DP with common prefix/suffix trimming; a size
 * guard collapses pathological diffs into one whole-file hunk instead of
 * blowing memory (picking then degrades to plain accept/reject, which is
 * exactly the previous behavior).
 */
public final class DiffHunks {

    private DiffHunks() {}

    private static final long MAX_DP_CELLS = 4_000_000L; // ~16 MB int[] worst case

    /** One contiguous change block. Line offsets are 0-based. */
    public static final class Hunk {
        public final int index;
        public final int oldStart;
        public final List<String> oldLines;
        public final int newStart;
        public final List<String> newLines;
        /** e.g. {@code "lines 12-14 (-3 +5)"} — matches the VS Code header shape. */
        public final String header;
        /** First changed line, trimmed, ≤60 chars — the picker's one-line preview. */
        public final String preview;

        Hunk(int index, int oldStart, List<String> oldLines, int newStart, List<String> newLines) {
            this.index = index;
            this.oldStart = oldStart;
            this.oldLines = oldLines;
            this.newStart = newStart;
            this.newLines = newLines;
            int oldCount = oldLines.size();
            int newCount = newLines.size();
            String where = oldCount > 0
                    ? (oldStart + 1) + "-" + (oldStart + oldCount)
                    : oldStart + "+"; // pure insertion sits between lines
            this.header = "lines " + where + " (-" + oldCount + " +" + newCount + ")";
            String first = newCount > 0 ? newLines.get(0) : "- " + oldLines.get(0);
            first = first.trim();
            this.preview = first.length() > 60 ? first.substring(0, 60) : first;
        }
    }

    private static List<String> splitLines(String text) {
        String s = text == null ? "" : text;
        List<String> out = new ArrayList<String>();
        int start = 0;
        while (true) {
            int nl = s.indexOf('\n', start);
            if (nl < 0) {
                out.add(s.substring(start));
                return out;
            }
            out.add(s.substring(start, nl));
            start = nl + 1;
        }
    }

    /** Contiguous change blocks between {@code original} and {@code modified}. */
    public static List<Hunk> computeHunks(String original, String modified) {
        List<Hunk> hunks = new ArrayList<Hunk>();
        String o = original == null ? "" : original;
        String m = modified == null ? "" : modified;
        if (o.equals(m)) return hunks;
        List<String> oldL = splitLines(o);
        List<String> newL = splitLines(m);

        // common prefix / suffix
        int pre = 0;
        while (pre < oldL.size() && pre < newL.size() && oldL.get(pre).equals(newL.get(pre))) {
            pre++;
        }
        int endO = oldL.size();
        int endN = newL.size();
        while (endO > pre && endN > pre && oldL.get(endO - 1).equals(newL.get(endN - 1))) {
            endO--;
            endN--;
        }
        List<String> midO = new ArrayList<String>(oldL.subList(pre, endO));
        List<String> midN = new ArrayList<String>(newL.subList(pre, endN));

        // size guard → one whole-change hunk (degrades to accept/reject-all)
        if ((long) (midO.size() + 1) * (midN.size() + 1) > MAX_DP_CELLS) {
            hunks.add(new Hunk(0, pre, midO, pre, midN));
            return hunks;
        }

        // LCS DP over the middle
        int n = midO.size();
        int mm = midN.size();
        int w = mm + 1;
        int[] dp = new int[(n + 1) * w];
        for (int i = n - 1; i >= 0; i--) {
            for (int j = mm - 1; j >= 0; j--) {
                dp[i * w + j] = midO.get(i).equals(midN.get(j))
                        ? dp[(i + 1) * w + j + 1] + 1
                        : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
            }
        }

        // backtrack → group contiguous del/add runs into hunks
        int i = 0;
        int j = 0;
        List<String> curOld = null;
        List<String> curNew = null;
        int curOldStart = 0;
        int curNewStart = 0;
        while (i < n || j < mm) {
            if (i < n && j < mm && midO.get(i).equals(midN.get(j))) {
                if (curOld != null) {
                    hunks.add(new Hunk(hunks.size(), curOldStart, curOld, curNewStart, curNew));
                    curOld = null;
                    curNew = null;
                }
                i++;
                j++;
            } else {
                if (curOld == null) {
                    curOld = new ArrayList<String>();
                    curNew = new ArrayList<String>();
                    curOldStart = pre + i;
                    curNewStart = pre + j;
                }
                if (j < mm && (i >= n || dp[i * w + j + 1] >= dp[(i + 1) * w + j])) {
                    curNew.add(midN.get(j));
                    j++;
                } else {
                    curOld.add(midO.get(i));
                    i++;
                }
            }
        }
        if (curOld != null) {
            hunks.add(new Hunk(hunks.size(), curOldStart, curOld, curNewStart, curNew));
        }
        return hunks;
    }

    /**
     * Rebuild the file with only the hunks whose {@code index} is in
     * {@code selectedIndices} applied; unselected hunks keep the ORIGINAL lines.
     */
    public static String applyHunks(String original, List<Hunk> hunks, Set<Integer> selectedIndices) {
        List<String> oldL = splitLines(original == null ? "" : original);
        List<Hunk> sorted = new ArrayList<Hunk>(hunks == null ? new ArrayList<Hunk>() : hunks);
        sorted.sort((a, b) -> Integer.compare(a.oldStart, b.oldStart));
        List<String> out = new ArrayList<String>();
        int cursor = 0;
        for (Hunk h : sorted) {
            out.addAll(oldL.subList(cursor, h.oldStart));
            out.addAll(selectedIndices != null && selectedIndices.contains(h.index) ? h.newLines : h.oldLines);
            cursor = h.oldStart + h.oldLines.size();
        }
        out.addAll(oldL.subList(cursor, oldL.size()));
        return String.join("\n", out);
    }
}
