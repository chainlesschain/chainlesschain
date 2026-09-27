package com.chainlesschain.ide.uitest;

import com.google.gson.*;
import com.intellij.remoterobot.RemoteRobot;
import com.intellij.remoterobot.fixtures.ComponentFixture;
import com.intellij.remoterobot.search.locators.Locators;
import java.nio.file.*;
import java.time.*;
import java.util.function.Predicate;
import static org.junit.jupiter.api.Assertions.*;

/** Native controls for mutations; reflection is read-only evidence of rendered row identities. */
final class ConversationRecoveryJourney {
    private static final Duration BUDGET = Duration.ofSeconds(60);
    private static final Gson JSON = new GsonBuilder().setPrettyPrinting().create();
    private final RemoteRobot robot;
    private final ComponentFixture frame;
    private final Path root;

    ConversationRecoveryJourney(RemoteRobot robot, ComponentFixture frame, Path root) {
        this.robot = robot; this.frame = frame; this.root = root;
    }

    private static final String SNAPSHOT = """
        var loader = Packages.com.intellij.ide.plugins.PluginManagerCore.getPlugin(
            Packages.com.intellij.openapi.extensions.PluginId.getId('com.chainlesschain.ide')).getPluginClassLoader();
        function field(object, name) {
            var f = object.getClass().getDeclaredField(name); f.setAccessible(true); return f.get(object);
        }
        var factory = java.lang.Class.forName('com.chainlesschain.ide.intellij.ChatToolWindowFactory', true, loader);
        var registryField = factory.getDeclaredField('REGISTRY'); registryField.setAccessible(true);
        var panel = registryField.get(null).get(component.getProject());
        if (panel == null) throw 'Chat panel not open';
        var tabs = field(panel, 'tabs'), ids = field(panel, 'tabIds'), views = field(panel, 'views');
        var index = tabs.getSelectedIndex(), view = views.get(ids.get(index)), conv = field(view, 'conv');
        var transcript = field(view, 'transcript'), pane = field(transcript, 'pane');
        var spans = field(field(transcript, 'savedHistory'), 'spans'), rows = [], tabList = [];
        for (var i = 0; i < spans.size(); i++) {
            var span = spans.get(i), saved = field(span, 'saved');
            if (saved != null) {
                var start = Number(field(span, 'start')), end = Number(field(span, 'end'));
                rows.push({id:String(saved.id()), text:String(pane.getDocument().getText(start, end-start)), start:start});
            }
        }
        rows.sort(function(a,b){return a.start-b.start;});
        for (var i = 0; i < ids.size(); i++) {
            var c = field(views.get(ids.get(i)), 'conv');
            tabList.push({id:String(field(c,'draftKey')), index:i, selected:i===index});
        }
        JSON.stringify({
            observedAt:String(java.time.Instant.now()), processId:String(java.lang.ProcessHandle.current().pid()),
            profile:String(Packages.com.intellij.openapi.application.PathManager.getConfigPath()),
            id:String(field(conv,'draftKey')), sessionId:String(field(conv,'sessionId')), tabs:tabList,
            inputText:String(field(view,'input').getText()), editable:field(view,'input').isEditable(),
            draftStatus:String(field(field(view,'drafts'),'status').getText()),
            text:String(pane.getText()), visible:pane.isShowing(), savedRows:rows
        });
        """;

    private JsonObject snapshot() {
        return JsonParser.parseString(String.valueOf(frame.callJs(SNAPSHOT, true))).getAsJsonObject();
    }
    private static String text(JsonObject value, String key) { return value.get(key).getAsString(); }
    private JsonObject waitFor(String label, Predicate<JsonObject> condition) throws Exception {
        long deadline = System.nanoTime() + BUDGET.toNanos();
        JsonObject last = null;
        while (System.nanoTime() < deadline) {
            last = snapshot();
            if (condition.test(last)) return last;
            Thread.sleep(150);
        }
        throw new AssertionError(label + " did not settle: " + last);
    }
    private ComponentFixture component(String xpath) {
        return robot.find(ComponentFixture.class, Locators.byXpath(xpath), BUDGET);
    }
    private void click(String name) {
        component("//div[@text='" + name + "' and @visible='true']").runJs("component.doClick();", true);
    }
    private void edit(String value) {
        component("//div[@accessiblename='Message the agent' and @visible='true']")
                .runJs("component.setText(" + JSON.toJson(value) + ");", true);
    }
    private void send(String value) throws Exception {
        waitFor("editable composer", s -> s.get("editable").getAsBoolean());
        edit(value); click("Send");
    }
    private JsonObject newTab() throws Exception {
        JsonObject before = snapshot(); click("+ New chat");
        return waitFor("new conversation", s -> !text(s,"id").equals(text(before,"id"))
                && s.getAsJsonArray("tabs").size() == before.getAsJsonArray("tabs").size()+1
                && s.get("editable").getAsBoolean());
    }
    private void select(String key) throws Exception {
        JsonObject state = snapshot(); int index = -1;
        for (JsonElement entry : state.getAsJsonArray("tabs")) {
            JsonObject tab = entry.getAsJsonObject();
            if (text(tab,"id").equals(key)) index = tab.get("index").getAsInt();
        }
        assertTrue(index >= 0, "persisted conversation missing: " + key);
        component("//div[@class='JBTabbedPane' and @visible='true']")
                .runJs("component.setSelectedIndex(" + index + ");", true);
        waitFor("selected conversation", s -> text(s,"id").equals(key) && s.get("visible").getAsBoolean());
    }
    private JsonObject saveDraft(String letter) throws Exception {
        String draft = "unsent draft " + letter + " 中文😀";
        waitFor("send completion", s -> s.get("editable").getAsBoolean() && text(s,"inputText").isEmpty());
        edit(draft);
        return waitFor("saved draft", s -> text(s,"inputText").equals(draft) && text(s,"draftStatus").contains("Draft saved"));
    }
    private JsonObject history(String letter, int turns) throws Exception {
        JsonObject s = waitFor("saved history " + letter, value -> value.getAsJsonArray("savedRows").size() == turns*2);
        assertHistory(s, letter, turns); return s;
    }
    private static void assertHistory(JsonObject s, String letter, int turns) {
        assertTrue(s.get("visible").getAsBoolean());
        JsonArray rows = s.getAsJsonArray("savedRows");
        assertEquals(turns*2, rows.size());
        java.util.Set<String> ids = new java.util.HashSet<>();
        for (int i = 0; i < rows.size(); i++) {
            JsonObject row = rows.get(i).getAsJsonObject();
            assertTrue(ids.add(text(row,"id")));
            assertTrue(text(row,"text").contains(i%2 == 0 ? "journey:history-"+letter : "canonical answer "+letter));
        }
        assertFalse(text(s,"text").contains("canonical answer " + (letter.equals("A") ? "B" : "A")));
    }
    private JsonObject completed(String sessionId) throws Exception {
        Path trace = root.resolve("fake-cli-protocol.jsonl");
        if (!Files.exists(trace)) return null;
        for (String line : Files.readAllLines(trace)) {
            JsonObject record;
            try { record = JsonParser.parseString(line).getAsJsonObject(); }
            catch (JsonParseException partial) { continue; }
            if (record.has("direction") && text(record,"direction").equals("canonical")
                    && record.has("sessionId") && text(record,"sessionId").equals(sessionId)) return record;
        }
        return null;
    }
    void run(String phase) throws Exception {
        Path baselinePath = root.resolve("conversation-recovery-initial.json");
        JsonObject evidence = new JsonObject();
        evidence.addProperty("schema", "cc-jetbrains-conversation-recovery/v1");
        evidence.addProperty("phase", phase);
        evidence.addProperty("model", "deterministic fixture");
        evidence.addProperty("persistence", "production canonical store and actual CLI command");
        if (phase.equals("initial")) {
            JsonObject a = newTab(); send("journey:history-A");
            a = waitFor("A started", s -> text(s,"text").contains("checking history fixture"));
            JsonObject b = newTab();
            String backgroundAt = text(b,"observedAt");
            JsonArray backgroundObservations = new JsonArray();
            backgroundObservations.add(b.deepCopy());
            send("journey:history-B"); history("B",1);
            b = saveDraft("B");
            JsonObject completion = null;
            long deadline = System.nanoTime()+BUDGET.toNanos();
            while (System.nanoTime() < deadline) {
                JsonObject observed = snapshot();
                assertEquals(text(b,"id"), text(observed,"id"), "B must remain active until A commits");
                backgroundObservations.add(observed);
                completion = completed(text(a,"sessionId"));
                if (completion != null) break;
                Thread.sleep(150);
            }
            assertNotNull(completion, "background A never committed");
            String foregroundReturnAt = Instant.now().toString();
            assertFalse(Instant.parse(text(completion,"at")).isBefore(Instant.parse(backgroundAt)), "A finished before B was selected");
            select(text(a,"id")); history("A",1);
            send("journey:history-A"); history("A",2); a = saveDraft("A");
            assertTrue(text(a,"text").contains("checking history fixture"), "intermediate tool output lost");
            select(text(b,"id"));
            assertEquals(text(b,"inputText"), text(snapshot(),"inputText"));
            select(text(a,"id"));
            assertEquals(text(a,"inputText"), text(snapshot(),"inputText"));
            evidence.addProperty("backgroundAt", backgroundAt);
            evidence.addProperty("foregroundReturnAt", foregroundReturnAt);
            evidence.addProperty("backgroundCompletedAt", text(completion,"at"));
            evidence.add("backgroundObservations", backgroundObservations);
            evidence.add("a", a); evidence.add("b", b);
        } else {
            JsonObject baseline = JsonParser.parseString(Files.readString(baselinePath)).getAsJsonObject();
            for (String key : new String[]{"a","b"}) {
                JsonObject prior = baseline.getAsJsonObject(key);
                select(text(prior,"id"));
                String letter = key.toUpperCase(java.util.Locale.ROOT); int turns = key.equals("a") ? 2 : 1;
                history(letter,turns);
                JsonObject restored = waitFor("restored unsent draft", s -> text(s,"inputText").equals(text(prior,"inputText")));
                assertHistory(restored,letter,turns);
                for (int i=0; i<turns*2; i++) assertEquals(
                        text(prior.getAsJsonArray("savedRows").get(i).getAsJsonObject(),"id"),
                        text(restored.getAsJsonArray("savedRows").get(i).getAsJsonObject(),"id"));
                assertNotEquals(text(prior,"processId"),text(restored,"processId"));
                assertEquals(text(prior,"profile"),text(restored,"profile"));
                evidence.add(key,restored);
            }
        }
        Files.writeString(root.resolve("conversation-recovery-"+phase+".json"), JSON.toJson(evidence)+"\n", StandardOpenOption.CREATE_NEW);
        System.out.println("[ui-smoke] canonical conversation recovery " + phase + " passed");
    }
}
