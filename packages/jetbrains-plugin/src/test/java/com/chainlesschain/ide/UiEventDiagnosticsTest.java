package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.*;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class UiEventDiagnosticsTest {
    @TempDir Path temporary;
    private final String previous = System.getProperty(UiEventDiagnostics.PROPERTY);

    @AfterEach void restoreProperty() {
        if (previous == null) System.clearProperty(UiEventDiagnostics.PROPERTY);
        else System.setProperty(UiEventDiagnostics.PROPERTY, previous);
    }

    private Path enable() throws Exception {
        Path root = temporary.toRealPath();
        System.setProperty(UiEventDiagnostics.PROPERTY, root.toString());
        return root.resolve("host-events.jsonl");
    }

    @Test void disabledByDefaultAndStillRunsTheRealAction() throws Exception {
        System.clearProperty(UiEventDiagnostics.PROPERTY);
        AtomicInteger calls = new AtomicInteger();
        UiEventDiagnostics.observeFailure(UiEventDiagnostics.Stage.RENDER_FAILED,
                Map.of("text", "secret prompt"), new Object(), "session-1", calls::incrementAndGet);
        UiEventDiagnostics.record(UiEventDiagnostics.Stage.RECEIVED, Map.of(), null, null, null);
        assertEquals(1, calls.get());
        try (var files = Files.list(temporary)) { assertEquals(0, files.count()); }
    }

    @Test void recordsOnlyBoundedIdentifierMetadata() throws Exception {
        Path output = enable();
        UiEventDiagnostics.record(UiEventDiagnostics.Stage.RECEIVED,
                Map.of("type", "approval_request", "id", "approval-4", "turn", 4,
                        "command", "secret command", "text", "secret prompt",
                        "session_id", "invalid session text", "permissions", Map.of("secret", "scope")),
                new Object(), "session-1", null);
        String text = Files.readString(output);
        assertFalse(text.contains("secret"));
        assertFalse(text.contains("invalid session"));
        Map<?, ?> record = (Map<?, ?>) MiniJson.parse(text);
        assertEquals("RECEIVED", record.get("stage"));
        assertEquals("approval-4", record.get("id"));
        assertEquals("session-1", record.get("session"));
        assertFalse(record.containsKey("command"));
        assertFalse(record.containsKey("permissions"));
    }

    @Test void recordsActualFailurePhaseAndRethrowsIdenticalExceptionOnce() throws Exception {
        Path output = enable();
        IllegalStateException actual = new IllegalStateException("secret exception message");
        AtomicInteger calls = new AtomicInteger();
        assertSame(actual, assertThrows(IllegalStateException.class, () ->
                UiEventDiagnostics.observeFailure(UiEventDiagnostics.Stage.RENDER_FAILED,
                        Map.of("kind", "approval", "id", "approval-4"), new Object(), "session-1",
                        () -> { calls.incrementAndGet(); throw actual; })));
        assertEquals(1, calls.get());
        String text = Files.readString(output);
        assertTrue(text.contains("RENDER_FAILED"));
        assertTrue(text.contains("java.lang.IllegalStateException"));
        assertFalse(text.contains("secret exception message"));
        assertFalse(text.contains("RENDER_RETURNED"));
    }

    @Test void diagnosticWriteFailureIsReportedWithoutReplacingTheActualFailure() throws Exception {
        Path output = enable();
        Files.createDirectory(output);
        PrintStream previousError = System.err;
        ByteArrayOutputStream diagnostic = new ByteArrayOutputStream();
        AssertionError actual = new AssertionError("secret cause");
        try (PrintStream capture = new PrintStream(diagnostic, true, StandardCharsets.UTF_8)) {
            System.setErr(capture);
            assertSame(actual, assertThrows(AssertionError.class, () ->
                    UiEventDiagnostics.observeFailure(UiEventDiagnostics.Stage.MAP_FAILED,
                            Map.of(), null, null, () -> { throw actual; })));
        } finally {
            System.setErr(previousError);
        }
        String text = diagnostic.toString(StandardCharsets.UTF_8);
        assertTrue(text.contains(UiEventDiagnostics.FAILURE_MARKER));
        assertTrue(text.contains("MAP_FAILED"));
        assertFalse(text.contains("secret cause"));
        assertFalse(text.contains(temporary.toString()));
    }
}
