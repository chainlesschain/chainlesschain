package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pure-layer tests for the PSI semantic bridge tools: position validation
 * (1-based contract), caps/truncation, JSON shaping, degrade-with-reason
 * paths, and conditional registration in {@link IdeTools#build}.
 */
class SemanticToolsTest {

    // ── validation ──────────────────────────────────────────────────────────

    @Test
    void validPositionParses() {
        SemanticTools.Position p = SemanticTools.requirePosition(args("a/B.java", 12L, 3L));
        assertEquals("a/B.java", p.path);
        assertEquals(12, p.line);
        assertEquals(3, p.column);
    }

    @Test
    void doublesFromJsonAreAccepted() {
        SemanticTools.Position p = SemanticTools.requirePosition(args("f", 2.0d, 7.0d));
        assertEquals(2, p.line);
        assertEquals(7, p.column);
    }

    @Test
    void missingOrBlankPathRejected() {
        assertThrows(IllegalArgumentException.class,
                () -> SemanticTools.requirePosition(args(null, 1L, 1L)));
        assertThrows(IllegalArgumentException.class,
                () -> SemanticTools.requirePosition(args("   ", 1L, 1L)));
        assertThrows(IllegalArgumentException.class,
                () -> SemanticTools.requirePosition(null));
    }

    @Test
    void zeroBasedInputIsRejectedWithContractInMessage() {
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> SemanticTools.requirePosition(args("f", 0L, 1L)));
        assertTrue(e.getMessage().contains("1-based"), "error must teach the contract");
        assertThrows(IllegalArgumentException.class,
                () -> SemanticTools.requirePosition(args("f", 1L, 0L)));
    }

    @Test
    void nonNumericLineRejected() {
        Map<String, Object> a = args("f", null, 1L);
        a.put("line", "12");
        assertThrows(IllegalArgumentException.class, () -> SemanticTools.requirePosition(a));
    }

    @Test
    void clampMaxBehavior() {
        assertEquals(100, SemanticTools.clampMax(null, 100, 200));
        assertEquals(100, SemanticTools.clampMax("50", 100, 200));
        assertEquals(100, SemanticTools.clampMax(0L, 100, 200));
        assertEquals(100, SemanticTools.clampMax(-3L, 100, 200));
        assertEquals(50, SemanticTools.clampMax(50L, 100, 200));
        assertEquals(200, SemanticTools.clampMax(9999L, 100, 200));
    }

    // ── hover ────────────────────────────────────────────────────────────────

    @Test
    void hoverStripsHtmlAndDecodesEntities() {
        Map<String, Object> raw = new LinkedHashMap<>();
        raw.put("text", "<html><b>List&lt;String&gt;</b><br/>first &amp; second</html>");
        raw.put("symbol", "foo");
        Map<String, Object> out = SemanticTools.shapeHover(raw);
        assertEquals(Boolean.TRUE, out.get("found"));
        assertEquals("foo", out.get("symbol"));
        assertEquals("List<String>\nfirst & second", out.get("text"));
        assertNull(out.get("truncated"));
    }

    @Test
    void hoverCapsLongText() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < SemanticTools.MAX_HOVER_CHARS + 500; i++) sb.append('x');
        Map<String, Object> raw = new LinkedHashMap<>();
        raw.put("text", sb.toString());
        Map<String, Object> out = SemanticTools.shapeHover(raw);
        assertEquals(Boolean.TRUE, out.get("truncated"));
        assertEquals(SemanticTools.MAX_HOVER_CHARS + 1, ((String) out.get("text")).length());
    }

    @Test
    void hoverNullDegradesWithReason() {
        Map<String, Object> out = SemanticTools.shapeHover(null);
        assertEquals(Boolean.FALSE, out.get("found"));
        assertNotNull(out.get("reason"));
    }

    @Test
    void stripHtmlHandlesBlocksAndScripts() {
        assertEquals("a\nb", SemanticTools.stripHtml("<p>a</p><p>b</p>").trim());
        assertEquals("", SemanticTools.stripHtml("<script>alert(1)</script>"));
        assertEquals("", SemanticTools.stripHtml(null));
    }

    // ── definitions / references ────────────────────────────────────────────

    @Test
    void definitionsCappedAtMax() {
        List<Map<String, Object>> raw = locations(SemanticTools.MAX_DEFINITIONS + 5);
        Map<String, Object> out = SemanticTools.shapeDefinitions(raw);
        assertEquals(Boolean.TRUE, out.get("found"));
        assertEquals(SemanticTools.MAX_DEFINITIONS, ((List<?>) out.get("definitions")).size());
        assertEquals(Boolean.TRUE, out.get("truncated"));
    }

    @Test
    void emptyDefinitionsCarryReason() {
        Map<String, Object> out = SemanticTools.shapeDefinitions(new ArrayList<>());
        assertEquals(Boolean.FALSE, out.get("found"));
        assertNotNull(out.get("reason"));
        Map<String, Object> outNull = SemanticTools.shapeDefinitions(null);
        assertEquals(Boolean.FALSE, outNull.get("found"));
    }

    @Test
    void referencesUnderMaxAreNotTruncated() {
        Map<String, Object> out = SemanticTools.shapeReferences(locations(3), 100);
        assertEquals(3, ((List<?>) out.get("references")).size());
        assertEquals(3L, out.get("total"));
        assertNull(out.get("truncated"));
    }

    @Test
    void referencesOverMaxAreCappedWithTotal() {
        Map<String, Object> out = SemanticTools.shapeReferences(locations(150), 100);
        assertEquals(100, ((List<?>) out.get("references")).size());
        assertEquals(150L, out.get("total"));
        assertEquals(Boolean.TRUE, out.get("truncated"));
        assertNull(out.get("totalIsLowerBound"));
    }

    @Test
    void referencesAtCollectBoundFlagLowerBound() {
        Map<String, Object> out =
                SemanticTools.shapeReferences(locations(SemanticTools.COLLECT_BOUND), 100);
        assertEquals(Boolean.TRUE, out.get("totalIsLowerBound"));
    }

    // ── rename preview ──────────────────────────────────────────────────────

    @Test
    void renamePreviewGroupsCountsAndNeverMutates() {
        List<Map<String, Object>> refs = new ArrayList<>();
        refs.add(loc("b.java"));
        refs.add(loc("a.java"));
        refs.add(loc("b.java"));
        Map<String, Object> symbol = new LinkedHashMap<>();
        symbol.put("name", "doWork");
        symbol.put("file", "a.java");
        Map<String, Object> out = SemanticTools.shapeRenamePreview(symbol, refs);
        assertEquals("doWork", out.get("symbol"));
        assertEquals(2L, out.get("fileCount"));
        assertEquals(4L, out.get("totalOccurrences")); // 3 refs + declaration
        assertEquals(Boolean.TRUE, out.get("preview"));
        assertTrue(((String) out.get("note")).contains("nothing was renamed"));
        List<?> files = (List<?>) out.get("files");
        Map<?, ?> first = (Map<?, ?>) files.get(0);
        // a.java: 1 ref + declaration = 2; b.java: 2 — tie broken by name asc
        assertEquals("a.java", first.get("file"));
        assertEquals(2L, first.get("occurrences"));
        assertEquals(Boolean.TRUE, first.get("declaration"));
        Map<?, ?> second = (Map<?, ?>) files.get(1);
        assertEquals("b.java", second.get("file"));
        assertNull(second.get("declaration"));
    }

    @Test
    void renamePreviewCapsFileList() {
        List<Map<String, Object>> refs = new ArrayList<>();
        for (int i = 0; i < SemanticTools.MAX_RENAME_FILES + 10; i++) {
            refs.add(loc("f" + String.format("%04d", i) + ".java"));
        }
        Map<String, Object> out = SemanticTools.shapeRenamePreview(null, refs);
        assertEquals(SemanticTools.MAX_RENAME_FILES, ((List<?>) out.get("files")).size());
        assertEquals((long) (SemanticTools.MAX_RENAME_FILES + 10), out.get("fileCount"));
        assertEquals(Boolean.TRUE, out.get("truncated"));
    }

    @Test
    void renamePreviewWithNothingFoundIsEmptyButWellFormed() {
        Map<String, Object> out = SemanticTools.shapeRenamePreview(null, null);
        assertEquals(0L, out.get("fileCount"));
        assertEquals(0L, out.get("totalOccurrences"));
        assertEquals(Boolean.TRUE, out.get("preview"));
    }

    // ── call hierarchy ──────────────────────────────────────────────────────

    @Test
    void callHierarchyCapsEachDirection() {
        Map<String, Object> raw = new LinkedHashMap<>();
        raw.put("symbol", "A#m");
        raw.put("callers", locations(30));
        raw.put("callees", locations(3));
        Map<String, Object> out = SemanticTools.shapeCallHierarchy(raw, 25);
        assertEquals("A#m", out.get("symbol"));
        assertEquals(25, ((List<?>) out.get("callers")).size());
        assertEquals(3, ((List<?>) out.get("callees")).size());
        assertEquals(Boolean.TRUE, out.get("callersTruncated"));
        assertNull(out.get("calleesTruncated"));
        assertNull(out.get("reason"));
    }

    @Test
    void callHierarchyReasonPassthroughAndNullDegrade() {
        Map<String, Object> raw = new LinkedHashMap<>();
        raw.put("callers", new ArrayList<>());
        raw.put("callees", new ArrayList<>());
        raw.put("reason", "not a method");
        assertEquals("not a method", SemanticTools.shapeCallHierarchy(raw, 25).get("reason"));

        Map<String, Object> out = SemanticTools.shapeCallHierarchy(null, 25);
        assertTrue(((List<?>) out.get("callers")).isEmpty());
        assertTrue(((List<?>) out.get("callees")).isEmpty());
        assertNotNull(out.get("reason"));
    }

    // ── symbol info / project model ─────────────────────────────────────────

    @Test
    void symbolInfoWhitelistsKnownKeys() {
        Map<String, Object> raw = new LinkedHashMap<>();
        raw.put("name", "run");
        raw.put("kind", "method");
        raw.put("containingClass", "com.x.Runner");
        raw.put("package", "com.x");
        raw.put("owner", "com.x.Runner");
        raw.put("internalJunk", "drop-me");
        Map<String, Object> out = SemanticTools.shapeSymbolInfo(raw);
        assertEquals(Boolean.TRUE, out.get("found"));
        assertEquals("run", out.get("name"));
        assertEquals("com.x.Runner", out.get("containingClass"));
        assertFalse(out.containsKey("internalJunk"));
    }

    @Test
    void symbolInfoNullOrNamelessDegrades() {
        assertEquals(Boolean.FALSE, SemanticTools.shapeSymbolInfo(null).get("found"));
        Map<String, Object> nameless = new LinkedHashMap<>();
        nameless.put("kind", "whitespace");
        assertEquals(Boolean.FALSE, SemanticTools.shapeSymbolInfo(nameless).get("found"));
    }

    @Test
    void projectModelCapsDependenciesPerModule() {
        Map<String, Object> module = new LinkedHashMap<>();
        module.put("name", "core");
        module.put("sourceRoots", new ArrayList<>(List.of("/p/src")));
        List<Object> deps = new ArrayList<>();
        for (int i = 0; i < SemanticTools.MAX_DEPENDENCIES + 7; i++) deps.add("lib" + i);
        module.put("dependencies", deps);
        Map<String, Object> raw = new LinkedHashMap<>();
        raw.put("jdk", "temurin-17 (17.0.9)");
        raw.put("modules", new ArrayList<>(List.of(module)));

        Map<String, Object> out = SemanticTools.shapeProjectModel(raw);
        assertEquals("temurin-17 (17.0.9)", out.get("jdk"));
        assertEquals(1L, out.get("moduleCount"));
        Map<?, ?> m = (Map<?, ?>) ((List<?>) out.get("modules")).get(0);
        assertEquals(SemanticTools.MAX_DEPENDENCIES, ((List<?>) m.get("dependencies")).size());
        assertEquals(Boolean.TRUE, m.get("dependenciesTruncated"));
        assertEquals((long) (SemanticTools.MAX_DEPENDENCIES + 7), m.get("dependencyCount"));
    }

    @Test
    void projectModelNullDegrades() {
        Map<String, Object> out = SemanticTools.shapeProjectModel(null);
        assertTrue(((List<?>) out.get("modules")).isEmpty());
        assertNotNull(out.get("reason"));
    }

    // ── registration + end-to-end tool calls over a fake facade ─────────────

    @Test
    void toolsAreOnlyExposedWhenTheFacadeIsProvided() {
        List<Tool> without = IdeTools.build(new NoopEditor());
        for (String name : semanticToolNames()) {
            assertNull(find(without, name), name + " must be absent without a facade");
        }
        List<Tool> with = IdeTools.build(new NoopEditor(), new FakeSemantics());
        for (String name : semanticToolNames()) {
            assertNotNull(find(with, name), name + " must be present with a facade");
        }
    }

    @Test
    void positionSchemasDeclareRequiredsAndDocumentOneBased() {
        List<Tool> tools = SemanticTools.build(new FakeSemantics());
        for (Tool t : tools) {
            if (t.name().equals("getProjectModel")) continue;
            Map<String, Object> schema = t.inputSchema();
            assertEquals(List.of("path", "line", "column"), schema.get("required"), t.name());
            Map<?, ?> props = (Map<?, ?>) schema.get("properties");
            String lineDesc = (String) ((Map<?, ?>) props.get("line")).get("description");
            assertTrue(lineDesc.contains("1-based"), t.name() + " line must document 1-based");
            assertTrue(t.description().contains("1-based"),
                    t.name() + " description must document 1-based");
        }
        Tool refs = find(tools, "findReferences");
        Map<?, ?> props = (Map<?, ?>) refs.inputSchema().get("properties");
        assertNotNull(props.get("max"), "findReferences exposes optional max");
        Tool hier = find(tools, "getCallHierarchy");
        props = (Map<?, ?>) hier.inputSchema().get("properties");
        assertNotNull(props.get("max"), "getCallHierarchy exposes optional max");
    }

    @Test
    void findReferencesHonorsMaxArgument() throws Exception {
        FakeSemantics sem = new FakeSemantics();
        sem.references = locations(40);
        Tool tool = find(SemanticTools.build(sem), "findReferences");
        Map<String, Object> a = args("F.java", 1L, 1L);
        a.put("max", 10L);
        Object res = tool.call(a);
        assertEquals(10, ((List<?>) ((Map<?, ?>) res).get("references")).size());
        assertEquals(40L, ((Map<?, ?>) res).get("total"));
    }

    @Test
    void renamePreviewToolComposesSymbolAndReferences() throws Exception {
        FakeSemantics sem = new FakeSemantics();
        sem.symbol = new LinkedHashMap<>();
        sem.symbol.put("name", "value");
        sem.symbol.put("file", "A.java");
        sem.references = new ArrayList<>(List.of(loc("B.java")));
        Tool tool = find(SemanticTools.build(sem), "renamePreview");
        Map<?, ?> res = (Map<?, ?>) tool.call(args("A.java", 5L, 9L));
        assertEquals("value", res.get("symbol"));
        assertEquals(2L, res.get("totalOccurrences"));
        assertEquals(Boolean.TRUE, res.get("preview"));
    }

    @Test
    void invalidArgsSurfaceAsIllegalArgument() {
        Tool tool = find(SemanticTools.build(new FakeSemantics()), "getHover");
        assertThrows(IllegalArgumentException.class, () -> tool.call(args("F.java", 0L, 1L)));
        assertThrows(IllegalArgumentException.class, () -> tool.call(new LinkedHashMap<>()));
    }

    @Test
    void shapedResultsSurviveMiniJsonRoundTrip() throws Exception {
        FakeSemantics sem = new FakeSemantics();
        sem.references = locations(3);
        Tool tool = find(SemanticTools.build(sem), "findReferences");
        Object res = tool.call(args("F.java", 2L, 4L));
        Map<String, Object> back = MiniJson.parseObject(MiniJson.stringify(res));
        assertEquals(3L, back.get("total"));
        assertEquals(3, ((List<?>) back.get("references")).size());
    }

    // ── fixtures ─────────────────────────────────────────────────────────────

    private static String[] semanticToolNames() {
        return new String[] { "getHover", "goToDefinition", "findReferences", "renamePreview",
                "getCallHierarchy", "getSymbolInfo", "getProjectModel" };
    }

    private static Map<String, Object> args(String path, Object line, Object column) {
        Map<String, Object> m = new LinkedHashMap<>();
        if (path != null) m.put("path", path);
        if (line != null) m.put("line", line);
        if (column != null) m.put("column", column);
        return m;
    }

    private static Map<String, Object> loc(String file) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("file", file);
        m.put("line", 1L);
        m.put("column", 1L);
        return m;
    }

    private static List<Map<String, Object>> locations(int n) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (int i = 0; i < n; i++) out.add(loc("f" + i + ".java"));
        return out;
    }

    private static Tool find(List<Tool> tools, String name) {
        for (Tool t : tools) if (t.name().equals(name)) return t;
        return null;
    }

    /** Minimal EditorFacade — the semantic tools never touch it. */
    private static final class NoopEditor implements EditorFacade {
        @Override public Map<String, Object> getSelection() { return null; }
        @Override public List<Map<String, Object>> getDiagnostics(String path) { return new ArrayList<>(); }
        @Override public List<Map<String, Object>> getOpenEditors() { return new ArrayList<>(); }
        @Override public Map<String, Object> openDiff(String p, String m, String o, String t) { return null; }
    }

    /** Scriptable fake of the PSI glue. */
    private static final class FakeSemantics implements SemanticTools.SemanticFacade {
        Map<String, Object> hover;
        List<Map<String, Object>> definitions = new ArrayList<>();
        List<Map<String, Object>> references = new ArrayList<>();
        Map<String, Object> symbol;
        Map<String, Object> hierarchy;
        Map<String, Object> model;

        @Override public Map<String, Object> hover(String p, int l, int c) { return hover; }
        @Override public List<Map<String, Object>> definitions(String p, int l, int c) { return definitions; }
        @Override public List<Map<String, Object>> references(String p, int l, int c, int b) { return references; }
        @Override public Map<String, Object> symbolInfo(String p, int l, int c) { return symbol; }
        @Override public Map<String, Object> callHierarchy(String p, int l, int c, int b) { return hierarchy; }
        @Override public Map<String, Object> projectModel() { return model; }
    }
}
