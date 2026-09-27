package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.SessionHistoryReader;
import com.chainlesschain.ide.SessionTranscriptChanges;
import com.chainlesschain.ide.SessionTranscriptChangesTest;
import com.chainlesschain.ide.SessionTranscriptPage;
import org.junit.jupiter.api.Test;
import javax.swing.*;
import java.awt.Component;
import java.awt.Container;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.function.BooleanSupplier;
import static org.junit.jupiter.api.Assertions.*;

class ChatHistorySyncTest {
    private static void edt(Runnable task) throws Exception { SwingUtilities.invokeAndWait(task); }
    private static <T extends Component> List<T> all(Container root, Class<T> type) {
        List<T> result = new ArrayList<>();
        for (Component c : root.getComponents()) { if (type.isInstance(c)) result.add(type.cast(c)); if (c instanceof Container child) result.addAll(all(child, type)); }
        return result;
    }
    private static final class Harness implements Executor, ChatHistoryView.Loader {
        final List<Runnable> jobs = new ArrayList<>(); final List<String> cursors = new ArrayList<>();
        final SessionTranscriptPage baseline = SessionTranscriptChangesTest.baseline("baseline"), rewind = SessionTranscriptChangesTest.baseline("rewind");
        final SessionTranscriptChanges first = SessionTranscriptChangesTest.changes("first", baseline.syncCursor());
        final SessionTranscriptChanges second = SessionTranscriptChangesTest.changes("second", first.nextCursor());
        final SessionTranscriptChanges meta = SessionTranscriptChangesTest.changes("metadata", second.nextCursor());
        ChatTranscript transcript; ChatHistoryView view; Object owner = new Object(); int snapshots; Exception failure;
        Harness() throws Exception {
            edt(() -> { transcript = new ChatTranscript(); view = new ChatHistoryView(transcript, () -> baseline.sessionId(), () -> false, true, this, this); view.ownerSource(() -> owner); view.onSelected(); });
            next();
        }
        public void execute(Runnable job) { jobs.add(job); }
        void next() throws Exception { jobs.removeFirst().run(); edt(() -> {}); }
        JButton latest() { return all(view.component(), JButton.class).stream().filter(b -> b.getText().equals("Latest")).findFirst().orElseThrow(); }
        void selectLast() {
            try {
                int at = transcript.pane().getDocument().getText(0, transcript.pane().getDocument().getLength()).lastIndexOf("same 中文😀");
                transcript.pane().select(at, at + 4); assertEquals("same", transcript.pane().getSelectedText());
            } catch (javax.swing.text.BadLocationException e) { throw new AssertionError(e); }
        }
        public SessionTranscriptPage read(String sid, String cursor, BooleanSupplier cancelled) { snapshots++; return snapshots == 1 ? baseline : rewind; }
        public SessionTranscriptChanges changes(String sid, String cursor, BooleanSupplier cancelled) throws Exception {
            assertFalse(SwingUtilities.isEventDispatchThread()); cursors.add(cursor);
            if (failure != null) throw failure;
            return cursor.equals(baseline.syncCursor()) ? first : cursor.equals(first.nextCursor()) ? second : meta;
        }
    }
    @Test void appliesContiguousBatchesAndRetriesIntegrityFailureAtTheSameCursor() throws Exception {
        Harness h = new Harness(); h.failure = new IOException("integrity failure");
        edt(h.view::settled); h.next();
        edt(() -> { assertEquals(2, h.transcript.savedIds().size()); assertTrue(h.latest().isEnabled()); });
        assertEquals(1, h.snapshots); h.failure = null;
        edt(() -> h.latest().doClick()); h.next(); h.next();
        assertEquals(List.of(h.baseline.syncCursor(), h.baseline.syncCursor(), h.first.nextCursor()), h.cursors);
        edt(() -> { assertEquals(6, h.transcript.savedIds().size()); h.view.onSelected(); }); h.next();
        assertEquals(h.second.nextCursor(), h.cursors.getLast()); assertTrue(h.jobs.isEmpty());
        edt(() -> {
            assertEquals(6, h.transcript.savedIds().size());
            assertTrue(all(h.view.component(), JLabel.class).stream().anyMatch(label -> label.getText().contains("1–6 of 6")));
        });
    }
    @Test void staleFallbackWaitsForSelectionAndDoesNotAdvanceBeforeApplying() throws Exception {
        Harness h = new Harness(); edt(h.view::settled); h.next(); h.next();
        h.failure = new SessionHistoryReader.CursorExpired();
        edt(() -> { h.selectLast(); h.view.onSelected(); });
        h.next();
        edt(() -> { assertEquals(6, h.transcript.savedIds().size()); assertFalse(h.latest().isEnabled()); h.transcript.pane().setCaretPosition(0); });
        edt(() -> {});
        edt(() -> { assertEquals(2, h.transcript.savedIds().size()); assertTrue(h.latest().isEnabled()); });
        assertEquals(2, h.snapshots);
    }
    @Test void deferredRewindCannotOverwriteNewLiveTextOrAReplacedOwner() throws Exception {
        Harness h = new Harness(); edt(h.view::settled); h.next(); h.next();
        h.failure = new SessionHistoryReader.CursorExpired();
        edt(() -> { h.selectLast(); h.view.onSelected(); }); h.next();
        edt(() -> { h.owner = new Object(); h.transcript.pane().setCaretPosition(0); }); edt(() -> {});
        edt(() -> { assertEquals(6, h.transcript.savedIds().size()); assertTrue(h.latest().isEnabled()); h.view.onSelected(); h.view.dispose(); });
        h.next(); edt(() -> assertEquals(6, h.transcript.savedIds().size()));
    }
    @Test void newLiveOutputInvalidatesAnOutstandingIncrementalRead() throws Exception {
        Harness h = new Harness();
        edt(() -> { h.view.settled(); h.transcript.append("new diagnostic"); h.view.liveChanged(); }); h.next();
        edt(() -> { assertEquals(2, h.transcript.savedIds().size()); assertTrue(h.transcript.pane().getText().contains("new diagnostic")); });
        h.next(); h.next();
        edt(() -> { assertEquals(6, h.transcript.savedIds().size()); assertTrue(h.transcript.pane().getText().contains("new diagnostic")); });
    }
    @Test void boundsRefreshToEightBatchesAndContinuesFromTheLastAppliedCursor() throws Exception {
        SessionTranscriptPage baseline = SessionTranscriptChangesTest.baseline("rewind");
        java.util.Map<String, SessionTranscriptChanges> batches = new java.util.LinkedHashMap<>();
        String cursor = baseline.syncCursor();
        for (Object raw : (List<?>) SessionTranscriptChangesTest.fixture().get("continuation")) {
            SessionTranscriptChanges batch = SessionTranscriptChanges.parse(com.chainlesschain.ide.MiniJson.stringify(raw), baseline.sessionId(), cursor);
            batches.put(cursor, batch); cursor = batch.nextCursor();
        }
        List<Runnable> jobs = new ArrayList<>(); List<String> queries = new ArrayList<>();
        ChatTranscript[] transcript = new ChatTranscript[1]; ChatHistoryView[] view = new ChatHistoryView[1];
        edt(() -> {
            transcript[0] = new ChatTranscript();
            view[0] = new ChatHistoryView(transcript[0], baseline::sessionId, () -> false, true, new ChatHistoryView.Loader() {
                public SessionTranscriptPage read(String sid, String before, BooleanSupplier cancelled) { return baseline; }
                public SessionTranscriptChanges changes(String sid, String after, BooleanSupplier cancelled) { queries.add(after); return batches.get(after); }
            }, jobs::add);
            view[0].onSelected();
        });
        jobs.removeFirst().run(); edt(() -> {}); edt(view[0]::settled);
        for (int i = 0; i < 8; i++) { jobs.removeFirst().run(); edt(() -> {}); }
        assertEquals(8, queries.size()); assertTrue(jobs.isEmpty());
        edt(() -> { assertEquals(18, transcript[0].savedIds().size()); view[0].onSelected(); });
        jobs.removeFirst().run(); edt(() -> {});
        assertEquals(new ArrayList<>(batches.keySet()), queries);
        edt(() -> assertEquals(20, transcript[0].savedIds().size()));
    }
}
