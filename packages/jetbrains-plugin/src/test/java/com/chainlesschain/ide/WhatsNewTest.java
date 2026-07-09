package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link WhatsNew} (cc changelog) layer. */
class WhatsNewTest {

    @Test
    void buildChangelogArgsPassesLimit() {
        assertEquals("changelog -n 5 --json", String.join(" ", WhatsNew.buildChangelogArgs(5)));
    }

    @Test
    void buildChangelogArgsDefaultsNonPositiveLimit() {
        assertEquals("changelog -n 5 --json", String.join(" ", WhatsNew.buildChangelogArgs(0)));
    }

    @Test
    void supportsChangelogGatesOnMinVersion() {
        assertTrue(WhatsNew.supportsChangelog("0.162.151"));
        assertTrue(WhatsNew.supportsChangelog("cc 0.163.0\n"));
        assertFalse(WhatsNew.supportsChangelog("0.162.150"));
        // A found semver >= min passes; a gcc shadow then degrades via empty parse.
        assertTrue(WhatsNew.supportsChangelog("cc (GCC) 12.2.0"));
        assertFalse(WhatsNew.supportsChangelog(null));
        assertFalse(WhatsNew.supportsChangelog("not a version"));
    }

    private static final String JSON =
            "{\"releases\":[{\"cliVersion\":\"0.162.152\",\"productVersion\":\"v5.0.3.134\","
                    + "\"date\":\"2026-07-07\",\"title\":\"audit batch\","
                    + "\"sections\":[{\"heading\":\"CLI\",\"body\":\"> fixed things\"}]},"
                    + "{\"cliVersion\":\"0.162.151\"},"
                    + "{\"noCliVersion\":true}]}";

    @Test
    void parseChangelogJsonKeepsValidReleases() {
        List<WhatsNew.Release> rels = WhatsNew.parseChangelogJson(JSON);
        assertEquals(2, rels.size());
        assertEquals("0.162.152", rels.get(0).cliVersion);
        assertEquals("v5.0.3.134", rels.get(0).productVersion);
        assertEquals(1, rels.get(0).sections.size());
        assertEquals("CLI", rels.get(0).sections.get(0)[0]);
        assertTrue(rels.get(1).sections.isEmpty());
    }

    @Test
    void parseChangelogJsonToleratesBadInput() {
        assertTrue(WhatsNew.parseChangelogJson("not json").isEmpty());
        assertTrue(WhatsNew.parseChangelogJson("{\"releases\":\"x\"}").isEmpty());
        assertTrue(WhatsNew.parseChangelogJson(null).isEmpty());
    }

    @Test
    void changelogToTextRendersReleasesAndInstalledMarker() {
        List<WhatsNew.Release> rels = WhatsNew.parseChangelogJson(JSON);
        String text = WhatsNew.changelogToText(rels, "0.162.151");
        assertTrue(text.startsWith("# cc CLI — What's New"));
        assertTrue(text.contains("## 0.162.152 (product v5.0.3.134, 2026-07-07)"));
        assertTrue(text.contains("## 0.162.151 ← installed"));
        assertTrue(text.contains("### CLI"));
        assertTrue(text.contains("fixed things"));
        assertFalse(text.contains("> fixed things"));
    }

    @Test
    void changelogToTextHeaderOnlyWhenNoReleases() {
        assertFalse(WhatsNew.changelogToText(null, null).isEmpty());
    }
}
