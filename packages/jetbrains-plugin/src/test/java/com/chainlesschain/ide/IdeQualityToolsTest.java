package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Conditional registration, path guard, and Context v2 quality-tool wiring. */
@SuppressWarnings("unchecked")
final class IdeQualityToolsTest {
    private static Tool find(List<Tool> tools, String name) {
        for (Tool tool : tools) {
            if (name.equals(tool.name())) return tool;
        }
        return null;
    }

    @Test
    void qualityToolsAreConditional() {
        List<Tool> tools = IdeTools.build(new FakeFacade(false));
        assertNull(find(tools, "getTestResults"));
        assertNull(find(tools, "getCoverage"));
        assertNull(find(tools, "getDebugState"));

        tools = IdeTools.build(new FakeFacade(true));
        assertNotNull(find(tools, "getTestResults"));
        assertNotNull(find(tools, "getCoverage"));
        assertNotNull(find(tools, "getDebugState"));
    }

    @Test
    void argumentsAreBoundedAndContextIsAttached() throws Exception {
        FakeFacade facade = new FakeFacade(true);
        List<Tool> tools = IdeTools.build(
                facade, null, List.of("/workspace"));
        Map<String, Object> tests = (Map<String, Object>) find(
                tools, "getTestResults").call(Map.of("limit", 999));
        assertEquals(20, facade.lastLimit);
        assertEquals("cc-ide-quality/v1", tests.get("schema"));
        assertEquals("cc-ide-context/v2",
                ((Map<?, ?>) tests.get("context")).get("schema"));

        Map<String, Object> coverage = (Map<String, Object>) find(
                tools, "getCoverage").call(
                        Map.of("path", "/workspace/src/A.java"));
        assertTrue(facade.lastCoveragePath.replace('\\', '/')
                .endsWith("/workspace/src/A.java"));
        assertTrue(String.valueOf(
                        ((Map<?, ?>) coverage.get("context"))
                                .get("documentUri"))
                .endsWith("/workspace/src/A.java"));

        Tool coverageTool = find(tools, "getCoverage");
        assertThrows(IllegalArgumentException.class, () ->
                coverageTool.call(Map.of("path", "/outside/secret.txt")));

        Map<String, Object> debug = (Map<String, Object>) find(
                tools, "getDebugState").call(Map.of());
        assertNull(((Map<?, ?>) debug.get("context")).get("documentUri"));
    }

    private static final class FakeFacade implements EditorFacade {
        final boolean supported;
        int lastLimit;
        String lastCoveragePath;

        FakeFacade(boolean supported) {
            this.supported = supported;
        }

        @Override public boolean supportsTestResults() { return supported; }
        @Override public boolean supportsCoverage() { return supported; }
        @Override public boolean supportsDebugState() { return supported; }

        @Override
        public Map<String, Object> getContextMetadata(
                String file, String tool) {
            return IdeContextV2.build(
                    List.of("/workspace"),
                    file == null ? null : "file://" + file.replace('\\', '/'),
                    null,
                    null,
                    "jetbrains-project-policy",
                    "live-host",
                    0);
        }

        @Override
        public Map<String, Object> getTestResults(int limit) {
            lastLimit = limit;
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("schema", "cc-ide-quality/v1");
            out.put("kind", "test-results");
            out.put("available", Boolean.TRUE);
            out.put("runs", new ArrayList<Map<String, Object>>());
            return out;
        }

        @Override
        public Map<String, Object> getCoverage(String path) {
            lastCoveragePath = path;
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("schema", "cc-ide-quality/v1");
            out.put("kind", "coverage");
            out.put("available", Boolean.TRUE);
            out.put("files", new ArrayList<Map<String, Object>>());
            return out;
        }

        @Override
        public Map<String, Object> getDebugState() {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("schema", "cc-ide-quality/v1");
            out.put("kind", "debug-state");
            out.put("available", Boolean.TRUE);
            out.put("session", null);
            out.put("breakpoints", new ArrayList<Map<String, Object>>());
            return out;
        }

        @Override public Map<String, Object> getSelection() { return null; }
        @Override public List<Map<String, Object>> getDiagnostics(String path) {
            return new ArrayList<Map<String, Object>>();
        }
        @Override public List<Map<String, Object>> getOpenEditors() {
            return new ArrayList<Map<String, Object>>();
        }
        @Override public Map<String, Object> openDiff(
                String path, String modifiedText,
                String originalText, String title) {
            return null;
        }
    }
}
