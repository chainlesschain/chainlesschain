package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

final class IdeCapabilitiesTest {
    private static Tool tool(String name) {
        return new Tool() {
            @Override public String name() { return name; }
            @Override public String description() { return "test"; }
            @Override public Map<String, Object> inputSchema() {
                return new LinkedHashMap<String, Object>();
            }
            @Override public Object call(Map<String, Object> args) { return null; }
        };
    }

    @Test
    void derivesFeaturesFromRegisteredTools() {
        Map<String, Object> manifest = IdeCapabilities.build(Arrays.asList(
                tool("getProjectModel"), tool("openDiff"), tool("unknown")
        ));
        assertEquals(1, manifest.get("schemaVersion"));
        assertEquals(Arrays.asList("getProjectModel", "openDiff", "unknown"),
                manifest.get("tools"));
        assertEquals(Arrays.asList("native_diff", "project_model"),
                manifest.get("features"));
    }

    @Test
    void emptyOrNullToolsAreSafe() {
        assertEquals(Arrays.asList(), IdeCapabilities.build(null).get("features"));
        assertEquals(new ArrayList<String>(),
                IdeCapabilities.build(new ArrayList<Tool>()).get("tools"));
    }
}
