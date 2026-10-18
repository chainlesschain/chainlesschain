package com.chainlesschain.ide.uitest;

import com.google.gson.*;
import com.intellij.remoterobot.RemoteRobot;
import com.intellij.remoterobot.fixtures.ComponentFixture;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
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
    private String targetTabId;

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
            if (error instanceof HostStartupExit startup) {
                failure.addProperty("category", "host-startup-exit");
                failure.addProperty("rawProtocolFile", startup.file);
                failure.add("rawProtocolRecords", startup.records.deepCopy());
            }
            // Commit the actual failure before attempting optional UI diagnostics.
            writeNew("driver-failure-" + phase + ".json", failure);
            if (targetTabId != null) {
                JsonObject observed = boundedFailureSnapshot(() -> ui.snapshotForFailure(targetTabId), 5000);
                observed.addProperty("targetTabId", targetTabId);
                observed.addProperty("phase", phase);
                try { writeNew("driver-failure-" + phase + "-snapshot.json", observed); }
                catch (Exception diagnosticError) { error.addSuppressed(diagnosticError); }
            }
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
        String expectedPluginVersion = System.getProperty("ui.verify01.pluginVersion", "");
        if (!expectedPluginVersion.isBlank()) {
            String installedVersion = String.valueOf((Object) frame.callJs(
                    "String(Packages.com.intellij.ide.plugins.PluginManagerCore.getPlugin("
                            + "Packages.com.intellij.openapi.extensions.PluginId.getId('com.chainlesschain.ide')).getVersion());", true));
            assertEquals(expectedPluginVersion, installedVersion, "actual installed public plugin version differs");
            JsonObject installed = new JsonObject();
            installed.addProperty("pluginId", "com.chainlesschain.ide");
            installed.addProperty("version", installedVersion);
            writeNew("installed-plugin.json", installed);
        }
        try (var files = Files.list(root)) {
            assertTrue(files.noneMatch(p -> p.getFileName().toString().startsWith("protocol-")), "raw protocol directory must be fresh");
        }
        Path promptFile = Path.of(System.getProperty("ui.verify01.promptFile", ""));
        assertTrue(promptFile.isAbsolute() && Files.size(promptFile) <= 1024 * 1024, "bounded absolute frozen prompt file required");
        String prompt = Files.readString(promptFile);
        assertFalse(prompt.isBlank(), "empty task prompt");
        JsonObject target = ui.newTab();
        targetTabId = string(target, "id");
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
        assertEquals(result, string(row, "sourceText"), "initial canonical source differs from protocol result");
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
        targetTabId = string(state, "tabId");
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
        assertEquals(result, string(restoredRow, "sourceText"), "restored canonical source changed on reload");
        action("restored-result", result);
        assertFalse(restored.get("childRunning").getAsBoolean(), "restoring history started an agent");
        assertEquals(state.get("rawProtocolDigests"), rawProtocolDigests(), "reload changed protocol or created a new session generation");
        writeNew("restored-snapshot.json", restored);
        writeNew("ui.json", actions);
    }

    private JsonArray waitForProtocol(boolean exit) throws Exception {
        while (System.currentTimeMillis() < deadline) {
            JsonArray records = pollProtocol(root, session, exit);
            if (records != null) return records;
            Thread.sleep(100);
        }
        throw new AssertionError(exit ? "No actual drained process exit after EOF" : "No observed task terminal before deadline");
    }

    static final class HostStartupExit extends AssertionError {
        final String file;
        final JsonArray records;
        HostStartupExit(Path file, JsonArray records) {
            super("host-startup-exit: child exited before init/input; code="
                    + records.get(0).getAsJsonObject().getAsJsonObject("event").get("code")
                    + "; raw=" + file.getFileName());
            this.file = file.getFileName().toString(); this.records = records.deepCopy();
        }
    }

    /** One nonblocking read of real observer records. No synthetic init/result. */
    static JsonArray pollProtocol(Path root, String session, boolean exit) throws Exception {
        List<Path> files;
        try (var paths = Files.list(root)) {
            List<Path> all = paths.toList();
            assertTrue(all.stream().noneMatch(p -> p.getFileName().toString().startsWith("capture-error-")),
                    "raw protocol observer reported a capture failure");
            files = all.stream().filter(p -> p.getFileName().toString().matches("protocol-[a-f0-9-]{36}\\.jsonl")).toList();
        }
        assertTrue(files.size() <= 1, "ambiguous raw protocol generations");
        if (files.isEmpty()) return null;
        Path path = files.get(0);
        assertFalse(Files.isSymbolicLink(path), "protocol file is a link");
        assertTrue(Files.size(path) <= 16 * 1024 * 1024);
        String raw = Files.readString(path);
        int complete = raw.lastIndexOf('\n');
        if (complete < 0) return null;
        JsonArray records = new JsonArray();
        for (String line : raw.substring(0, complete).split("\n")) records.add(JsonParser.parseString(line));
        // The fresh capture root and exactly one generation establish ownership
        // before any session init exists. Require a sole fully drained exit;
        // partial output, input, or any init must never become a startup verdict.
        if (records.size() == 1 && complete == raw.length() - 1) {
            JsonObject record = records.get(0).getAsJsonObject();
            JsonObject event = record.getAsJsonObject("event");
            if ("exit".equals(string(record, "direction")) && event != null
                    && event.has("code") && !event.get("code").isJsonNull()
                    && event.has("stdoutDrained") && event.get("stdoutDrained").getAsBoolean())
                throw new HostStartupExit(path, records);
        }
        if (!owns(records, session)) return null;
        JsonObject terminal = terminal(records);
        if (terminal == null) return null;
        if (!exit) return records;
        JsonObject last = records.get(records.size()-1).getAsJsonObject();
        if (!string(last,"direction").equals("exit")) return null;
        assertTrue(last.getAsJsonObject("event").get("stdoutDrained").getAsBoolean(), "stdout was not drained");
        return records;
    }

    /** Failure evidence has its own short budget, never more task execution. */
    static JsonObject boundedFailureSnapshot(Callable<JsonObject> capture, long budgetMs) {
        ExecutorService worker = Executors.newSingleThreadExecutor(task -> {
            Thread thread = new Thread(task, "verify01-failure-snapshot");
            thread.setDaemon(true); return thread;
        });
        Future<JsonObject> pending = worker.submit(capture);
        JsonObject result = new JsonObject();
        result.addProperty("at", Instant.now().toString());
        result.addProperty("diagnosticOnly", true);
        try { result.add("snapshot", pending.get(budgetMs, TimeUnit.MILLISECONDS)); }
        catch (Exception error) {
            if (error instanceof InterruptedException) Thread.currentThread().interrupt();
            result.addProperty("captureError", error.toString());
        } finally { pending.cancel(true); worker.shutdownNow(); }
        return result;
    }

    private static boolean owns(JsonArray records, String session) {
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
