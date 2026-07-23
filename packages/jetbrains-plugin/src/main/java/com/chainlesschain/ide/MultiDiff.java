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
 * No IntelliJ SDK; per-file line counts reuse the bounded {@link DiffHunks}
 * LCS (equivalent to the JS twin), so it compiles + tests with plain
 * {@code javac}. The IntelliJ glue opens the native multi-file diff; this stays
 * host-free.
 */
public final class MultiDiff {

    public static final int MAX_REVIEW_CHANGESET_FILES = 64;
    public static final long MAX_REVIEW_CHANGESET_BYTES = 8L * 1024L * 1024L;
    public static final String REASON_CHANGESET_LIMIT =
            "changeset exceeds IDE diff review limits";

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

    /** One entry omitted from native review; never contains file content. */
    public static final class ReviewSkip {
        public final String path;
        public final String kind;
        public final String reason;
        public final long bytes;
        public final long limitBytes;

        ReviewSkip(String path, String kind, String reason, long bytes, long limitBytes) {
            this.path = path;
            this.kind = kind;
            this.reason = reason;
            this.bytes = bytes;
            this.limitBytes = limitBytes;
        }
    }

    /** Deterministic, bounded subset safe to materialize in the IDE. */
    public static final class ReviewPlan {
        public final List<FileChange> reviewable;
        public final List<ReviewSkip> skipped;
        public final long totalBytes;
        public final long maxFileBytes;
        public final int maxFiles;
        public final long maxTotalBytes;

        ReviewPlan(
                List<FileChange> reviewable,
                List<ReviewSkip> skipped,
                long totalBytes,
                long maxFileBytes,
                int maxFiles,
                long maxTotalBytes) {
            this.reviewable = reviewable;
            this.skipped = skipped;
            this.totalBytes = totalBytes;
            this.maxFileBytes = maxFileBytes;
            this.maxFiles = maxFiles;
            this.maxTotalBytes = maxTotalBytes;
        }

        public boolean degraded() {
            return !skipped.isEmpty();
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

    /**
     * Partition before native editor documents or LCS state are created.
     * Binary/large entries and entries beyond aggregate limits are reported,
     * never silently applied.
     */
    public static ReviewPlan planReview(
            List<FileChange> files,
            Map<String, byte[]> currentBytes,
            long maxFileBytes,
            int maxFiles,
            long maxTotalBytes) {
        return planReview(
                files,
                currentBytes,
                null,
                maxFileBytes,
                maxFiles,
                maxTotalBytes);
    }

    public static ReviewPlan planReview(
            List<FileChange> files,
            Map<String, byte[]> currentBytes,
            Map<String, Long> currentSizes,
            long maxFileBytes,
            int maxFiles,
            long maxTotalBytes) {
        long fileByteLimit = maxFileBytes > 0
                ? maxFileBytes : DiffApplyGuard.MAX_REVIEW_FILE_BYTES;
        int fileCountLimit = maxFiles > 0 ? maxFiles : MAX_REVIEW_CHANGESET_FILES;
        long totalByteLimit = maxTotalBytes > 0
                ? maxTotalBytes : MAX_REVIEW_CHANGESET_BYTES;
        List<FileChange> reviewable = new ArrayList<FileChange>();
        List<ReviewSkip> skipped = new ArrayList<ReviewSkip>();
        long totalBytes = 0L;
        for (FileChange file : normalizeMultiDiffFiles(files)) {
            String original = file.originalText != null ? file.originalText : "";
            if (original.equals(file.modifiedText)) continue;
            byte[] disk = file.originalText == null && currentBytes != null
                    ? currentBytes.get(file.path) : null;
            Long diskSize = file.originalText == null && currentSizes != null
                    ? currentSizes.get(file.path) : null;
            DiffApplyGuard.ReviewPayload payload = DiffApplyGuard.checkReviewPayload(
                    file.modifiedText,
                    file.originalText,
                    disk,
                    diskSize,
                    fileByteLimit);
            if (!payload.reviewable) {
                skipped.add(new ReviewSkip(
                        file.path,
                        payload.kind,
                        payload.reason,
                        payload.bytes,
                        payload.limitBytes));
                continue;
            }
            if (reviewable.size() >= fileCountLimit
                    || totalBytes + payload.bytes > totalByteLimit) {
                skipped.add(new ReviewSkip(
                        file.path,
                        "changeset-limit",
                        REASON_CHANGESET_LIMIT,
                        payload.bytes,
                        totalByteLimit));
                continue;
            }
            reviewable.add(file);
            totalBytes += payload.bytes;
        }
        return new ReviewPlan(
                reviewable,
                skipped,
                totalBytes,
                fileByteLimit,
                fileCountLimit,
                totalByteLimit);
    }

    public static ReviewPlan planReview(
            List<FileChange> files, Map<String, byte[]> currentBytes) {
        return planReview(
                files,
                currentBytes,
                DiffApplyGuard.MAX_REVIEW_FILE_BYTES,
                MAX_REVIEW_CHANGESET_FILES,
                MAX_REVIEW_CHANGESET_BYTES);
    }

    // ── internals ──────────────────────────────────────────────────────────

    private static int countLines(String s) {
        if (s.isEmpty()) return 0;
        return s.split("\\n", -1).length;
    }

    /**
     * Added/removed line counts via the bounded DiffHunks LCS — same totals
     * the JS twin produces (a replaced line counts as -1 +1).
     * @return int[]{ added, removed }
     */
    private static int[] diffCounts(String original, String modified) {
        int removed = 0;
        int added = 0;
        for (DiffHunks.Hunk h : DiffHunks.computeHunks(original, modified)) {
            removed += h.oldLines.size();
            added += h.newLines.size();
        }
        return new int[] { added, removed };
    }
}
