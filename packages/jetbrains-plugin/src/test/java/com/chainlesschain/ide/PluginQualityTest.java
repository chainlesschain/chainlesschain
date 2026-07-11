package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link PluginQuality} — the plugin/LSP quality board core (gap #11), the
 * Java twin of the VS extension's plugin-quality.js. Mirrors the VS test
 * invariants: argv builders against the real CLI surface, tolerant parsers,
 * quality-flag derivation (broken / lsp ok·unavailable·unknown·none / unused —
 * incl. the doc-mandated "an lsp-only plugin is NOT unused" rule and
 * unknown-status honesty when the live probe can't vouch for the plugin's own
 * server), and the deliberate ABSENCE of a fabricated {@code slow} flag.
 */
class PluginQualityTest {

    // ------------------------------------------------------------- helpers

    private static Map<String, Object> plugin(String name) {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("name", name);
        p.put("version", "1.0.0");
        p.put("scope", "user");
        p.put("dir", "/plugins/" + name);
        p.put("ok", Boolean.TRUE);
        return p;
    }

    private static PluginQuality.Validation validation(String json) {
        PluginQuality.Validation v = PluginQuality.parsePluginValidate(json);
        assertTrue(v != null && !v.failed, "fixture must parse");
        return v;
    }

    private static PluginQuality.Validation emptyValidation() {
        return validation("{\"ok\":true,\"componentCounts\":{}}");
    }

    // ------------------------------------------------------------ builders

    @Test
    void buildsValidateAndStatusArgs() {
        assertEquals(Arrays.asList("plugin", "validate", "C:\\plugins\\p1", "--json"),
                PluginQuality.buildPluginValidateArgs("C:\\plugins\\p1"));
        assertEquals(Arrays.asList("code-intel", "status", "--json"),
                PluginQuality.buildCodeIntelStatusArgs());
    }

    // -------------------------------------------------- parsePluginValidate

    @Test
    void parseValidateReturnsNullForUnreadableOutput() {
        assertNull(PluginQuality.parsePluginValidate(""));
        assertNull(PluginQuality.parsePluginValidate(null));
        assertNull(PluginQuality.parsePluginValidate("not json"));
        assertNull(PluginQuality.parsePluginValidate("[1,2]"));
    }

    @Test
    void parseValidateNormalizesCountsErrorsAndLsp() {
        PluginQuality.Validation v = PluginQuality.parsePluginValidate(
                "{\"ok\":false,\"errors\":[\"manifest.version is required\"],"
                        + "\"warnings\":[\"skill x path not found\"],"
                        + "\"componentCounts\":{\"skills\":2,\"lsp\":1,\"mcp\":\"nope\"},"
                        + "\"components\":{\"lsp\":[{\"languageId\":\"mylang\","
                        + "\"command\":\"mylang-ls\",\"id\":\"mylang-ls\"},"
                        + "{\"notAServer\":true}]}}");
        assertFalse(v.ok);
        assertEquals(List.of("manifest.version is required"), v.errors);
        assertEquals(2, v.counts.get("skills"));
        assertEquals(1, v.counts.get("lsp"));
        assertEquals(0, v.counts.get("mcp")); // non-numeric coerced to 0
        assertEquals(0, v.counts.get("settings"));
        assertEquals(PluginQuality.COMPONENT_TYPES.size(), v.counts.size());
        assertEquals(1, v.lsp.size());
        assertEquals("mylang", v.lsp.get(0).languageId);
        assertEquals("mylang-ls", v.lsp.get(0).id);
    }

    @Test
    void parseValidateFallsBackToCommandAsLspId() {
        PluginQuality.Validation v = PluginQuality.parsePluginValidate(
                "{\"ok\":true,\"componentCounts\":{\"lsp\":1},"
                        + "\"components\":{\"lsp\":[{\"languageId\":\"go\","
                        + "\"command\":\"gopls\"}]}}");
        assertEquals(1, v.lsp.size());
        assertEquals("go", v.lsp.get(0).languageId);
        assertEquals("gopls", v.lsp.get(0).id); // registry default
    }

    // ------------------------------------------------ parseCodeIntelStatus

    @Test
    void parseStatusReturnsNullWhenProbeUnreadable() {
        assertNull(PluginQuality.parseCodeIntelStatus(""));
        assertNull(PluginQuality.parseCodeIntelStatus("{}")); // no servers array
        assertNull(PluginQuality.parseCodeIntelStatus("garbage"));
    }

    @Test
    void parseStatusUsesStrictBooleanAvailability() {
        List<PluginQuality.StatusServer> rows = PluginQuality.parseCodeIntelStatus(
                "{\"servers\":[{\"languageId\":\"typescript\",\"id\":\"tsserver\","
                        + "\"available\":true},"
                        + "{\"languageId\":\"go\",\"id\":\"gopls\",\"available\":\"yes\"},"
                        + "{\"noLanguage\":true}],\"extensions\":[\".ts\"]}");
        assertEquals(2, rows.size());
        assertTrue(rows.get(0).available);
        assertFalse(rows.get(1).available); // "yes" is not true
    }

    // ------------------------------------------------ deriveLspAvailability

    private static final List<PluginQuality.LspEntry> DECLARED =
            List.of(new PluginQuality.LspEntry("mylang", "mylang-ls"));

    @Test
    void lspNoneWhenPluginDeclaresNoLsp() {
        assertEquals("none", PluginQuality.deriveLspAvailability(List.of(), List.of()));
        assertEquals("none", PluginQuality.deriveLspAvailability(null, null));
    }

    @Test
    void lspUnknownWhenNoLiveStatusData() {
        assertEquals("unknown", PluginQuality.deriveLspAvailability(DECLARED, null));
    }

    @Test
    void lspUnknownWhenStatusRowIsADifferentServer() {
        // Untrusted plugin → its server never registered; the builtin row for
        // the same languageId proves nothing about the plugin's own binary.
        assertEquals("unknown", PluginQuality.deriveLspAvailability(DECLARED,
                List.of(new PluginQuality.StatusServer("mylang", "someone-else", true))));
    }

    @Test
    void lspUnknownWhenLanguageIdAbsentFromProbe() {
        assertEquals("unknown", PluginQuality.deriveLspAvailability(DECLARED,
                List.of(new PluginQuality.StatusServer("go", "gopls", true))));
    }

    @Test
    void lspUnavailableWhenOwnServerDidNotResolve() {
        assertEquals("unavailable", PluginQuality.deriveLspAvailability(DECLARED,
                List.of(new PluginQuality.StatusServer("mylang", "mylang-ls", false))));
    }

    @Test
    void lspOkWhenEveryDeclaredServerResolved() {
        assertEquals("ok", PluginQuality.deriveLspAvailability(DECLARED,
                List.of(new PluginQuality.StatusServer("mylang", "mylang-ls", true))));
    }

    // ------------------------------------------------------ quality flags

    @Test
    void rowsNullWhenPluginListUnreadable() {
        assertNull(PluginQuality.buildQualityRows(null, Map.of(), null));
    }

    @Test
    void flagsBrokenFromValidateErrors() {
        List<PluginQuality.Row> rows = PluginQuality.buildQualityRows(
                List.of(plugin("bad")),
                Map.of("bad", validation("{\"ok\":false,"
                        + "\"errors\":[\"manifest.name is required\"],"
                        + "\"componentCounts\":{}}")),
                null);
        assertEquals(Boolean.TRUE, rows.get(0).broken);
        assertEquals(List.of("manifest.name is required"), rows.get(0).brokenReasons);
    }

    @Test
    void flagsUnusedOnlyWhenEveryComponentCountIsZero() {
        List<PluginQuality.Row> rows = PluginQuality.buildQualityRows(
                List.of(plugin("empty"), plugin("has-skill")),
                Map.of("empty", emptyValidation(),
                        "has-skill", validation(
                                "{\"ok\":true,\"componentCounts\":{\"skills\":1}}")),
                null);
        assertEquals(Boolean.TRUE, rows.get(0).unused);
        assertEquals(Boolean.FALSE, rows.get(1).unused);
    }

    @Test
    void lspOnlyPluginIsNotUnused() {
        // Doc-mandated: a plugin that only ships an LSP server contributes.
        List<PluginQuality.Row> rows = PluginQuality.buildQualityRows(
                List.of(plugin("lsp-only")),
                Map.of("lsp-only", validation("{\"ok\":true,"
                        + "\"componentCounts\":{\"lsp\":1},"
                        + "\"components\":{\"lsp\":[{\"languageId\":\"mylang\","
                        + "\"id\":\"mylang-ls\"}]}}")),
                List.of(new PluginQuality.StatusServer("mylang", "mylang-ls", false)));
        assertEquals(Boolean.FALSE, rows.get(0).unused);
        assertEquals("unavailable", rows.get(0).lsp);
    }

    @Test
    void degradesHonestlyWhenValidateOutputMissing() {
        List<PluginQuality.Row> rows = PluginQuality.buildQualityRows(
                List.of(plugin("mystery")),
                Map.of("mystery",
                        PluginQuality.Validation.failure("validate produced no JSON")),
                null);
        PluginQuality.Row r = rows.get(0);
        assertTrue(r.validateFailed);
        assertEquals("validate produced no JSON", r.validateMessage);
        assertNull(r.broken); // unknown — never fabricated
        assertNull(r.unused);
        assertEquals("unknown", r.lsp);
    }

    @Test
    void missingValidationEntryAlsoDegrades() {
        List<PluginQuality.Row> rows = PluginQuality.buildQualityRows(
                List.of(plugin("nobody-validated")), Map.of(), null);
        assertTrue(rows.get(0).validateFailed);
        assertEquals("plugin validate produced no output", rows.get(0).validateMessage);
        assertNull(rows.get(0).broken);
    }

    @Test
    void discoveryLevelInvalidPluginIsBrokenWithoutValidate() {
        Map<String, Object> bad = plugin("discovered-bad");
        bad.put("ok", Boolean.FALSE);
        List<PluginQuality.Row> rows =
                PluginQuality.buildQualityRows(List.of(bad), Map.of(), null);
        assertEquals(Boolean.TRUE, rows.get(0).broken);
        // …and a discovery-bad plugin with good validate output stays broken.
        List<PluginQuality.Row> rows2 = PluginQuality.buildQualityRows(
                List.of(bad), Map.of("discovered-bad", emptyValidation()), null);
        assertEquals(Boolean.TRUE, rows2.get(0).broken);
    }

    @Test
    void neverEmitsAFabricatedSlowFlag() {
        // The CLI records no load/exec timing — the Row type must not even
        // have a slow field (VS twin asserts `"slow" in row === false`).
        for (Field f : PluginQuality.Row.class.getFields()) {
            assertFalse(f.getName().toLowerCase().contains("slow"),
                    "Row must not fabricate a timing flag: " + f.getName());
        }
        assertTrue(PluginQuality.flagsFor(PluginQuality.buildQualityRows(
                        List.of(plugin("p")), Map.of("p", emptyValidation()), null).get(0))
                .stream().noneMatch(s -> s.contains("slow")));
    }

    // ------------------------------------------------------------ display

    @Test
    void formatCountsShowsOnlyNonZeroTypes() {
        PluginQuality.Validation v = validation(
                "{\"ok\":true,\"componentCounts\":{\"skills\":2,\"lsp\":1}}");
        assertEquals("skills 2 · lsp 1", PluginQuality.formatCounts(v.counts));
        assertEquals("", PluginQuality.formatCounts(emptyValidation().counts));
        assertEquals("", PluginQuality.formatCounts(null));
    }

    @Test
    void describeRendersUnreadableEmptyAndProbeWarningStates() {
        assertTrue(PluginQuality.describe(null, true)
                .contains("could not read plugins"));
        assertTrue(PluginQuality.describe(List.of(), true)
                .contains("No runtime plugins installed"));
        String warned = PluginQuality.describe(List.of(), false);
        assertTrue(warned.contains("code-intel status"));
        assertTrue(warned.contains("unknown"));
    }

    @Test
    void describeRendersFlagsCountsAndErrors() {
        List<PluginQuality.Row> rows = PluginQuality.buildQualityRows(
                List.of(plugin("bad"), plugin("lsp-only"), plugin("empty")),
                Map.of("bad", validation("{\"ok\":false,\"errors\":[\"boom\"],"
                                + "\"componentCounts\":{\"skills\":1}}"),
                        "lsp-only", validation("{\"ok\":true,"
                                + "\"componentCounts\":{\"lsp\":1},"
                                + "\"components\":{\"lsp\":[{\"languageId\":\"mylang\","
                                + "\"id\":\"mylang-ls\"}]}}"),
                        "empty", emptyValidation()),
                null);
        String text = PluginQuality.describe(rows, false);
        assertTrue(text.contains("bad v1.0.0  [user]"));
        assertTrue(text.contains("✖ broken"));
        assertTrue(text.contains("errors: boom"));
        assertTrue(text.contains("lsp unknown")); // probe absent → honest
        assertTrue(text.contains("unused"));
        assertTrue(text.contains("components: (none)"));
        // The lsp-only row is NOT flagged unused anywhere.
        int lspOnlyAt = text.indexOf("lsp-only");
        int emptyAt = text.indexOf("empty v");
        String lspOnlyBlock = text.substring(lspOnlyAt, emptyAt);
        assertFalse(lspOnlyBlock.contains("unused"));
    }

    @Test
    void summaryLineCountsCategories() {
        List<PluginQuality.Row> rows = PluginQuality.buildQualityRows(
                List.of(plugin("bad"), plugin("empty"), plugin("mystery")),
                Map.of("bad", validation("{\"ok\":false,\"errors\":[\"x\"],"
                                + "\"componentCounts\":{\"skills\":1}}"),
                        "empty", emptyValidation(),
                        "mystery", PluginQuality.Validation.failure("no output")),
                List.of());
        String line = PluginQuality.summaryLine(rows, true);
        assertTrue(line.contains("plugins: 3"));
        assertTrue(line.contains("broken: 1"));
        assertTrue(line.contains("unused: 1"));
        assertTrue(line.contains("unknown: 1")); // the failed-validate row
        assertEquals("plugins: n/a", PluginQuality.summaryLine(null, true));
        assertTrue(PluginQuality.summaryLine(List.of(), false)
                .contains("lsp probe: unavailable"));
    }
}
