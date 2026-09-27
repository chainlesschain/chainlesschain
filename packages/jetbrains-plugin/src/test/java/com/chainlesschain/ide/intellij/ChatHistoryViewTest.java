package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.SessionTranscriptPage;
import org.junit.jupiter.api.Test;
import javax.swing.*;
import java.awt.Component;
import java.awt.Container;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;

class ChatHistoryViewTest {
    private static class Worker implements Executor {
        final List<Runnable> jobs = new ArrayList<>();
        public void execute(Runnable job) { jobs.add(job); }
        void next() throws Exception { jobs.removeFirst().run(); flush(); }
    }
    private static SessionTranscriptPage page(String session, String text, String next) {
        String hash = "a".repeat(64);
        return new SessionTranscriptPage(session, hash, hash, 3, 2,
                List.of(new SessionTranscriptPage.Row(session + ":" + hash + ":0", hash, 0,
                        next == null ? 0 : 1, "assistant", text, false)), next, false);
    }
    private static void edt(Runnable runnable) throws Exception { SwingUtilities.invokeAndWait(runnable); }
    private static void flush() throws Exception { edt(() -> {}); }
    private static <T extends Component> List<T> components(Container root, Class<T> type) {
        List<T> result = new ArrayList<>();
        for (Component child : root.getComponents()) {
            if (type.isInstance(child)) result.add(type.cast(child));
            if (child instanceof Container container) result.addAll(components(container, type));
        }
        return result;
    }
    private static JButton button(ChatHistoryView view, String text) {
        return components(view.component(), JButton.class).stream().filter(b -> text.equals(b.getAccessibleContext().getAccessibleName())).findFirst().orElseThrow();
    }

    @Test void restoresTwoIndependentTabsAndBackgroundFinalTextOffEdt() throws Exception {
        Worker worker = new Worker();
        AtomicReference<ChatTranscript> a = new AtomicReference<>(), b = new AtomicReference<>();
        AtomicReference<ChatHistoryView> va = new AtomicReference<>(), vb = new AtomicReference<>();
        AtomicReference<String> answer = new AtomicReference<>("saved A");
        edt(() -> {
            a.set(new ChatTranscript()); b.set(new ChatTranscript());
            va.set(new ChatHistoryView(a.get(), () -> "a", () -> false, true, (sid, cursor, cancelled) -> {
                assertFalse(SwingUtilities.isEventDispatchThread()); return page(sid, answer.get(), null);
            }, worker));
            vb.set(new ChatHistoryView(b.get(), () -> "b", () -> false, true, (sid, cursor, cancelled) -> page(sid, "saved B", null), worker));
            va.get().onSelected(); vb.get().onSelected();
        });
        worker.next(); worker.next();
        edt(() -> {
            assertTrue(a.get().pane().getText().contains("saved A"));
            assertTrue(b.get().pane().getText().contains("saved B"));
            a.get().appendAssistantDelta("partial A"); va.get().liveChanged();
            answer.set("final A after background completion"); va.get().settled();
        });
        worker.next();
        edt(() -> {
            assertTrue(a.get().pane().getText().contains(answer.get()));
            assertFalse(a.get().pane().getText().contains("saved B"));
            assertFalse(b.get().pane().getText().contains("final A"));
        });
    }

    @Test void lateReadsDoNotOverwriteNewLiveOutputAndRefreshAfterIdle() throws Exception {
        Worker worker = new Worker(); AtomicBoolean active = new AtomicBoolean();
        ChatTranscript[] transcript = new ChatTranscript[1]; ChatHistoryView[] view = new ChatHistoryView[1];
        edt(() -> {
            transcript[0] = new ChatTranscript();
            view[0] = new ChatHistoryView(transcript[0], () -> "a", active::get, true,
                    (sid, cursor, cancelled) -> page(sid, "canonical final", null), worker);
            view[0].onSelected(); active.set(true);
            transcript[0].appendAssistantDelta("new live text"); view[0].liveChanged();
        });
        worker.next();
        edt(() -> {
            assertTrue(transcript[0].pane().getText().contains("new live text"));
            assertFalse(transcript[0].pane().getText().contains("canonical final"));
            active.set(false); view[0].idle();
        });
        worker.next();
        edt(() -> assertTrue(transcript[0].pane().getText().contains("canonical final")));
    }

    @Test void completedOldSessionReadCannotReappearAfterResetOrDispose() throws Exception {
        Worker worker = new Worker(); AtomicReference<String> sid = new AtomicReference<>("old");
        ChatTranscript[] transcript = new ChatTranscript[1]; ChatHistoryView[] view = new ChatHistoryView[1];
        edt(() -> {
            transcript[0] = new ChatTranscript();
            view[0] = new ChatHistoryView(transcript[0], sid::get, () -> false, true,
                    (session, cursor, cancelled) -> page(session, session + " content", null), worker);
            view[0].onSelected();
            // Block the EDT just until the worker queues its completed result;
            // reset before allowing the real Swing callback to run.
            Thread thread = new Thread(worker.jobs.removeFirst()); thread.start();
            try { thread.join(2000); } catch (InterruptedException e) { throw new AssertionError(e); }
            sid.set("new"); view[0].reset(true); view[0].onSelected();
        });
        flush();
        edt(() -> assertFalse(transcript[0].pane().getText().contains("old content")));
        worker.next();
        edt(() -> {
            assertTrue(transcript[0].pane().getText().contains("new content"));
            view[0].onSelected(); view[0].dispose(); transcript[0].clear();
        });
        worker.next();
        edt(() -> assertEquals("", transcript[0].pane().getText()));
    }

    @Test void olderPagesKeepTheLiveTranscriptSeparateAndReturnWithoutReplay() throws Exception {
        Worker worker = new Worker(); ChatTranscript[] transcript = new ChatTranscript[1]; ChatHistoryView[] view = new ChatHistoryView[1];
        edt(() -> {
            transcript[0] = new ChatTranscript();
            view[0] = new ChatHistoryView(transcript[0], () -> "a", () -> false, true,
                    (sid, cursor, cancelled) -> page(sid, cursor == null ? "latest" : "older", cursor == null ? "cursor" : null), worker);
            view[0].onSelected();
        });
        worker.next();
        edt(() -> button(view[0], "Older messages").doClick());
        worker.next();
        edt(() -> {
            assertTrue(transcript[0].pane().getText().contains("latest"));
            assertFalse(transcript[0].pane().getText().contains("older"));
            assertTrue(components(view[0].component(), JTextPane.class).stream().anyMatch(p -> p.getText().contains("older")));
            transcript[0].append("live continuation"); view[0].liveChanged();
            button(view[0], "Return to live conversation").doClick();
            assertTrue(transcript[0].pane().getText().contains("live continuation"));
            assertFalse(button(view[0], "Return to live conversation").isEnabled());
        });
        assertTrue(worker.jobs.isEmpty());
    }

    @Test void selectedTextSurvivesAutomaticRefreshAndManualLatestCanReplaceIt() throws Exception {
        Worker worker = new Worker(); ChatTranscript[] transcript = new ChatTranscript[1]; ChatHistoryView[] view = new ChatHistoryView[1];
        edt(() -> {
            transcript[0] = new ChatTranscript(); transcript[0].append("keep selected text"); transcript[0].pane().select(0, 4);
            view[0] = new ChatHistoryView(transcript[0], () -> "a", () -> false, true,
                    (sid, cursor, cancelled) -> page(sid, "saved", null), worker);
            view[0].onSelected();
        });
        worker.next();
        edt(() -> {
            assertEquals("keep", transcript[0].pane().getSelectedText());
            button(view[0], "Latest saved messages").doClick();
        });
        worker.next();
        edt(() -> assertTrue(transcript[0].pane().getText().contains("saved")));
    }

    @Test void stoppingKeepsTransientFailureTextAndCancelsAutomaticReplacement() throws Exception {
        Worker worker = new Worker(); ChatTranscript[] transcript = new ChatTranscript[1]; ChatHistoryView[] view = new ChatHistoryView[1];
        edt(() -> {
            transcript[0] = new ChatTranscript();
            view[0] = new ChatHistoryView(transcript[0], () -> "a", () -> false, true,
                    (sid, cursor, cancelled) -> page(sid, "partial saved content", null), worker);
            view[0].onSelected();
            transcript[0].append("turn failed before completion"); view[0].liveChanged(); view[0].stopped();
        });
        worker.next();
        edt(() -> {
            view[0].idle();
            view[0].onSelected();
            assertTrue(transcript[0].pane().getText().contains("turn failed before completion"));
            assertTrue(button(view[0], "Latest saved messages").isEnabled());
        });
        assertTrue(worker.jobs.isEmpty());
    }

    @Test void automaticRefreshDoesNotMoveAReaderAwayFromOlderLiveText() throws Exception {
        Worker worker = new Worker(); ChatTranscript[] transcript = new ChatTranscript[1]; ChatHistoryView[] view = new ChatHistoryView[1];
        edt(() -> {
            transcript[0] = new ChatTranscript(); transcript[0].append("older live text\n".repeat(100));
            view[0] = new ChatHistoryView(transcript[0], () -> "a", () -> false, true,
                    (sid, cursor, cancelled) -> page(sid, "replacement", null), worker);
        });
        // Finish the initial append's deferred caret visibility update before
        // simulating an actual reader scrolling away from that caret.
        flush();
        edt(() -> {
            transcript[0].pane().setSize(300, 5000);
            JViewport viewport = (JViewport) transcript[0].pane().getParent();
            viewport.setExtentSize(new java.awt.Dimension(300, 150));
            viewport.setViewPosition(new java.awt.Point(0, 100));
            assertFalse(transcript[0].canReplaceHistory());
            view[0].onSelected();
        });
        worker.next();
        edt(() -> {
            assertTrue(transcript[0].pane().getText().contains("older live text"));
            assertEquals(100, ((JViewport) transcript[0].pane().getParent()).getViewPosition().y);
        });
    }

    @Test void failuresAndQueueRejectionKeepReadableContentAndShowAnError() throws Exception {
        Worker worker = new Worker(); ChatTranscript[] transcript = new ChatTranscript[1]; ChatHistoryView[] view = new ChatHistoryView[1];
        edt(() -> {
            transcript[0] = new ChatTranscript(); transcript[0].append("readable");
            view[0] = new ChatHistoryView(transcript[0], () -> "a", () -> false, true,
                    (sid, cursor, cancelled) -> { throw new IOException("corrupt transcript"); }, worker);
            view[0].onSelected();
        });
        worker.next();
        edt(() -> {
            assertTrue(transcript[0].pane().getText().contains("readable"));
            assertTrue(components(view[0].component(), JLabel.class).stream().anyMatch(label -> label.getText().contains("corrupt transcript")));
            ChatHistoryView rejected = new ChatHistoryView(transcript[0], () -> "a", () -> false, true,
                    (sid, cursor, cancelled) -> page(sid, "must not run", null), job -> { throw new java.util.concurrent.RejectedExecutionException("queue full"); });
            rejected.onSelected();
            assertTrue(components(rejected.component(), JLabel.class).stream().anyMatch(label -> label.getText().contains("queue full")));
        });
    }

    @Test void entireBoundedHistoryPageRemainsReadablePastTheLiveDocumentCap() throws Exception {
        edt(() -> {
            ChatTranscript transcript = new ChatTranscript();
            List<SessionTranscriptPage.Row> rows = new ArrayList<>();
            for (int i = 0; i < 3; i++) rows.add(new SessionTranscriptPage.Row("id" + i, "a".repeat(64), 0, i,
                    "assistant", "row-" + i + "x".repeat(150_000), i == 1));
            SessionTranscriptPage page = new SessionTranscriptPage("a", "a".repeat(64), "a".repeat(64), 4, 3, rows, null, true);
            transcript.replaceHistory(page, true);
            assertTrue(transcript.pane().getText().contains("row-0"));
            assertTrue(transcript.pane().getText().contains("row-2"));
            assertTrue(transcript.pane().getText().contains("Message shortened"));
            assertTrue(transcript.pane().getDocument().getLength() < 500_000);
            assertEquals(0, transcript.pane().getCaretPosition());
            transcript.appendAssistantDelta("new live answer");
            assertTrue(transcript.pane().getDocument().getLength() <= 200_000);
        });
    }
}
