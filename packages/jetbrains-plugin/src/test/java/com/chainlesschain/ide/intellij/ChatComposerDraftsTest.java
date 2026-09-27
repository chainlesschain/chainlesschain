package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import javax.swing.*;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;

class ChatComposerDraftsTest {
    @TempDir Path temp;
    @Test void cancelledPreparedInputRestoresComposerAndKeepsItsSavedRecordRejected() throws Exception {
        for (boolean unknown : List.of(false, true)) {
            Path root = temp.resolve("drafts-" + unknown);
            ChatDraftStore store = new ChatDraftStore(root);
            String key = ChatDraftStore.newKey();
            store.save(key, "s1", "unsent 中文😀", List.of());
            Harness h = create(store, key); drain();
            AtomicLong revision = new AtomicLong();
            SwingUtilities.invokeAndWait(() -> {
                revision.set(h.drafts.revision()); h.busy.set(true); h.drafts.beginSend();
            });
            ChatDraftStore.Prepared prepared = h.drafts.prepare("unsent 中文😀", List.of(), null).get(5, TimeUnit.SECONDS);
            if (unknown) h.drafts.markUnknown(prepared.submission().id()).get(5, TimeUnit.SECONDS);
            h.drafts.rejectUndispatched(prepared.submission().id()).get(5, TimeUnit.SECONDS);
            SwingUtilities.invokeAndWait(() -> {
                h.busy.set(false); h.drafts.finishSend(null, revision.get());
                assertEquals("unsent 中文😀", h.input.getText()); assertTrue(h.input.isEditable());
            });
            drain();
            ChatDraftStore.Draft recovered = new ChatDraftStore(root).load(key);
            assertEquals("unsent 中文😀", recovered.composer().text());
            assertEquals("rejected", recovered.submissions().get(0).status());
            SwingUtilities.invokeAndWait(h.drafts::dispose); drain();
        }
    }
    private static class Harness {
        final JTextArea input = new JTextArea();
        final ChatComposerImages images = new ChatComposerImages(input);
        final ConversationManager.Conversation conv = new ConversationManager().create(null, "s1", true);
        final AtomicBoolean busy = new AtomicBoolean();
        ChatComposerDrafts drafts;
        Harness(ChatDraftStore store, String key) {
            conv.draftKey = key;
            drafts = new ChatComposerDrafts(null, conv, store, input, images, busy::get, () -> null, ignored -> {});
        }
    }
    private Harness create(ChatDraftStore store, String key) throws Exception {
        AtomicReference<Harness> result = new AtomicReference<>();
        SwingUtilities.invokeAndWait(() -> result.set(new Harness(store, key)));
        return result.get();
    }
    private void drain() throws Exception {
        for (int i = 0; i < 3; i++) {
            ChatDraftTasks.submit(() -> null).get(5, TimeUnit.SECONDS);
            SwingUtilities.invokeAndWait(() -> {});
        }
    }
    @Test void restoresDraftAndKeepsNewerInputWhenAStoredSubmissionFinishes() throws Exception {
        ChatDraftStore store = new ChatDraftStore(temp.resolve("drafts"));
        String key = ChatDraftStore.newKey();
        store.save(key, "s1", "saved input", List.of());
        Harness h = create(store, key); drain();
        AtomicLong revision = new AtomicLong();
        SwingUtilities.invokeAndWait(() -> {
            assertTrue(h.drafts.ready()); assertEquals("saved input", h.input.getText());
            revision.set(h.drafts.revision()); h.busy.set(true); h.drafts.beginSend();
        });
        ChatDraftStore.Prepared prepared = h.drafts.prepare("saved input", List.of(), null).get(5, TimeUnit.SECONDS);
        h.drafts.markUnknown(prepared.submission().id()).get(5, TimeUnit.SECONDS);
        SwingUtilities.invokeAndWait(() -> {
            h.input.setText("newer programmatic input"); h.busy.set(false);
            h.drafts.finishSend(prepared, revision.get());
            assertEquals("newer programmatic input", h.input.getText());
        });
        drain();
        assertEquals("newer programmatic input", store.load(key).composer().text());
        assertEquals("unknown", store.load(key).submissions().get(0).status());
        SwingUtilities.invokeAndWait(h.drafts::dispose); drain();
    }
    @Test void preservesInputWhenTabClosesWhileTheAgentHasNotStarted() throws Exception {
        ChatDraftStore store = new ChatDraftStore(temp.resolve("drafts"));
        String key = ChatDraftStore.newKey(); Harness h = create(store, key); drain();
        SwingUtilities.invokeAndWait(() -> {
            h.input.setText("do not lose while binary probing"); h.busy.set(true);
            h.drafts.beginSend(); h.drafts.dispose();
        });
        drain();
        assertEquals("do not lose while binary probing", new ChatDraftStore(temp.resolve("drafts")).load(key).composer().text());
    }
    @Test void delayedRecoveryCannotOverwriteNewInputOrAuthorizeSendingOldImages() throws Exception {
        CountDownLatch reading = new CountDownLatch(1), release = new CountDownLatch(1);
        ChatDraftStore store = new ChatDraftStore(temp.resolve("drafts")) {
            @Override public List<String> paths(String key, Content content) throws java.io.IOException {
                reading.countDown();
                try { if (!release.await(5, TimeUnit.SECONDS)) throw new java.io.IOException("test gate timed out"); }
                catch (InterruptedException error) { throw new java.io.IOException(error); }
                return super.paths(key, content);
            }
        };
        String key = ChatDraftStore.newKey(); store.save(key, "s1", "old saved input", List.of());
        Harness h = create(store, key);
        try {
            assertTrue(reading.await(5, TimeUnit.SECONDS));
            SwingUtilities.invokeAndWait(() -> h.input.setText("new input"));
        } finally { release.countDown(); }
        drain();
        SwingUtilities.invokeAndWait(() -> {
            assertEquals("new input", h.input.getText()); assertFalse(h.drafts.ready()); h.drafts.dispose();
        });
        drain();
        assertEquals("old saved input", store.load(key).composer().text());
        assertTrue(store.list().stream().anyMatch(d -> !key.equals(d.key()) && d.composer().text().equals("new input")),
                "closing a recovery conflict preserves the newer text as a separate recoverable draft");
    }
}
