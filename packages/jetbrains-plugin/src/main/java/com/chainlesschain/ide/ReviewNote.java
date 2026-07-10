package com.chainlesschain.ide;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Parse one "Request changes…" review note into the VS-Code comment shape
 * {@code { line?, endLine?, lineText?, note }} (0-based editor lines).
 *
 * VS Code anchors a note to the reviewer's selection in the diff's right pane;
 * JetBrains collects notes through a modal input after the diff window closed,
 * so the anchor rides IN the text instead: an optional {@code "12:"} or
 * {@code "12-15:"} prefix (1-based, as displayed in the diff gutter; full-width
 * {@code ：} accepted). {@code lineText} is copied from the reviewed text so the
 * CLI's formatReviewComments renders the same anchored feedback either way.
 *
 * Pure JDK, no IntelliJ SDK — smoke/JUnit testable.
 */
public final class ReviewNote {

    private ReviewNote() {}

    /** {@code "12: note"} / {@code "12-15: note"} — 1-based line anchor prefix. */
    private static final Pattern ANCHOR =
            Pattern.compile("^\\s*(\\d{1,6})(?:\\s*-\\s*(\\d{1,6}))?\\s*[:：]\\s*(\\S.*)$", Pattern.DOTALL);

    /**
     * @param input        raw reviewer input (one note)
     * @param reviewedText the right-pane text the reviewer was looking at
     *                     (possibly user-edited); anchors resolve against it
     * @return comment map in the VS Code shape, or null for blank input
     */
    public static Map<String, Object> parse(String input, String reviewedText) {
        if (input == null) return null;
        String raw = input.trim();
        if (raw.isEmpty()) return null;

        Map<String, Object> c = new LinkedHashMap<>();
        Matcher m = ANCHOR.matcher(raw);
        if (m.matches()) {
            String[] lines = (reviewedText == null ? "" : reviewedText).split("\n", -1);
            int start = parseIntSafe(m.group(1));
            int end = m.group(2) != null ? parseIntSafe(m.group(2)) : start;
            if (end < start) { int t = start; start = end; end = t; } // forgive "15-12:"
            // Anchor only when the start line exists in the reviewed text —
            // a stale/typo'd number degrades to a general note, never a lie.
            if (start >= 1 && start <= lines.length) {
                int line = start - 1;                              // 1-based → 0-based
                int endLine = Math.min(end, lines.length) - 1;
                c.put("line", line);
                c.put("endLine", endLine);
                c.put("lineText", lines[line]);
                c.put("note", m.group(3).trim());
                return c;
            }
        }
        c.put("note", raw); // no (valid) anchor → general note, keep the full text
        return c;
    }

    private static int parseIntSafe(String s) {
        try {
            return Integer.parseInt(s);
        } catch (NumberFormatException e) {
            return -1; // \d{1,6} can't overflow, but stay total anyway
        }
    }
}
