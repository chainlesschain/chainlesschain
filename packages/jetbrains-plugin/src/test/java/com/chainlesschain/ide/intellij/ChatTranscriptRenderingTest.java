package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.SessionTranscriptPage;
import com.chainlesschain.ide.TranscriptReferences;
import org.junit.jupiter.api.Test;
import javax.swing.SwingUtilities;
import javax.swing.text.StyleConstants;
import java.util.List;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class ChatTranscriptRenderingTest {
    private static final String SESSION = "render-session";
    private static final String EVENT = "b".repeat(64);
    private static final String RAW = "Run `npm test` **now**. [guide](https://example.com/a?q=1) 中文😀\n```java\nint x = 1;\n```\nUnclosed `literal";
    private static final String VISIBLE = "Run npm test now. [guide](https://example.com/a?q=1) 中文😀\nint x = 1;\n\nUnclosed `literal";

    private static SessionTranscriptPage page(String text, String role) {
        return new SessionTranscriptPage(SESSION, "a".repeat(64), EVENT, 2, 1,
                List.of(new SessionTranscriptPage.Row("saved-render-row", EVENT, 0, 0, role, text, false)), null, false);
    }
    private static String body(ChatTranscript transcript) {
        try { var document = transcript.pane().getDocument(); return document.getText(0, document.getLength()); }
        catch (javax.swing.text.BadLocationException error) { throw new AssertionError(error); }
    }
    private static Object field(Object target, String name) {
        try { var field = target.getClass().getDeclaredField(name); field.setAccessible(true); return field.get(target); }
        catch (ReflectiveOperationException error) { throw new AssertionError(error); }
    }
    @SuppressWarnings("unchecked") private static List<ChatTranscriptHistory.Span> spans(ChatTranscript transcript) {
        return (List<ChatTranscriptHistory.Span>) field(field(transcript, "savedHistory"), "spans");
    }
    private static void assertStyled(ChatTranscript transcript) {
        String visible = body(transcript);
        assertEquals(1, visible.split(java.util.regex.Pattern.quote(VISIBLE), -1).length - 1);
        var document = transcript.pane().getStyledDocument();
        int code = visible.indexOf("npm test"), bold = visible.indexOf("now.");
        assertTrue(StyleConstants.isBold(document.getCharacterElement(bold).getAttributes()));
        assertEquals(StyleConstants.getForeground(document.getCharacterElement(code).getAttributes()),
                StyleConstants.getForeground(document.getCharacterElement(visible.indexOf("int x = 1;")).getAttributes()));
        assertNotEquals(StyleConstants.getForeground(document.getCharacterElement(visible.indexOf("Run ")).getAttributes()),
                StyleConstants.getForeground(document.getCharacterElement(code).getAttributes()));
    }

    @Test void liveMergedAndReplacedHistoryShareCodeBoldLinkAndUnicodeDisplay() throws Exception {
        SwingUtilities.invokeAndWait(() -> {
            ChatTranscript live = new ChatTranscript(); live.appendAssistantDelta(RAW); live.finalizeAssistantRun();
            ChatTranscript restored = new ChatTranscript(); assertTrue(restored.mergeHistory(page(RAW, "assistant"), true));
            ChatTranscript browser = new ChatTranscript(); browser.replaceHistory(page(RAW, "assistant"), false);
            for (ChatTranscript transcript : List.of(live, restored, browser)) assertStyled(transcript);
            var span = spans(restored).getFirst();
            assertEquals(RAW, span.raw); assertEquals(RAW, span.saved.text()); assertEquals(EVENT, span.saved.eventId());
            assertEquals(List.of("saved-render-row"), restored.savedIds());
            assertTrue(restored.mergeHistory(page(RAW, "assistant"), true));
            assertStyled(restored); assertEquals(1, spans(restored).size());
        });
    }

    @Test void livePromotionAndNewTranscriptKeepCanonicalSourceAndSavedIdentitySeparateFromDisplay() throws Exception {
        var refs = TranscriptReferences.result(Map.of("type", "result", "session_id", SESSION,
                "transcript_refs", Map.of("schema", "chainlesschain.session-transcript-references/v1",
                        "sessionId", SESSION, "assistantEventId", EVENT)), SESSION);
        assertNotNull(refs);
        SwingUtilities.invokeAndWait(() -> {
            ChatTranscript live = new ChatTranscript(); Object owner = new Object(); live.owned(owner, SESSION);
            live.appendAssistantDelta(RAW); live.referencedAssistant(RAW, refs, owner, SESSION);
            assertTrue(live.mergeHistory(page(RAW, "assistant"), true));
            assertEquals(1, spans(live).size()); assertEquals(RAW, spans(live).getFirst().saved.text()); assertStyled(live);
            ChatTranscript reopened = new ChatTranscript(); assertTrue(reopened.mergeHistory(page(RAW, "assistant"), true));
            assertEquals(live.savedIds(), reopened.savedIds()); assertStyled(reopened);
            assertEquals(RAW, spans(reopened).getFirst().saved.text());
            assertNotEquals(RAW, VISIBLE, "test must distinguish canonical and rendered text");
        });
    }

    @Test void renderedOffsetsPreserveFollowingSelectionAndRejectConflictingReplacement() throws Exception {
        SwingUtilities.invokeAndWait(() -> {
            var tail = new SessionTranscriptPage.Row("tail", "c".repeat(64), 0, 1, "user", "keep `literal` selected", false);
            var first = page("**long bold** and `code`", "assistant").messages().getFirst();
            var baseline = new SessionTranscriptPage(SESSION, "a".repeat(64), EVENT, 3, 2, List.of(first, tail), null, false);
            ChatTranscript transcript = new ChatTranscript(); assertTrue(transcript.mergeHistory(baseline, true));
            int at = body(transcript).indexOf(tail.text()); transcript.pane().select(at, at + tail.text().length());
            var replacement = new SessionTranscriptPage.Row(first.id(), first.eventId(), 0, 0, "assistant", "`x`", false);
            var update = new SessionTranscriptPage(SESSION, "a".repeat(64), EVENT, 3, 2, List.of(replacement, tail), null, false);
            assertTrue(transcript.mergeHistory(update, true)); assertEquals(tail.text(), transcript.pane().getSelectedText());
            assertEquals(List.of(first.id(), tail.id()), transcript.savedIds());
            var firstSpan = spans(transcript).stream().filter(s -> first.id().equals(s.saved.id())).findFirst().orElseThrow();
            try { assertEquals("\nMessage 1, assistant (saved)\nx\n", transcript.pane().getDocument().getText(firstSpan.start, firstSpan.end - firstSpan.start)); }
            catch (javax.swing.text.BadLocationException error) { throw new AssertionError(error); }
            int codeAt = firstSpan.end - 2; transcript.pane().select(codeAt, codeAt + 1);
            String unchanged = body(transcript); assertFalse(transcript.mergeHistory(baseline, true)); assertEquals(unchanged, body(transcript));
        });
    }

    @Test void userAndToolMarkdownRemainLiteralAndTruncatedAssistantSuffixStaysOutsideBody() throws Exception {
        SwingUtilities.invokeAndWait(() -> {
            for (String role : List.of("user", "tool")) {
                ChatTranscript transcript = new ChatTranscript(); assertTrue(transcript.mergeHistory(page(RAW, role), true));
                assertTrue(body(transcript).contains(RAW));
                ChatTranscript browser = new ChatTranscript(); browser.replaceHistory(page(RAW, role), false); assertTrue(body(browser).contains(RAW));
            }
            var row = new SessionTranscriptPage.Row("shortened", EVENT, 0, 0, "assistant", "`visible`", true);
            ChatTranscript transcript = new ChatTranscript(); assertTrue(transcript.mergeHistory(new SessionTranscriptPage(SESSION, "a".repeat(64), EVENT, 2, 1, List.of(row), null, false), true));
            assertTrue(body(transcript).contains("\nvisible\n[Message shortened for display;"));
            assertEquals("`visible`", spans(transcript).getFirst().saved.text());
            assertEquals(transcript.pane().getDocument().getLength(), spans(transcript).getFirst().end);
        });
    }
}
