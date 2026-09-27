package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class QuestionDraftStoreTest {
    @TempDir Path temp;
    private ChatDraftStore.Question question(String id, String status) {
        return new ChatDraftStore.Question(id, "a".repeat(64), "session", "q1", "Question", Map.of("answer", "草稿"), "Answer: 草稿", status);
    }
    @Test void independentQuestionWritesPreserveComposerAndInputReceiptsAndArchiveCannotRevert() throws Exception {
        ChatDraftStore store = new ChatDraftStore(temp);
        String key = ChatDraftStore.newKey(), id = ChatDraftStore.newKey();
        var submission = store.prepare(key, "session", "submitted", List.of(), null);
        store.save(key, "session", "new composer", List.of());
        store.saveQuestion(key, question(id, "draft"));
        store.settle(key, submission.submission().id(), null);
        store.saveQuestion(key, question(id, "archived"));
        store.saveQuestion(key, question(id, "draft"));
        var reloaded = new ChatDraftStore(temp).load(key);
        assertEquals("new composer", reloaded.composer().text());
        assertEquals("unknown", reloaded.submissions().getFirst().status());
        assertEquals("archived", reloaded.questions().getFirst().status());
        store.discardQuestion(key, id);
        assertTrue(store.load(key).questions().isEmpty());
        assertEquals("new composer", store.load(key).composer().text());
    }
    @Test void questionsAloneKeepADraftDiscoverableUntilExplicitDiscard() throws Exception {
        ChatDraftStore store = new ChatDraftStore(temp);
        String key = ChatDraftStore.newKey(), id = ChatDraftStore.newKey();
        store.saveQuestion(key, question(id, "draft"));
        store.save(key, "session", "", List.of());
        assertEquals(1, store.list().size());
        store.discardQuestion(key, id);
        assertTrue(store.list().isEmpty());
    }
    @Test void schemaV1MigratesAndQuestionIdentityBudgetsAndCorruptionFailClosed() throws Exception {
        ChatDraftStore store = new ChatDraftStore(temp);
        String key = ChatDraftStore.newKey(), id = ChatDraftStore.newKey();
        store.save(key, "session", "text", List.of());
        Path file = temp.resolve(key).resolve("draft.json");
        var old = MiniJson.parseObject(Files.readString(file)); old.put("version", 1); old.remove("questions"); Files.writeString(file, MiniJson.stringify(old));
        store.saveQuestion(key, question(id, "draft"));
        assertEquals(2, ((Number) MiniJson.parseObject(Files.readString(file)).get("version")).intValue());
        assertThrows(IOException.class, () -> store.saveQuestion(key, new ChatDraftStore.Question(id, "b".repeat(64), "session", "q1", "Q", Map.of(), "", "draft")));
        for (int i = 1; i < 16; i++) store.saveQuestion(key, question(ChatDraftStore.newKey(), "draft"));
        assertThrows(IOException.class, () -> store.saveQuestion(key, question(ChatDraftStore.newKey(), "draft")));
        assertEquals(16, store.load(key).questions().size());
        var record = MiniJson.parseObject(Files.readString(file)); record.put("questions", List.of(Map.of("id", "../bad")));
        String damaged = MiniJson.stringify(record); Files.writeString(file, damaged);
        assertThrows(IOException.class, () -> store.saveQuestion(key, question(id, "draft")));
        assertEquals(damaged, Files.readString(file));
    }
    @Test void failedRenameLeavesPreviousQuestionFields() throws Exception {
        ChatDraftStore store = new ChatDraftStore(temp); String key = ChatDraftStore.newKey(), id = ChatDraftStore.newKey();
        store.saveQuestion(key, question(id, "draft"));
        ChatDraftStore failing = new ChatDraftStore(temp) {
            @Override protected void replace(Path source, Path target) throws IOException { throw new IOException("rename failed"); }
        };
        assertThrows(IOException.class, () -> failing.saveQuestion(key, question(id, "archived")));
        assertEquals("draft", store.load(key).questions().getFirst().status());
    }
}
