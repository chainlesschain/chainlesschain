package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The four IDE tools (getSelection / getDiagnostics / getOpenEditors /
 * openDiff), identical in name + contract to the VS Code extension so the CLI
 * sees the same `mcp__ide__*` surface regardless of editor. Each tool delegates
 * to the injected {@link EditorFacade}.
 */
public final class IdeTools {
    private IdeTools() {}

    public static List<Tool> build(EditorFacade editor) {
        List<Tool> tools = new ArrayList<>();

        tools.add(new BaseTool(
                "getSelection",
                "Return the active editor's current selection: file path, language, "
                        + "the selected range, and the selected text (empty selection returns "
                        + "the cursor position with no text). Returns null when no editor is active.",
                emptyObjectSchema()) {
            @Override public Object call(Map<String, Object> args) {
                Map<String, Object> sel = editor.getSelection();
                return sel; // may be null
            }
        });

        tools.add(new BaseTool(
                "getDiagnostics",
                "Return current diagnostics (errors/warnings from linters, type checkers, "
                        + "etc.). Optionally scope to a single file via `path`.",
                schemaWithOptionalPath()) {
            @Override public Object call(Map<String, Object> args) {
                String path = args == null ? null : (String) args.get("path");
                List<Map<String, Object>> diags = editor.getDiagnostics(path);
                Map<String, Object> out = new LinkedHashMap<>();
                out.put("diagnostics", diags == null ? new ArrayList<>() : diags);
                return out;
            }
        });

        tools.add(new BaseTool(
                "getOpenEditors",
                "List the files currently open in editor tabs, flagging the active one.",
                emptyObjectSchema()) {
            @Override public Object call(Map<String, Object> args) {
                List<Map<String, Object>> eds = editor.getOpenEditors();
                Map<String, Object> out = new LinkedHashMap<>();
                out.put("editors", eds == null ? new ArrayList<>() : eds);
                return out;
            }
        });

        tools.add(new BaseTool(
                "openDiff",
                "Open a native side-by-side diff in the editor for the user to review a "
                        + "proposed change, then BLOCK until they accept or reject it. `path` is "
                        + "the target file; `modifiedText` is the proposed new content; "
                        + "`originalText` defaults to the file's current content. On accept the "
                        + "(possibly user-edited) text is written to the file. Returns "
                        + "{ outcome: 'accepted'|'rejected', path, finalText? } — this call can "
                        + "take a while, that is expected.",
                openDiffSchema()) {
            @Override public Object call(Map<String, Object> args) {
                if (args == null) args = new LinkedHashMap<>();
                Object path = args.get("path");
                Object modified = args.get("modifiedText");
                if (!(path instanceof String) || !(modified instanceof String)) {
                    throw new IllegalArgumentException("openDiff requires `path` and `modifiedText`");
                }
                Map<String, Object> res = editor.openDiff(
                        (String) path,
                        (String) modified,
                        (String) args.get("originalText"),
                        (String) args.get("title"));
                if (res != null) return res;
                Map<String, Object> fallback = new LinkedHashMap<>();
                fallback.put("outcome", "rejected");
                fallback.put("path", path);
                return fallback;
            }
        });

        return tools;
    }

    private static Map<String, Object> emptyObjectSchema() {
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("type", "object");
        s.put("properties", new LinkedHashMap<>());
        return s;
    }

    private static Map<String, Object> schemaWithOptionalPath() {
        Map<String, Object> props = new LinkedHashMap<>();
        props.put("path", strProp("Absolute file path to scope diagnostics to (optional)."));
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("type", "object");
        s.put("properties", props);
        return s;
    }

    private static Map<String, Object> openDiffSchema() {
        Map<String, Object> props = new LinkedHashMap<>();
        props.put("path", strProp("Absolute path of the file to diff."));
        props.put("modifiedText", strProp("Proposed new file content (right-hand side)."));
        props.put("originalText", strProp("Original content; defaults to the file on disk."));
        props.put("title", strProp("Diff tab title (optional)."));
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("type", "object");
        s.put("properties", props);
        s.put("required", new ArrayList<>(Arrays.asList("path", "modifiedText")));
        return s;
    }

    private static Map<String, Object> strProp(String desc) {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("type", "string");
        p.put("description", desc);
        return p;
    }

    /** A Tool with name/description/schema fixed; subclasses implement call(). */
    abstract static class BaseTool implements Tool {
        private final String name;
        private final String description;
        private final Map<String, Object> schema;

        BaseTool(String name, String description, Map<String, Object> schema) {
            this.name = name;
            this.description = description;
            this.schema = schema;
        }

        @Override public String name() { return name; }
        @Override public String description() { return description; }
        @Override public Map<String, Object> inputSchema() { return schema; }
    }
}
