package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * Binary resolution coverage plus real JDK child/pipe checks for configuration
 * reloads while chat and plan turns are queued. No installed CLI or model needed.
 */
class AgentChatSessionTest {

    /** Real pipe peer: keep user turns pending until the test releases them. */
    public static final class QueuedAgent {
        public static void main(String[] args) throws Exception {
            java.io.BufferedReader input = new java.io.BufferedReader(new java.io.InputStreamReader(System.in));
            for (String line; (line = input.readLine()) != null;) {
                if (line.contains("\"type\":\"user\""))
                    System.out.println("{\"type\":\"system\",\"subtype\":\"queued\"}");
                else if (line.contains("\"type\":\"interrupt\""))
                    System.out.println("{\"type\":\"result\",\"subtype\":\"interrupted\"}");
                else if (line.contains("\"action\":\"approve\""))
                    System.out.println("{\"type\":\"plan_update\",\"note\":\"nothing to approve\"}");
                else if (line.contains("\"action\":\"revise\""))
                    System.out.println("{\"type\":\"plan_update\",\"state\":\"planning\"}");
                else System.out.println("{\"type\":\"slash_command_result\",\"ok\":true}");
                System.out.flush();
            }
        }
    }

    @Test
    void allTabsSeeNewConfigurationButQueuedTurnsFinishBeforeReload() throws Exception {
        BlockingQueue<Map<String, Object>> events = new LinkedBlockingQueue<>();
        AgentChatSession.Options options = new AgentChatSession.Options();
        options.configurationRevision = 10;
        options.baseCommandOverride = List.of(
                java.nio.file.Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                "-cp", System.getProperty("java.class.path"),
                QueuedAgent.class.getName());
        options.onEvent = events::add;
        AgentChatSession first = new AgentChatSession(options);
        AgentChatSession second = new AgentChatSession(options);
        try {
            first.start();
            second.start();
            assertFalse(first.shouldReloadConfiguration(10));
            assertTrue(first.shouldReloadConfiguration(11));
            assertTrue(second.shouldReloadConfiguration(11));
            assertTrue(first.send("one"));
            assertTrue(first.send("two"));
            assertTrue(first.hasPendingTurns());
            assertFalse(first.shouldReloadConfiguration(11));
            assertEquals("system", events.poll(10, TimeUnit.SECONDS).get("type"));
            assertEquals("system", events.poll(10, TimeUnit.SECONDS).get("type"));
            assertTrue(first.sendEvent(Map.of("type", "slash_command")));
            assertEquals("slash_command_result", events.poll(10, TimeUnit.SECONDS).get("type"));
            assertFalse(first.shouldReloadConfiguration(11), "Control replies do not complete user turns");
            assertTrue(first.interrupt());
            assertEquals("result", events.poll(10, TimeUnit.SECONDS).get("type"));
            assertFalse(first.shouldReloadConfiguration(11), "The second submitted turn is still pending");
            assertTrue(second.shouldReloadConfiguration(11), "Another idle tab can use the saved config");
            assertTrue(first.interrupt());
            assertEquals("result", events.poll(10, TimeUnit.SECONDS).get("type"));
            assertFalse(first.hasPendingTurns());
            assertTrue(first.shouldReloadConfiguration(11));
            assertTrue(first.isRunning(), "Saving config must not itself stop active processes");
            assertTrue(first.sendEvent(Map.of("type", "plan", "action", "revise")));
            assertEquals("plan_update", events.poll(10, TimeUnit.SECONDS).get("type"));
            assertFalse(first.shouldReloadConfiguration(11), "Plan continuations also use the model");
            assertTrue(first.interrupt());
            assertEquals("result", events.poll(10, TimeUnit.SECONDS).get("type"));
            assertTrue(first.shouldReloadConfiguration(11));
            assertTrue(first.sendEvent(Map.of("type", "plan", "action", "approve")));
            assertEquals("plan_update", events.poll(10, TimeUnit.SECONDS).get("type"));
            assertTrue(first.shouldReloadConfiguration(11), "A rejected/no-op plan control does not leave a pending turn");
        } finally {
            first.stop();
            second.stop();
        }
    }

    @AfterEach
    void clearOverride() {
        // The override is a process-wide static — reset so tests don't leak into
        // each other (or into resolveBinary()'s real probing elsewhere).
        AgentChatSession.setConfiguredBinary(null);
    }

    @Test
    void configuredBinaryOverrideWinsInResolveBinary() {
        AgentChatSession.setConfiguredBinary("/opt/tools/cc");
        assertEquals("/opt/tools/cc", AgentChatSession.resolveBinary());
    }

    @Test
    void setConfiguredBinaryTrimsSurroundingWhitespace() {
        AgentChatSession.setConfiguredBinary("  C:\\bin\\cc.cmd  ");
        assertEquals("C:\\bin\\cc.cmd", AgentChatSession.configuredBinary());
    }

    @Test
    void blankOrNullClearsTheOverride() {
        AgentChatSession.setConfiguredBinary("cc");
        assertEquals("cc", AgentChatSession.configuredBinary());
        AgentChatSession.setConfiguredBinary("   ");
        assertNull(AgentChatSession.configuredBinary());
        AgentChatSession.setConfiguredBinary("cc");
        AgentChatSession.setConfiguredBinary(null);
        assertNull(AgentChatSession.configuredBinary());
    }

    @Test
    void looksLikeCcVersionAcceptsBareSemver() {
        assertTrue(AgentChatSession.looksLikeCcVersion("0.162.95"));
        assertTrue(AgentChatSession.looksLikeCcVersion("0.162.95\n"));
        assertTrue(AgentChatSession.looksLikeCcVersion("v1.2.3"));
    }

    @Test
    void looksLikeCcVersionRejectsCompilerAndShellBanners() {
        assertFalse(AgentChatSession.looksLikeCcVersion("cc (GCC) 12.2.0"));
        assertFalse(AgentChatSession.looksLikeCcVersion("Apple clang version 15.0.0"));
        assertFalse(AgentChatSession.looksLikeCcVersion("Microsoft Windows [Version 10.0.19045]"));
        assertFalse(AgentChatSession.looksLikeCcVersion("not a version"));
        assertFalse(AgentChatSession.looksLikeCcVersion(""));
        assertFalse(AgentChatSession.looksLikeCcVersion(null));
    }

    @Test
    void chooseBinaryPicksAHealthyCc() {
        assertEquals("cc", AgentChatSession.chooseBinary(c -> "0.162.150"));
    }

    @Test
    void chooseBinaryFallsThroughAShadowedCcToChainlesschain() {
        assertEquals(
                "chainlesschain",
                AgentChatSession.chooseBinary(
                        c ->
                                c.equals("cc")
                                        ? "cc (GCC) 12.2.0"
                                        : c.equals("chainlesschain") ? "0.162.150" : ""));
    }

    @Test
    void chooseBinaryYieldsNullWhenNoCandidateResolves() {
        assertNull(AgentChatSession.chooseBinary(c -> ""));
        assertNull(AgentChatSession.chooseBinary(c -> null));
    }

    @Test
    void windowsCapturePreservesJsonAsOneExactArgument() {
        List<String> command = AgentChatSession.buildCaptureCommand(
                "C:\\Program Files\\cc.cmd",
                Arrays.asList(
                        "checkpoint", "action", "--submission",
                        "{\"schema\":\"cc-action/v1\",\"value\":\"a b\"}"),
                true);
        assertEquals(Arrays.asList(
                "cmd.exe", "/d", "/s", "/v:off", "/c",
                "\"\"C:\\Program Files\\cc.cmd\" \"checkpoint\" \"action\" "
                        + "\"--submission\" "
                        + "\"{\"\"schema\"\":\"\"cc-action/v1\"\","
                        + "\"\"value\"\":\"\"a b\"\"}\"\""), command);
    }

    @Test
    void windowsCaptureFailsClosedOnCmdExpansionOrLineBreaks() {
        assertTrue(AgentChatSession.buildCaptureCommand(
                "cc", Arrays.asList("--submission", "%PATH%"), true).isEmpty());
        assertTrue(AgentChatSession.buildCaptureCommand(
                "cc", Arrays.asList("line1\nline2"), true).isEmpty());
    }

    @Test
    void posixCaptureKeepsTheShellLessArgumentVector() {
        assertEquals(Arrays.asList("cc", "--submission", "{\"value\":\"a b\"}"),
                AgentChatSession.buildCaptureCommand(
                        "cc", Arrays.asList("--submission", "{\"value\":\"a b\"}"),
                        false));
    }
}
