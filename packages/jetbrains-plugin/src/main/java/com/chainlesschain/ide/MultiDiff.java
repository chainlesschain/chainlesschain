package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Pure helpers for multi-file diff review (openMultiDiff — batch review of a
 * whole changeset at once) — a direct port of the VS Code extension's
 * multi-diff.js. Normalizes the proposed file set, computes a per-file +/-
 * summary, and resolves a per-file accept decision into the writes to perform.
 * No IntelliJ SDK; the per-file line counts use an inline LCS (equivalent to the
 * JS diff-hunks totals), so it compiles + tests with plain {@code javac}. The
 * IntelliJ glue opens the native multi-file diff; this stays host-free.
 */
public final class MultiDiff {

    private MultiDiff() {}

    /** One proposed file change. originalText null == "diff against disk / new file". */
    public static final class FileChange {
        public final String path;
        public final String modifiedText;
        public final String originalText; // nullable
        public FileChange(String path, String modifiedText, String originalText) {
            this.path = path;
            this.modifiedText = modifiedText;
            this.originalText = originalText;
        }
    }

    /** Per-file change stats for the review UI. */
    public static final class FileStat {
        public final String path;
        public final int added;
        public final int removed;
        public final boolean isNew;
        public final boolean unchanged;
        FileStat(String path, int added, int removed, boolean isNew, boolean unchanged) {
            this.path = path;
            this.added = added;
            this.removed = removed;
            this.isNew = isNew;
            this.unchanged = unchanged;
        }
    }

    /** Changeset summary: per-file stats + totals. */
    public static final class Summary {
        public final List<FileStat> files;
        public final int count;
        public final int totalAdded;
        public final int totalRemoved;
        Summary(List<FileStat> files, int count, int totalAdded, int totalRemoved) {
            this.files = files;
            this.count = count;
            this.totalAdded = totalAdded;
            this.totalRemoved = totalRemoved;
        }
    }

    /**
     * Keep valid {@code {path, modifiedText}} entries, deduped by path (last
     * write wins). originalText defaults to null.
     */
    public static List<FileChange> normalizeMultiDiffFiles(List<FileChange> files) {
        Map<String, FileChange> byPath = new LinkedHashMap<String, FileChange>();
        if (files != null) {
            for (FileChange f : files) {
                if (f == null || f.path == null || f.path.isEmpty()) continue;
                if (f.modifiedText == null) continue;
                byPath.put(f.path, new FileChange(f.path, f.modifiedText, f.originalText));
            }
        }
        return new ArrayList<FileChange>(byPath.values());
    }

    /** Per-file added/removed line counts + new/unchanged flags. */
    public static FileStat fileStat(FileChange f) {
        String original = f.originalText != null ? f.originalText : "";
        String modified = f.modifiedText;
        if (original.equals(modified)) {
            return new FileStat(f.path, 0, 0, false, true);
        }
        // Whole-file add or delete: count lines directly (no phantom empty line).
        if (original.isEmpty() || modified.isEmpty()) {
            int added = modified.isEmpty() ? 0 : countLines(modified);
            int removed = original.isEmpty() ? 0 : countLines(original);
            return new FileStat(f.path, added, removed,
                    original.isEmpty() && !modified.isEmpty(), false);
        }
        int[] c = diffCounts(original, modified);
        return new FileStat(f.path, c[0], c[1], false, false);
    }

    /** Changeset summary for the review UI: per-file stats + totals. */
    public static Summary changesetSummary(List<FileChange> files) {
        List<FileChange> norm = normalizeMultiDiffFiles(files);
        List<FileStat> stats = new ArrayList<FileStat>();
        int added = 0, removed = 0;
        for (FileChange f : norm) {
            FileStat s = fileStat(f);
            stats.add(s);
            added += s.added;
            removed += s.removed;
        }
        return new Summary(stats, norm.size(), added, removed);
    }

    /** One-line label for a file in the pick list, e.g. "src/a.js  +12 -3 (new)". */
    public static String fileLabel(FileStat s) {
        StringBuilder counts = new StringBuilder();
        if (s.added != 0) counts.append("+").append(s.added);
        if (s.removed != 0) {
            if (counts.length() > 0) counts.append(" ");
            counts.append("-").append(s.removed);
        }
        if (counts.length() == 0) counts.append("±0"); // ±0
        String flag = s.isNew ? " (new)" : (s.unchanged ? " (unchanged)" : "");
        return (s.path + "  " + counts + flag).trim();
    }

    /**
     * Resolve which files to write. {@code selectedPaths} null → accept ALL;
     * otherwise only the listed paths. Unchanged files are dropped either way.
     */
    public static List<FileChange> selectWrites(List<FileChange> files, Set<String> selectedPaths) {
        List<FileChange> out = new ArrayList<FileChange>();
        for (FileChange f : normalizeMultiDiffFiles(files)) {
            String original = f.originalText != null ? f.originalText : "";
            if (original.equals(f.modifiedText)) continue; // skip no-ops
            if (selectedPaths != null && !selectedPaths.contains(f.path)) continue;
            out.add(new FileChange(f.path, f.modifiedText, null));
        }
        return out;
    }

    // ── internals ──────────────────────────────────────────────────────────

    private static int countLines(String s) {
        if (s.isEmpty()) return 0;
        return s.split("\\n", -1).length;
    }

    /**
     * Added/removed line counts via an LCS of the two line sequences — same
     * totals the JS diff-hunks produces (a replaced line counts as -1 +1).
     * @return int[]{ added, removed }
     */
    private static int[] diffCounts(String original, String modified) {
        String[] a = original.split("\\n", -1);
        String[] b = modified.split("\\n", -1);
        int n = a.length, m = b.length;
        // LCS length via DP.
        int[][] dp = new int[n + 1][m + 1];
        for (int i = n - 1; i >= 0; i--) {
            for (int j = m - 1; j >= 0; j--) {
                if (a[i].equals(b[j])) {
                    dp[i][j] = dp[i + 1][j + 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
                }
            }
        }
        int lcs = dp[0][0];
        int removed = n - lcs;
        int added = m - lcs;
        return new int[] { added, removed };
    }
}
