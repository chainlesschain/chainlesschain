package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.List;

/**
 * A tiny, dependency-free Markdown tokenizer for the chat transcript: splits an
 * assistant message into styled spans the Swing view renders with attributes
 * (monospace for code, bold for emphasis). Deliberately minimal — fenced
 * ```code```, inline `code`, and **bold** — because that covers the vast
 * majority of what a coding assistant emits, and unclosed markers degrade
 * gracefully to plain text (never throws, never loses characters). SDK-free,
 * Java 8, fully unit-testable; the JTextPane glue lives in ConversationView.
 */
public final class MarkdownLite {
    private MarkdownLite() {}

    public enum Kind { TEXT, CODE, BOLD }

    public static final class Span {
        public final Kind kind;
        public final String text;

        public Span(Kind kind, String text) {
            this.kind = kind;
            this.text = text == null ? "" : text;
        }

        @Override
        public boolean equals(Object o) {
            if (!(o instanceof Span)) return false;
            Span s = (Span) o;
            return kind == s.kind && text.equals(s.text);
        }

        @Override
        public int hashCode() {
            return kind.hashCode() * 31 + text.hashCode();
        }

        @Override
        public String toString() {
            return kind + "(" + text + ")";
        }
    }

    /**
     * Parse `md` into a flat list of spans, in order. The concatenation of all
     * span texts equals the rendered text (markers removed), so the view can
     * insert each span with its style and lose nothing.
     */
    public static List<Span> parse(String md) {
        List<Span> out = new ArrayList<>();
        if (md == null || md.isEmpty()) return out;
        StringBuilder buf = new StringBuilder();
        int i = 0;
        int n = md.length();
        while (i < n) {
            // Fenced code block: ``` … ``` (optionally with a language tag line).
            if (md.startsWith("```", i)) {
                int close = md.indexOf("```", i + 3);
                if (close >= 0) {
                    flush(out, buf);
                    String body = md.substring(i + 3, close);
                    int nl = body.indexOf('\n');
                    if (nl >= 0) {
                        String first = body.substring(0, nl).trim();
                        // drop a leading language tag (e.g. ```java\n…)
                        if (!first.isEmpty() && first.matches("[A-Za-z0-9+#._-]+")) {
                            body = body.substring(nl + 1);
                        }
                    }
                    out.add(new Span(Kind.CODE, body));
                    i = close + 3;
                    continue;
                }
            }
            char c = md.charAt(i);
            // Inline code: `…`
            if (c == '`') {
                int close = md.indexOf('`', i + 1);
                if (close > i) {
                    flush(out, buf);
                    out.add(new Span(Kind.CODE, md.substring(i + 1, close)));
                    i = close + 1;
                    continue;
                }
            }
            // Bold: **…**
            if (c == '*' && i + 1 < n && md.charAt(i + 1) == '*') {
                int close = md.indexOf("**", i + 2);
                if (close > i + 1) {
                    flush(out, buf);
                    out.add(new Span(Kind.BOLD, md.substring(i + 2, close)));
                    i = close + 2;
                    continue;
                }
            }
            buf.append(c);
            i++;
        }
        flush(out, buf);
        return out;
    }

    private static void flush(List<Span> out, StringBuilder buf) {
        if (buf.length() > 0) {
            out.add(new Span(Kind.TEXT, buf.toString()));
            buf.setLength(0);
        }
    }
}
