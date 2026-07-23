package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link MultiDiff} layer. */
class MultiDiffTest {

    @Test
    void normalizeDedupesLastWriteWinsAndDropsInvalid() {
        List<MultiDiff.FileChange> raw = new ArrayList<>();
        raw.add(new MultiDiff.FileChange("a.js", "1", null));
        raw.add(new MultiDiff.FileChange("a.js", "2", null)); // supersedes
        raw.add(new MultiDiff.FileChange("b.js", null, null)); // no modified -> dropped
        raw.add(new MultiDiff.FileChange("c.js", "z", "y"));
        List<MultiDiff.FileChange> norm = MultiDiff.normalizeMultiDiffFiles(raw);
        assertEquals(2, norm.size());
        assertEquals("a.js", norm.get(0).path);
        assertEquals("2", norm.get(0).modifiedText);
    }

    @Test
    void changesetSummaryTotalsAddedRemovedAndFlagsNewFile() {
        List<MultiDiff.FileChange> cs = new ArrayList<>();
        cs.add(new MultiDiff.FileChange("edit.js", "a\nX\nc", "a\nb\nc")); // +1 -1
        cs.add(new MultiDiff.FileChange("new.js", "hello\nworld", "")); // +2 new
        MultiDiff.Summary sum = MultiDiff.changesetSummary(cs);
        assertEquals(2, sum.count);
        assertEquals(3, sum.totalAdded);
        assertEquals(1, sum.totalRemoved);
        MultiDiff.FileStat fresh = sum.files.get(1);
        assertTrue(fresh.isNew);
        assertEquals(2, fresh.added);
        assertEquals(0, fresh.removed);
    }

    @Test
    void changesetSummaryFlagsUnchangedFile() {
        MultiDiff.Summary same = MultiDiff.changesetSummary(
                Arrays.asList(new MultiDiff.FileChange("same.js", "x\ny", "x\ny")));
        assertTrue(same.files.get(0).unchanged);
    }

    @Test
    void fileLabelRendersCounts() {
        assertEquals("a.js  +12 -3",
                MultiDiff.fileLabel(new MultiDiff.FileStat("a.js", 12, 3, false, false)));
    }

    @Test
    void fileLabelRendersNewFlag() {
        assertEquals("n.js  +5 (new)",
                MultiDiff.fileLabel(new MultiDiff.FileStat("n.js", 5, 0, true, false)));
    }

    @Test
    void selectWritesNullSelectsAllChangedAndDropsNoOps() {
        List<MultiDiff.FileChange> files = Arrays.asList(
                new MultiDiff.FileChange("a.js", "2", "1"),
                new MultiDiff.FileChange("b.js", "y", "x"),
                new MultiDiff.FileChange("noop.js", "same", "same"));
        List<MultiDiff.FileChange> all = MultiDiff.selectWrites(files, null);
        assertEquals(2, all.size());
    }

    @Test
    void selectWritesSubsetDropsNoOpAndKeepsPicked() {
        List<MultiDiff.FileChange> files = Arrays.asList(
                new MultiDiff.FileChange("a.js", "2", "1"),
                new MultiDiff.FileChange("b.js", "y", "x"),
                new MultiDiff.FileChange("noop.js", "same", "same"));
        Set<String> pick = new HashSet<>(Arrays.asList("a.js", "noop.js"));
        List<MultiDiff.FileChange> sub = MultiDiff.selectWrites(files, pick);
        assertEquals(1, sub.size());
        assertEquals("a.js", sub.get(0).path);
    }

    @Test
    void selectWritesEmptySelectionWritesNothing() {
        List<MultiDiff.FileChange> files = Arrays.asList(
                new MultiDiff.FileChange("a.js", "2", "1"),
                new MultiDiff.FileChange("b.js", "y", "x"),
                new MultiDiff.FileChange("noop.js", "same", "same"));
        assertEquals(0, MultiDiff.selectWrites(files, new HashSet<>()).size());
    }

    @Test
    void normalizesPosixAndGitFileModes() {
        assertEquals(0755, MultiDiff.normalizeFileMode(0755));
        assertEquals(0755, MultiDiff.normalizeFileMode("755"));
        assertEquals(0755, MultiDiff.normalizeFileMode("100755"));
        assertEquals(0644, MultiDiff.normalizeFileMode("100644"));
        assertNull(MultiDiff.normalizeFileMode("888"));
        assertNull(MultiDiff.normalizeFileMode(0100755));
    }

    @Test
    void preservesMixedLifecycleIntentInLabelsAndSelectedWrites() {
        List<MultiDiff.FileChange> files = Arrays.asList(
                new MultiDiff.FileChange(
                        "old.txt", "moved", "moved",
                        "rename", "new.txt", null, null),
                new MultiDiff.FileChange(
                        "gone.txt", "", "gone",
                        "delete", null, null, null),
                new MultiDiff.FileChange(
                        "run.sh", "echo ok", "echo ok",
                        "mode-change", null, "100644", "100755"));
        MultiDiff.Summary summary = MultiDiff.changesetSummary(files);
        assertTrue(MultiDiff.fileLabel(summary.files.get(0)).contains("new.txt"));
        assertTrue(MultiDiff.fileLabel(summary.files.get(1)).contains("delete"));
        assertTrue(MultiDiff.fileLabel(summary.files.get(2)).contains("100755"));

        List<MultiDiff.FileChange> writes = MultiDiff.selectWrites(files, null);
        assertEquals(3, writes.size());
        assertEquals("rename", writes.get(0).operation);
        assertEquals("new.txt", writes.get(0).targetPath);
        assertEquals("100755", writes.get(2).newMode);
        assertNull(writes.get(0).originalText);
    }

    @Test
    void modeChangeDegradesExplicitlyWhenTheHostCannotApplyIt() {
        MultiDiff.FileChange mode = new MultiDiff.FileChange(
                "run.sh", "echo ok", "echo ok",
                "mode-change", null, "100644", "100755");
        MultiDiff.ReviewPlan unsupported = MultiDiff.planReview(
                Arrays.asList(mode), null, null, 100, 10, 100, false);
        assertTrue(unsupported.reviewable.isEmpty());
        assertEquals(1, unsupported.skipped.size());
        assertEquals("unsupported-operation", unsupported.skipped.get(0).kind);
        assertEquals(
                MultiDiff.REASON_MODE_CHANGE_UNSUPPORTED,
                unsupported.skipped.get(0).reason);
        assertEquals("mode-change", unsupported.skipped.get(0).operation);

        MultiDiff.ReviewPlan supported = MultiDiff.planReview(
                Arrays.asList(mode), null, null, 100, 10, 100, true);
        assertEquals(1, supported.reviewable.size());
        assertFalse(supported.degraded());
    }

    @Test
    void malformedLifecycleEntriesAreSkippedWithoutContent() {
        List<MultiDiff.FileChange> files = Arrays.asList(
                new MultiDiff.FileChange(
                        "rename.txt", "x", "x",
                        "rename", null, null, null),
                new MultiDiff.FileChange(
                        "delete.txt", "not empty", "x",
                        "delete", null, null, null),
                new MultiDiff.FileChange(
                        "odd.txt", "y", "x",
                        "unknown", null, null, null));
        MultiDiff.ReviewPlan plan =
                MultiDiff.planReview(files, null, 100, 10, 1000);
        assertTrue(plan.reviewable.isEmpty());
        assertEquals(3, plan.skipped.size());
        for (MultiDiff.ReviewSkip skip : plan.skipped) {
            assertEquals("unsupported-operation", skip.kind);
            assertTrue(skip.reason.startsWith(
                    MultiDiff.REASON_UNSUPPORTED_OPERATION));
            assertEquals(0, skip.bytes);
        }
    }

    @Test
    void reviewPlanPartitionsBinaryLargeAndReviewableEntries() {
        List<MultiDiff.FileChange> files = Arrays.asList(
                new MultiDiff.FileChange("ok.js", "b", "a"),
                new MultiDiff.FileChange("large.js", "345", "12"),
                new MultiDiff.FileChange("blob.bin", "b", "a\0"));
        MultiDiff.ReviewPlan plan =
                MultiDiff.planReview(files, null, 4, 10, 100);
        assertEquals(1, plan.reviewable.size());
        assertEquals("ok.js", plan.reviewable.get(0).path);
        assertEquals(2, plan.skipped.size());
        assertEquals("large-file", plan.skipped.get(0).kind);
        assertEquals("binary", plan.skipped.get(1).kind);
        assertTrue(plan.degraded());
    }

    @Test
    void reviewPlanBoundsCountAndAggregateBytesDeterministically() {
        List<MultiDiff.FileChange> files = Arrays.asList(
                new MultiDiff.FileChange("a.js", "aa", ""),
                new MultiDiff.FileChange("b.js", "bb", ""),
                new MultiDiff.FileChange("c.js", "cc", ""));
        MultiDiff.ReviewPlan plan =
                MultiDiff.planReview(files, null, 10, 2, 3);
        assertEquals(1, plan.reviewable.size());
        assertEquals(2, plan.skipped.size());
        assertEquals(MultiDiff.REASON_CHANGESET_LIMIT, plan.skipped.get(0).reason);
        assertEquals(MultiDiff.REASON_CHANGESET_LIMIT, plan.skipped.get(1).reason);
        assertEquals(2, plan.totalBytes);
    }

    @Test
    void reviewPlanUsesDiskBytesWhenBaselineIsMissing() {
        List<MultiDiff.FileChange> files = Arrays.asList(
                new MultiDiff.FileChange("disk.bin", "text", null));
        Map<String, byte[]> disk = new HashMap<>();
        disk.put("disk.bin", new byte[] { 1, 0, 2 });
        MultiDiff.ReviewPlan plan =
                MultiDiff.planReview(files, disk, 100, 10, 100);
        assertTrue(plan.reviewable.isEmpty());
        assertEquals("binary", plan.skipped.get(0).kind);
    }

    @Test
    void reviewPlanUsesFullDiskSizeWithABoundedProbe() {
        List<MultiDiff.FileChange> files = Arrays.asList(
                new MultiDiff.FileChange("large.txt", "new", null));
        Map<String, byte[]> probes = new HashMap<>();
        probes.put("large.txt", new byte[] { 1, 2, 3, 4, 5 });
        Map<String, Long> sizes = new HashMap<>();
        sizes.put("large.txt", 100L);
        MultiDiff.ReviewPlan plan =
                MultiDiff.planReview(files, probes, sizes, 10, 10, 1000);
        assertTrue(plan.reviewable.isEmpty());
        assertEquals("large-file", plan.skipped.get(0).kind);
        assertEquals(103, plan.skipped.get(0).bytes);
    }

    @Test
    void largeLineMatrixSummaryUsesBoundedDiffHunks() {
        String original = "a\n".repeat(2500);
        String modified = "b\n".repeat(2500);
        MultiDiff.Summary summary = MultiDiff.changesetSummary(Arrays.asList(
                new MultiDiff.FileChange("large.txt", modified, original)));
        assertEquals(2500, summary.totalAdded);
        assertEquals(2500, summary.totalRemoved);
    }
}
