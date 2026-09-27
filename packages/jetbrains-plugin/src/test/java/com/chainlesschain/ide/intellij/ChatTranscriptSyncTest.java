package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.SessionTranscriptChangesTest;
import com.chainlesschain.ide.SessionTranscriptPage;
import com.chainlesschain.ide.TranscriptReferences;
import org.junit.jupiter.api.Test;
import javax.swing.SwingUtilities;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class ChatTranscriptSyncTest {
    private static final String SESSION = SessionTranscriptChangesTest.SESSION;
    private static final String TEXT = "same 中文😀";
    private static void edt(Runnable task) throws Exception { SwingUtilities.invokeAndWait(task); }
    private static String body(ChatTranscript transcript) {
        try { return transcript.pane().getDocument().getText(0, transcript.pane().getDocument().getLength()); }
        catch (javax.swing.text.BadLocationException e) { throw new AssertionError(e); }
    }
    @SuppressWarnings("unchecked") private static TranscriptReferences refs(int index) throws Exception {
        Object raw = ((List<?>) SessionTranscriptChangesTest.fixture().get("refs")).get(index);
        return TranscriptReferences.result(Map.of("type", "result", "session_id", SESSION, "transcript_refs", raw), SESSION);
    }
    private static Map<String, Object> receipt(TranscriptReferences refs) {
        return Map.of("type", "system", "subtype", "input_accepted", "session_id", SESSION,
                "client_message_id", refs.clientMessageId(), "receipt", Map.of("sessionId", SESSION,
                        "clientMessageId", refs.clientMessageId(), "eventHash", refs.userEventId(), "inputDigest", "a".repeat(64), "duplicate", false));
    }
    @Test void mergesSourceBoundFinalSegmentsAndRepeatedTextWithoutLosingToolsOrDiagnostics() throws Exception {
        SessionTranscriptPage baseline = SessionTranscriptChangesTest.baseline("baseline");
        var first = SessionTranscriptChangesTest.changes("first", baseline.syncCursor());
        var second = SessionTranscriptChangesTest.changes("second", first.nextCursor());
        var meta = SessionTranscriptChangesTest.changes("metadata", second.nextCursor());
        List<TranscriptReferences> refs = List.of(refs(0), refs(1), refs(2));
        edt(() -> {
            ChatTranscript t = new ChatTranscript(); Object owner = new Object();
            assertTrue(t.mergeHistory(baseline, true));
            for (int i = 1; i < 3; i++) {
                var r = refs.get(i);
                t.appendUser(TEXT, "", r.clientMessageId(), owner, SESSION);
                t.inputReceipt(receipt(r), SESSION, owner);
                t.inputReceipt(receipt(r), SESSION, owner);
                t.appendAssistantDelta("checking " + i);
                t.append("\n→ read_file " + i + "\n");
                t.appendAssistantDelta("partial");
                t.referencedAssistant(TEXT, r, owner, SESSION);
                t.append("\nturn budget stopped " + i + "\n");
            }
            assertTrue(t.mergeHistory(first.page(), false));
            assertTrue(t.mergeHistory(second.page(), false));
            assertTrue(t.mergeHistory(second.page(), false));
            String merged = t.pane().getText();
            assertTrue(t.mergeHistory(meta.page(), false));
            assertEquals(merged, t.pane().getText());
            assertEquals(6, t.savedIds().size()); assertEquals(6, t.savedIds().stream().distinct().count());
            assertEquals(6, merged.split(TEXT, -1).length - 1);
            assertFalse(merged.contains("partial"));
            for (int i = 1; i < 3; i++) {
                assertTrue(merged.contains("checking " + i)); assertTrue(merged.contains("read_file " + i));
                assertTrue(merged.contains("turn budget stopped " + i));
            }
        });
    }
    @Test void neverAssociatesByEqualTextOrWrongChildAndCanAssociateARepeatedReceiptLater() throws Exception {
        SessionTranscriptPage baseline = SessionTranscriptChangesTest.baseline("baseline");
        TranscriptReferences refs = refs(0);
        edt(() -> {
            ChatTranscript t = new ChatTranscript(); Object owner = new Object();
            t.appendUser(TEXT, "", refs.clientMessageId(), owner, SESSION);
            t.inputReceipt(receipt(refs), SESSION, new Object());
            t.appendAssistantDelta(TEXT); t.finalizeAssistantRun();
            assertTrue(t.mergeHistory(baseline, true));
            assertEquals(4, t.pane().getText().split(TEXT, -1).length - 1);
            t.inputReceipt(receipt(refs), SESSION, owner);
            assertTrue(t.mergeHistory(baseline, true));
            assertEquals(3, t.pane().getText().split(TEXT, -1).length - 1);
            assertEquals(2, t.savedIds().size());
        });
    }
    @Test void verifiedRewindWaitsForConflictingSelectionAndRetainsUnassociatedText() throws Exception {
        SessionTranscriptPage baseline = SessionTranscriptChangesTest.baseline("baseline");
        var first = SessionTranscriptChangesTest.changes("first", baseline.syncCursor());
        SessionTranscriptPage rewind = SessionTranscriptChangesTest.baseline("rewind");
        edt(() -> {
            ChatTranscript t = new ChatTranscript(); t.mergeHistory(baseline, true); t.mergeHistory(first.page(), false);
            t.append("diagnostic remains");
            int at = body(t).lastIndexOf(TEXT); t.pane().select(at, at + TEXT.length());
            assertEquals(TEXT, t.pane().getSelectedText());
            String before = t.pane().getText();
            assertFalse(t.mergeHistory(rewind, true)); assertEquals(before, t.pane().getText());
            assertEquals(TEXT, t.pane().getSelectedText());
            t.pane().setCaretPosition(0); assertTrue(t.mergeHistory(rewind, true));
            assertEquals(2, t.savedIds().size()); assertTrue(t.pane().getText().contains("diagnostic remains"));
        });
    }
    @Test void preservesActualSelectionWhenRowsAreInsertedBeforeIt() throws Exception {
        SessionTranscriptPage baseline = SessionTranscriptChangesTest.baseline("baseline");
        TranscriptReferences refs = refs(0);
        edt(() -> {
            ChatTranscript t = new ChatTranscript(); Object owner = new Object(); t.owned(owner, SESSION);
            t.appendAssistantDelta(TEXT); t.referencedAssistant(TEXT, refs, owner, SESSION);
            int at = body(t).indexOf(TEXT); t.pane().select(at, at + TEXT.length());
            assertEquals(TEXT, t.pane().getSelectedText());
            assertTrue(t.mergeHistory(baseline, true));
            assertEquals(TEXT, t.pane().getSelectedText()); assertEquals(2, t.savedIds().size());
        });
    }
    @Test void selectionCannotAllowTheDocumentToGrowBeyondItsBudget() throws Exception {
        List<SessionTranscriptPage.Row> rows = new ArrayList<>();
        for (int i = 0; i < 6; i++) rows.add(new SessionTranscriptPage.Row("row" + i, "a".repeat(64), 0, i, "assistant", "x".repeat(175_000), false));
        SessionTranscriptPage large = new SessionTranscriptPage(SESSION, "a".repeat(64), "a".repeat(64), 7, 6, rows, null, false);
        edt(() -> {
            ChatTranscript t = new ChatTranscript(); t.append("keep selected\n" + "z".repeat(30_000));
            t.pane().select(0, 4); String before = t.pane().getText();
            assertFalse(t.mergeHistory(large, true)); assertEquals(before, t.pane().getText()); assertTrue(t.savedIds().isEmpty());
            t.pane().setCaretPosition(t.pane().getDocument().getLength());
            assertTrue(t.mergeHistory(large, true));
            assertTrue(t.pane().getDocument().getLength() <= ChatTranscriptHistory.MAX_DOCUMENT_CHARS);
        });
    }
    @Test void anAppendAtSelectionEndDoesNotExtendTheSelection() throws Exception {
        SessionTranscriptPage baseline = SessionTranscriptChangesTest.baseline("baseline");
        edt(() -> {
            ChatTranscript t = new ChatTranscript(); t.append("selected diagnostic"); t.pane().select(0, t.pane().getDocument().getLength());
            assertTrue(t.mergeHistory(baseline, true)); assertEquals("selected diagnostic", t.pane().getSelectedText());
        });
    }
    @Test void savedRowBudgetEvictsTextAndSelectionDefersEviction() throws Exception {
        List<SessionTranscriptPage.Row> rows = new ArrayList<>();
        for (int i = 0; i < 100; i++) rows.add(new SessionTranscriptPage.Row("row" + i, "a".repeat(64), 0, i, "assistant", "saved-" + i + "!", false));
        SessionTranscriptPage baseline = new SessionTranscriptPage(SESSION, "a".repeat(64), "a".repeat(64), 101, 100, rows, null, false);
        SessionTranscriptPage update = new SessionTranscriptPage(SESSION, "a".repeat(64), "b".repeat(64), 102, 101,
                List.of(new SessionTranscriptPage.Row("last", "b".repeat(64), 0, 100, "assistant", "newest", false)), null, false);
        edt(() -> {
            ChatTranscript t = new ChatTranscript(); assertTrue(t.mergeHistory(baseline, true));
            int at = body(t).indexOf("saved-0!"); t.pane().select(at, at + 8);
            assertFalse(t.mergeHistory(update, false)); assertEquals(100, t.savedIds().size());
            t.pane().setCaretPosition(0); assertTrue(t.mergeHistory(update, false));
            assertEquals(100, t.savedIds().size()); assertEquals(1, t.firstSavedOrdinal(-1));
            assertFalse(body(t).contains("saved-0!")); assertTrue(body(t).contains("newest"));
        });
    }
    @Test void metadataEvictionDuringMergeCannotOrphanAnIdentifiedSavedCandidate() throws Exception {
        edt(() -> {
            javax.swing.JTextPane pane = new javax.swing.JTextPane();
            var style = new javax.swing.text.SimpleAttributeSet();
            var history = new ChatTranscriptHistory(pane, style, style, style, (offset, removed, added) -> {});
            var document = pane.getStyledDocument();
            try {
                document.insertString(0, "same", style);
                var candidate = history.add(0, 4, "assistant", "same", SESSION, null, new Object());
                candidate.eventRef = "b".repeat(64);
                for (int i = 0; i < 4095; i++) {
                    int start = document.getLength(); document.insertString(start, "x", style);
                    history.add(start, start + 1, "assistant", "x", SESSION, null, new Object());
                }
                var page = new SessionTranscriptPage(SESSION, "a".repeat(64), "b".repeat(64), 3, 2, List.of(
                        new SessionTranscriptPage.Row("user", "a".repeat(64), 0, 0, "user", "question", false),
                        new SessionTranscriptPage.Row("assistant", "b".repeat(64), 0, 1, "assistant", "same", false)), null, false);
                assertTrue(history.merge(page, true)); assertEquals(List.of("user", "assistant"), history.savedIds());
                assertTrue(history.merge(new SessionTranscriptPage(SESSION, "c".repeat(64), "c".repeat(64), 1, 0, List.of(), null, false), true));
                assertFalse(document.getText(0, document.getLength()).contains("same"));
            } catch (javax.swing.text.BadLocationException error) { throw new AssertionError(error); }
        });
    }
}
