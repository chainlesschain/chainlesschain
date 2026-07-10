package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link RemoteDoctor} analyzer. */
class RemoteDoctorTest {

    private static RemoteDoctor.Check byId(RemoteDoctor.Result r, String id) {
        for (RemoteDoctor.Check c : r.checks) if (c.id.equals(id)) return c;
        return null;
    }

    @Test
    void comparesVersionsIgnoringPrerelease() {
        assertTrue(RemoteDoctor.compareVersions("0.162.156", "0.162.155") > 0);
        assertTrue(RemoteDoctor.compareVersions("0.162.155", "0.162.156") < 0);
        assertEquals(0, RemoteDoctor.compareVersions("v1.0.0", "1.0.0"));
        assertEquals(0, RemoteDoctor.compareVersions("0.162.156-alpha.1", "0.162.156"));
    }

    @Test
    void cleanLocalSessionIsAllOk() {
        RemoteDoctor.Signals s = new RemoteDoctor.Signals();
        s.cliFound = true;
        s.cliVersion = "0.162.156";
        s.minCliVersion = "0.162.150";
        s.bridgePort = 51234;
        s.portProbe = "listening";
        RemoteDoctor.Result r = RemoteDoctor.analyze(s);
        assertEquals("ok", r.level);
        assertNotNull(byId(r, "cli-ok"));
        assertNotNull(byId(r, "bridge-ok"));
        assertNull(byId(r, "wsl-networking"));
    }

    @Test
    void flagsWslMirroredNetworking() {
        RemoteDoctor.Signals s = new RemoteDoctor.Signals();
        s.isWsl = true;
        RemoteDoctor.Check c = byId(RemoteDoctor.analyze(s), "wsl-networking");
        assertNotNull(c);
        assertEquals("warn", c.level);
        assertTrue(c.fix.contains("networkingMode=mirrored"));
    }

    @Test
    void errorsOnMissingCliWithRemoteHint() {
        RemoteDoctor.Signals s = new RemoteDoctor.Signals();
        s.isWsl = true;
        s.cliFound = false;
        RemoteDoctor.Result r = RemoteDoctor.analyze(s);
        assertEquals("error", r.level);
        RemoteDoctor.Check c = byId(r, "cli-missing");
        assertEquals("npm install -g chainlesschain", c.fix);
        assertTrue(c.detail.contains("host the IDE runs on"));
    }

    @Test
    void warnsOnOutdatedCli() {
        RemoteDoctor.Signals s = new RemoteDoctor.Signals();
        s.cliFound = true;
        s.cliVersion = "0.162.100";
        s.minCliVersion = "0.162.150";
        assertEquals("warn", byId(RemoteDoctor.analyze(s), "cli-outdated").level);
    }

    @Test
    void bridgeStoppedErrorsAndFirewallOnlyWhenRemote() {
        RemoteDoctor.Signals stopped = new RemoteDoctor.Signals();
        stopped.bridgePort = 0;
        stopped.portProbe = "stopped";
        assertEquals("error", byId(RemoteDoctor.analyze(stopped), "bridge-stopped").level);

        RemoteDoctor.Signals remote = new RemoteDoctor.Signals();
        remote.isWsl = true;
        remote.bridgePort = 51234;
        remote.portProbe = "unknown";
        assertNotNull(byId(RemoteDoctor.analyze(remote), "firewall"));

        RemoteDoctor.Signals local = new RemoteDoctor.Signals();
        local.bridgePort = 51234;
        local.portProbe = "listening";
        assertNull(byId(RemoteDoctor.analyze(local), "firewall"));
    }

    @Test
    void summaryRendersLevelAndFixes() {
        RemoteDoctor.Signals s = new RemoteDoctor.Signals();
        s.isWsl = true;
        s.cliFound = false;
        String summary = RemoteDoctor.analyze(s).summary;
        assertTrue(summary.contains("Remote / WSL Doctor"));
        assertTrue(summary.contains("✗"));
        assertTrue(summary.contains("fix:"));
    }
}
