package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.MarkdownLite;
import com.chainlesschain.ide.TranscriptCap;

import javax.swing.JTextPane;
import javax.accessibility.AccessibleContext;
import javax.swing.text.BadLocationException;
import javax.swing.text.SimpleAttributeSet;
import javax.swing.text.StyleConstants;
import javax.swing.text.StyledDocument;
import java.awt.Color;
import java.awt.Font;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

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
    // The active assistant turn keeps its stable heading at
    // [assistantHeadingStart, assistantRunStart) and its streamed markdown at
    // [assistantRunStart, doc end). Both ranges are protected until finalize.
    private int assistantHeadingStart = -1;
    private int assistantRunStart = -1;
    private boolean inAssistantRun = false;
    private TranscriptCap.BoundedEntry assistantEntry;
    // Extended-thinking deltas form blocks separated by visible non-thinking
    // output. Their document ranges let /expand replace each block with a
    // compact placeholder and later restore the exact text.
    private final List<ThinkingBlock> thinkingBlocks = new ArrayList<>();
    private ThinkingBlock activeThinkingBlock;
    private int turnThinkingStart = 0;
    private int turnNumber = 0;
    private boolean assistantHeadingAdded = false;
    private String lastFinalizedAssistantText = "";
    private String lastAnnouncementText = "";
    private final Set<String> announcementKeys = new LinkedHashSet<>();
    private final ChatTranscriptHistory savedHistory;
    private ChatTranscriptHistory.Span lastFinalizedSpan;
    private Object liveOwner;
    private String liveSessionId;
    private Runnable historyReady = () -> {};
    private boolean freezeCaretVisibility;
    private long caretEpoch;

    private static final String THINKING_PLACEHOLDER = "thinking (collapsed)\n";
    private static final int MAX_ANNOUNCEMENT_CHARS = 4_000;

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
        pane.setCaret(new javax.swing.text.DefaultCaret() {
            @Override protected void adjustVisibility(java.awt.Rectangle rectangle) {
                if (!freezeCaretVisibility) super.adjustVisibility(rectangle);
            }
        });
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
        savedHistory = new ChatTranscriptHistory(pane, stylePlain, styleBold, styleDim, this::historyEdit);
        pane.addCaretListener(event -> {
            if (pane.getSelectionStart() == pane.getSelectionEnd()) javax.swing.SwingUtilities.invokeLater(() -> historyReady.run());
        });
    }

    void onHistoryReady(Runnable ready) { historyReady = ready; }
    void owned(Object owner, String sessionId) {
        if (liveOwner != owner || !java.util.Objects.equals(liveSessionId, sessionId)) finalizeAssistantRun();
        liveOwner = owner; liveSessionId = sessionId;
    }
    void appendUser(String text, String tag, String clientId, Object owner, String sessionId) {
        owned(owner, sessionId); beginTurn();
        String header = "\nTurn " + turnNumber + ", User message\n";
        String display = TranscriptCap.boundEntry("\nyou> " + text + tag + "\n", TranscriptCap.DEFAULT_MAX_CHARS);
        append(display);
        int end = pane.getDocument().getLength();
        savedHistory.add(Math.max(0, end - header.length() - display.length()), end, "user", text, sessionId, clientId, owner);
    }
    void inputReceipt(java.util.Map<String, Object> event, String sessionId, Object owner) { savedHistory.input(event, sessionId, owner); }
    void referencedAssistant(String finalText, com.chainlesschain.ide.TranscriptReferences refs, Object owner, String sessionId) {
        owned(owner, sessionId); lastFinalizedSpan = null;
        if (!inAssistantRun) appendAssistantDelta(finalText);
        finalizeAssistantRun();
        savedHistory.terminal(lastFinalizedSpan, refs, owner);
    }
    long firstSavedOrdinal(long fallback) { return savedHistory.firstOrdinal(fallback); }
    long lastSavedOrdinal() { return savedHistory.lastOrdinal(); }
    List<String> savedIds() { return savedHistory.savedIds(); }
    boolean mergeHistory(com.chainlesschain.ide.SessionTranscriptPage page, boolean baseline) {
        finalizeAssistantRun();
        boolean following = pane.getSelectionStart() == pane.getSelectionEnd() && isFollowingBottom();
        javax.swing.JViewport viewport = pane.getParent() instanceof javax.swing.JViewport v ? v : null;
        java.awt.Point position = viewport == null ? null : viewport.getViewPosition();
        javax.swing.text.DefaultCaret caret = (javax.swing.text.DefaultCaret) pane.getCaret();
        int policy = caret.getUpdatePolicy();
        long operation = ++caretEpoch;
        freezeCaretVisibility = !following;
        try {
            int start = pane.getSelectionStart(), end = pane.getSelectionEnd();
            boolean selected = start != end, backwards = caret.getDot() < caret.getMark();
            // Document Position(0) never shifts. Anchor inside the selected
            // text instead, with a backward-biased end, so inserts immediately
            // before/after a selection cannot become part of that selection.
            javax.swing.text.Position startAnchor = pane.getDocument().createPosition(selected && start == 0 ? 1 : start);
            javax.swing.text.Position endAnchor = pane.getDocument().createPosition(selected ? end - 1 : end);
            caret.setUpdatePolicy(javax.swing.text.DefaultCaret.NEVER_UPDATE);
            boolean applied = savedHistory.merge(page, baseline);
            if (applied) {
                if (following) stickToBottomIfFollowing(true);
                else {
                    int newStart = startAnchor.getOffset() - (selected && start == 0 ? 1 : 0);
                    int newEnd = endAnchor.getOffset() + (selected ? 1 : 0);
                    caret.setDot(backwards ? newEnd : newStart); caret.moveDot(backwards ? newStart : newEnd);
                    if (viewport != null) viewport.setViewPosition(position);
                }
            }
            return applied;
        } catch (BadLocationException error) { throw new IllegalStateException(error); }
        finally {
            caret.setUpdatePolicy(policy);
            // DefaultCaret schedules visibility changes after document edits.
            javax.swing.SwingUtilities.invokeLater(() -> { if (caretEpoch == operation) freezeCaretVisibility = false; });
        }
    }
    private void historyEdit(int offset, int removed, int added) {
        for (int i = thinkingBlocks.size() - 1; i >= 0; i--) {
            ThinkingBlock block = thinkingBlocks.get(i);
            if (removed > 0) {
                block.start = ChatTranscriptHistory.removedPosition(block.start, offset, removed);
                block.end = ChatTranscriptHistory.removedPosition(block.end, offset, removed);
                if (block.end <= block.start) { thinkingBlocks.remove(i); continue; }
            }
            if (offset <= block.start) { block.start += added; block.end += added; }
            else if (offset < block.end) block.end += added;
        }
        turnThinkingStart = Math.min(turnThinkingStart, thinkingBlocks.size());
    }

    /** The Swing component (for scroll-pane wrapping and drop-target install). */
    JTextPane pane() {
        return pane;
    }

    boolean canReplaceHistory() {
        return pane.getDocument().getLength() == 0 ||
                (pane.getSelectionStart() == pane.getSelectionEnd() && isFollowingBottom());
    }

    /** Bounded page replacement without replaying tool, question or accessibility events.
     * All rows remain visible: the 200K live cap must not silently drop earlier
     * rows of a validated page (at most 1 MiB text plus 100 headings). */
    void replaceHistory(com.chainlesschain.ide.SessionTranscriptPage page, boolean earlier) {
        clear();
        StyledDocument document = pane.getStyledDocument();
        try {
            for (com.chainlesschain.ide.SessionTranscriptPage.Row row : page.messages()) {
                String role = "user".equals(row.role()) ? "User message"
                        : "assistant".equals(row.role()) ? "Assistant response" : "Tool result";
                document.insertString(document.getLength(), "\nMessage " + (row.ordinal() + 1) + ", " + role + "\n", styleBold);
                document.insertString(document.getLength(), row.text(), stylePlain);
                if (row.truncated()) document.insertString(document.getLength(),
                        "\n[Message shortened for display; the saved session retains its original content.]", styleDim);
                document.insertString(document.getLength(), "\n", stylePlain);
                if ("user".equals(row.role())) turnNumber++;
            }
            pane.setCaretPosition(earlier ? 0 : document.getLength());
        } catch (BadLocationException error) { throw new IllegalStateException("Could not render saved history", error); }
    }

    /** Start a user turn with a stable heading in the visual and accessible
     * transcript. */
    void beginTurn() {
        closeThinkingBlock();
        finalizeAssistantRun();
        turnNumber += 1;
        turnThinkingStart = thinkingBlocks.size();
        assistantHeadingAdded = false;
        insertStyled("\nTurn " + turnNumber + ", User message\n", styleBold);
    }

    int currentTurnNumber() {
        return turnNumber;
    }

    String lastAssistantText() {
        return lastFinalizedAssistantText;
    }

    private void ensureAssistantHeading() {
        if (turnNumber == 0) turnNumber = 1;
        if (assistantHeadingAdded) return;
        assistantHeadingAdded = true;
        String heading = "Turn " + turnNumber + ", Assistant response\n";
        insertStyled(heading, styleBold);
        assistantHeadingStart = Math.max(
                0, pane.getStyledDocument().getLength() - heading.length());
    }

    /** Emit a categorized and deduplicated accessibility event. Streaming
     * deltas never call this method; only settled semantic events do. */
    boolean announce(String category, String text, String eventKey) {
        String normalized = String.valueOf(text == null ? "" : text)
                .replaceAll("\\s+", " ").trim();
        if (normalized.isEmpty()) return false;
        String prefix = (turnNumber > 0 ? "Turn " + turnNumber + ", " : "")
                + category + ": ";
        int budget = Math.max(0, MAX_ANNOUNCEMENT_CHARS - prefix.length());
        String body = normalized;
        if (body.length() > budget) {
            body = body.substring(0, Math.max(0, budget - 1)) + "…";
        }
        String announcement = prefix + body;
        if (announcement.length() > MAX_ANNOUNCEMENT_CHARS) {
            announcement = announcement.substring(0, MAX_ANNOUNCEMENT_CHARS);
        }
        String key = eventKey == null || eventKey.isEmpty()
                ? announcement : eventKey;
        if (announcementKeys.contains(key)) return false;
        announcementKeys.add(key);
        if (announcementKeys.size() > 256) {
            announcementKeys.remove(announcementKeys.iterator().next());
        }
        String previous = lastAnnouncementText;
        lastAnnouncementText = announcement;
        pane.getAccessibleContext().firePropertyChange(
                AccessibleContext.ACCESSIBLE_VISIBLE_DATA_PROPERTY,
                previous, announcement);
        return true;
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
            ensureAssistantHeading();
            assistantRunStart = pane.getStyledDocument().getLength();
            inAssistantRun = true;
            int headingChars = assistantHeadingStart >= 0
                    ? Math.max(0, assistantRunStart - assistantHeadingStart)
                    : 0;
            assistantEntry = new TranscriptCap.BoundedEntry(
                    Math.max(0, TranscriptCap.DEFAULT_MAX_CHARS - headingChars));
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
        }
        activeThinkingBlock.end = document.getLength() + s.length();
        insertStyled(s, styleDim);
        if (activeThinkingBlock != null) {
            activeThinkingBlock.end = pane.getStyledDocument().getLength();
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
        final boolean expand = thinkingBlocks.stream()
                .anyMatch(block -> block.hiddenText != null);
        try {
            for (int i = thinkingBlocks.size() - 1; i >= 0; i--) {
                ThinkingBlock block = thinkingBlocks.get(i);
                int length = Math.max(0, block.end - block.start);
                int delta = 0;
                if (!expand && block.hiddenText == null) {
                    block.hiddenText = document.getText(block.start, length);
                    document.remove(block.start, length);
                    document.insertString(
                            block.start, THINKING_PLACEHOLDER, styleDim);
                    block.end = block.start + THINKING_PLACEHOLDER.length();
                    delta = (block.end - block.start) - length;
                } else if (expand && block.hiddenText != null) {
                    document.remove(block.start, length);
                    String text = block.hiddenText;
                    document.insertString(block.start, text, styleDim);
                    block.end = block.start + text.length();
                    block.hiddenText = null;
                    delta = (block.end - block.start) - length;
                }
                for (int j = i + 1; j < thinkingBlocks.size(); j++) {
                    ThinkingBlock later = thinkingBlocks.get(j);
                    later.start += delta;
                    later.end += delta;
                }
            }
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

    /** Collapse every reasoning-only block produced by the completed turn. */
    void collapseCompletedReasoning() {
        closeThinkingBlock();
        StyledDocument document = pane.getStyledDocument();
        final boolean following = isFollowingBottom();
        try {
            for (int i = thinkingBlocks.size() - 1;
                    i >= Math.min(turnThinkingStart, thinkingBlocks.size()); i--) {
                ThinkingBlock block = thinkingBlocks.get(i);
                if (block.hiddenText != null) continue;
                int length = Math.max(0, block.end - block.start);
                block.hiddenText = document.getText(block.start, length);
                document.remove(block.start, length);
                document.insertString(block.start, THINKING_PLACEHOLDER, styleDim);
                block.end = block.start + THINKING_PLACEHOLDER.length();
                int delta = (block.end - block.start) - length;
                for (int j = i + 1; j < thinkingBlocks.size(); j++) {
                    ThinkingBlock later = thinkingBlocks.get(j);
                    later.start += delta;
                    later.end += delta;
                }
            }
            stickToBottomIfFollowing(following);
            trimHiddenReasoning();
        } catch (BadLocationException ignored) {
            /* retain visible reasoning if the document changed unexpectedly */
        }
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
        int spanStart = assistantHeadingStart >= 0 ? assistantHeadingStart : start;
        int end = d.getLength();
        inAssistantRun = false;
        assistantHeadingStart = -1;
        assistantRunStart = -1;
        assistantEntry = null;
        if (start < 0 || end <= start) return;
        final boolean following = isFollowingBottom();
        try {
            String text = d.getText(start, end - start);
            lastFinalizedAssistantText = text;
            boolean selected = pane.getSelectionStart() < end && pane.getSelectionEnd() > start
                    && pane.getSelectionStart() != pane.getSelectionEnd();
            if (!selected) {
            d.remove(start, end - start);
            for (MarkdownLite.Span span : MarkdownLite.parse(text)) {
                javax.swing.text.AttributeSet st =
                        span.kind == MarkdownLite.Kind.CODE ? styleCode
                        : span.kind == MarkdownLite.Kind.BOLD ? styleBold
                        : stylePlain;
                d.insertString(d.getLength(), span.text, st);
            }
            }
            lastFinalizedSpan = savedHistory.add(spanStart, d.getLength(), "assistant", text, liveSessionId, null, liveOwner);
            stickToBottomIfFollowing(following && !selected);
        } catch (BadLocationException ignored) {
            /* best-effort — leave the plain text in place on any hiccup */
        }
    }

    /** Wipe the transcript and reset the run state (tab reset / resume). */
    void clear() {
        savedHistory.clear(); lastFinalizedSpan = null;
        inAssistantRun = false;
        assistantHeadingStart = -1;
        assistantRunStart = -1;
        assistantEntry = null;
        activeThinkingBlock = null;
        thinkingBlocks.clear();
        turnThinkingStart = 0;
        turnNumber = 0;
        assistantHeadingAdded = false;
        lastFinalizedAssistantText = "";
        lastAnnouncementText = "";
        announcementKeys.clear();
        pane.setText("");
    }

    private void insertStyled(String s, javax.swing.text.AttributeSet style) {
        caretEpoch++; freezeCaretVisibility = false;
        try {
            final boolean following = isFollowingBottom();
            StyledDocument d = pane.getStyledDocument();
            String bounded = TranscriptCap.boundEntry(
                    s, TranscriptCap.DEFAULT_MAX_CHARS);
            d.insertString(d.getLength(), bounded, style);
            // Bound long-session memory: drop the oldest text once the document
            // exceeds the cap, never trimming into the active assistant heading
            // or run (whose absolute offsets shift with removed history). Mirrors
            // the VS Code panel's transcript node cap (chainlesschain-ide 0.36.5).
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
        int protectedStart = inAssistantRun && assistantHeadingStart >= 0
                ? assistantHeadingStart : assistantRunStart;
        int removeLen = TranscriptCap.removeCount(
                document.getLength(), protectedStart, inAssistantRun,
                TranscriptCap.DEFAULT_MAX_CHARS);
        if (removeLen <= 0) return;
        int whole = savedHistory.wholePrefix(removeLen);
        if (!inAssistantRun || protectedStart < 0 || whole <= protectedStart) removeLen = whole;
        trimThinkingBlocks(removeLen);
        document.remove(0, removeLen);
        if (assistantHeadingStart >= 0) {
            assistantHeadingStart = Math.max(0, assistantHeadingStart - removeLen);
        }
        if (assistantRunStart >= 0) {
            assistantRunStart = Math.max(0, assistantRunStart - removeLen);
        }
    }

    /** Shift tracked reasoning ranges when the transcript evicts its prefix. */
    private void trimThinkingBlocks(int removeLen) {
        for (int i = thinkingBlocks.size() - 1; i >= 0; i--) {
            ThinkingBlock block = thinkingBlocks.get(i);
            if (block.end <= removeLen) {
                if (activeThinkingBlock == block) activeThinkingBlock = null;
                thinkingBlocks.remove(i);
                if (i < turnThinkingStart) turnThinkingStart -= 1;
                continue;
            }
            block.start = Math.max(0, block.start - removeLen);
            block.end -= removeLen;
        }
        turnThinkingStart = Math.max(0,
                Math.min(turnThinkingStart, thinkingBlocks.size()));
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
