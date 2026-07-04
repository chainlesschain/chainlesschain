package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.MarkdownLite;
import com.chainlesschain.ide.TranscriptCap;

import javax.swing.JTextPane;
import javax.swing.text.BadLocationException;
import javax.swing.text.SimpleAttributeSet;
import javax.swing.text.StyleConstants;
import javax.swing.text.StyledDocument;
import java.awt.Color;
import java.awt.Font;

/**
 * The chat transcript pane: styled streaming text with the markdown
 * snap-on-finalize behavior and the long-session memory cap. Split out of
 * ConversationView (opportunistic split) — owns the {@link JTextPane}, the
 * four text styles, and the active assistant-run state; ConversationView
 * delegates its append*() calls here. EDT-only, like the rest of the panel.
 */
final class ChatTranscript {

    private final JTextPane pane = new JTextPane();
    private final SimpleAttributeSet stylePlain = new SimpleAttributeSet();
    private final SimpleAttributeSet styleCode = new SimpleAttributeSet();
    private final SimpleAttributeSet styleBold = new SimpleAttributeSet();
    private final SimpleAttributeSet styleDim = new SimpleAttributeSet(); // extended-thinking
    // The active assistant markdown run: [assistantRunStart, doc end) is plain
    // streamed text that gets re-styled as markdown when the run finalizes.
    private int assistantRunStart = -1;
    private boolean inAssistantRun = false;

    ChatTranscript() {
        pane.setEditable(false);
        // JTextPane wraps by default (no setLineWrap). Keep the monospace look.
        pane.setFont(new Font(Font.MONOSPACED, Font.PLAIN, pane.getFont().getSize()));
        StyleConstants.setForeground(styleCode, new Color(0xCC, 0x78, 0x32)); // amber code
        StyleConstants.setBold(styleBold, true);
        StyleConstants.setForeground(styleDim, new Color(0x80, 0x80, 0x80)); // gray thinking
        StyleConstants.setItalic(styleDim, true);
    }

    /** The Swing component (for scroll-pane wrapping and drop-target install). */
    JTextPane pane() {
        return pane;
    }

    /** A plain transcript line (header / tool / info / error). Ends any pending
     *  assistant markdown run first so it gets re-styled before this line. */
    void append(String s) {
        finalizeAssistantRun();
        insertStyled(s, stylePlain);
    }

    /** Streaming assistant text — appended plain; re-styled with markdown when
     *  the run finalizes (so streaming stays responsive, then snaps to styled). */
    void appendAssistantDelta(String s) {
        if (!inAssistantRun) {
            assistantRunStart = pane.getStyledDocument().getLength();
            inAssistantRun = true;
        }
        insertStyled(s, stylePlain);
    }

    /** Extended-thinking reasoning — streamed dim/italic, not markdown-rendered. */
    void appendThinking(String s) {
        finalizeAssistantRun();
        insertStyled(s, styleDim);
    }

    /** Re-render the just-streamed assistant run as markdown (code → monospace
     *  amber, **bold** → bold). No-op when not in a run. */
    void finalizeAssistantRun() {
        if (!inAssistantRun) return;
        inAssistantRun = false;
        StyledDocument d = pane.getStyledDocument();
        int end = d.getLength();
        int start = assistantRunStart;
        assistantRunStart = -1;
        if (start < 0 || end <= start) return;
        try {
            String text = d.getText(start, end - start);
            d.remove(start, end - start);
            for (MarkdownLite.Span span : MarkdownLite.parse(text)) {
                javax.swing.text.AttributeSet st =
                        span.kind == MarkdownLite.Kind.CODE ? styleCode
                        : span.kind == MarkdownLite.Kind.BOLD ? styleBold
                        : stylePlain;
                d.insertString(d.getLength(), span.text, st);
            }
            pane.setCaretPosition(d.getLength());
        } catch (BadLocationException ignored) {
            /* best-effort — leave the plain text in place on any hiccup */
        }
    }

    /** Wipe the transcript and reset the run state (tab reset / resume). */
    void clear() {
        inAssistantRun = false;
        assistantRunStart = -1;
        pane.setText("");
    }

    private void insertStyled(String s, javax.swing.text.AttributeSet style) {
        try {
            StyledDocument d = pane.getStyledDocument();
            d.insertString(d.getLength(), s, style);
            // Bound long-session memory: drop the oldest text once the document
            // exceeds the cap, never trimming into the active assistant run (whose
            // absolute offset is shifted by whatever is removed). Mirrors the VS
            // Code panel's transcript node cap (chainlesschain-ide 0.36.5).
            int removeLen = TranscriptCap.removeCount(
                    d.getLength(), assistantRunStart, inAssistantRun,
                    TranscriptCap.DEFAULT_MAX_CHARS);
            if (removeLen > 0) {
                d.remove(0, removeLen);
                if (assistantRunStart >= 0) assistantRunStart -= removeLen;
            }
            pane.setCaretPosition(d.getLength());
        } catch (BadLocationException ignored) {
            /* document offsets are append-only here — should not happen */
        }
    }
}
