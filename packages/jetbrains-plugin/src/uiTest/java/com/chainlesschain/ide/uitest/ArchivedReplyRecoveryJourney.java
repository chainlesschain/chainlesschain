package com.chainlesschain.ide.uitest;

import com.google.gson.*;
import com.intellij.remoterobot.RemoteRobot;
import com.intellij.remoterobot.fixtures.ComponentFixture;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import static org.junit.jupiter.api.Assertions.*;

/** Deterministic archived reply restoration only; never a new VERIFY01 task. */
final class ArchivedReplyRecoveryJourney {
    private static final Gson JSON = new GsonBuilder().setPrettyPrinting().create();
    private final ComponentFixture frame;
    private final ConversationRecoveryJourney ui;
    private final Path root;
    ArchivedReplyRecoveryJourney(RemoteRobot robot, ComponentFixture frame, Path root) {
        this.frame = frame; this.root = root;
        this.ui = new ConversationRecoveryJourney(robot, frame, root);
    }
    private static String text(JsonObject value, String key) { return value.get(key).getAsString(); }
    private static String digest(String value) throws Exception {
        return "sha256:" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    }
    private JsonObject row(JsonObject snapshot, String source, String rendered) {
        if (!snapshot.get("visible").getAsBoolean() || snapshot.get("childRunning").getAsBoolean()
                || snapshot.get("turnActive").getAsBoolean()) return null;
        JsonObject found = null;
        for (JsonElement value : snapshot.getAsJsonArray("savedRows")) {
            JsonObject row = value.getAsJsonObject();
            if (!"assistant".equals(text(row,"role"))) continue;
            if (found != null || !source.equals(text(row,"sourceText")) || !rendered.equals(text(row,"bodyText"))
                    || row.get("truncated").getAsBoolean() || !text(row,"id").startsWith(text(snapshot,"sessionId") + ":")) return null;
            found = row;
        }
        return found;
    }
    void run(String phase) throws Exception {
        try {
            assertTrue(phase.equals("initial") || phase.equals("restart"));
            JsonObject fixture = JsonParser.parseString(Files.readString(root.resolve("fixture.json"))).getAsJsonObject();
            assertEquals("chainlesschain.archived-reply-fixture/v1", text(fixture,"schema"));
            assertEquals("verify-33", text(fixture,"sampleId"));
            String source = text(fixture,"source"), rendered = text(fixture,"rendered");
            assertEquals(text(fixture,"sourceDigest"), digest(source));
            assertEquals(text(fixture,"renderedDigest"), digest(rendered));
            assertNotEquals(source, rendered, "raw Markdown must not pass as rendered text");
            String plugin = String.valueOf((Object) frame.callJs("String(Packages.com.intellij.ide.plugins.PluginManagerCore.getPlugin(Packages.com.intellij.openapi.extensions.PluginId.getId('com.chainlesschain.ide')).getVersion());", true));
            String ide = String.valueOf((Object) frame.callJs("String(Packages.com.intellij.openapi.application.ApplicationInfo.getInstance().getFullVersion());", true));
            String os = String.valueOf((Object) frame.callJs("String(java.lang.System.getProperty('os.name'));", true));
            assertEquals("0.4.167", plugin); assertEquals("2025.2", ide); assertEquals("Linux", os);
            JsonObject installation = ui.verifyInstalledArchive();
            JsonObject baseline = null;
            if (phase.equals("initial")) {
                assertFalse(Files.exists(root.resolve("recovery-initial.json")));
                ui.newTab(); ui.send(text(fixture,"prompt"));
            } else {
                baseline = JsonParser.parseString(Files.readString(root.resolve("recovery-initial.json"))).getAsJsonObject();
                JsonObject original = baseline.getAsJsonObject("snapshot");
                JsonObject opened = ui.snapshot();
                assertNotEquals(text(original,"processId"), text(opened,"processId"));
                assertEquals(text(original,"profile"), text(opened,"profile"));
                ui.select(text(original,"id"));
            }
            JsonObject snapshot = ui.waitFor("exact archived rendered body and stopped fixture child", s -> row(s, source, rendered) != null);
            JsonObject saved = row(snapshot, source, rendered);
            if (baseline != null) {
                JsonObject prior = baseline.getAsJsonObject("snapshot");
                assertEquals(text(prior,"sessionId"), text(snapshot,"sessionId"));
                assertEquals(text(row(prior, source, rendered),"id"), text(saved,"id"));
                assertEquals(baseline.get("installation"), installation);
            }
            JsonObject proof = new JsonObject();
            proof.addProperty("schema", "chainlesschain.archived-reply-recovery/v1");
            proof.addProperty("sampleId", "verify-33"); proof.addProperty("phase", phase);
            proof.addProperty("at", Instant.now().toString()); proof.addProperty("platform", "linux");
            proof.addProperty("pluginVersion", plugin); proof.addProperty("ideVersion", ide);
            proof.addProperty("sourceDigest", digest(source)); proof.addProperty("renderedDigest", digest(rendered));
            proof.add("installation", installation); proof.add("snapshot", snapshot);
            Files.writeString(root.resolve("recovery-" + phase + ".json"), JSON.toJson(proof)+"\n", StandardOpenOption.CREATE_NEW);
        } catch (Exception | AssertionError error) {
            JsonObject failure = new JsonObject(); failure.addProperty("phase", phase); failure.addProperty("error", error.toString());
            try { failure.add("snapshot", ui.snapshot()); } catch (Exception | AssertionError ignored) { }
            Files.writeString(root.resolve("recovery-failure-" + phase + ".json"), JSON.toJson(failure)+"\n", StandardOpenOption.CREATE_NEW);
            throw error;
        }
    }
}
