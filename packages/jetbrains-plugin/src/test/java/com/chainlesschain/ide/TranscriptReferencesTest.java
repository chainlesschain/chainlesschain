package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class TranscriptReferencesTest {
    @Test @SuppressWarnings("unchecked") void validatesResultAndBothSessionBindings() throws Exception {
        Map<String, Object> refs = (Map<String, Object>) ((List<?>) SessionTranscriptChangesTest.fixture().get("refs")).getFirst();
        Map<String, Object> event = new HashMap<>(Map.of("type", "result", "session_id", SessionTranscriptChangesTest.SESSION, "transcript_refs", refs));
        assertNotNull(TranscriptReferences.result(event, SessionTranscriptChangesTest.SESSION));
        assertNull(TranscriptReferences.result(event, "other"));
        for (String field : List.of("sessionId", "assistantEventId", "userEventId", "clientMessageId", "unknown")) {
            Map<String, Object> invalid = new HashMap<>(refs); invalid.put(field, "!"); event.put("transcript_refs", invalid);
            assertNull(TranscriptReferences.result(event, SessionTranscriptChangesTest.SESSION), field);
        }
    }
    @Test void rejectsIncompleteOrMismatchedInputReceipts() {
        Map<String, Object> receipt = new HashMap<>(Map.of("sessionId", "s", "clientMessageId", "client", "eventHash", "a".repeat(64), "inputDigest", "b".repeat(64), "duplicate", false));
        Map<String, Object> event = new HashMap<>(Map.of("type", "system", "subtype", "input_accepted", "session_id", "s", "client_message_id", "client", "receipt", receipt));
        assertEquals("a".repeat(64), TranscriptReferences.input(event, "s"));
        for (String field : List.of("sessionId", "clientMessageId", "eventHash", "inputDigest", "duplicate")) {
            Map<String, Object> invalid = new HashMap<>(receipt); invalid.remove(field); event.put("receipt", invalid);
            assertNull(TranscriptReferences.input(event, "s"), field);
        }
    }
}
