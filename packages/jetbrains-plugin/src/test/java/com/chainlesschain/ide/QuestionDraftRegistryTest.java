package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.io.TempDir;
import java.io.IOException;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.jupiter.api.Assertions.*;

class QuestionDraftRegistryTest {
    @TempDir Path temp;
    private final Object owner = new Object(), generation = new Object();
    private final String key = ChatDraftStore.newKey();
    private QuestionDraftRegistry registry(ChatDraftStore store) {
        var registry = new QuestionDraftRegistry(store, key); registry.bind(owner, generation, "session"); return registry;
    }
    private static void drain() throws Exception {
        for (int i = 0; i < 3; i++) ChatDraftTasks.submit(() -> null).get(5, TimeUnit.SECONDS);
    }
    @AfterEach void finishStorageWork() throws Exception { drain(); }
    @Test void restoresBoundFieldsAcrossHostCrashWithoutGrantingResponseAuthority() throws Exception {
        var store = new ChatDraftStore(temp); var first = registry(store);
        var original = first.open(QuestionDraftContractTest.request()); drain();
        first.edit(original, Map.of("answer", "saved")); first.save(original).get(5, TimeUnit.SECONDS);
        var reopened = registry(new ChatDraftStore(temp));
        var fresh = reopened.open(QuestionDraftContractTest.request()); drain();
        assertEquals(Map.of("answer", "saved"), reopened.view(fresh).values());
        assertEquals(QuestionDraftRegistry.State.DRAFT, reopened.view(fresh).state());
        assertFalse(reopened.claim(fresh));
        reopened.edit(fresh, Map.of("answer", "edited")); reopened.save(fresh).get(5, TimeUnit.SECONDS);
        assertEquals(1, store.load(key).questions().size(), "adopt the matching record, rather than duplicating it");
    }
    @Test void mismatchedRequestSessionCannotAcquireResponseAuthority() throws Exception {
        var registry = registry(new ChatDraftStore(temp));
        var request = QuestionDraftContractTest.request(); request.put("sessionId", "other");
        assertThrows(IOException.class, () -> registry.open(request));
        request.remove("sessionId"); request.put("binding", Map.of("sessionId", "other"));
        assertThrows(IOException.class, () -> registry.open(request));
    }
    @Test void unboundQuestionsOnlyRetainValuesInSameLiveInstanceAndSchemaChangesArchiveTheOldForm() throws Exception {
        var store = new ChatDraftStore(temp); var first = registry(store);
        var request = QuestionDraftContractTest.request(); request.remove("binding");
        var original = first.open(request); drain();
        first.edit(original, Map.of("answer", "legacy")); first.save(original).get(5, TimeUnit.SECONDS);
        assertSame(original, first.open(request));
        var second = registry(store); var fresh = second.open(request); drain();
        assertTrue(second.view(fresh).values().isEmpty());
        request.put("options", List.of("changed"));
        var changed = first.open(request); drain();
        assertEquals(QuestionDraftRegistry.State.ARCHIVED, first.view(original).state());
        assertFalse(first.claim(original)); assertTrue(first.editable(changed));
        first.event(owner, generation, "session", "q1", true, "");
        assertEquals(QuestionDraftRegistry.State.UNKNOWN, first.view(changed).state(), "reused IDs cannot establish which schema was resolved");
    }
    @Test void reserveIsExclusiveAndRequiresDiskSuccessBeforeAOneTimeDispatch() throws Exception {
        var store = new ChatDraftStore(temp); var registry = registry(store);
        var entry = registry.open(QuestionDraftContractTest.request()); drain();
        registry.edit(entry, Map.of("answer", "one"));
        CountDownLatch gate = new CountDownLatch(1);
        var blocker = ChatDraftTasks.submit(() -> { assertTrue(gate.await(5, TimeUnit.SECONDS)); return null; });
        try {
            var reserved = registry.reserve(entry);
            assertFalse(registry.claim(entry), "saving is not dispatch permission");
            assertFalse(registry.reserve(entry).get(5, TimeUnit.SECONDS));
            gate.countDown(); blocker.get(5, TimeUnit.SECONDS);
            assertTrue(reserved.get(5, TimeUnit.SECONDS));
        } finally { gate.countDown(); }
        assertEquals("archived", store.load(key).questions().getFirst().status(), "persist uncertainty before any pipe write");
        assertTrue(registry.claim(entry)); assertFalse(registry.claim(entry));
        assertEquals(QuestionDraftRegistry.State.AWAITING, registry.view(entry).state());
        registry.event(new Object(), generation, "session", "q1", true, "");
        registry.event(owner, new Object(), "session", "q1", true, "");
        registry.event(owner, generation, "other", "q1", true, "");
        assertEquals(QuestionDraftRegistry.State.AWAITING, registry.view(entry).state());
        registry.event(owner, generation, "session", "q1", true, ""); drain();
        assertEquals(QuestionDraftRegistry.State.RESOLVED, registry.view(entry).state());
        registry.deliveryFailed(entry); assertEquals(QuestionDraftRegistry.State.RESOLVED, registry.view(entry).state());
        assertSame(entry, registry.open(QuestionDraftContractTest.request()), "duplicate requests cannot revive a terminal response");
    }
    @Test void replacementWhileSaveIsPendingRevokesOldResponseIncludingAnUnboundRequest() throws Exception {
        var store = new ChatDraftStore(temp); var registry = registry(store);
        var request = QuestionDraftContractTest.request(); request.remove("binding");
        var entry = registry.open(request); drain(); registry.edit(entry, Map.of("answer", "old"));
        CountDownLatch gate = new CountDownLatch(1);
        ChatDraftTasks.submit(() -> { assertTrue(gate.await(5, TimeUnit.SECONDS)); return null; });
        try {
            var reserved = registry.reserve(entry);
            registry.bind(new Object(), new Object(), "session");
            gate.countDown(); assertFalse(reserved.get(5, TimeUnit.SECONDS)); drain();
        } finally { gate.countDown(); }
        assertFalse(registry.claim(entry)); assertFalse(registry.owns(entry));
        assertEquals("archived", store.load(key).questions().getFirst().status());
    }
    @Test void saveFailureAllowsExplicitRetryButDeliveryFailureAndRejectionDoNot() throws Exception {
        AtomicBoolean failing = new AtomicBoolean(true);
        var store = new ChatDraftStore(temp) {
            @Override public void saveQuestion(String key, Question candidate) throws IOException {
                if (failing.get()) throw new IOException("disk full"); super.saveQuestion(key, candidate);
            }
        };
        var registry = registry(store); var entry = registry.open(QuestionDraftContractTest.request()); drain();
        registry.edit(entry, Map.of("answer", "keep"));
        assertFalse(registry.reserve(entry).get(5, TimeUnit.SECONDS));
        assertTrue(registry.view(entry).message().contains("disk full")); assertTrue(registry.editable(entry));
        failing.set(false); assertTrue(registry.reserve(entry).get(5, TimeUnit.SECONDS)); assertTrue(registry.claim(entry));
        registry.deliveryFailed(entry);
        assertEquals(QuestionDraftRegistry.State.UNKNOWN, registry.view(entry).state());
        assertFalse(registry.reserve(entry).get(5, TimeUnit.SECONDS));
        registry.event(owner, generation, "session", "q1", false, "binding_mismatch");
        assertFalse(registry.claim(entry));
        assertTrue(registry.view(entry).message().contains("binding_mismatch"));
        drain();
    }
    @Test void deferredQuestionsSurviveTurnEndButStopArchivesEverything() throws Exception {
        var registry = registry(new ChatDraftStore(temp));
        var blocking = registry.open(QuestionDraftContractTest.request());
        var request = QuestionDraftContractTest.request(); request.put("id", "later"); request.put("blocking", false);
        var deferred = registry.open(request); drain();
        registry.turnEnded(); drain();
        assertFalse(registry.editable(blocking)); assertTrue(registry.editable(deferred));
        registry.cancelAll("stop"); drain(); assertFalse(registry.editable(deferred));
        assertSame(blocking, registry.open(QuestionDraftContractTest.request()));
    }
    @Test void lateLoadAdoptsIdentityWithoutOverwritingEditsAndDetachArchivesAdoptedRecord() throws Exception {
        var store = new ChatDraftStore(temp); var first = registry(store);
        var original = first.open(QuestionDraftContractTest.request()); drain();
        first.edit(original, Map.of("answer", "old")); first.save(original).get(5, TimeUnit.SECONDS);
        CountDownLatch entered = new CountDownLatch(1), gate = new CountDownLatch(1);
        AtomicBoolean once = new AtomicBoolean();
        var delayed = new ChatDraftStore(temp) {
            @Override public Draft load(String key) throws IOException {
                if (once.compareAndSet(false, true)) {
                    entered.countDown();
                    try { if (!gate.await(5, TimeUnit.SECONDS)) throw new IOException("timeout"); }
                    catch (InterruptedException e) { throw new IOException(e); }
                }
                return super.load(key);
            }
        };
        var second = registry(delayed); var current = second.open(QuestionDraftContractTest.request());
        try {
            assertTrue(entered.await(5, TimeUnit.SECONDS));
            second.edit(current, Map.of("answer", "newer")); second.detach("closed");
        } finally { gate.countDown(); }
        drain();
        assertEquals(Map.of("answer", "newer"), second.view(current).values());
        var saved = store.load(key).questions(); assertEquals(1, saved.size());
        assertEquals("archived", saved.getFirst().status()); assertEquals("newer", saved.getFirst().fields().get("answer"));
    }
    @Test void failedLoadCanBeRetriedWithoutReplacingEditsOrTreatingUnreadableStorageAsEmpty() throws Exception {
        var store = new ChatDraftStore(temp); var first = registry(store);
        var original = first.open(QuestionDraftContractTest.request()); drain(); first.edit(original, Map.of("answer", "old")); first.save(original).get();
        AtomicBoolean fail = new AtomicBoolean(true);
        var flaky = new ChatDraftStore(temp) {
            @Override public Draft load(String key) throws IOException { if (fail.get()) throw new IOException("unreadable"); return super.load(key); }
        };
        var second = registry(flaky); var entry = second.open(QuestionDraftContractTest.request()); drain();
        assertFalse(second.view(entry).loaded()); assertFalse(second.reserve(entry).get());
        second.edit(entry, Map.of("answer", "new")); fail.set(false); second.retry(entry); drain();
        assertTrue(second.view(entry).loaded()); assertEquals("new", second.view(entry).values().get("answer"));
        assertEquals(1, store.load(key).questions().size()); assertEquals("new", store.load(key).questions().getFirst().fields().get("answer"));
    }
}
