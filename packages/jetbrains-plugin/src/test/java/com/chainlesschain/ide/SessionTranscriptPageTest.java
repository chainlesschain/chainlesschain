package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import static org.junit.jupiter.api.Assertions.*;

class SessionTranscriptPageTest {
    static String fixture() throws Exception {
        return Files.readString(Path.of("../cli/__tests__/fixtures/session-transcript-history-page-v2.json"));
    }
    @Test void acceptsTheSameRealCliPageAsVsCodeWithoutExecutingMessages() throws Exception {
        SessionTranscriptPage page = SessionTranscriptPage.parse(fixture(), "fixture-history", null);
        assertEquals(2, page.messages().size());
        assertEquals("answer one", page.messages().getFirst().text());
        assertEquals("question two", page.messages().getLast().text());
        assertNotNull(page.nextCursor());
        assertFalse(page.snapshotBoundary());
        assertThrows(UnsupportedOperationException.class, () -> page.messages().clear());
        assertEquals(List.of("session", "show", "--json", "--history", "--page-size", "50", "--before", page.nextCursor(), "--", "fixture-history"),
                SessionTranscriptPage.arguments("fixture-history", page.nextCursor()));
    }
    @Test @SuppressWarnings("unchecked") void rejectsWrongSessionAndInconsistentIdentityOrNavigation() throws Exception {
        List<Consumer<Map<String, Object>>> edits = List.of(
                p -> p.put("sessionId", "other"),
                p -> p.put("revision", "invalid"),
                p -> p.put("nextCursor", null),
                p -> p.put("contextOnly", true),
                p -> p.put("eventCount", 1.5),
                p -> p.put("messages", List.of()),
                p -> ((Map<String, Object>) ((List<?>) p.get("messages")).getFirst()).put("id", "other"),
                p -> ((List<Object>) p.get("messages")).set(1, ((List<?>) p.get("messages")).getFirst()),
                p -> ((Map<String, Object>) ((List<?>) p.get("messages")).getFirst()).put("text", "x".repeat(200_001)),
                p -> ((Map<String, Object>) p.get("coverage")).put("kind", "unknown"));
        for (Consumer<Map<String, Object>> edit : edits) {
            Map<String, Object> page = MiniJson.parseObject(fixture()); edit.accept(page);
            assertThrows(IllegalArgumentException.class, () -> SessionTranscriptPage.parse(MiniJson.stringify(page), "fixture-history", null));
        }
    }
    @Test void requiresTheRequestedCursorGenerationAndEarlierRange() throws Exception {
        Map<String, Object> page = MiniJson.parseObject(fixture());
        String cursor = (String) page.get("nextCursor");
        assertThrows(IllegalArgumentException.class, () -> SessionTranscriptPage.parse(MiniJson.stringify(page), "fixture-history", cursor));
        Map<String, Object> older = MiniJson.parseObject(new String(Base64.getUrlDecoder().decode(cursor), java.nio.charset.StandardCharsets.UTF_8));
        older.put("generation", "f".repeat(64));
        String stale = Base64.getUrlEncoder().withoutPadding().encodeToString(MiniJson.stringify(older).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        assertThrows(IllegalArgumentException.class, () -> SessionTranscriptPage.parse(MiniJson.stringify(page), "fixture-history", stale));
    }
    @Test void rejectsOversizedAndShellLikeInputs() {
        assertThrows(IllegalArgumentException.class, () -> SessionTranscriptPage.arguments("--help && launch", null));
        assertThrows(IllegalArgumentException.class, () -> SessionTranscriptPage.arguments("good", "%PATH%"));
        assertThrows(IllegalArgumentException.class, () -> SessionTranscriptPage.parse("中".repeat(800_000), "good", null));
    }
}
