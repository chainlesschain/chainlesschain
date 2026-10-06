package com.chainlesschain.ide.uitest;

import com.google.gson.*;
import com.intellij.remoterobot.RemoteRobot;
import com.intellij.remoterobot.fixtures.ComponentFixture;
import java.nio.file.*;
import java.time.*;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

/** Real child processes and native Send/Stop; keeps the production 120s deadline. */
final class ColdInitializationJourney {
    private static final Gson JSON = new GsonBuilder().setPrettyPrinting().create();
    private final Path root;
    private final ConversationRecoveryJourney ui;
    private final JsonArray results = new JsonArray();
    private final long deadline;

    ColdInitializationJourney(RemoteRobot robot, ComponentFixture frame, Path root, long deadline) throws Exception {
        this.root = root.toRealPath(); this.deadline = deadline;
        ui = new ConversationRecoveryJourney(robot, frame, root, deadline);
    }

    void run() throws Exception {
        try {
            scenario("slow-init", false, false);
            scenario("timeout-late-init", true, false);
            scenario("stop-before-init", false, true);
            Files.writeString(root.resolve("cold-ui.json"), JSON.toJson(results) + "\n", StandardOpenOption.CREATE_NEW);
        } catch (Exception | AssertionError error) {
            JsonObject failure = new JsonObject(); failure.addProperty("error", error.toString());
            failure.add("completed", results);
            Files.writeString(root.resolve("cold-failure.json"), JSON.toJson(failure) + "\n", StandardOpenOption.CREATE_NEW);
            throw error;
        }
    }

    private static String text(JsonObject value, String key) { return value.get(key).getAsString(); }

    private JsonObject waitGate(JsonObject gate, String command) throws Exception {
        long until = Math.min(deadline, System.currentTimeMillis() + 60000);
        Path trace = root.resolve("fake-cli-protocol.jsonl");
        while (System.currentTimeMillis() < until) {
            if (Files.exists(trace)) for (String line : Files.readAllLines(trace)) {
                JsonObject record;
                try { record = JsonParser.parseString(line).getAsJsonObject(); }
                catch (JsonParseException partial) { continue; }
                if (record.has("command") && text(record, "command").equals(command)
                        && text(record, "sessionId").equals(text(gate, "sessionId"))
                        && text(record, "nonce").equals(text(gate, "nonce"))) return record;
            }
            Thread.sleep(25);
        }
        throw new AssertionError("Missing actual child gate: " + command);
    }

    private void scenario(String name, boolean timeout, boolean stop) throws Exception {
        System.out.println("[cold-init] started " + name);
        JsonObject tab = ui.newTab(), gate = new JsonObject(), proof = new JsonObject();
        gate.addProperty("sessionId", text(tab, "sessionId"));
        gate.addProperty("nonce", UUID.randomUUID().toString());
        // This fixture deadline exceeds the UNCHANGED production wait so the
        // child is still demonstrably alive when the submission expires.
        gate.addProperty("timeoutMs", 180000);
        Path gateFile = root.resolve("init-gate.json"), release = root.resolve("init-gate.json.release");
        Files.writeString(gateFile, JSON.toJson(gate));
        String prompt = "journey:model cold-" + name + " 中文😀";
        proof.addProperty("case", name); proof.addProperty("prompt", prompt);
        proof.addProperty("sessionId", text(gate, "sessionId"));
        try {
            proof.addProperty("submittedAt", Instant.now().toString());
            ui.send(prompt);
            JsonObject waiting = waitGate(gate, "init-gate-waiting");
            proof.add("waiting", waiting);
            JsonObject preparing = ui.snapshot(); proof.add("preparing", preparing);
            assertTrue(preparing.get("childRunning").getAsBoolean());
            assertTrue(preparing.get("sendInFlight").getAsBoolean());
            assertFalse(preparing.get("receiptReady").getAsBoolean());
            assertEquals(prompt, text(preparing, "inputText"));
            JsonObject held;
            if (timeout) {
                held = ui.waitFor("production initialization timeout", s ->
                        !s.get("sendInFlight").getAsBoolean() && s.get("editable").getAsBoolean()
                        && text(s, "text").contains("Agent initialization did not finish in time"), Duration.ofSeconds(150));
            } else if (stop) {
                ui.click("Stop");
                held = ui.waitFor("Stop during init", s -> !s.get("sendInFlight").getAsBoolean()
                        && s.get("editable").getAsBoolean() && text(s, "text").contains("Input stopped before delivery"));
            } else {
                Thread.sleep(30000);
                held = ui.snapshot();
                assertTrue(held.get("sendInFlight").getAsBoolean());
            }
            proof.add("held", held);
            assertTrue(held.get("childRunning").getAsBoolean(), "init wait is not evidence of child exit");
            assertEquals(prompt, text(held, "inputText"));
            assertEquals(text(preparing, "childProcessId"), text(held, "childProcessId"));
            assertFalse(held.get("receiptReady").getAsBoolean());
            assertFalse(text(held, "text").contains("agent session is not running"));
            Files.writeString(release, JSON.toJson(gate));
            proof.add("released", waitGate(gate, "init-gate-released"));
            JsonObject ready = ui.waitFor("real late init", s -> s.get("receiptReady").getAsBoolean());
            proof.add("ready", ready);
            if (timeout || stop) {
                Thread.sleep(2000);
                JsonObject settled = ui.snapshot(); proof.add("beforeRetry", settled);
                assertEquals(prompt, text(settled, "inputText"));
                assertFalse(settled.get("sendInFlight").getAsBoolean());
                assertFalse(text(settled, "text").contains("probe=" + prompt), "late init revived expired input");
                proof.addProperty("explicitRetryAt", Instant.now().toString());
                ui.send(prompt);
            }
            JsonObject completed = ui.waitFor("explicit input delivered once", s ->
                    !s.get("sendInFlight").getAsBoolean() && text(s, "text").contains("probe=" + prompt)
                    && text(s, "inputText").isEmpty());
            assertEquals(text(preparing, "childProcessId"), text(completed, "childProcessId"));
            assertTrue(completed.get("childRunning").getAsBoolean());
            proof.add("completed", completed); results.add(proof);
            System.out.println("[cold-init] completed " + name);
        } finally {
            Files.writeString(release, JSON.toJson(gate));
            Files.writeString(root.resolve("cold-" + name + ".json"), JSON.toJson(proof) + "\n", StandardOpenOption.CREATE_NEW);
        }
    }
}
