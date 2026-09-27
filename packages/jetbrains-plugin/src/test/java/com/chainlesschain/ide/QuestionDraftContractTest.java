package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;
import java.io.IOException;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

@SuppressWarnings("unchecked")
class QuestionDraftContractTest {
    static Map<String, Object> request() {
        Map<String, Object> binding = new LinkedHashMap<>();
        binding.put("backgroundAgentId", null); binding.put("sessionId", "session"); binding.put("turnId", "turn");
        binding.put("toolUseId", "tool"); binding.put("sequence", 1);
        return new LinkedHashMap<>(Map.of("id", "q1", "question", "What next?", "binding", binding));
    }
    @Test void identityIsStableButBindsSessionSchemaAndTurn() throws Exception {
        var request = request();
        String digest = QuestionDraftContract.identity("session", request);
        assertEquals(digest, QuestionDraftContract.identity("session", new TreeMap<>(request)));
        assertNotEquals(digest, QuestionDraftContract.identity("other", request));
        for (String key : List.of("question", "requestedSchema", "purpose", "contextRevision", "options", "mode", "binding")) {
            var changed = new LinkedHashMap<>(request); changed.put(key, "changed");
            assertNotEquals(digest, QuestionDraftContract.identity("session", changed), key);
        }
        assertTrue(QuestionDraftContract.hasRecoveryBinding("session", request));
        assertFalse(QuestionDraftContract.hasRecoveryBinding("other", request));
        assertFalse(QuestionDraftContract.hasRecoveryBinding(null, Map.of("binding", Map.of())));
        for (Object sequence : List.of(0, -1, 1.5, 9_007_199_254_740_992L, Double.NaN)) {
            var changed = new LinkedHashMap<>((Map<String, Object>) request.get("binding")); changed.put("sequence", sequence);
            assertFalse(QuestionDraftContract.hasRecoveryBinding("session", Map.of("binding", changed)));
        }
    }
    @Test void detachedSnapshotCannotBeMutatedThroughOriginalOrReturnedNestedMaps() throws Exception {
        var request = request();
        var copy = QuestionDraftContract.snapshot(request);
        ((Map<String, Object>) request.get("binding")).put("turnId", "changed");
        assertEquals("turn", ((Map<?, ?>) copy.get("binding")).get("turnId"));
        assertThrows(UnsupportedOperationException.class, () -> ((Map<String, Object>) copy.get("binding")).put("turnId", "changed"));
        assertThrows(IOException.class, () -> QuestionDraftContract.snapshot(Map.of("x", Double.NaN)));
        Map<String, Object> cyclic = new HashMap<>(); cyclic.put("self", cyclic);
        assertThrows(IOException.class, () -> QuestionDraftContract.snapshot(cyclic));
        assertThrows(IOException.class, () -> QuestionDraftContract.identity("session", Map.of("question", "x".repeat(131073))));
    }
    @Test void secretAndUnknownFieldsNeverReachDiskProjectionOrArchivedText() throws Exception {
        var fields = QuestionDraftContract.fields(Map.of("elicitation", true, "requestedSchema", Map.of("type", "object", "properties", Map.of(
                "name", Map.of("type", "string"), "token", Map.of("type", "string", "writeOnly", true),
                "enabled", Map.of("type", "boolean")))));
        var normalized = QuestionDraftContract.normalize(fields, Map.of(QuestionDraftContract.fieldKey("name"), "Alice",
                QuestionDraftContract.fieldKey("token"), "secret", "unknown", "secret", QuestionDraftContract.fieldKey("enabled"), true));
        assertEquals(2, normalized.size());
        assertFalse(QuestionDraftContract.text(fields, normalized).contains("secret"));
        assertTrue(QuestionDraftContract.fields(Map.of("mode", "url")).isEmpty());
        assertTrue(QuestionDraftContract.fields(Map.of("elicitation", true, "requestedSchema", Map.of("type", "array"))).isEmpty());
        assertTrue(QuestionDraftContract.fields(Map.of("elicitation", true, "requestedSchema", Map.of("type", "object", "properties",
                Map.of("password", Map.of("type", "string", "format", "password"))))).isEmpty());
    }
    @Test void enumValuesUseCollisionFreeKeysAndRejectStaleChoices() throws Exception {
        assertNotEquals(QuestionDraftContract.optionKey("a|b", "c"), QuestionDraftContract.optionKey("a", "b|c"));
        var fields = QuestionDraftContract.fields(Map.of("options", List.of("one", "two")));
        assertEquals(Map.of("answer", "two"), QuestionDraftContract.normalize(fields, Map.of("answer", "two")));
        assertThrows(IOException.class, () -> QuestionDraftContract.normalize(fields, Map.of("answer", "removed")));
        assertThrows(IOException.class, () -> QuestionDraftContract.normalize(fields, Map.of("answer", false)));
        var multiple = QuestionDraftContract.fields(Map.of("options", List.of("one", "two"), "multiSelect", true));
        assertEquals("two: true", QuestionDraftContract.text(multiple, Map.of("option-0", false, "option-1", true)));
        assertThrows(IOException.class, () -> QuestionDraftContract.fields(Map.of("options", Collections.nCopies(129, "choice"), "multiSelect", true)));
    }
    @Test void fieldCharacterAndUtf8BudgetsRejectBeforePersistence() throws Exception {
        var fields = QuestionDraftContract.fields(Map.of());
        assertThrows(IOException.class, () -> QuestionDraftContract.normalize(fields, Map.of("answer", "x".repeat(32769))));
        assertThrows(IOException.class, () -> QuestionDraftContract.normalize(fields, Map.of("answer", "中".repeat(30000))));
    }
    @Test void canonicalIdentityDoesNotReorderTheDisplayedFields() throws Exception {
        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("zFirst", Map.of("type", "string")); properties.put("aLast", Map.of("type", "string"));
        var copy = QuestionDraftContract.snapshot(Map.of("elicitation", true, "requestedSchema", Map.of("type", "object", "properties", properties)));
        assertEquals(List.of("zFirst", "aLast"), QuestionDraftContract.fields(copy).stream().map(QuestionDraftContract.Field::label).toList());
    }
    @Test void eventProjectionPreservesDeferredLifecycleAndElicitationSchema() {
        var event = request(); event.put("type", "question_request"); event.put("mode", "deferred"); event.put("blocking", false);
        event.put("purpose", "plan"); event.put("contextRevision", 7);
        var ui = ChatEvents.mapAgentEvent(event, new ChatEvents.TurnState());
        assertEquals("deferred", ui.get("mode")); assertEquals(false, ui.get("blocking"));
        assertEquals("plan", ui.get("purpose")); assertEquals(7, ui.get("contextRevision"));
        event.put("metadata", Map.of("kind", "mcp_elicitation", "mode", "url", "url", "https://example.com"));
        ui = ChatEvents.mapAgentEvent(event, new ChatEvents.TurnState());
        assertEquals("url", ui.get("mode")); assertEquals(false, ui.get("blocking")); assertEquals(true, ui.get("elicitation"));
    }
}
