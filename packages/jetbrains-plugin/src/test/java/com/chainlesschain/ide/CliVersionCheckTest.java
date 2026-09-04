package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link CliVersionCheck} layer. */
class CliVersionCheckTest {

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
        assertEquals("0.166.22", CliVersionCheck.RECOMMENDED_CLI_VERSION);
        assertEquals("0.166.22", CliVersionCheck.preferredUpgradeTarget(null));
        assertEquals("0.166.22", CliVersionCheck.preferredUpgradeTarget("0.166.21"));
        assertEquals("0.166.23", CliVersionCheck.preferredUpgradeTarget("0.166.23"));

        String notice = CliVersionCheck.updateNotice(
                "0.166.21", CliVersionCheck.RECOMMENDED_CLI_VERSION);
        assertTrue(notice != null && notice.contains("npm i -g chainlesschain@latest"));
    }
}
