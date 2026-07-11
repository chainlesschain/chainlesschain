package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link PolicyViewer} — the permission/policy viewer core (gap #10): payload
 * parsing (incl. malformed JSON → null), section shaping, per-source failure
 * tolerance in {@link PolicyViewer#describe} and the counts summary line.
 */
class PolicyViewerTest {

    private static final long NOW = 1_800_000_000_000L;

    private static final String PERMISSIONS_JSON = "{" +
            "\"rules\":{\"allow\":[\"Read\",\"Bash(git status)\"]," +
            "\"ask\":[\"Bash(git push:*)\"],\"deny\":[\"Bash(rm:*)\"]}," +
            "\"sources\":{\"deny:Bash(rm:*)\":\".claude/settings.json\"," +
            "\"allow:Read\":\"~/.claude/settings.json\"}," +
            "\"files\":[\".claude/settings.json\",\"~/.claude/settings.json\"]," +
            "\"managed\":{\"allowManagedPermissionRulesOnly\":true," +
            "\"disableBypassPermissionsMode\":\"disable\"," +
            "\"requireSignedPlugins\":true,\"allowedPlugins\":[]}," +
            "\"managedFile\":\"C:/managed/policy.json\"}";

    private static final String DENIALS_JSON = "{\"file\":\"x\",\"count\":2," +
            "\"denials\":[" +
            "{\"at\":" + (NOW - 3_600_000L) + ",\"tool\":\"run_shell\"," +
            "\"summary\":\"rm -rf /\",\"reason\":\"deny rule\",\"via\":\"settings-rules\"," +
            "\"rule\":\"Bash(rm:*)\",\"count\":3,\"permissionMode\":\"auto\"}," +
            "{\"at\":" + (NOW - 60_000L) + ",\"tool\":\"write_file\"," +
            "\"summary\":\"/etc/passwd\",\"via\":\"policy\",\"rule\":null}]}";

    private static final String AUTOMODE_JSON = "{" +
            "\"schema\":\"chainlesschain.auto-mode/v1\"," +
            "\"effective\":{\"classifyAllShell\":true}," +
            "\"files\":[\".claude/settings.json\"],\"managedFile\":null," +
            "\"decisions\":{" +
            "\"low\":{\"decision\":\"allow\",\"reason\":\"read-only\",\"source\":\"default\"}," +
            "\"medium\":{\"decision\":\"ask\",\"reason\":\"custom\",\"source\":\"settings\"}," +
            "\"high\":{\"decision\":\"deny\",\"reason\":\"locked\",\"source\":\"settings\"}}," +
            "\"rules\":[{\"match\":{\"tool\":\"run_shell\"," +
            "\"commandPattern\":\"git push*\"},\"decision\":\"ask\"," +
            "\"reason\":\"pushes need eyes\"}]," +
            "\"customized\":true}";

    private static final String DEFAULTS_JSON = "{" +
            "\"schema\":\"chainlesschain.auto-mode/v1\",\"mode\":\"auto\"," +
            "\"precedence\":[\"managed-settings\",\"permission-rules.deny\"," +
            "\"permission-rules.ask\",\"permission-rules.allow\"," +
            "\"shell-policy\",\"approval-gate\",\"hooks\"]}";

    // ------------------------------------------------------- permissions

    @Test
    void parsePermissionsGroupsRulesWithSourcesAndManagedFlags() {
        PolicyViewer.PermissionsSection p = PolicyViewer.parsePermissions(PERMISSIONS_JSON);
        assertNotNull(p);
        assertEquals(2, p.count("allow"));
        assertEquals(1, p.count("ask"));
        assertEquals(1, p.count("deny"));
        // deny renders first (render order deny → ask → allow)
        assertEquals("deny", p.rules.get(0).kind);
        assertEquals("Bash(rm:*)", p.rules.get(0).rule);
        assertEquals(".claude/settings.json", p.rules.get(0).source);
        // rule without a source entry keeps ""
        PolicyViewer.RuleEntry ask = p.rules.get(1);
        assertEquals("ask", ask.kind);
        assertEquals("", ask.source);
        assertEquals(2, p.files.size());
        assertEquals("C:/managed/policy.json", p.managedFile);
        assertTrue(p.managedFlags.contains("user/project permission rules disabled"));
        assertTrue(p.managedFlags.contains("bypassPermissions disabled"));
        assertTrue(p.managedFlags.contains("signed plugin manifests required"));
        assertTrue(p.managedFlags.contains("managed plugin supply-chain policy active"));
        assertFalse(p.managedFlags.contains("only managed hooks may run"));
    }

    @Test
    void parsePermissionsToleratesMalformedAndEmpty() {
        assertNull(PolicyViewer.parsePermissions("not json {{"));
        assertNull(PolicyViewer.parsePermissions(null));
        assertNull(PolicyViewer.parsePermissions(""));
        assertNull(PolicyViewer.parsePermissions("[1,2]"));
        assertNull(PolicyViewer.parsePermissions("{\"rules\":\"nope\"}"));
        PolicyViewer.PermissionsSection empty = PolicyViewer.parsePermissions(
                "{\"rules\":{\"allow\":[],\"ask\":[],\"deny\":[]},\"sources\":{}," +
                        "\"files\":[],\"managed\":null,\"managedFile\":null}");
        assertNotNull(empty);
        assertEquals(0, empty.rules.size());
        assertEquals("", empty.managedFile);
    }

    // ----------------------------------------------------------- denials

    @Test
    void parseDenialsShapesRecords() {
        List<PolicyViewer.Denial> d = PolicyViewer.parseDenials(DENIALS_JSON);
        assertNotNull(d);
        assertEquals(2, d.size());
        PolicyViewer.Denial first = d.get(0);
        assertEquals("run_shell", first.tool);
        assertEquals("rm -rf /", first.summary);
        assertEquals("settings-rules", first.via);
        assertEquals("Bash(rm:*)", first.rule);
        assertEquals(3L, first.count);
        assertEquals("auto", first.permissionMode);
        assertTrue(first.at > 0);
        // missing/null fields normalize: count defaults to 1, rule ""
        PolicyViewer.Denial second = d.get(1);
        assertEquals(1L, second.count);
        assertEquals("", second.rule);
        assertEquals("", second.permissionMode);
    }

    @Test
    void parseDenialsToleratesMalformed() {
        assertNull(PolicyViewer.parseDenials("oops"));
        assertNull(PolicyViewer.parseDenials(null));
        assertNull(PolicyViewer.parseDenials("{\"denials\":\"x\"}"));
        List<PolicyViewer.Denial> empty =
                PolicyViewer.parseDenials("{\"denials\":[]}");
        assertNotNull(empty);
        assertEquals(0, empty.size());
        // junk rows inside the array are skipped, valid ones survive
        List<PolicyViewer.Denial> mixed = PolicyViewer.parseDenials(
                "{\"denials\":[\"junk\",{\"tool\":\"t\"}]}");
        assertEquals(1, mixed.size());
    }

    // ---------------------------------------------------------- auto-mode

    @Test
    void parseAutoModeReadsMatrixFineRulesAndFlags() {
        PolicyViewer.AutoModeSection a = PolicyViewer.parseAutoMode(AUTOMODE_JSON);
        assertNotNull(a);
        assertTrue(a.customized);
        assertTrue(a.classifyAllShell);
        assertEquals(3, a.decisions.size());
        assertEquals("allow", a.decisions.get("low").decision);
        assertEquals("ask", a.decisions.get("medium").decision);
        assertEquals("settings", a.decisions.get("medium").source);
        assertEquals("deny", a.decisions.get("high").decision);
        assertEquals(1, a.rules.size());
        assertEquals("ask", a.rules.get(0).decision);
        assertTrue(a.rules.get(0).match.contains("tool=run_shell"));
        assertTrue(a.rules.get(0).match.contains("commandPattern=git push*"));
        assertEquals(List.of(".claude/settings.json"), a.files);
        assertEquals("", a.managedFile); // JSON null → ""
    }

    @Test
    void parseAutoModeToleratesMalformed() {
        assertNull(PolicyViewer.parseAutoMode("}{"));
        assertNull(PolicyViewer.parseAutoMode(null));
        assertNull(PolicyViewer.parseAutoMode("{\"decisions\":[]}"));
        // decisions present but empty object → section with no cells, no throw
        PolicyViewer.AutoModeSection a =
                PolicyViewer.parseAutoMode("{\"decisions\":{}}");
        assertNotNull(a);
        assertEquals(0, a.decisions.size());
        assertFalse(a.customized);
    }

    // --------------------------------------------------------- precedence

    @Test
    void parsePrecedenceChain() {
        List<String> p = PolicyViewer.parsePrecedence(DEFAULTS_JSON);
        assertNotNull(p);
        assertEquals(7, p.size());
        assertEquals("managed-settings", p.get(0));
        assertEquals("hooks", p.get(6));
        assertNull(PolicyViewer.parsePrecedence("bad"));
        assertNull(PolicyViewer.parsePrecedence("{}"));
        assertNull(PolicyViewer.parsePrecedence("{\"precedence\":[]}"));
    }

    // ------------------------------------------------------------ display

    @Test
    void describeRendersAllSections() {
        String text = PolicyViewer.describe(
                PolicyViewer.parsePermissions(PERMISSIONS_JSON),
                PolicyViewer.parseDenials(DENIALS_JSON),
                PolicyViewer.parseAutoMode(AUTOMODE_JSON),
                PolicyViewer.parsePrecedence(DEFAULTS_JSON), NOW);
        assertTrue(text.contains("deny (1):"));
        assertTrue(text.contains("Bash(rm:*)"));
        assertTrue(text.contains("[.claude/settings.json]"));
        assertTrue(text.contains("[managed]"));
        assertTrue(text.contains("user/project permission rules disabled"));
        // denials render most-recent first with count/mode/relative time
        int newest = text.indexOf("write_file /etc/passwd");
        int older = text.indexOf("run_shell rm -rf /");
        assertTrue(newest >= 0 && older > newest);
        assertTrue(text.contains("x3"));
        assertTrue(text.contains("mode auto"));
        assertTrue(text.contains("1m ago"));
        // auto-mode matrix + fine rule + precedence chain
        assertTrue(text.contains("autoMode.decisions (customized)"));
        assertTrue(text.contains("classifyAllShell: true"));
        assertTrue(text.contains("tool=run_shell"));
        assertTrue(text.contains("high"));
        assertTrue(text.contains("managed-settings > permission-rules.deny"));
        // fully healthy render carries no warning marker
        assertFalse(text.contains("⚠"));
    }

    @Test
    void describeDegradesFailedSourcesToWarningsOthersStillRender() {
        String text = PolicyViewer.describe(null,
                PolicyViewer.parseDenials(DENIALS_JSON), null, null, NOW);
        // failed sections → warning entries
        assertTrue(text.contains("⚠ unavailable (cc permissions list failed"));
        assertTrue(text.contains("⚠ unavailable (cc auto-mode config failed"));
        assertTrue(text.contains("⚠ unavailable (cc auto-mode defaults failed"));
        // the healthy section still renders
        assertTrue(text.contains("run_shell rm -rf /"));
    }

    @Test
    void describeHandlesEmptyEverythingWithoutThrowing() {
        PolicyViewer.PermissionsSection empty = PolicyViewer.parsePermissions(
                "{\"rules\":{\"allow\":[],\"ask\":[],\"deny\":[]}}");
        String text = PolicyViewer.describe(empty, List.of(),
                PolicyViewer.parseAutoMode("{\"decisions\":{}}"), List.of(), NOW);
        assertTrue(text.contains("(no permission rules)"));
        assertTrue(text.contains("(no recent policy denials)"));
        assertTrue(text.contains("sources: defaults only"));
    }

    @Test
    void summaryLineCounts() {
        String s = PolicyViewer.summaryLine(
                PolicyViewer.parsePermissions(PERMISSIONS_JSON),
                PolicyViewer.parseDenials(DENIALS_JSON),
                PolicyViewer.parseAutoMode(AUTOMODE_JSON));
        assertEquals("permissions: 2 allow / 1 ask / 1 deny · 2 recent denials"
                + " · auto-mode: customized (+1 fine-grained)", s);
        assertEquals("permissions: n/a · denials: n/a · auto-mode: n/a",
                PolicyViewer.summaryLine(null, null, null));
    }

    // --------------------------------------------------------------- args

    @Test
    void ccArgsMatchTheCliSurface() {
        assertEquals(List.of("permissions", "list", "--json"),
                PolicyViewer.buildPermissionsListArgs());
        assertEquals(List.of("permissions", "recent", "--json", "-n", "50"),
                PolicyViewer.buildRecentDenialsArgs(50));
        assertEquals(List.of("permissions", "recent", "--json", "-n", "1"),
                PolicyViewer.buildRecentDenialsArgs(0));
        assertEquals(List.of("auto-mode", "config", "--json"),
                PolicyViewer.buildAutoModeConfigArgs());
        assertEquals(List.of("auto-mode", "defaults"),
                PolicyViewer.buildAutoModeDefaultsArgs());
    }
}
