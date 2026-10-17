package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.MarkdownLite;
import javax.swing.text.AttributeSet;
import javax.swing.text.BadLocationException;
import javax.swing.text.StyledDocument;
import java.util.List;

/** One display projection for live and saved assistant text. Canonical raw text
 * stays on the transcript row; display offsets always use rendered lengths. */
final class ChatTranscriptRendering {
    private final AttributeSet plain, code, bold;

    ChatTranscriptRendering(AttributeSet plain, AttributeSet code, AttributeSet bold) {
        this.plain = plain; this.code = code; this.bold = bold;
    }

    private static List<MarkdownLite.Span> spans(String role, String text) {
        return "assistant".equals(role) ? MarkdownLite.parse(text)
                : List.of(new MarkdownLite.Span(MarkdownLite.Kind.TEXT, text));
    }

    static int length(String role, String text) {
        return spans(role, text).stream().mapToInt(span -> span.text.length()).sum();
    }

    int insert(StyledDocument document, int offset, String role, String text) throws BadLocationException {
        int end = offset;
        for (MarkdownLite.Span span : spans(role, text)) {
            AttributeSet style = span.kind == MarkdownLite.Kind.CODE ? code
                    : span.kind == MarkdownLite.Kind.BOLD ? bold : plain;
            document.insertString(end, span.text, style);
            end += span.text.length();
        }
        return end - offset;
    }
}
