package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
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
}
