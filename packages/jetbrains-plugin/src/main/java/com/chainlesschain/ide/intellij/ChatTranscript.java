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
import java.util.ArrayList;
import java.util.List;

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
    private TranscriptCap.BoundedEntry assistantEntry;
    // Extended-thinking deltas form blocks separated by visible non-thinking
    // output. Their document ranges let /expand replace each block with a
    // compact placeholder and later restore the exact text.
    private final List<ThinkingBlock> thinkingBlocks = new ArrayList<>();
    private ThinkingBlock activeThinkingBlock;
    private boolean thinkingExpanded = true;

    private static final String THINKING_PLACEHOLDER = "thinking (collapsed)\n";

    private static final class ThinkingBlock {
        int start;
        int end;
        String hiddenText;

        ThinkingBlock(int start, int end) {
            this.start = start;
            this.end = end;
        }
    }

    ChatTranscript() {
        pane.setEditable(false);
        pane.getAccessibleContext().setAccessibleName("Conversation transcript");
        pane.getAccessibleContext().setAccessibleDescription(
                "Read-only ChainlessChain agent conversation and tool activity");
        // JTextPane wraps by default (no setLineWrap). Keep the monospace look.
        pane.setFont(new Font(Font.MONOSPACED, Font.PLAIN, pane.getFont().getSize()));
        // JBColor(light, dark): theme-aware so code/thinking text stays readable
        // when the IDE switches to Darcula (JBColor resolves at paint time).
        StyleConstants.setForeground(styleCode, new com.intellij.ui.JBColor(
                new Color(0xCC, 0x78, 0x32), new Color(0xE8, 0x9A, 0x50))); // amber code
        StyleConstants.setBold(styleBold, true);
        StyleConstants.setForeground(styleDim, new com.intellij.ui.JBColor(
                new Color(0x80, 0x80, 0x80), new Color(0x9A, 0x9A, 0x9A))); // gray thinking
        StyleConstants.setItalic(styleDim, true);
    }

    /** The Swing component (for scroll-pane wrapping and drop-target install). */
    JTextPane pane() {
        return pane;
    }

    /** True when the viewport is at (or within a line of) the bottom — i.e. the
     *  user is following the live output. When they've scrolled up to read, this
     *  is false and we must NOT yank them back down on the next insert. Defaults
     *  to true before layout / without an enclosing viewport (tests). */
    private boolean isFollowingBottom() {
        java.awt.Container p = pane.getParent();
        if (!(p instanceof javax.swing.JViewport)) return true;
        java.awt.Rectangle view = ((javax.swing.JViewport) p).getViewRect();
        int slop = Math.max(24, pane.getFont().getSize() * 2); // ~one line
        return view.y + view.height >= pane.getHeight() - slop;
    }

    private void stickToBottomIfFollowing(boolean wasFollowing) {
        if (wasFollowing) pane.setCaretPosition(pane.getStyledDocument().getLength());
    }

    /** A plain transcript line (header / tool / info / error). Ends any pending
     *  assistant markdown run first so it gets re-styled before this line. */
    void append(String s) {
        closeThinkingBlock();
        finalizeAssistantRun();
        insertStyled(s, stylePlain);
    }

    /** Streaming assistant text — appended plain; re-styled with markdown when
     *  the run finalizes (so streaming stays responsive, then snaps to styled). */
    void appendAssistantDelta(String s) {
        closeThinkingBlock();
        if (!inAssistantRun) {
            assistantRunStart = pane.getStyledDocument().getLength();
            inAssistantRun = true;
            assistantEntry = new TranscriptCap.BoundedEntry(
                    TranscriptCap.DEFAULT_MAX_CHARS);
        }
        boolean wasTruncated = assistantEntry.truncated();
        assistantEntry.append(s);
        if (!assistantEntry.truncated()) {
            insertStyled(s, stylePlain);
        } else if (!wasTruncated) {
            replaceActiveAssistantText(assistantEntry.text());
        }
    }

    /** Extended-thinking reasoning — streamed dim/italic, not markdown-rendered. */
    void appendThinking(String s) {
        closeThinkingBlock();
        finalizeAssistantRun();
        insertStyled(s, styleDim);
    }

    /** A collapsible extended-thinking delta from the live agent session. */
    void appendReasoning(String s) {
        finalizeAssistantRun();
        StyledDocument document = pane.getStyledDocument();
        if (activeThinkingBlock == null) {
            int start = document.getLength();
            activeThinkingBlock = new ThinkingBlock(start, start);
            thinkingBlocks.add(activeThinkingBlock);
            if (!thinkingExpanded) {
                activeThinkingBlock.hiddenText = "";
                activeThinkingBlock.end =
                        start + THINKING_PLACEHOLDER.length();
                insertStyled(THINKING_PLACEHOLDER, styleDim);
            }
        }
        if (thinkingExpanded) {
            activeThinkingBlock.end = document.getLength() + s.length();
            insertStyled(s, styleDim);
            if (activeThinkingBlock != null) {
                activeThinkingBlock.end =
                        pane.getStyledDocument().getLength();
            }
        } else {
            activeThinkingBlock.hiddenText += s;
            trimHiddenReasoning();
        }
    }

    /**
     * Expand every reasoning block when any block is collapsed; otherwise
     * collapse them all. Returns false when the transcript has no blocks.
     */
    boolean toggleAllReasoning() {
        closeThinkingBlock();
        finalizeAssistantRun();
        if (thinkingBlocks.isEmpty()) return false;
        StyledDocument document = pane.getStyledDocument();
        final boolean following = isFollowingBottom();
        try {
            for (int i = thinkingBlocks.size() - 1; i >= 0; i--) {
                ThinkingBlock block = thinkingBlocks.get(i);
                int length = Math.max(0, block.end - block.start);
                if (thinkingExpanded) {
                    block.hiddenText = document.getText(block.start, length);
                    document.remove(block.start, length);
                    document.insertString(
                            block.start, THINKING_PLACEHOLDER, styleDim);
                    block.end = block.start + THINKING_PLACEHOLDER.length();
                } else {
                    document.remove(block.start, length);
                    String text = block.hiddenText == null
                            ? "" : block.hiddenText;
                    document.insertString(block.start, text, styleDim);
                    block.end = block.start + text.length();
                    block.hiddenText = null;
                }
                int delta = (block.end - block.start) - length;
                for (int j = i + 1; j < thinkingBlocks.size(); j++) {
                    ThinkingBlock later = thinkingBlocks.get(j);
                    later.start += delta;
                    later.end += delta;
                }
            }
            thinkingExpanded = !thinkingExpanded;
            stickToBottomIfFollowing(following);
            pane.revalidate();
            pane.repaint();
            return true;
        } catch (BadLocationException ignored) {
            return false;
        }
    }

    private void closeThinkingBlock() {
        activeThinkingBlock = null;
    }

    /** Re-render the just-streamed assistant run as markdown (code → monospace
     *  amber, **bold** → bold). No-op when not in a run. */
    void finalizeAssistantRun() {
        if (!inAssistantRun) return;
        StyledDocument d = pane.getStyledDocument();
        if (assistantEntry != null && assistantEntry.truncated()) {
            replaceActiveAssistantText(assistantEntry.text());
        }
        int start = assistantRunStart;
        int end = d.getLength();
        inAssistantRun = false;
        assistantRunStart = -1;
        assistantEntry = null;
        if (start < 0 || end <= start) return;
        final boolean following = isFollowingBottom();
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
            stickToBottomIfFollowing(following);
        } catch (BadLocationException ignored) {
            /* best-effort — leave the plain text in place on any hiccup */
        }
    }

    /** Wipe the transcript and reset the run state (tab reset / resume). */
    void clear() {
        inAssistantRun = false;
        assistantRunStart = -1;
        assistantEntry = null;
        activeThinkingBlock = null;
        thinkingBlocks.clear();
        thinkingExpanded = true;
        pane.setText("");
    }

    private void insertStyled(String s, javax.swing.text.AttributeSet style) {
        try {
            final boolean following = isFollowingBottom();
            StyledDocument d = pane.getStyledDocument();
            String bounded = TranscriptCap.boundEntry(
                    s, TranscriptCap.DEFAULT_MAX_CHARS);
            d.insertString(d.getLength(), bounded, style);
            // Bound long-session memory: drop the oldest text once the document
            // exceeds the cap, never trimming into the active assistant run (whose
            // absolute offset is shifted by whatever is removed). Mirrors the VS
            // Code panel's transcript node cap (chainlesschain-ide 0.36.5).
            trimDocumentToCap(d);
            stickToBottomIfFollowing(following);
        } catch (BadLocationException ignored) {
            /* document offsets are append-only here — should not happen */
        }
    }

    /** Replace a capped active run once at threshold-crossing/finalization. */
    private void replaceActiveAssistantText(String text) {
        if (assistantRunStart < 0) return;
        try {
            StyledDocument document = pane.getStyledDocument();
            document.remove(
                    assistantRunStart, document.getLength() - assistantRunStart);
            document.insertString(assistantRunStart, text, stylePlain);
            trimDocumentToCap(document);
        } catch (BadLocationException ignored) {
            /* offsets are owned by this append-only transcript */
        }
    }

    private void trimDocumentToCap(StyledDocument document)
            throws BadLocationException {
        int removeLen = TranscriptCap.removeCount(
                document.getLength(), assistantRunStart, inAssistantRun,
                TranscriptCap.DEFAULT_MAX_CHARS);
        if (removeLen <= 0) return;
        trimThinkingBlocks(removeLen);
        document.remove(0, removeLen);
        if (assistantRunStart >= 0) assistantRunStart -= removeLen;
    }

    /** Shift tracked reasoning ranges when the transcript evicts its prefix. */
    private void trimThinkingBlocks(int removeLen) {
        for (int i = thinkingBlocks.size() - 1; i >= 0; i--) {
            ThinkingBlock block = thinkingBlocks.get(i);
            if (block.end <= removeLen) {
                if (activeThinkingBlock == block) activeThinkingBlock = null;
                thinkingBlocks.remove(i);
                continue;
            }
            block.start = Math.max(0, block.start - removeLen);
            block.end -= removeLen;
        }
    }

    /** Keep hidden reasoning within the same bound as the visible transcript. */
    private void trimHiddenReasoning() {
        int total = 0;
        for (ThinkingBlock block : thinkingBlocks) {
            if (block.hiddenText != null) total += block.hiddenText.length();
        }
        int excess = total - TranscriptCap.DEFAULT_MAX_CHARS;
        if (excess <= 0) return;
        for (ThinkingBlock block : thinkingBlocks) {
            if (excess <= 0) break;
            if (block.hiddenText == null || block.hiddenText.isEmpty()) continue;
            int remove = Math.min(excess, block.hiddenText.length());
            block.hiddenText = block.hiddenText.substring(remove);
            excess -= remove;
        }
    }
}
