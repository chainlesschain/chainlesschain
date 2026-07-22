package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link SlashCommands} catalog + completion. */
class SlashCommandsTest {

    @Test
    void detectSlashTokenReturnsBareLeadingPrefix() {
        assertEquals("co", SlashCommands.detectSlashToken("/co"));
        assertEquals("", SlashCommands.detectSlashToken("/"));
        assertEquals("th", SlashCommands.detectSlashToken("  /TH"));
    }

    @Test
    void detectSlashTokenReturnsNullWhenNotABareLeadingToken() {
        assertNull(SlashCommands.detectSlashToken("/cost x"));
        assertNull(SlashCommands.detectSlashToken("hi /x"));
        assertNull(SlashCommands.detectSlashToken(""));
        assertNull(SlashCommands.detectSlashToken(null));
    }

    @Test
    void filterCoMatchesCompactContextCostInMenuOrder() {
        List<String[]> co = SlashCommands.filter("co");
        assertEquals(3, co.size());
        assertEquals("/compact", co.get(0)[0]);
    }

    @Test
    void filterCompNarrowsToCompactOnly() {
        List<String[]> comp = SlashCommands.filter("comp");
        assertEquals(1, comp.size());
        assertEquals("/compact", comp.get(0)[0]);
    }

    @Test
    void filterEmptyPrefixReturnsAllAndNoMatchIsEmpty() {
        assertEquals(SlashCommands.COMMANDS.size(), SlashCommands.filter("").size());
        assertTrue(SlashCommands.filter("zzz").isEmpty());
    }

    @Test
    void filterReReturnsRejectReviewRetryRewindInMenuOrder() {
        List<String[]> re = SlashCommands.filter("re");
        assertEquals(5, re.size());
        assertEquals("/reject", re.get(0)[0]);
        assertEquals("/review", re.get(1)[0]);
        assertEquals("/retry", re.get(2)[0]);
        assertEquals("/rewind", re.get(3)[0]);
        assertEquals("/release-notes", re.get(4)[0]);
    }

    @Test
    void filterNarrowerPrefixesDisambiguate() {
        List<String[]> rev = SlashCommands.filter("rev");
        assertEquals(1, rev.size());
        assertEquals("/review", rev.get(0)[0]);

        List<String[]> ret = SlashCommands.filter("ret");
        assertEquals(1, ret.size());
        assertEquals("/retry", ret.get(0)[0]);

        List<String[]> sess = SlashCommands.filter("sess");
        assertEquals(1, sess.size());
        assertEquals("/sessions", sess.get(0)[0]);
    }

    @Test
    void labelFormatsCommandAndHelp() {
        assertEquals("/cost  —  token cost",
                SlashCommands.label(new String[] { "/cost", "token cost" }));
    }
}
