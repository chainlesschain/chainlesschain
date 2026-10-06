package com.chainlesschain.ide.uitest;

import com.google.gson.Gson;
import com.google.gson.JsonParser;
import com.intellij.remoterobot.RemoteRobot;
import com.intellij.remoterobot.fixtures.ComponentFixture;
import com.intellij.remoterobot.search.locators.Locators;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

/** Runs a test-only renderer probe inside the installed, visible IntelliJ host. */
final class NativeTranscriptJourney {
    static void run(RemoteRobot robot, ComponentFixture frame, Path root) throws Exception {
        robot.find(ComponentFixture.class, Locators.byXpath("//div[@text='+ New chat' and @visible='true']"),
                Duration.ofSeconds(60)).runJs("component.doClick();", true);
        String token = UUID.randomUUID().toString();
        Path output = root.resolve("native-transcript-metrics.json");
        assertFalse(Files.exists(output), "Native receipt must be fresh");
        Gson json = new Gson();
        String location = NativeTranscriptProbe.class.getProtectionDomain().getCodeSource().getLocation().toExternalForm();
        String locate = """
            var pluginLoader = Packages.com.intellij.ide.plugins.PluginManagerCore.getPlugin(
                Packages.com.intellij.openapi.extensions.PluginId.getId('com.chainlesschain.ide')).getPluginClassLoader();
            var urls = java.lang.reflect.Array.newInstance(java.net.URL, 1);
            urls[0] = new java.net.URL(%s);
            var loader = new java.net.URLClassLoader(urls, java.lang.ClassLoader.getPlatformClassLoader());
            var probe = java.lang.Class.forName('com.chainlesschain.ide.uitest.NativeTranscriptProbe', true, loader);
            var viewTypes = java.lang.reflect.Array.newInstance(java.lang.Class, 2);
            viewTypes[0] = java.lang.Object; viewTypes[1] = java.lang.ClassLoader;
            var viewArgs = java.lang.reflect.Array.newInstance(java.lang.Object, 2);
            viewArgs[0] = component; viewArgs[1] = pluginLoader;
            var view = probe.getMethod('activeView', viewTypes).invoke(null, viewArgs);
            """.formatted(json.toJson(location));
        long readyDeadline = System.nanoTime() + Duration.ofSeconds(60).toNanos();
        String previous = null;
        boolean ready = false;
        while (System.nanoTime() < readyDeadline) {
            // callJs is generic: passing it directly to String.valueOf selects
            // the char[] overload and inserts a failing runtime cast for strings.
            Object observation = frame.callJs(locate + """
                var readyTypes = java.lang.reflect.Array.newInstance(java.lang.Class, 1);
                readyTypes[0] = java.lang.Object;
                var readyArgs = java.lang.reflect.Array.newInstance(java.lang.Object, 1);
                readyArgs[0] = view;
                var result = String(probe.getMethod('readiness', readyTypes).invoke(null, readyArgs));
                loader.close(); result;
                """, false); // CLI identity subprocess runs off EDT; the probe marshals UI reads onto EDT.
            String observed = String.valueOf(observation);
            var state = JsonParser.parseString(observed).getAsJsonObject();
            if (state.get("ready").getAsBoolean() && observed.equals(previous)) { ready = true; break; }
            previous = observed;
            Thread.sleep(100); // Bounded readiness polling; elapsed time never counts as readiness.
        }
        assertTrue(ready, "Native transcript initialization has not settled: " + previous);
        String script = locate + """
            var types = java.lang.reflect.Array.newInstance(java.lang.Class, 5);
            types[0] = java.lang.Object; types[1] = java.lang.String; types[2] = java.lang.String;
            types[3] = java.lang.String; types[4] = java.lang.String;
            var arguments = java.lang.reflect.Array.newInstance(java.lang.Object, 5);
            arguments[0] = view; arguments[1] = %s; arguments[2] = %s;
            var info = Packages.com.intellij.openapi.application.ApplicationInfo.getInstance();
            arguments[3] = String(info.getFullVersion()); arguments[4] = String(info.getBuild().asString());
            probe.getMethod('start', types).invoke(null, arguments);
            """.formatted(json.toJson(output.toString()), json.toJson(token));
        frame.runJs(script, false); // Probe rechecks current CLI identity before starting its EDT timer.
        long deadline = System.nanoTime() + Duration.ofMinutes(5).toNanos();
        while (!Files.exists(output) && System.nanoTime() < deadline) Thread.sleep(200);
        assertTrue(Files.exists(output), "Native EDT probe did not produce a receipt");
        var evidence = JsonParser.parseString(Files.readString(output)).getAsJsonObject();
        assertEquals(token, evidence.get("runToken").getAsString());
        assertEquals("measured", evidence.get("status").getAsString(), evidence.toString());
        assertEquals(3, evidence.getAsJsonArray("cases").size());
        System.out.println("[ui-smoke] native Swing transcript measurements collected; SLO not evaluated");
    }
}
