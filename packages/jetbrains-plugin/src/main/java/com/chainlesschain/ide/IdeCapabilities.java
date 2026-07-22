package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Runtime IDE capability manifest derived from the registered MCP tools. */
public final class IdeCapabilities {
    public static final int SCHEMA_VERSION = 1;

    private static final Map<String, String> TOOL_FEATURES = new LinkedHashMap<>();
    static {
        TOOL_FEATURES.put("getSelection", "selection");
        TOOL_FEATURES.put("getActiveFile", "active_file");
        TOOL_FEATURES.put("getDiagnostics", "diagnostics");
        TOOL_FEATURES.put("getOpenEditors", "open_editors");
        TOOL_FEATURES.put("openDiff", "native_diff");
        TOOL_FEATURES.put("openMultiDiff", "multi_file_diff");
        TOOL_FEATURES.put("getTerminalOutput", "terminal_output");
        TOOL_FEATURES.put("getPreviewState", "preview_state");
        TOOL_FEATURES.put("executeCode", "notebook_execute");
        TOOL_FEATURES.put("getHover", "semantic_hover");
        TOOL_FEATURES.put("goToDefinition", "semantic_definition");
        TOOL_FEATURES.put("findReferences", "semantic_references");
        TOOL_FEATURES.put("renamePreview", "semantic_rename");
        TOOL_FEATURES.put("getCallHierarchy", "semantic_call_hierarchy");
        TOOL_FEATURES.put("getSymbolInfo", "semantic_symbols");
        TOOL_FEATURES.put("getProjectModel", "project_model");
    }

    private IdeCapabilities() {}

    public static Map<String, Object> build(List<Tool> tools) {
        Set<String> names = new LinkedHashSet<>();
        if (tools != null) {
            for (Tool tool : tools) {
                if (tool != null && tool.name() != null && !tool.name().isEmpty()) {
                    names.add(tool.name());
                }
            }
        }
        List<String> sortedNames = new ArrayList<>(names);
        Collections.sort(sortedNames);
        Set<String> featureSet = new LinkedHashSet<>();
        for (String name : sortedNames) {
            String feature = TOOL_FEATURES.get(name);
            if (feature != null) featureSet.add(feature);
        }
        List<String> features = new ArrayList<>(featureSet);
        Collections.sort(features);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("schemaVersion", SCHEMA_VERSION);
        result.put("features", features);
        result.put("tools", sortedNames);
        return result;
    }
}
