package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

final class PluginManagerTest {

    @Test
    void targetsUnifiedRuntimeCommands() {
        assertEquals(Arrays.asList("plugin", "installed", "--json"),
                PluginManager.buildPluginInstalledArgs());
        // The row's install scope rides along — CLI trust/untrust default to
        // scope project, so without it Trust errors on user-scope installs and
        // Untrust silently no-ops (VS Code twin buildPluginTrustArgs parity).
        assertEquals(Arrays.asList("plugin", "trust", "p1", "--scope", "user"),
                PluginManager.buildPluginTrustArgs("p1", true, "user"));
        assertEquals(Arrays.asList("plugin", "untrust", "p1", "--scope", "project"),
                PluginManager.buildPluginTrustArgs("p1", false, "project"));
        assertEquals(Arrays.asList("plugin", "trust", "p1"),
                PluginManager.buildPluginTrustArgs("p1", true, null));
        assertEquals(Arrays.asList("plugin", "untrust", "p1"),
                PluginManager.buildPluginTrustArgs("p1", false, ""));
        assertEquals(Arrays.asList("plugin", "uninstall", "p1", "--scope", "project"),
                PluginManager.buildPluginUninstallArgs("p1", "project"));
        assertEquals(Arrays.asList("plugin", "uninstall", "p1", "--scope", "user"),
                PluginManager.buildPluginUninstallArgs("p1", null));
        assertEquals(Arrays.asList("plugin", "add", "./dir", "--json"),
                PluginManager.buildPluginAddArgs("./dir", ""));
        assertEquals(Arrays.asList("plugin", "add", "pkg",
                        "--registry", "https://r.example", "--json"),
                PluginManager.buildPluginAddArgs("pkg", "https://r.example"));
        assertEquals(Arrays.asList("mcp", "servers", "--json"),
                PluginManager.buildMcpServersArgs());
        assertEquals(Arrays.asList("mcp", "remove", "srv"),
                PluginManager.buildMcpRemoveArgs("srv"));
        assertEquals(Arrays.asList("mcp", "connect", "srv", "--json"),
                PluginManager.buildMcpConnectArgs("srv"));
        assertEquals(Arrays.asList("skill", "list", "--json"),
                PluginManager.buildSkillListArgs());
    }

    @Test
    void distinguishesUnreadableFromEmpty() {
        assertNull(PluginManager.parsePluginInstalled("not json"));
        assertTrue(PluginManager.parsePluginInstalled("[]").isEmpty());
        assertNull(PluginManager.parseMcpServers("nope"));
        assertNull(PluginManager.parseSkillList("{}"));
    }

    @Test
    void parsesPluginRowsAndFormatsLines() {
        List<Map<String, Object>> rows = PluginManager.parsePluginInstalled(
                "[{\"name\":\"a\",\"version\":\"1.0.0\",\"scope\":\"user\",\"ok\":true},"
                        + "{\"name\":\"b\",\"scope\":\"project\",\"ok\":false},"
                        + "{\"noName\":true}]");
        assertEquals(2, rows.size());
        assertEquals("✔ a v1.0.0  [user]", PluginManager.formatPluginLine(rows.get(0)));
        assertEquals("✖ b  [project]", PluginManager.formatPluginLine(rows.get(1)));
    }

    @Test
    void parsesMcpServersWithPolicyAnnotations() {
        List<Map<String, Object>> rows = PluginManager.parseMcpServers(
                "[{\"name\":\"good\",\"url\":\"https://x\",\"_transport\":\"https\","
                        + "\"autoConnect\":1,\"_allowed\":true},"
                        + "{\"name\":\"blocked\",\"command\":\"node srv.js\","
                        + "\"_allowed\":false,\"_reason\":\"http not allowed\"}]");
        assertEquals(2, rows.size());
        String good = PluginManager.formatMcpLine(rows.get(0));
        assertTrue(good.contains("good"));
        assertTrue(good.contains("[auto]"));
        assertTrue(good.contains("(https)"));
        assertTrue(good.contains("https://x"));
        assertFalse(good.contains("blocked"));
        String blocked = PluginManager.formatMcpLine(rows.get(1));
        assertTrue(blocked.contains("[blocked: http not allowed]"));
        assertTrue(blocked.contains("node srv.js"));
    }

    @Test
    void parsesAndFiltersSkills() {
        List<Map<String, Object>> rows = PluginManager.parseSkillList(
                "[{\"id\":\"s1\",\"name\":\"Skill One\",\"category\":\"ai\","
                        + "\"source\":\"bundled\",\"description\":\"does AI things\"},"
                        + "{\"name\":\"only-name\"},{\"neither\":true}]");
        assertEquals(2, rows.size());
        assertEquals("Skill One — ai [bundled]",
                PluginManager.formatSkillLine(rows.get(0)));
        assertEquals("only-name", PluginManager.formatSkillLine(rows.get(1)));

        // Filter matches id/name/category/description, case-insensitive.
        assertEquals(1, PluginManager.filterSkills(rows, "AI things").size());
        assertEquals(1, PluginManager.filterSkills(rows, "ONLY-NAME").size());
        assertEquals(2, PluginManager.filterSkills(rows, "").size());
        assertEquals(0, PluginManager.filterSkills(rows, "zzz").size());
        assertTrue(PluginManager.filterSkills(null, "x").isEmpty());
    }
}
