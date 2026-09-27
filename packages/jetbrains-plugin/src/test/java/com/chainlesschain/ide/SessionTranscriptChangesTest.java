package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import static org.junit.jupiter.api.Assertions.*;

public class SessionTranscriptChangesTest {
    public static final String SESSION = "fixture-history-sync";
    public static Map<String, Object> fixture() throws Exception {
        return MiniJson.parseObject(Files.readString(Path.of("../cli/__tests__/fixtures/session-transcript-sync-v1.json")));
    }
    public static SessionTranscriptPage baseline(String key) throws Exception {
        return SessionTranscriptPage.parse(MiniJson.stringify(fixture().get(key)), SESSION, null);
    }
    public static SessionTranscriptChanges changes(String key, String cursor) throws Exception {
        return SessionTranscriptChanges.parse(MiniJson.stringify(fixture().get(key)), SESSION, cursor);
    }
    @Test void readsRealCliBatchesMetadataAndRewind() throws Exception {
        SessionTranscriptPage page = baseline("baseline");
        SessionTranscriptChanges first = changes("first", page.syncCursor());
        SessionTranscriptChanges second = changes("second", first.nextCursor());
        SessionTranscriptChanges meta = changes("metadata", second.nextCursor());
        assertEquals(2, first.from()); assertTrue(first.hasMore());
        assertEquals(4, second.from()); assertFalse(second.hasMore());
        assertEquals(6, meta.from()); assertTrue(meta.page().messages().isEmpty());
        assertNotEquals(second.nextCursor(), meta.nextCursor());
        assertNotEquals(page.generation(), baseline("rewind").generation());
        assertEquals(page.messages(), baseline("rewind").messages());
        assertEquals(List.of("session", "show", "--json", "--history", "--after", page.syncCursor(), "--page-size", "50", "--", SESSION),
                SessionTranscriptChanges.arguments(SESSION, page.syncCursor()));
    }
    @Test @SuppressWarnings("unchecked") void rejectsBadSessionHeadRangeIdentityAndContinuation() throws Exception {
        SessionTranscriptPage page = baseline("baseline");
        List<Consumer<Map<String, Object>>> mutations = List.of(
                m -> m.put("sessionId", "other"), m -> m.put("generation", "f".repeat(64)),
                m -> m.put("eventCount", page.eventCount()), m -> m.put("eventCount", 1),
                m -> m.put("from", 3), m -> m.put("from", -1), m -> m.put("hasMore", false),
                m -> m.put("nextCursor", page.syncCursor()), m -> m.put("messages", List.of()),
                m -> m.put("contextOnly", true), m -> m.put("schema", "other"),
                m -> ((List<Object>) m.get("messages")).set(1, ((List<?>) m.get("messages")).getFirst()),
                m -> ((Map<String, Object>) ((List<?>) m.get("messages")).getFirst()).put("ordinal", 1));
        for (Consumer<Map<String, Object>> mutation : mutations) {
            Map<String, Object> batch = (Map<String, Object>) fixture().get("first"); mutation.accept(batch);
            assertThrows(IllegalArgumentException.class, () -> SessionTranscriptChanges.parse(MiniJson.stringify(batch), SESSION, page.syncCursor()));
        }
        Map<String, Object> cursor = MiniJson.parseObject(new String(Base64.getUrlDecoder().decode(page.syncCursor()), StandardCharsets.UTF_8));
        cursor.put("view", "history");
        String changed = Base64.getUrlEncoder().withoutPadding().encodeToString(MiniJson.stringify(cursor).getBytes(StandardCharsets.UTF_8));
        assertThrows(IllegalArgumentException.class, () -> changes("first", changed));
        assertThrows(IllegalArgumentException.class, () -> SessionTranscriptChanges.arguments(SESSION, "%PATH%"));
    }
    @Test void latestSnapshotRequiresConsistentSyncCursorAndOlderMustNotClaimOne() throws Exception {
        Map<String, Object> page = MiniJson.parseObject(MiniJson.stringify(fixture().get("baseline")));
        page.put("syncCursor", baseline("rewind").syncCursor());
        assertThrows(IllegalArgumentException.class, () -> SessionTranscriptPage.parse(MiniJson.stringify(page), SESSION, null));
    }
}
