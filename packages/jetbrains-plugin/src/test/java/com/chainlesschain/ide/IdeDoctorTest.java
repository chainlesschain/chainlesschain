package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link IdeDoctor} (Diagnose Bridge) layer. */
class IdeDoctorTest {

    @Test
    void buildStatusArgs() {
        assertEquals("ide status", String.join(" ", IdeDoctor.buildStatusArgs()));
    }

    @Test
    void buildDoctorArgs() {
        assertEquals("ide doctor", String.join(" ", IdeDoctor.buildDoctorArgs()));
    }

    @Test
    void buildJetbrainsArgs() {
        assertEquals("ide jetbrains", String.join(" ", IdeDoctor.buildJetbrainsArgs()));
    }

    @Test
    void formatReportWhenUpShowsPortAndPassesSectionsThrough() {
        String up = IdeDoctor.formatReport(51234,
                "connect intellij:51234", "reason: workspace-match",
                "endpoint injected: yes",
                RuntimeCompatibility.evaluate(
                        "0.162.176",
                        RuntimeCompatibility.MIN_CLI_VERSION,
                        51234,
                        null),
                "0.4.69",
                "2024.3");
        assertTrue(up.contains("running on 127.0.0.1:51234"));
        assertTrue(up.contains("connect intellij:51234"));
        assertTrue(up.contains("reason: workspace-match"));
        assertTrue(up.contains("endpoint injected: yes"));
        assertTrue(up.contains("READY (可运行)"));
        assertTrue(up.contains("Plugin: 0.4.69"));
        assertTrue(up.contains("CLI: 0.162.176"));
    }

    @Test
    void formatReportWhenDownFlagsStoppedAndPlaceholdersEmptySections() {
        String down = IdeDoctor.formatReport(
                -1, "", null, "  ",
                RuntimeCompatibility.evaluate(
                        "",
                        RuntimeCompatibility.MIN_CLI_VERSION,
                        -1,
                        null),
                "0.4.69",
                "2024.3");
        assertTrue(down.contains("STOPPED"));
        assertTrue(down.contains("Restart Bridge"));
        assertTrue(down.contains("NEEDS REPAIR (需要修复)"));
        int placeholders = down.split("no output — is the cc CLI installed", -1).length - 1;
        assertEquals(3, placeholders);
    }
}
