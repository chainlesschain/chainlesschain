package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/** getPreviewState bridge tool — conditional exposure + contract shape. */
final class IdeToolsPreviewTest {

    private static class FakeFacade implements EditorFacade {
        final boolean supportsPreview;
        Map<String, Object> previewResult;

        FakeFacade(boolean supportsPreview) {
            this.supportsPreview = supportsPreview;
        }

        @Override public Map<String, Object> getSelection() { return null; }
        @Override public List<Map<String, Object>> getDiagnostics(String path) {
            return new ArrayList<Map<String, Object>>();
        }
        @Override public List<Map<String, Object>> getOpenEditors() {
            return new ArrayList<Map<String, Object>>();
        }
        @Override public Map<String, Object> openDiff(
                String path, String modifiedText, String originalText, String title) {
            return null;
        }
        @Override public boolean supportsPreviewState() { return supportsPreview; }
        @Override public Map<String, Object> getPreviewState() { return previewResult; }
    }

    private static Tool find(List<Tool> tools, String name) {
        for (Tool t : tools) if (name.equals(t.name())) return t;
        return null;
    }

    @Test
    void toolIsOnlyExposedWhenTheFacadeSupportsIt() {
        assertNull(find(IdeTools.build(new FakeFacade(false)), "getPreviewState"));
        assertNotNull(find(IdeTools.build(new FakeFacade(true)), "getPreviewState"));
    }

    @Test
    void passesFacadeStateThroughAndDegradesOnNull() throws Exception {
        FakeFacade facade = new FakeFacade(true);
        Map<String, Object> state = new LinkedHashMap<String, Object>();
        state.put("running", Boolean.TRUE);
        state.put("url", "http://localhost:5173/");
        state.put("output", "VITE ready");
        facade.previewResult = state;
        Tool tool = find(IdeTools.build(facade), "getPreviewState");
        assertSame(state, tool.call(null));

        facade.previewResult = null; // facade broke its contract
        Object res = tool.call(null);
        assertTrue(res instanceof Map);
        assertEquals(Boolean.FALSE, ((Map<?, ?>) res).get("running"));
        assertEquals("", ((Map<?, ?>) res).get("output"));
    }

    @Test
    void defaultFacadeContractIsWellFormedAndUnsupported() {
        EditorFacade minimal = new EditorFacade() {
            @Override public Map<String, Object> getSelection() { return null; }
            @Override public List<Map<String, Object>> getDiagnostics(String path) {
                return new ArrayList<Map<String, Object>>();
            }
            @Override public List<Map<String, Object>> getOpenEditors() {
                return new ArrayList<Map<String, Object>>();
            }
            @Override public Map<String, Object> openDiff(
                    String path, String modifiedText, String originalText, String title) {
                return null;
            }
        };
        assertFalse(minimal.supportsPreviewState());
        Map<String, Object> res = minimal.getPreviewState();
        assertEquals(Boolean.FALSE, res.get("running"));
        assertEquals("", res.get("output"));
        assertTrue(res.containsKey("url"));
        assertTrue(res.containsKey("script"));
        assertTrue(res.containsKey("exitCode"));
    }
}
