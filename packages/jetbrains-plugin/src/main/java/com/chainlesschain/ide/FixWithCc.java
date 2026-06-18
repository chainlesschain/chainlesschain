package com.chainlesschain.ide;

import java.util.List;

/**
 * "Fix with ChainlessChain" — pure helpers for the diagnostics quick-fix
 * (Claude-Code IDE parity: an intention/quick-fix on an error or warning that
 * seeds the chat with a fix request scoped to THIS file + THESE problems).
 * Mirrors the VS Code panel's {@code fix-with-cc.js}. SDK-free, Java 8, testable;
 * the IntentionAction glue lives in {@code intellij/FixWithCcIntention}.
 */
public final class FixWithCc {
    private FixWithCc() {}

    public static final int MAX_DIAGNOSTICS = 10;  // a fix request shouldn't dump a whole noisy file
    public static final int MAX_MESSAGE_LEN = 300;

    /** A single diagnostic, already reduced to plain strings (no SDK types). */
    public static final class Diag {
        public final int line;        // 0-based
        public final String severity; // "Error" / "Warning" / "Info" / "Hint"
        public final String message;
        public final String source;   // inspection source, may be null
        public final String code;     // inspection code/id, may be null

        public Diag(int line, String severity, String message, String source, String code) {
            this.line = line;
            this.severity = severity == null ? "Problem" : severity;
            this.message = message == null ? "" : message;
            this.source = source;
            this.code = code;
        }
    }

    private static boolean notBlank(String s) {
        return s != null && !s.trim().isEmpty();
    }

    /** Collapse whitespace + truncate a (possibly multi-line) diagnostic message. */
    public static String tidyMessage(String msg) {
        String s = (msg == null ? "" : msg).replaceAll("\\s+", " ").trim();
        return s.length() > MAX_MESSAGE_LEN ? s.substring(0, MAX_MESSAGE_LEN - 1) + "…" : s;
    }

    /** One human-readable bullet: {@code - [Error] line 13: <msg> (source code)}. */
    public static String formatDiagnosticLine(Diag d) {
        int line = d.line + 1; // 0-based → 1-based
        String where = notBlank(d.source)
                ? d.source.trim() + (notBlank(d.code) ? " " + d.code.trim() : "")
                : (notBlank(d.code) ? d.code.trim() : "");
        String tail = where.isEmpty() ? "" : " (" + where + ")";
        return "- [" + d.severity + "] line " + line + ": " + tidyMessage(d.message) + tail;
    }

    /** Lightbulb / menu title — singular vs counted. */
    public static String buildFixActionTitle(int n) {
        return n > 1 ? "Fix " + n + " problems with ChainlessChain" : "Fix with ChainlessChain";
    }

    /**
     * Build the prompt seeded into the chat input. References the file as
     * {@code @<relPath>} so the CLI's file-ref expander attaches its contents,
     * then lists the problems. Returns "" when there is nothing to fix.
     */
    public static String formatFixPrompt(String relPath, List<Diag> diagnostics) {
        if (diagnostics == null || diagnostics.isEmpty()) return "";
        int shown = Math.min(diagnostics.size(), MAX_DIAGNOSTICS);
        String path = relPath == null ? "" : relPath.replace('\\', '/').trim();
        String target = path.isEmpty() ? "this file" : "@" + path;
        String noun = shown > 1 ? "problems" : "problem";
        StringBuilder sb = new StringBuilder();
        sb.append("Fix the following ").append(noun).append(" in ").append(target)
                .append(" and briefly explain the change:");
        for (int i = 0; i < shown; i++) sb.append("\n").append(formatDiagnosticLine(diagnostics.get(i)));
        if (diagnostics.size() > MAX_DIAGNOSTICS) {
            sb.append("\n- …and ").append(diagnostics.size() - MAX_DIAGNOSTICS).append(" more");
        }
        return sb.append("\n").toString();
    }
}
