package com.chainlesschain.ide.uitest;

import com.google.gson.*;
import java.nio.file.*;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

/** Offline tests of the operator driver, never a provider/GUI task substitute. */
final class Verify01HostJourneyTest {
    @TempDir Path root;
    private static final String GENERATION = "6468eeff-1212-4430-a8c9-a186f7e2303f";
    private Path raw() { return root.resolve("protocol-" + GENERATION + ".jsonl"); }
    private static JsonObject record(String direction, String event) {
        JsonObject row = new JsonObject();
        row.addProperty("direction", direction);
        row.add("event", JsonParser.parseString(event));
        return row;
    }
    private void write(JsonObject... rows) throws Exception {
        StringBuilder text = new StringBuilder();
        for (JsonObject row : rows) text.append(row).append('\n');
        Files.writeString(raw(), text);
    }
    private static JsonObject exit(boolean drained) {
        return record("exit", "{\"code\":1,\"signal\":null,\"stdoutDrained\":" + drained + "}");
    }
    private static JsonObject init(String session) {
        return record("output", "{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"" + session + "\"}");
    }

    @Test void soleRealExitFailsImmediatelyAndRetainsExactOriginalBytes() throws Exception {
        // Exact record shape from the failed public Windows first-run capture.
        String raw = "{\"schema\":\"chainlesschain.ide-protocol-record/v1\",\"generation\":\"" + GENERATION
                + "\",\"sequence\":1,\"at\":\"2026-10-17T18:34:40.177653700Z\",\"direction\":\"exit\","
                + "\"event\":{\"code\":1,\"signal\":null,\"stdoutDrained\":true}}\n";
        Files.writeString(raw(), raw);
        Verify01HostJourney.HostStartupExit error = assertTimeout(Duration.ofSeconds(1), () ->
                assertThrows(Verify01HostJourney.HostStartupExit.class,
                        () -> Verify01HostJourney.pollProtocol(root, "uninitialized-session", false)));
        assertTrue(error.getMessage().startsWith("host-startup-exit:"));
        assertEquals(raw().getFileName().toString(), error.file);
        assertEquals(1, error.records.size());
        assertEquals("exit", error.records.get(0).getAsJsonObject().get("direction").getAsString());
        assertEquals(raw, Files.readString(raw()));
        assertFalse(Files.exists(root.resolve("protocol.json")));
        assertFalse(Files.exists(root.resolve("restart-state.json")));
    }

    @Test void exitZeroWithoutInitStillCannotCountAsTaskCompletion() throws Exception {
        write(record("exit", "{\"code\":0,\"stdoutDrained\":true}"));
        assertThrows(Verify01HostJourney.HostStartupExit.class,
                () -> Verify01HostJourney.pollProtocol(root, "s", false));
    }

    @Test void incompleteOrUndrainedExitIsNotPrematurelyAttributed() throws Exception {
        Files.writeString(raw(), exit(true).toString());
        assertNull(Verify01HostJourney.pollProtocol(root, "s", false));
        write(exit(false));
        assertNull(Verify01HostJourney.pollProtocol(root, "s", false));
        Files.writeString(raw(), exit(true) + "\n{\"partial\":");
        assertNull(Verify01HostJourney.pollProtocol(root, "s", false));
    }

    @Test void initOrInputExcludesPreInitVerdictAndForeignInitIsNotOwned() throws Exception {
        write(init("s"), exit(true));
        assertNull(Verify01HostJourney.pollProtocol(root, "s", false));
        write(init("another-session"), exit(true));
        assertNull(Verify01HostJourney.pollProtocol(root, "s", false));
        write(record("input", "{\"type\":\"user\"}"), exit(true));
        assertNull(Verify01HostJourney.pollProtocol(root, "s", false));
    }

    @Test void multipleGenerationsAndObserverErrorsFailClosed() throws Exception {
        write(exit(true));
        Path other = root.resolve("protocol-0721ae75-6ae2-4602-9846-cea0302ab457.jsonl");
        Files.writeString(other, init("s") + "\n");
        AssertionError ambiguous = assertThrows(AssertionError.class,
                () -> Verify01HostJourney.pollProtocol(root, "s", false));
        assertTrue(ambiguous.getMessage().contains("ambiguous raw protocol"));
        Files.delete(other);
        Files.writeString(root.resolve("capture-error-observer.json"), "{}");
        AssertionError observer = assertThrows(AssertionError.class,
                () -> Verify01HostJourney.pollProtocol(root, "s", false));
        assertTrue(observer.getMessage().contains("capture failure"));
    }

    @Test void existingTerminalAndDrainedExitRequirementsRemainIntact() throws Exception {
        JsonObject terminal = record("output", "{\"type\":\"result\",\"subtype\":\"error\",\"is_error\":true,\"error\":\"real failure\"}");
        write(init("s"), terminal);
        assertEquals(2, Verify01HostJourney.pollProtocol(root, "s", false).size());
        assertNull(Verify01HostJourney.pollProtocol(root, "s", true));
        write(init("s"), terminal, exit(true));
        assertEquals(3, Verify01HostJourney.pollProtocol(root, "s", true).size());
        write(init("s"), terminal, exit(false));
        assertThrows(AssertionError.class, () -> Verify01HostJourney.pollProtocol(root, "s", true));
        write(init("s"), terminal, terminal);
        assertThrows(AssertionError.class, () -> Verify01HostJourney.pollProtocol(root, "s", false));
    }

    @Test void diagnosticsKeepObservedTextAndReadinessWithoutInventingOutput() {
        JsonObject actual = JsonParser.parseString("{\"id\":\"original-tab\",\"text\":\"agent exited (1)\","
                + "\"receiptReady\":false,\"childRunning\":false,\"sendInFlight\":false,\"draftStatus\":\"Draft saved\"}").getAsJsonObject();
        JsonObject result = Verify01HostJourney.boundedFailureSnapshot(() -> actual, 1000);
        assertEquals(actual, result.get("snapshot"));
        assertTrue(result.get("diagnosticOnly").getAsBoolean());
        assertFalse(result.has("captureError"));
    }

    @Test void diagnosticFailureOrTimeoutCannotBecomeTaskSuccess() {
        JsonObject failed = Verify01HostJourney.boundedFailureSnapshot(() -> {
            throw new IllegalStateException("real UI unavailable");
        }, 1000);
        assertFalse(failed.has("snapshot"));
        assertTrue(failed.get("captureError").getAsString().contains("real UI unavailable"));
        JsonObject timeout = assertTimeout(Duration.ofSeconds(2), () ->
                Verify01HostJourney.boundedFailureSnapshot(() -> { Thread.sleep(60000); return new JsonObject(); }, 25));
        assertFalse(timeout.has("snapshot"));
        assertTrue(timeout.get("captureError").getAsString().contains("TimeoutException"));
    }
}
