package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link CliVersionCheck} layer. */
class CliVersionCheckTest {

    @Test void installedIdentityRejectsCompilerAndErrorBanners() {
        for (String raw : new String[] {"cc (GCC) 12.2.0", "Apple clang version 17.0.0", "error\n0.166.88", "", "command not found"}) {
            assertNull(CliVersionCheck.installedVersion(raw));
            assertNull(CliVersionCheck.updateNotice(raw, "99.0.0"));
        }
        assertEquals("0.166.88", CliVersionCheck.installedVersion("\n v0.166.88\n"));
    }

    @Test
    void parseVersionExtractsSemverFromOutput() {
        assertEquals("0.162.80", CliVersionCheck.parseVersion("chainlesschain 0.162.80\n"));
    }

    @Test
    void parseVersionNullWhenNoSemver() {
        assertNull(CliVersionCheck.parseVersion("no version here"));
    }

    @Test
    void compareOrdersVersions() {
        assertTrue(CliVersionCheck.compare("0.162.80", "0.162.93") < 0);
        assertTrue(CliVersionCheck.compare("0.162.93", "0.162.93") == 0);
        assertTrue(CliVersionCheck.compare("0.163.0", "0.162.99") > 0);
    }

    @Test
    void parseNpmLatestPullsVersion() {
        assertEquals("0.162.93",
                CliVersionCheck.parseNpmLatest("{\"name\":\"chainlesschain\",\"version\":\"0.162.93\"}"));
        assertNull(CliVersionCheck.parseNpmLatest("{}"));
    }

    @Test
    void updateNoticeWhenTrailingLatest() {
        String notice = CliVersionCheck.updateNotice("0.162.80", "0.162.93");
        assertTrue(notice != null && notice.contains("0.162.93"));
    }

    @Test
    void updateNoticeNullWhenUpToDateOrAheadOrUnknown() {
        assertNull(CliVersionCheck.updateNotice("0.162.93", "0.162.93"));
        assertNull(CliVersionCheck.updateNotice("0.163.0", "0.162.93"));
        assertNull(CliVersionCheck.updateNotice(null, "0.162.93"));
        assertNull(CliVersionCheck.updateNotice("0.162.80", null));
    }

    @Test
    void recommendedReleaseIsTheOfflineUpgradeFloor() {
        // Release metadata verification independently binds this recommendation
        // to gradle.properties. Exercise the upgrade floor across releases.
        String recommended = CliVersionCheck.RECOMMENDED_CLI_VERSION;
        assertEquals(recommended, CliVersionCheck.preferredUpgradeTarget(null));
        assertEquals(recommended, CliVersionCheck.preferredUpgradeTarget("0.166.27"));
        assertEquals(recommended, CliVersionCheck.preferredUpgradeTarget("0.166.34"));
        assertEquals(recommended, CliVersionCheck.preferredUpgradeTarget("unavailable"));
        assertEquals(recommended, CliVersionCheck.preferredUpgradeTarget("0.166.133"));
        assertEquals(recommended, CliVersionCheck.preferredUpgradeTarget(recommended));
        assertEquals("99.0.0", CliVersionCheck.preferredUpgradeTarget("99.0.0"));

        String notice = CliVersionCheck.updateNotice(
                "0.166.27", CliVersionCheck.RECOMMENDED_CLI_VERSION);
        assertTrue(notice != null && notice.contains("npm i -g chainlesschain@latest"));
    }
}
