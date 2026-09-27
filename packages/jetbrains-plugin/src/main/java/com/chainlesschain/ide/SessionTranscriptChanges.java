package com.chainlesschain.ide;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/** Contiguous verified display-history updates; cursors grant no execution rights. */
public record SessionTranscriptChanges(SessionTranscriptPage page, long from, String nextCursor, boolean hasMore) {
    public record Cursor(String sessionId, String generation, String revision, long eventCount, long offset) {}
    public static Cursor cursor(String value, String sessionId) {
        require(value != null && value.matches("[\\w-]{1,1024}"), "Invalid history sync cursor");
        Map<String, Object> map = MiniJson.parseObject(new String(Base64.getUrlDecoder().decode(value), StandardCharsets.UTF_8));
        require(SessionTranscriptPage.integer(map.get("v")) == 1 && "history-sync".equals(map.get("view"))
                && sessionId.equals(map.get("sessionId")) && SessionTranscriptPage.hash(map.get("generation"))
                && SessionTranscriptPage.hash(map.get("revision")), "Invalid history sync binding");
        long count = SessionTranscriptPage.integer(map.get("eventCount")), offset = SessionTranscriptPage.integer(map.get("offset"));
        require(count > 0, "Invalid history sync event count");
        return new Cursor(sessionId, (String) map.get("generation"), (String) map.get("revision"), count, offset);
    }
    public static void validateCursor(String value, SessionTranscriptPage page, long offset) {
        Cursor cursor = cursor(value, page.sessionId());
        require(Objects.equals(cursor.generation(), page.generation()) && Objects.equals(cursor.revision(), page.revision())
                && cursor.eventCount() == page.eventCount() && cursor.offset() == offset, "Inconsistent history sync cursor");
    }
    public static List<String> arguments(String sessionId, String cursor) {
        SessionTranscriptPage.arguments(sessionId, null);
        cursor(cursor, sessionId);
        return List.of("session", "show", "--json", "--history", "--after", cursor, "--page-size", "50", "--", sessionId);
    }
    public static SessionTranscriptChanges parse(String json, String sessionId, String suppliedCursor) {
        arguments(sessionId, suppliedCursor);
        require(json != null && json.length() <= SessionTranscriptPage.MAX_RESPONSE_BYTES
                && json.getBytes(StandardCharsets.UTF_8).length <= SessionTranscriptPage.MAX_RESPONSE_BYTES, "History update is too large");
        Map<String, Object> map = MiniJson.parseObject(json);
        require("chainlesschain.session-transcript-changes/v1".equals(map.get("schema")), "Unsupported history update");
        SessionTranscriptPage page = SessionTranscriptPage.values(map, sessionId, true);
        Cursor anchor = cursor(suppliedCursor, sessionId);
        long from = SessionTranscriptPage.integer(map.get("from")), end = from + page.messages().size();
        require(from == anchor.offset() && Objects.equals(anchor.generation(), page.generation())
                && page.eventCount() >= anchor.eventCount() && page.totalMessages() >= end
                && (page.eventCount() != anchor.eventCount() || Objects.equals(anchor.revision(), page.revision()))
                && (page.messages().isEmpty() ? from == page.totalMessages() : page.messages().getFirst().ordinal() == from)
                && map.get("hasMore") instanceof Boolean && map.get("nextCursor") instanceof String, "Invalid history update boundary");
        String next = (String) map.get("nextCursor");
        validateCursor(next, page, end);
        boolean more = (Boolean) map.get("hasMore");
        require(more == (end < page.totalMessages()), "Inconsistent history update continuation");
        return new SessionTranscriptChanges(page, from, next, more);
    }
    private static void require(boolean condition, String error) { if (!condition) throw new IllegalArgumentException(error); }
}
