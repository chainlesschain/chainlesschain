package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;

/** {@link ReviewNote#parse} — the "12:" / "12-15:" line-anchor prefix parser. */
class ReviewNoteTest {

    private static final String TEXT = "alpha\nbeta\ngamma\ndelta\nepsilon";

    @Test
    void blankInputEndsTheLoop() {
        assertNull(ReviewNote.parse(null, TEXT));
        assertNull(ReviewNote.parse("", TEXT));
        assertNull(ReviewNote.parse("   ", TEXT));
    }

    @Test
    void plainNoteHasNoAnchor() {
        Map<String, Object> c = ReviewNote.parse("use a guard clause here", TEXT);
        assertEquals("use a guard clause here", c.get("note"));
        assertFalse(c.containsKey("line"));
        assertFalse(c.containsKey("lineText"));
    }

    @Test
    void singleLineAnchorIsZeroBasedWithLineText() {
        Map<String, Object> c = ReviewNote.parse("2: rename this variable", TEXT);
        assertEquals(1, c.get("line"));
        assertEquals(1, c.get("endLine"));
        assertEquals("beta", c.get("lineText"));
        assertEquals("rename this variable", c.get("note"));
    }

    @Test
    void rangeAnchorSpansLines() {
        Map<String, Object> c = ReviewNote.parse("2-4: extract these into a helper", TEXT);
        assertEquals(1, c.get("line"));
        assertEquals(3, c.get("endLine"));
        assertEquals("beta", c.get("lineText"));
        assertEquals("extract these into a helper", c.get("note"));
    }

    @Test
    void reversedRangeIsForgiven() {
        Map<String, Object> c = ReviewNote.parse("4-2: same but backwards", TEXT);
        assertEquals(1, c.get("line"));
        assertEquals(3, c.get("endLine"));
    }

    @Test
    void endLineClampsToLastLine() {
        Map<String, Object> c = ReviewNote.parse("3-99: tail range", TEXT);
        assertEquals(2, c.get("line"));
        assertEquals(4, c.get("endLine")); // 5 lines → last 0-based index 4
    }

    @Test
    void outOfRangeStartDegradesToGeneralNote() {
        Map<String, Object> c = ReviewNote.parse("99: stale anchor", TEXT);
        assertFalse(c.containsKey("line"));
        assertEquals("99: stale anchor", c.get("note")); // keep the full text — never invent an anchor
    }

    @Test
    void zeroLineIsNotAnAnchor() {
        Map<String, Object> c = ReviewNote.parse("0: lines are 1-based", TEXT);
        assertFalse(c.containsKey("line"));
        assertEquals("0: lines are 1-based", c.get("note"));
    }

    @Test
    void fullWidthColonAnchors() {
        Map<String, Object> c = ReviewNote.parse("2：全角冒号也可以", TEXT);
        assertEquals(1, c.get("line"));
        assertEquals("全角冒号也可以", c.get("note"));
    }

    @Test
    void anchorWithoutNoteTextIsAGeneralNote() {
        Map<String, Object> c = ReviewNote.parse("12:", TEXT);
        assertFalse(c.containsKey("line"));
        assertEquals("12:", c.get("note"));
    }

    @Test
    void anchorsResolveAgainstTheReviewedTextItWasGiven() {
        Map<String, Object> c = ReviewNote.parse("1: top", "edited first line\nrest");
        assertEquals(0, c.get("line"));
        assertEquals("edited first line", c.get("lineText"));
    }
}
