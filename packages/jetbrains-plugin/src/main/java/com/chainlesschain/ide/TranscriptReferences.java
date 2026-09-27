package com.chainlesschain.ide;

import java.util.Map;
import java.util.Set;

/** Shape validation only: consumers must also verify owner and canonical history. */
public record TranscriptReferences(String sessionId, String assistantEventId, String userEventId, String clientMessageId) {
    private static final Set<String> KEYS = Set.of("schema", "sessionId", "assistantEventId", "userEventId", "clientMessageId");
    public static TranscriptReferences result(Map<String, Object> event, String sessionId) {
        if (event == null || sessionId == null || !"result".equals(event.get("type")) || !sessionId.equals(event.get("session_id"))
                || !(event.get("transcript_refs") instanceof Map<?, ?> refs)
                || !"chainlesschain.session-transcript-references/v1".equals(refs.get("schema"))
                || !sessionId.equals(refs.get("sessionId")) || !KEYS.containsAll(refs.keySet())
                || !SessionTranscriptPage.hash(refs.get("assistantEventId"))
                || (refs.containsKey("userEventId") && !SessionTranscriptPage.hash(refs.get("userEventId")))
                || (refs.containsKey("clientMessageId") && !clientId(refs.get("clientMessageId")))) return null;
        return new TranscriptReferences(sessionId, (String) refs.get("assistantEventId"),
                (String) refs.get("userEventId"), (String) refs.get("clientMessageId"));
    }
    public static String input(Map<String, Object> event, String sessionId) {
        if (event == null || sessionId == null || !"system".equals(event.get("type")) || !"input_accepted".equals(event.get("subtype"))
                || !sessionId.equals(event.get("session_id")) || !clientId(event.get("client_message_id"))
                || !(event.get("receipt") instanceof Map<?, ?> receipt) || !sessionId.equals(receipt.get("sessionId"))
                || !event.get("client_message_id").equals(receipt.get("clientMessageId"))
                || !SessionTranscriptPage.hash(receipt.get("eventHash")) || !SessionTranscriptPage.hash(receipt.get("inputDigest"))
                || !(receipt.get("duplicate") instanceof Boolean)) return null;
        return (String) receipt.get("eventHash");
    }
    private static boolean clientId(Object value) { return value instanceof String text && text.matches("[a-zA-Z0-9_-]{1,80}"); }
}
