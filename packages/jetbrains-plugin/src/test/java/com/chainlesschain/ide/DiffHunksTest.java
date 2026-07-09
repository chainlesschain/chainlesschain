package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link DiffHunks} layer. */
class DiffHunksTest {

    private static Set<Integer> indices(int... xs) {
        Set<Integer> s = new HashSet<>();
        for (int x : xs) s.add(x);
        return s;
    }

    private static Set<Integer> allIndices(List<DiffHunks.Hunk> hunks) {
        Set<Integer> s = new HashSet<>();
        for (DiffHunks.Hunk h : hunks) s.add(h.index);
        return s;
    }

    @Test
    void identicalTextYieldsNoHunks() {
        assertTrue(DiffHunks.computeHunks("a\nb\nc", "a\nb\nc").isEmpty());
    }

    @Test
    void singleReplacementIsOneHunkWith1BasedHeader() {
        List<DiffHunks.Hunk> hunks = DiffHunks.computeHunks("a\nb\nc", "a\nB\nc");
        assertEquals(1, hunks.size());
        DiffHunks.Hunk h = hunks.get(0);
        assertEquals("lines 2-2 (-1 +1)", h.header);
        assertEquals(List.of("b"), h.oldLines);
        assertEquals(List.of("B"), h.newLines);
    }

    @Test
    void applyingAllHunksReproducesTheModifiedText() {
        String original = "a\nb\nc\nd";
        String modified = "a\nB\nc\nD";
        List<DiffHunks.Hunk> hunks = DiffHunks.computeHunks(original, modified);
        assertEquals(modified, DiffHunks.applyHunks(original, hunks, allIndices(hunks)));
    }

    @Test
    void applyingNoHunksReproducesTheOriginalText() {
        String original = "a\nb\nc\nd";
        String modified = "a\nB\nc\nD";
        List<DiffHunks.Hunk> hunks = DiffHunks.computeHunks(original, modified);
        assertEquals(original, DiffHunks.applyHunks(original, hunks, indices()));
    }

    @Test
    void partialSelectionAppliesOnlyThePickedHunk() {
        // Two independent changes → two hunks; pick only the first.
        String original = "a\nb\nc\nd\ne";
        String modified = "a\nB\nc\nd\nE";
        List<DiffHunks.Hunk> hunks = DiffHunks.computeHunks(original, modified);
        assertEquals(2, hunks.size());
        assertEquals("a\nB\nc\nd\ne", DiffHunks.applyHunks(original, hunks, indices(hunks.get(0).index)));
    }

    @Test
    void pureInsertionHeaderUsesTheBetween0LineShape() {
        // Appending a line at the end is a pure insertion (oldCount 0).
        List<DiffHunks.Hunk> hunks = DiffHunks.computeHunks("a\nb", "a\nb\nc");
        assertEquals(1, hunks.size());
        assertTrue(hunks.get(0).header.startsWith("lines "), hunks.get(0).header);
        assertTrue(hunks.get(0).header.contains("-0 +1"), hunks.get(0).header);
    }

    @Test
    void previewIsTrimmedAndCappedAt60Chars() {
        String longLine = "x".repeat(200);
        List<DiffHunks.Hunk> hunks = DiffHunks.computeHunks("a", "  " + longLine + "  ");
        assertEquals(60, hunks.get(0).preview.length());
    }
}
