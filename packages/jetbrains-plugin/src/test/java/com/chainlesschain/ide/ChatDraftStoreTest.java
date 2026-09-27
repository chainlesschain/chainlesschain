package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ChatDraftStoreTest {
    @TempDir Path temp;
    private Path image(String name, int extra) throws IOException {
        byte[] png = Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==");
        byte[] bytes = Arrays.copyOf(png, png.length + extra);
        return Files.write(temp.resolve(name), bytes);
    }
    @Test void savesIndependentImageSnapshotsAndRecoversAcrossStoreInstances() throws Exception {
        Path root = temp.resolve("drafts"), original = image("one.png", 0);
        ChatDraftStore store = new ChatDraftStore(root);
        String key = ChatDraftStore.newKey();
        store.save(key, "s1", "中文\nemoji 🧪", List.of(original.toString()));
        Files.delete(original);
        ChatDraftStore reopened = new ChatDraftStore(root);
        ChatDraftStore.Draft recovered = reopened.load(key);
        assertEquals("中文\nemoji 🧪", recovered.composer().text());
        assertEquals(1, reopened.paths(key, recovered.composer()).size());
        assertEquals(1, reopened.list().size());
        reopened.save(key, "s1", "", List.of());
        assertTrue(reopened.list().isEmpty());
        assertFalse(Files.exists(root.resolve(key)));
    }
    @Test void preparingMovesComposerToSavedInputAndUnknownDoesNotMeanAccepted() throws Exception {
        ChatDraftStore store = new ChatDraftStore(temp.resolve("drafts"));
        String key = ChatDraftStore.newKey();
        store.save(key, "s1", "run", List.of(image("one.png", 0).toString()));
        ChatDraftStore.Prepared prepared = store.prepare(key, "s1", "run", store.paths(key, store.load(key).composer()), "source");
        assertEquals("", store.load(key).composer().text());
        assertEquals("prepared", store.load(key).submissions().get(0).status());
        store.settle(key, prepared.submission().id(), null);
        assertEquals("unknown", store.load(key).submissions().get(0).status());
        assertTrue(Files.exists(Path.of(prepared.paths().get(0))));
        Map<String, Object> receipt = new LinkedHashMap<>(Map.of("sessionId", "other", "clientMessageId", prepared.submission().id(),
                "inputDigest", "b".repeat(64), "eventHash", "a".repeat(64)));
        assertThrows(IOException.class, () -> store.settle(key, prepared.submission().id(), receipt));
        receipt.put("sessionId", "s1");
        store.settle(key, prepared.submission().id(), receipt);
        assertEquals("accepted", store.load(key).submissions().get(0).status());
        store.settle(key, prepared.submission().id(), null);
        assertEquals("accepted", store.load(key).submissions().get(0).status());
        assertTrue(Files.exists(Path.of(prepared.paths().get(0))), "acceptance precedes image consumption; retain the snapshot");
        store.discardSubmission(key, prepared.submission().id());
        assertFalse(Files.exists(Path.of(prepared.paths().get(0))));
    }
    @Test void failedMetadataReplacementPreservesOriginalTextAndAttachments() throws Exception {
        Path root = temp.resolve("drafts");
        String key = ChatDraftStore.newKey();
        ChatDraftStore store = new ChatDraftStore(root);
        store.save(key, "s1", "original", List.of(image("one.png", 0).toString()));
        ChatDraftStore failing = new ChatDraftStore(root) {
            @Override protected void replace(Path source, Path target) throws IOException {
                if (target.getFileName().toString().equals("draft.json")) throw new IOException("injected rename failure");
                super.replace(source, target);
            }
        };
        Path newer = image("two.png", 1);
        assertThrows(IOException.class, () -> failing.save(key, "s1", "replacement", List.of(newer.toString())));
        ChatDraftStore.Draft recovered = store.load(key);
        assertEquals("original", recovered.composer().text());
        assertEquals(1, store.paths(key, recovered.composer()).size());
        try (var files = Files.list(root.resolve(key))) { assertEquals(2, files.count(), "failed write must not leak images or temps"); }
    }
    @Test void damagedFilesAndTraversalFailWithoutDiscardingRecoverableText() throws Exception {
        Path root = temp.resolve("drafts");
        ChatDraftStore store = new ChatDraftStore(root);
        String key = ChatDraftStore.newKey();
        store.save(key, "s1", "keep this text", List.of(image("one.png", 0).toString()));
        ChatDraftStore.Draft before = store.load(key);
        Path saved = Path.of(store.paths(key, before.composer()).get(0));
        Files.writeString(saved, "tampered");
        assertThrows(IOException.class, () -> store.paths(key, before.composer()));
        assertEquals("keep this text", store.load(key).composer().text());
        store.saveText(key, "s1", "edited while attachment is missing");
        assertEquals("edited while attachment is missing", store.load(key).composer().text());
        assertEquals(before.composer().images(), store.load(key).composer().images());
        assertThrows(IOException.class, () -> store.load("../escape"));
        assertThrows(IOException.class, () -> store.paths(key, new ChatDraftStore.Content("", List.of(new ChatDraftStore.Attachment("../escape", 1, "a".repeat(64))))));
        Path metadata = root.resolve(key).resolve("draft.json");
        Files.writeString(metadata, "{broken");
        assertThrows(IOException.class, () -> store.save(key, "s1", "overwrite", List.of()));
        assertEquals("{broken", Files.readString(metadata));
    }
    @Test void idleCleanupRetainsUnknownInputsAndNewComposerImages() throws Exception {
        ChatDraftStore store = new ChatDraftStore(temp.resolve("drafts"));
        String key = ChatDraftStore.newKey();
        ChatDraftStore.Prepared accepted = store.prepare(key, "s1", "accepted", List.of(image("one.png", 0).toString()), null);
        ChatDraftStore.Prepared unknown = store.prepare(key, "s1", "unknown", List.of(), null);
        store.settle(key, unknown.submission().id(), null);
        store.settle(key, accepted.submission().id(), Map.of("sessionId", "s1", "clientMessageId", accepted.submission().id(),
                "inputDigest", "b".repeat(64), "eventHash", "a".repeat(64)));
        store.save(key, "s1", "reuse attached image", accepted.paths());
        store.discardAcceptedWhenIdle(key);
        assertEquals(List.of(unknown.submission().id()), store.load(key).submissions().stream().map(ChatDraftStore.Submission::id).toList());
        assertTrue(Files.exists(Path.of(accepted.paths().get(0))), "the new composer still references this snapshot");
    }
    @Test void enforcesTextImageAndSavedInputBudgetsWithoutClearingTheComposer() throws Exception {
        ChatDraftStore store = new ChatDraftStore(temp.resolve("drafts"));
        String key = ChatDraftStore.newKey();
        assertThrows(IOException.class, () -> store.save(key, "s1", "x".repeat(100001), List.of()));
        Path png = image("one.png", 0);
        assertThrows(IOException.class, () -> store.save(key, "s1", "", Collections.nCopies(5, png.toString())));
        for (int i = 0; i < 8; i++) store.prepare(key, "s1", "input " + i, List.of(), null);
        store.save(key, "s1", "ninth", List.of());
        assertThrows(IOException.class, () -> store.prepare(key, "s1", "ninth", List.of(), null));
        assertEquals("ninth", store.load(key).composer().text());
        assertEquals(8, store.load(key).submissions().size());
    }
}
