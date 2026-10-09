package com.chainlesschain.ide;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/** Opt-in metadata-only observations for isolated real-IDE UI journeys. */
public final class UiEventDiagnostics {
    public static final String PROPERTY = "chainlesschain.uiTest.eventCaptureRoot";
    public static final String FAILURE_MARKER = "[cc-ui-event-diagnostic-write-failed]";
    public enum Stage {
        RECEIVED, STALE_RECEIVE, CALLBACK_FAILED, MAPPED, MAP_FAILED, SCHEDULED, SCHEDULE_FAILED,
        EDT_ENTERED, STALE_EDT, RENDER_RETURNED, RENDER_FAILED,
        CARD_ENTERED, CARD_SKIPPED, CARD_ADDED
    }

    private UiEventDiagnostics() {}

    /** Observation errors never replace the event's own result or exception. */
    public static void record(Stage stage, Map<String, Object> event,
            Object generation, String sessionId, Throwable failure) {
        try {
            String configured = System.getProperty(PROPERTY, "");
            if (configured.isBlank()) return;
            Path root = Path.of(configured);
            if (!root.isAbsolute() || !Files.isDirectory(root, LinkOption.NOFOLLOW_LINKS)
                    || !root.normalize().equals(root) || !root.toRealPath().equals(root)) {
                throw new java.io.IOException("Unsafe capture directory");
            }
            Path output = root.resolve("host-events.jsonl");
            if (Files.isSymbolicLink(output)) throw new java.io.IOException("Unsafe capture file");
            Map<String, Object> record = new LinkedHashMap<>();
            record.put("schema", "chainlesschain.ui-event-diagnostic/v1");
            record.put("at", Instant.now().toString());
            record.put("stage", stage.name());
            record.put("generation", generation == null ? null
                    : Integer.toHexString(System.identityHashCode(generation)));
            putIdentifier(record, "session", sessionId);
            if (event != null) {
                for (String key : new String[] {"type", "kind", "id", "session_id"}) {
                    putIdentifier(record, key, event.get(key));
                }
                Object turn = event.get("turn");
                if (turn instanceof Byte || turn instanceof Short || turn instanceof Integer || turn instanceof Long)
                    record.put("turn", turn);
            }
            if (failure != null) record.put("failureClass", failure.getClass().getName());
            synchronized (UiEventDiagnostics.class) {
                Files.writeString(output, MiniJson.stringify(record) + "\n", StandardCharsets.UTF_8,
                        StandardOpenOption.CREATE, StandardOpenOption.APPEND, LinkOption.NOFOLLOW_LINKS);
            }
        } catch (Exception failureToObserve) {
            // Never include an exception message: paths and payloads can contain secrets.
            System.err.println(FAILURE_MARKER + " stage=" + stage.name()
                    + " failureClass=" + failureToObserve.getClass().getName());
        }
    }

    /** Run the actual boundary once, recording and rethrowing the identical failure. */
    public static void observeFailure(Stage stage, Map<String, Object> event,
            Object generation, String sessionId, Runnable action) {
        try {
            action.run();
        } catch (RuntimeException | Error failure) {
            record(stage, event, generation, sessionId, failure);
            throw failure;
        }
    }

    private static void putIdentifier(Map<String, Object> output, String key, Object value) {
        if (value instanceof String text && text.length() <= 128
                && text.matches("[A-Za-z0-9_.:-]{1,128}")) output.put(key, text);
    }
}
