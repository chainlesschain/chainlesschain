package com.chainlesschain.ide.uitest;

import com.google.gson.*;
import com.intellij.remoterobot.RemoteRobot;
import com.intellij.remoterobot.fixtures.ComponentFixture;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** One operator-authorized task through real Swing controls, then a separate IDE restart.
 * No model override, fixture CLI, synthetic terminal, or forced-success fallback. */
final class Verify01HostJourney {
    private static final Gson JSON = new GsonBuilder().serializeNulls().setPrettyPrinting().create();
    private final ComponentFixture frame;
    private final ConversationRecoveryJourney ui;
    private final Path root;
    private final String sample;
    private final long deadline;
    private final JsonArray actions = new JsonArray();
    private String session;

    Verify01HostJourney(RemoteRobot robot, ComponentFixture frame, Path root, String sample) throws Exception {
        this.frame = frame;
        assertTrue(root.isAbsolute() && Files.isDirectory(root), "explicit existing capture directory required");
        this.root = root.toRealPath();
        assertTrue(sample.matches("(?:verify-\\d{2}|first-run-[a-z0-9-]+)"), "invalid sample ID");
        this.sample = sample;
        this.deadline = Long.parseLong(System.getProperty("ui.verify01.deadlineMs", "0"));
        long remaining = deadline - System.currentTimeMillis();
        assertTrue(remaining > 0 && remaining <= 1200000,
                "explicit task-wide epoch deadline is required, at most 20 minutes ahead");
        this.ui = new ConversationRecoveryJourney(robot, frame, this.root, deadline);
    }

    void run(String phase) throws Exception {
        try {
            if (phase.equals("initial")) initial();
            else if (phase.equals("restart")) restart();
            else throw new IllegalArgumentException("VERIFY01 phase must be initial or restart");
        } catch (Exception | AssertionError error) {
            JsonObject failure = new JsonObject();
            failure.addProperty("phase", phase); failure.addProperty("at", Instant.now().toString());
            failure.addProperty("error", error.toString());
            failure.add("completedActions", actions.deepCopy());
            writeNew("driver-failure-" + phase + ".json", failure);
            throw error;
        }
    }

    private void initial() throws Exception {
        assertFalse(Files.exists(root.resolve("ui.json")), "refusing stale capture");
        String configured = String.valueOf((Object) frame.callJs(
                "String(java.lang.System.getProperty('chainlesschain.verify01.captureRoot',''));", true));
        assertEquals(root, Path.of(configured).toRealPath(), "IDE observer must use the explicit capture directory");
        String project = String.valueOf((Object) frame.callJs("String(component.getProject().getBasePath());", true));
        assertEquals(Path.of(System.getProperty("ui.verify01.workspace")).toRealPath(), Path.of(project).toRealPath(),
                "actual IDE project differs from prepared task workspace");
        try (var files = Files.list(root)) {
            assertTrue(files.noneMatch(p -> p.getFileName().toString().startsWith("protocol-")), "raw protocol directory must be fresh");
        }
        Path promptFile = Path.of(System.getProperty("ui.verify01.promptFile", ""));
        assertTrue(promptFile.isAbsolute() && Files.size(promptFile) <= 1024 * 1024, "bounded absolute frozen prompt file required");
        String prompt = Files.readString(promptFile);
        assertFalse(prompt.isBlank(), "empty task prompt");
        JsonObject target = ui.newTab();
        session = string(target, "sessionId");
        assertFalse(session.equals("null") || session.isBlank());
        String mode = System.getProperty("ui.verify01.permissionMode", "");
        String command, label;
        switch (mode) {
            case "acceptEdits" -> { command = "/auto"; label = "auto (accept edits)"; }
            case "default" -> { command = "/normal"; label = "normal"; }
            case "bypassPermissions" -> { command = "/bypass"; label = "bypass (skip all approvals)"; }
            default -> throw new IllegalArgumentException("explicit frozen permissionMode is required");
        }
        ui.send(command);
        ui.waitFor("permission mode selected through composer", s -> string(s,"id").equals(string(target,"id"))
                && string(s,"text").contains("approval mode → " + label) && s.get("editable").getAsBoolean());
        action("submit", null);
        ui.send(prompt);
        ui.newTab(); action("background-tab", null);
        JsonArray records = waitForProtocol(false);
        JsonObject init = null;
        for (JsonElement value : records) {
            JsonObject event = value.getAsJsonObject().getAsJsonObject("event");
            if ("system".equals(string(event,"type")) && "init".equals(string(event,"subtype"))) {
                assertNull(init, "multiple task initializations"); init = event;
            }
        }
        assertNotNull(init); assertEquals(mode, string(init,"permission_mode"));
        JsonObject terminal = terminal(records);
        ui.select(string(target, "id")); action("return-tab", null);
        String result = terminalText(terminal);
        boolean knownFailure = terminal.has("is_error") && terminal.get("is_error").getAsBoolean();
        JsonObject visible;
        try {
            visible = ui.waitFor("actual final result rendered", s -> rendered(s, result) != null
                    || (knownFailure && s.get("visible").getAsBoolean() && !result.isBlank() && string(s,"text").contains(result)));
            action("final-result", result);
        } finally {
            gracefulEnd();
            records = waitForProtocol(true);
            writeNew("protocol.json", records);
            assertEquals(records, JsonParser.parseString(Files.readString(root.resolve("protocol.json"))),
                    "protocol summary differs from parsed raw JSONL records");
        }
        if (knownFailure) {
            writeNew("ui.json", actions);
            writeNew("failed-final-snapshot.json", visible);
            return; // Keep the actual error prefix; never invent successful reload recovery.
        }
        JsonObject row = rendered(visible, result);
        JsonObject state = new JsonObject();
        state.addProperty("sampleId", sample); state.addProperty("sessionId", session);
        state.addProperty("deadlineMs", deadline);
        state.addProperty("tabId", string(target, "id"));
        state.addProperty("processId", string(visible, "processId"));
        state.addProperty("profile", string(visible, "profile"));
        state.addProperty("result", result); state.addProperty("renderedText", string(row, "bodyText"));
        state.addProperty("savedRowId", string(row, "id"));
        state.add("finalSnapshot", visible);
        state.add("rawProtocolDigests", rawProtocolDigests());
        state.addProperty("readyForRestartAt", Instant.now().toString());
        writeNew("restart-state.json", state);
        writeNew("ui-initial.json", actions);
    }

    private void gracefulEnd() {
        // EOF the actual persistent child. Poll the observer for its real drained exit.
        // This runs off the EDT; it does not call stop(), fabricate exit, or replay input.
        frame.callJs("""
            function field(o,n) { var f=o.getClass().getDeclaredField(n); f.setAccessible(true); return f.get(o); }
            var loader=Packages.com.intellij.ide.plugins.PluginManagerCore.getPlugin(
                Packages.com.intellij.openapi.extensions.PluginId.getId('com.chainlesschain.ide')).getPluginClassLoader();
            var factory=java.lang.Class.forName('com.chainlesschain.ide.intellij.ChatToolWindowFactory',true,loader);
            var registry=factory.getDeclaredField('REGISTRY'); registry.setAccessible(true);
            var panel=registry.get(null).get(component.getProject());
            var view=field(panel,'views').get(field(panel,'tabIds').get(field(panel,'tabs').getSelectedIndex()));
            var child=field(field(view,'conv'),'session');
            if (child != null && child.isRunning()) child.end();
            // An independently exited child may already be detached by onExit.
            // Only its recorded drained exit, checked by the caller, proves completion.
            child != null;
            """, false);
    }

    private void restart() throws Exception {
        JsonObject state = JsonParser.parseString(Files.readString(root.resolve("restart-state.json"))).getAsJsonObject();
        assertEquals(sample, string(state, "sampleId")); session = string(state, "sessionId");
        assertEquals(deadline, state.get("deadlineMs").getAsLong(), "restart cannot reset the task deadline");
        assertEquals(state.get("rawProtocolDigests"), rawProtocolDigests(), "protocol changed or a new agent started before reload observation");
        JsonArray previous = JsonParser.parseString(Files.readString(root.resolve("ui-initial.json"))).getAsJsonArray();
        assertEquals(4, previous.size()); previous.forEach(actions::add);
        JsonObject reopened = ui.snapshot();
        assertNotEquals(string(state, "processId"), string(reopened, "processId"), "restart requires a distinct real IDE process");
        assertEquals(string(state, "profile"), string(reopened, "profile"), "restart must reuse the same profile");
        action("reload", null); // Observed new host, never recorded merely because a restart was requested.
        ui.select(string(state, "tabId"));
        String result = string(state, "result");
        JsonObject restored = ui.waitFor("saved result rendered after IDE restart", s -> rendered(s, result) != null);
        assertEquals(session, string(restored, "sessionId"));
        JsonObject restoredRow = rendered(restored, result);
        assertEquals(string(state, "savedRowId"), string(restoredRow, "id"), "saved result identity changed on reload");
        assertEquals(string(state, "renderedText"), string(restoredRow, "bodyText"), "rendered final body changed on reload");
        assertEquals(result, string(restoredRow, "bodyText"), "restored visible body differs from canonical source");
        action("restored-result", result);
        assertFalse(restored.get("childRunning").getAsBoolean(), "restoring history started an agent");
        assertEquals(state.get("rawProtocolDigests"), rawProtocolDigests(), "reload changed protocol or created a new session generation");
        writeNew("restored-snapshot.json", restored);
        writeNew("ui.json", actions);
    }

    private JsonArray waitForProtocol(boolean exit) throws Exception {
        while (System.currentTimeMillis() < deadline) {
            try (var paths = Files.list(root)) {
                assertTrue(paths.noneMatch(p -> p.getFileName().toString().startsWith("capture-error-")),
                        "raw protocol observer reported a capture failure");
            }
            try (var paths = Files.list(root)) {
                for (Path path : paths.filter(p -> p.getFileName().toString().matches("protocol-[a-f0-9-]{36}\\.jsonl")).toList()) {
                    assertTrue(Files.size(path) <= 16 * 1024 * 1024);
                    String raw = Files.readString(path);
                    int complete = raw.lastIndexOf('\n');
                    if (complete < 0) continue;
                    JsonArray records = new JsonArray();
                    for (String line : raw.substring(0, complete).split("\n")) records.add(JsonParser.parseString(line));
                    if (!owns(records)) continue;
                    JsonObject terminal = terminal(records);
                    if (terminal == null) continue;
                    if (!exit) return records;
                    JsonObject last = records.get(records.size()-1).getAsJsonObject();
                    if (!string(last,"direction").equals("exit")) continue;
                    JsonObject actualExit = last.getAsJsonObject("event");
                    assertTrue(actualExit.get("stdoutDrained").getAsBoolean(), "stdout was not drained");
                    // Preserve the actual exit, including failures, for the independent importer.
                    return records;
                }
            }
            Thread.sleep(100);
        }
        throw new AssertionError(exit ? "No actual drained process exit after EOF" : "No observed task terminal before deadline");
    }

    private boolean owns(JsonArray records) {
        for (JsonElement value : records) {
            JsonObject record = value.getAsJsonObject(), event = record.getAsJsonObject("event");
            if ("output".equals(string(record,"direction")) && "system".equals(string(event,"type"))
                    && "init".equals(string(event,"subtype")) && session.equals(string(event,"session_id"))) return true;
        }
        return false;
    }
    private static JsonObject terminal(JsonArray records) {
        JsonObject found = null;
        for (JsonElement value : records) {
            JsonObject record = value.getAsJsonObject(), event = record.getAsJsonObject("event");
            if ("output".equals(string(record,"direction")) && "result".equals(string(event,"type"))) {
                assertNull(found, "multiple task terminals"); found = event;
            }
        }
        return found;
    }
    private static String terminalText(JsonObject terminal) {
        String key = terminal.has("error") && terminal.get("error").isJsonPrimitive() ? "error" : "result";
        assertTrue(terminal.has(key) && terminal.get(key).isJsonPrimitive(), "terminal lacks real text");
        return terminal.get(key).getAsString();
    }
    private static JsonObject rendered(JsonObject snapshot, String result) {
        if (!snapshot.get("visible").getAsBoolean()) return null;
        for (JsonElement value : snapshot.getAsJsonArray("savedRows")) {
            JsonObject row = value.getAsJsonObject();
            if ("assistant".equals(string(row,"role")) && result.equals(string(row,"sourceText"))
                    && string(row,"id").startsWith(string(snapshot,"sessionId") + ":")
                    && !row.get("truncated").getAsBoolean() && !string(row,"text").isBlank()) return row;
        }
        return null;
    }
    private void action(String name, String result) throws Exception {
        assertTrue(System.currentTimeMillis() < deadline, "task-wide deadline expired");
        JsonObject value = new JsonObject(); value.addProperty("action", name);
        value.addProperty("sampleId", sample); value.addProperty("sessionId", session);
        value.addProperty("at", Instant.now().toString());
        if (result != null) value.addProperty("resultDigest", "sha256:" + HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(result.getBytes(StandardCharsets.UTF_8))));
        actions.add(value);
        // A failed journey retains exactly the actions observed up to the failure.
        writeNew("action-" + actions.size() + ".json", value);
    }
    private void writeNew(String name, JsonElement value) throws Exception {
        Files.writeString(root.resolve(name), JSON.toJson(value)+"\n", StandardOpenOption.CREATE_NEW);
    }
    private JsonObject rawProtocolDigests() throws Exception {
        JsonObject result = new JsonObject();
        try (var files = Files.list(root)) {
            for (Path file : files.sorted().toList()) {
                String name = file.getFileName().toString();
                assertFalse(name.startsWith("capture-error-"), "raw protocol observer failed");
                if (name.matches("protocol-[a-f0-9-]{36}\\.jsonl") || name.equals("protocol.json")) {
                    assertFalse(Files.isSymbolicLink(file), "protocol file is a link");
                    assertTrue(Files.size(file) <= 16 * 1024 * 1024);
                    result.addProperty(name, HexFormat.of().formatHex(
                            MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file))));
                }
            }
        }
        assertTrue(result.size() >= 2, "completed raw and imported protocol evidence required");
        return result;
    }
    private static String string(JsonObject value, String name) {
        return value.has(name) && !value.get(name).isJsonNull() ? value.get(name).getAsString() : "";
    }
}
