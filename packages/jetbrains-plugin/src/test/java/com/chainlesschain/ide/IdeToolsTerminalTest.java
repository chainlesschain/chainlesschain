package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/** getTerminalOutput bridge tool — conditional exposure + arg handling. */
final class IdeToolsTerminalTest {

    /** Minimal fake facade; terminal support is toggled per test. */
    private static class FakeFacade implements EditorFacade {
        final boolean supportsTerminal;
        Integer seenLimit;
        Map<String, Object> terminalResult;

        FakeFacade(boolean supportsTerminal) {
            this.supportsTerminal = supportsTerminal;
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
        @Override public boolean supportsTerminalOutput() { return supportsTerminal; }
        @Override public Map<String, Object> getTerminalOutput(int limit) {
            seenLimit = limit;
            return terminalResult;
        }
    }

    private static Tool find(List<Tool> tools, String name) {
        for (Tool t : tools) if (name.equals(t.name())) return t;
        return null;
    }

    @Test
    void toolIsOnlyExposedWhenTheFacadeSupportsIt() {
        assertNull(find(IdeTools.build(new FakeFacade(false)), "getTerminalOutput"));
        assertNotNull(find(IdeTools.build(new FakeFacade(true)), "getTerminalOutput"));
    }

    @Test
    void routesLimitAndDefaultsToThree() throws Exception {
        FakeFacade facade = new FakeFacade(true);
        facade.terminalResult = new LinkedHashMap<String, Object>();
        facade.terminalResult.put("terminals",
                new ArrayList<Object>(Arrays.asList(new LinkedHashMap<String, Object>())));
        Tool tool = find(IdeTools.build(facade), "getTerminalOutput");

        Map<String, Object> args = new LinkedHashMap<String, Object>();
        args.put("limit", 7L);
        Object res = tool.call(args);
        assertEquals(7, facade.seenLimit);
        assertSame(facade.terminalResult, res);

        tool.call(null);
        assertEquals(3, facade.seenLimit);

        // Non-positive / junk limits fall back to the default.
        args.put("limit", -2L);
        tool.call(args);
        assertEquals(3, facade.seenLimit);
    }

    @Test
    void malformedFacadeResultDegradesToEmptyList() throws Exception {
        FakeFacade facade = new FakeFacade(true);
        facade.terminalResult = null; // facade broke its contract
        Tool tool = find(IdeTools.build(facade), "getTerminalOutput");
        Object res = tool.call(null);
        assertTrue(res instanceof Map);
        Object terminals = ((Map<?, ?>) res).get("terminals");
        assertTrue(terminals instanceof List);
        assertTrue(((List<?>) terminals).isEmpty());
    }

    @Test
    void defaultFacadeContractIsEmptyNotNull() {
        // A facade that does NOT override the terminal methods gets the
        // interface defaults: unsupported + empty-but-well-formed result.
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
        Map<String, Object> res = minimal.getTerminalOutput(3);
        assertTrue(res.get("terminals") instanceof List);
        assertFalse(minimal.supportsTerminalOutput());
    }
}
