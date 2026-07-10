package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

final class RemoteHandoffTest {

    @Test
    void buildsTheBackgroundHandoffArgv() {
        assertEquals(Arrays.asList(
                "agent", "--bg", "--resume", "panel-1",
                "-p", "Continue.", "--output-format", "json"),
                RemoteHandoff.buildHandoffArgs("panel-1", "Continue."));
    }

    @Test
    void parsesLauncherStateOutOfNoisyStdout() {
        String out = "some log line\n{\"id\":\"bg-1\",\"sessionId\":\"panel-1\"}\n";
        Map<String, Object> state = RemoteHandoff.parseBackgroundState(out);
        assertNotNull(state);
        assertEquals("bg-1", state.get("id"));
        assertNull(RemoteHandoff.parseBackgroundState("no json here"));
        assertNull(RemoteHandoff.parseBackgroundState("{\"ok\":true}"));
    }

    @Test
    void buildsRemoteControlArgv() {
        assertEquals(Arrays.asList("remote-control", "start", "--json"),
                RemoteHandoff.buildRemoteControlStartArgs());
        assertEquals(Arrays.asList("remote-control", "status", "--json", "--prune"),
                RemoteHandoff.buildRemoteControlStatusArgs());
        assertEquals(Arrays.asList("remote-control", "stop", "--port", "18800", "--json"),
                RemoteHandoff.buildRemoteControlStopArgs(18800));
    }

    @Test
    void extractsPrettyPrintedPairingJsonFromAccumulatingBuffer() {
        String pretty = "{\n  \"mode\": \"direct\",\n  \"port\": 18800,\n"
                + "  \"pairingUri\": \"chainlesschain://remote-session/x?t={not-a-brace}\",\n"
                + "  \"pairing\": { \"token\": \"we\\\"ird{tok}en\" }\n}";
        assertNull(RemoteHandoff.extractFirstJsonObject(pretty.substring(0, 40)));
        Map<String, Object> parsed = RemoteHandoff.extractFirstJsonObject(pretty);
        assertNotNull(parsed);
        assertEquals(18800L, ((Number) parsed.get("port")).longValue());
        Map<String, Object> withTail =
                RemoteHandoff.extractFirstJsonObject(pretty + "\nserving\n{ garbage");
        assertNotNull(withTail);
        assertEquals("direct", withTail.get("mode"));
        assertNull(RemoteHandoff.extractFirstJsonObject("no braces"));
    }

    @Test
    void parsesStatusJsonAndFiltersInvalidRecords() {
        List<Map<String, Object>> rows = RemoteHandoff.parseRemoteControlStatus(
                "[{\"port\":18800,\"pid\":1,\"alive\":true,\"mode\":\"direct\"},"
                        + "{\"invalid\":true,\"stateFile\":\"x\"}]");
        assertEquals(1, rows.size());
        assertEquals(18800L, ((Number) rows.get(0).get("port")).longValue());
        assertTrue(RemoteHandoff.parseRemoteControlStatus("nope").isEmpty());
    }

    @Test
    void formatsHandoffNoteAndPairingNote() {
        Map<String, Object> state = new LinkedHashMap<String, Object>();
        state.put("id", "bg-1");
        String note = RemoteHandoff.formatHandoffNote(state);
        assertNotNull(note);
        assertTrue(note.contains("bg-1"));
        assertTrue(note.contains("cc attach bg-1"));
        assertNull(RemoteHandoff.formatHandoffNote(null));

        Map<String, Object> pairing = new LinkedHashMap<String, Object>();
        pairing.put("mode", "relay");
        pairing.put("port", 18800L);
        pairing.put("pairingUri", "chainlesschain://remote-session/abc");
        Map<String, Object> inner = new LinkedHashMap<String, Object>();
        inner.put("expiresAt", 1760000000000L);
        pairing.put("pairing", inner);
        String pn = RemoteHandoff.formatPairingNote(pairing);
        assertNotNull(pn);
        assertTrue(pn.contains("relay (E2EE)"));
        assertTrue(pn.contains("chainlesschain://remote-session/abc"));
        assertTrue(pn.contains("2025")); // epoch expiry rendered as an ISO instant
        assertNull(RemoteHandoff.formatPairingNote(new LinkedHashMap<String, Object>()));
    }

    @Test
    void formatsStatusLines() {
        Map<String, Object> h = new LinkedHashMap<String, Object>();
        h.put("port", 18800L);
        h.put("pid", 42L);
        h.put("alive", Boolean.TRUE);
        h.put("mode", "direct");
        h.put("agentSessionId", "s1");
        String line = RemoteHandoff.formatStatusLine(h);
        assertTrue(line.contains("running"));
        assertTrue(line.contains("port 18800"));
        assertTrue(line.contains("session s1"));
        assertEquals("", RemoteHandoff.formatStatusLine(null));
    }

    @Test
    void slashMenuAdvertisesHandoff() {
        boolean found = false;
        for (String[] row : SlashCommands.COMMANDS) {
            if ("/handoff".equals(row[0])) found = true;
        }
        assertTrue(found);
    }
}
