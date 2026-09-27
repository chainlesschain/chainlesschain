package com.chainlesschain.ide;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashSet;
import java.util.List;
import java.util.Map;

/** Display-only v2 history contract. No message is dispatched as an Agent event. */
public record SessionTranscriptPage(String sessionId, String generation, String revision,
        long eventCount, long totalMessages, List<Row> messages, String nextCursor,
        boolean snapshotBoundary, String syncCursor) {
    public static final int MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
    public static final int MAX_TEXT_CHARS = 200_000;
    public record Row(String id, String eventId, long itemIndex, long ordinal,
                      String role, String text, boolean truncated) {}

    public SessionTranscriptPage { messages = List.copyOf(messages); }
    public SessionTranscriptPage(String sessionId, String generation, String revision, long eventCount,
            long totalMessages, List<Row> messages, String nextCursor, boolean snapshotBoundary) {
        this(sessionId, generation, revision, eventCount, totalMessages, messages, nextCursor, snapshotBoundary, null);
    }

    public static List<String> arguments(String sessionId, String cursor) {
        require(sessionId != null && sessionId.matches("[\\w.:-]{1,256}"), "Invalid history session ID");
        require(cursor == null || cursor.matches("[\\w-]{1,1024}"), "Invalid history cursor");
        List<String> args = new ArrayList<>(List.of("session", "show", "--json", "--history", "--page-size", "50"));
        if (cursor != null) args.addAll(List.of("--before", cursor));
        args.addAll(List.of("--", sessionId));
        return List.copyOf(args);
    }

    public static SessionTranscriptPage parse(String json, String sessionId, String requestedCursor) {
        arguments(sessionId, requestedCursor);
        require(json != null && json.length() <= MAX_RESPONSE_BYTES
                && json.getBytes(StandardCharsets.UTF_8).length <= MAX_RESPONSE_BYTES, "History response is too large");
        Map<String, Object> page = MiniJson.parseObject(json);
        require("chainlesschain.session-transcript-page/v2".equals(page.get("schema"))
                && sessionId.equals(page.get("sessionId")) && Boolean.FALSE.equals(page.get("contextOnly")),
                "Unsupported history response; update the cc CLI");
        SessionTranscriptPage values = values(page, sessionId, false);
        long events = values.eventCount(), total = values.totalMessages();
        String generation = values.generation(), revision = values.revision();
        List<Row> rows = values.messages();
        require(page.containsKey("nextCursor"), "Missing history cursor");
        String next = nullableString(page.get("nextCursor"));
        long first = rows.isEmpty() ? 0 : rows.getFirst().ordinal();
        require((first > 0) == (next != null), "Invalid history page boundary");
        if (next != null) {
            Map<String, Object> cursor = cursor(next, sessionId);
            require(!rows.isEmpty() && java.util.Objects.equals(generation, cursor.get("generation"))
                    && java.util.Objects.equals(revision, cursor.get("revision"))
                    && events == integer(cursor.get("eventCount")) && first == integer(cursor.get("before")), "Invalid next history cursor");
        }
        if (requestedCursor != null) {
            Map<String, Object> cursor = cursor(requestedCursor, sessionId);
            require(!rows.isEmpty() && java.util.Objects.equals(generation, cursor.get("generation"))
                    && events >= integer(cursor.get("eventCount"))
                    && rows.stream().allMatch(row -> row.ordinal() < integer(cursor.get("before"))),
                    "History changed; reload the latest page");
        }
        String sync = nullableString(page.get("syncCursor"));
        if (sync != null) {
            require(requestedCursor == null && (total == 0 || rows.getLast().ordinal() == total - 1), "Invalid latest history boundary");
            SessionTranscriptChanges.validateCursor(sync, values, total);
        }
        return new SessionTranscriptPage(sessionId, generation, revision, events, total, rows, next, values.snapshotBoundary(), sync);
    }

    static SessionTranscriptPage values(Map<String, Object> page, String sessionId, boolean incremental) {
        require(sessionId.equals(page.get("sessionId")) && Boolean.FALSE.equals(page.get("contextOnly")), "Invalid history session");
        long events = integer(page.get("eventCount")), total = integer(page.get("totalMessages"));
        String generation = nullableString(page.get("generation")), revision = nullableString(page.get("revision"));
        require(events == 0 ? generation == null && revision == null && total == 0
                : hash(generation) && hash(revision), "Invalid history revision");
        Map<?, ?> coverage = object(page.get("coverage"));
        boolean boundary = "snapshot-boundary".equals(coverage.get("kind"));
        require(boundary ? hash(coverage.get("boundaryEvent")) && coverage.get("reason") instanceof String
                && List.of("timeline-replacement", "context-snapshot", "branch-snapshot").contains(coverage.get("reason"))
                : "from-origin".equals(coverage.get("kind")) && coverage.get("boundaryEvent") == null && coverage.get("reason") == null,
                "Invalid history coverage");
        require(page.get("messages") instanceof List<?>, "Missing history messages");
        List<?> raw = (List<?>) page.get("messages");
        require(raw.size() <= 100 && raw.size() <= total && (incremental || total == 0 || !raw.isEmpty()), "Invalid history message count");
        List<Row> rows = new ArrayList<>();
        HashSet<String> ids = new HashSet<>();
        int chars = 0;
        for (Object value : raw) {
            Map<?, ?> row = object(value);
            String event = string(row.get("eventId")), id = string(row.get("id"));
            long item = integer(row.get("itemIndex")), ordinal = integer(row.get("ordinal"));
            String role = string(row.get("role")), text = string(row.get("text"));
            chars += text.length();
            require(hash(event) && id.equals(sessionId + ":" + event + ":" + item) && ids.add(id)
                    && ordinal < total && (rows.isEmpty() || ordinal == rows.getLast().ordinal() + 1)
                    && List.of("user", "assistant", "tool").contains(role)
                    && text.length() <= MAX_TEXT_CHARS && chars <= 1024 * 1024
                    && row.get("truncated") instanceof Boolean, "Invalid history message identity or bounds");
            rows.add(new Row(id, event, item, ordinal, role, text, (Boolean) row.get("truncated")));
        }
        return new SessionTranscriptPage(sessionId, generation, revision, events, total, rows, null, boundary);
    }

    public SessionTranscriptPage navigation(long before) {
        String cursor = before <= 0 ? null : Base64.getUrlEncoder().withoutPadding().encodeToString(MiniJson.stringify(Map.of(
                "v", 2, "sessionId", sessionId, "generation", generation, "revision", revision,
                "eventCount", eventCount, "before", before)).getBytes(StandardCharsets.UTF_8));
        return new SessionTranscriptPage(sessionId, generation, revision, eventCount, totalMessages, messages, cursor, snapshotBoundary, syncCursor);
    }

    private static Map<String, Object> cursor(String value, String sessionId) {
        require(value.matches("[\\w-]{1,1024}"), "Invalid history cursor");
        Map<String, Object> cursor = MiniJson.parseObject(new String(Base64.getUrlDecoder().decode(value), StandardCharsets.UTF_8));
        require(integer(cursor.get("v")) == 2 && sessionId.equals(cursor.get("sessionId"))
                && hash(cursor.get("generation")) && hash(cursor.get("revision"))
                && integer(cursor.get("eventCount")) > 0 && integer(cursor.get("before")) > 0, "Invalid history cursor binding");
        return cursor;
    }
    private static Map<?, ?> object(Object value) {
        require(value instanceof Map<?, ?>, "Invalid history object"); return (Map<?, ?>) value;
    }
    private static String nullableString(Object value) { return value == null ? null : string(value); }
    private static String string(Object value) {
        require(value instanceof String, "Invalid history text"); return (String) value;
    }
    static boolean hash(Object value) { return value instanceof String text && text.matches("[a-f0-9]{64}"); }
    static long integer(Object value) {
        require(value instanceof Number, "Invalid history integer");
        double n = ((Number) value).doubleValue();
        require(Double.isFinite(n) && n >= 0 && n <= 9_007_199_254_740_991d && n == Math.floor(n), "Invalid history integer");
        return ((Number) value).longValue();
    }
    private static void require(boolean valid, String reason) { if (!valid) throw new IllegalArgumentException(reason); }
}
