package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
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
        assertEquals("/rewind", re.get(1)[0]);
        assertEquals("/retry", re.get(2)[0]);
        assertEquals("/review", re.get(3)[0]);
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

    @Test
    void sessionCommandsUseVsCodeDescriptionsAndLiveSessionRoutes() {
        List<String> actual = new java.util.ArrayList<>();
        for (SlashCommands.Definition definition : SlashCommands.DEFINITIONS) {
            if (definition.route == SlashCommands.Route.SESSION) {
                actual.add(definition.name + "|" + definition.target
                        + "|" + definition.description);
            }
        }
        assertEquals(Arrays.asList(
                "/status|status|show CLI, model, session, IDE and MCP status",
                "/doctor|doctor|diagnose this live session",
                "/mcp|mcp|show MCP servers connected to this session",
                "/hooks|hooks|show hooks loaded in this session",
                "/permissions|permissions|show effective session permissions",
                "/agents|agents|show configured agent definitions",
                "/tasks|tasks|show background shell tasks in this session",
                "/memory|memory|show project memory loaded in this session"),
                actual);
        assertNotNull(SlashCommands.find("/status"));
    }

    @Test
    void resumeAliasAndHelpComeFromTheSameManifest() {
        assertEquals("/sessions", SlashCommands.find("/resume").name);
        assertEquals("expand or collapse all reasoning blocks",
                SlashCommands.find("/expand").description);
        String help = SlashCommands.formatHelp();
        assertTrue(help.contains(
                "/sessions, /resume - resume a saved session"));
        for (SlashCommands.Definition definition : SlashCommands.DEFINITIONS) {
            assertTrue(help.contains(
                    definition.name + " - " + definition.description)
                    || help.contains(definition.name + ", "),
                    definition.name);
        }
    }

    @Test
    void sessionEventPreservesArgumentsAndCorrelationId() {
        Map<String, Object> event = SlashCommands.sessionEvent(
                SlashCommands.find("/status"), "  --verbose  ", "slash-test");
        assertEquals("slash_command", event.get("type"));
        assertEquals("slash-test", event.get("request_id"));
        assertEquals("status", event.get("command"));
        assertEquals("--verbose", event.get("args"));
        assertNull(SlashCommands.sessionEvent(
                SlashCommands.find("/init"), "", "not-session"));
    }

    @Test
    void cliArgumentTokenizerPreservesWindowsPathsAndQuotedValues() {
        assertEquals(Arrays.asList(
                        "--template", "code-project", "C:\\work tree\\repo"),
                SlashCommands.splitArguments(
                        "--template code-project \"C:\\work tree\\repo\""));
        IllegalArgumentException error = org.junit.jupiter.api.Assertions.assertThrows(
                IllegalArgumentException.class,
                () -> SlashCommands.splitArguments("\"unterminated"));
        assertEquals("unterminated quoted argument", error.getMessage());
    }

    @Test
    void cliValidationMatchesVsCodeReadOnlyPluginPolicy() {
        assertNull(SlashCommands.validateCliArguments(
                "init", Arrays.asList("--template", "code-project", "--force")));
        assertNull(SlashCommands.validateCliArguments(
                "plugin", Arrays.asList("info", "sample", "--json")));
        assertTrue(SlashCommands.validateCliArguments(
                "plugin", Arrays.asList("install", "sample"))
                .contains("changes local plugin state"));
        assertTrue(SlashCommands.validateCliArguments(
                "init", Arrays.asList("--template", "unknown"))
                .contains("unknown /init template"));
    }
}
