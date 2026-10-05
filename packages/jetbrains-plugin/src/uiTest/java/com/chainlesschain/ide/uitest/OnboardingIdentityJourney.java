package com.chainlesschain.ide.uitest;

import com.google.gson.*;
import com.intellij.remoterobot.RemoteRobot;
import com.intellij.remoterobot.fixtures.ComponentFixture;
import com.intellij.remoterobot.search.locators.Locators;
import java.nio.file.*;
import java.time.*;
import javax.imageio.ImageIO;
import static org.junit.jupiter.api.Assertions.*;

/** Real Settings controls and chat panels; local command fixtures, no provider. */
final class OnboardingIdentityJourney {
    private static final Gson JSON = new GsonBuilder().setPrettyPrinting().create();
    private final RemoteRobot robot;
    private final ComponentFixture frame;
    private final Path root;
    private final ConversationRecoveryJourney ui;
    private final JsonObject config;
    private final JsonArray results = new JsonArray();

    OnboardingIdentityJourney(RemoteRobot robot, ComponentFixture frame, Path root) throws Exception {
        this.robot = robot; this.frame = frame; this.root = root.toRealPath();
        config = JsonParser.parseString(Files.readString(root.resolve("onboarding-config.json"))).getAsJsonObject();
        ui = new ConversationRecoveryJourney(robot, frame, root,
                config.get("deadlineMs").getAsLong());
    }

    void run() throws Exception {
        try {
            settings(config.get("goodCommand").getAsString(), false);
            observe("valid", "LLM not configured yet", false);

            // A previous successful probe must not authorize a different path.
            String missing = config.get("missingCommand").getAsString();
            settings(missing, true);
            observe("bad-explicit-with-managed", missing, true);
            manualFailure(missing);

            settings(config.get("goodCommand").getAsString(), false);
            observe("repaired-explicit", "LLM not configured yet", false);

            // Replace the command's bytes without changing its configured path.
            Files.writeString(root.resolve("version-mode.txt"), "gcc");
            observe("same-path-gcc", "configured CLI path", true);

            settings("", false);
            observe("gcc-on-path", "CLI (cc) not found", true);
            manualFailure("Cannot read the installed cc version");

            // Removing the private PATH shim exercises actual command absence.
            Path global = Path.of(config.get("globalCommand").getAsString());
            Files.move(global, global.resolveSibling("cc-disabled.cmd"));
            observe("missing", "CLI (cc) not found", true);

            settings("", true);
            observe("managed-fallback", "LLM not configured yet", false);

            // Repair within the SAME IDE process; no cache reset through reflection.
            Files.writeString(root.resolve("version-mode.txt"), "valid");
            Files.move(global.resolveSibling("cc-disabled.cmd"), global);
            settings("", false);
            observe("installed-on-path-without-restart", "LLM not configured yet", false);
            write("onboarding-ui.json", results);
        } catch (Exception | AssertionError error) {
            JsonObject failed = new JsonObject();
            failed.addProperty("error", error.toString());
            failed.add("completed", results);
            write("onboarding-failure.json", failed);
            ImageIO.write(robot.getScreenshot(), "png", root.resolve("onboarding-failure.png").toFile());
            throw error;
        }
    }

    private ComponentFixture find(String xpath) {
        return robot.find(ComponentFixture.class, Locators.byXpath(xpath), Duration.ofSeconds(45));
    }

    private void settings(String command, boolean managed) throws Exception {
        frame.runJs("""
            importClass(com.intellij.openapi.application.ApplicationManager);
            importClass(com.intellij.openapi.options.ShowSettingsUtil);
            importClass(java.lang.Runnable);
            var project=component.getProject();
            ApplicationManager.getApplication().invokeLater(new Runnable({run:function(){
                ShowSettingsUtil.getInstance().showSettingsDialog(project, 'ChainlessChain IDE');
            }}));
            """, true);
        find("//div[@accessiblename='ChainlessChain CLI path' and @visible='true']")
                .runJs("component.setText(" + JSON.toJson(command) + ");", true);
        find("//div[@accessiblename='ChainlessChain managed CLI fallback' and @visible='true']")
                .runJs("if(component.isSelected()!==" + managed + ") component.doClick();", true);
        find("//div[@text='OK' and @visible='true']").runJs("component.doClick();", true);
        // Read the real persisted application service only after native Apply/OK.
        String actual = String.valueOf((Object) frame.callJs("""
            var loader=Packages.com.intellij.ide.plugins.PluginManagerCore.getPlugin(
                Packages.com.intellij.openapi.extensions.PluginId.getId('com.chainlesschain.ide')).getPluginClassLoader();
            var cls=java.lang.Class.forName('com.chainlesschain.ide.intellij.CcSettings',true,loader);
            var settings=Packages.com.intellij.openapi.application.ApplicationManager.getApplication().getService(cls);
            String(settings.getCcPath())+'|'+String(settings.isManagedCliEnabled());
            """, true));
        assertEquals(command + "|" + managed, actual, "Settings action did not apply requested configuration");
    }

    private void observe(String name, String expected, boolean rejected) throws Exception {
        ui.newTab();
        JsonObject snapshot = ui.waitFor(name, value -> value.get("text").getAsString().contains(expected));
        if (rejected) assertFalse(snapshot.get("text").getAsString().contains("LLM not configured yet"),
                "Wrong CLI identity was presented as a provider configuration problem");
        assertFalse(snapshot.get("childRunning").getAsBoolean(), "Identity diagnostics must not run an agent");
        JsonObject record = new JsonObject();
        record.addProperty("case", name); record.addProperty("at", Instant.now().toString());
        record.add("snapshot", snapshot); results.add(record);
        write(name + ".json", record);
        ImageIO.write(robot.getScreenshot(), "png", root.resolve(name + ".png").toFile());
    }

    private void manualFailure(String expected) throws Exception {
        find("//div[@text='⚙ LLM' and @visible='true']").runJs("component.doClick();", true);
        find("//div[@text='Check for cc updates…' and @visible='true']").runJs("component.doClick();", true);
        ComponentFixture dialog = find("//div[@class='MyDialog' and @visible='true']");
        String text = String.valueOf((Object) dialog.callJs("""
            var result=[];
            function walk(c){
                try{var t=c.getText();if(t!=null)result.push(String(t));}catch(ignore){}
                if(c instanceof java.awt.Container){var children=c.getComponents();for(var i=0;i<children.length;i++)walk(children[i]);}
            }
            walk(component);result.join('\\n');
            """, true));
        assertTrue(text.contains(expected), "Manual update did not reject this identity: " + text);
        JsonObject evidence = new JsonObject(); evidence.addProperty("text", text);
        evidence.addProperty("at", Instant.now().toString());
        write("manual-update-" + results.size() + ".json", evidence);
        find("//div[@text='OK' and @visible='true']").runJs("component.doClick();", true);
    }

    private void write(String name, JsonElement value) throws Exception {
        Files.writeString(root.resolve(name), JSON.toJson(value) + "\n", StandardOpenOption.CREATE_NEW);
    }
}
