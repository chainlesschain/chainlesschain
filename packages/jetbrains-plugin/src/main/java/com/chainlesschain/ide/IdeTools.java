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

        tools.add(new BaseTool(
                "openMultiDiff",
                "Open a native multi-file diff for a whole changeset and BLOCK until the "
                        + "user accepts all, picks a subset, or rejects. `files` is a list of "
                        + "{ path, modifiedText, originalText? }; chosen files are written. "
                        + "Returns { outcome:'accepted'|'partial'|'rejected', written:[path…], "
                        + "count } — this call can take a while, that is expected.",
                openMultiDiffSchema()) {
            @Override public Object call(Map<String, Object> args) {
                if (args == null) args = new LinkedHashMap<>();
                Object filesObj = args.get("files");
                List<MultiDiff.FileChange> changes = new ArrayList<>();
                if (filesObj instanceof List) {
                    for (Object o : (List<?>) filesObj) {
                        if (!(o instanceof Map)) continue;
                        Map<?, ?> m = (Map<?, ?>) o;
                        Object p = m.get("path");
                        Object mod = m.get("modifiedText");
                        if (!(p instanceof String) || !(mod instanceof String)) continue;
                        Object orig = m.get("originalText");
                        changes.add(new MultiDiff.FileChange((String) p, (String) mod,
                                orig instanceof String ? (String) orig : null));
                    }
                }
                if (changes.isEmpty()) {
                    throw new IllegalArgumentException(
                            "openMultiDiff requires a non-empty `files` array of { path, modifiedText }");
                }
                Map<String, Object> res = editor.openMultiDiff(changes, (String) args.get("title"));
                if (res != null) return res;
                Map<String, Object> fallback = new LinkedHashMap<>();
                fallback.put("outcome", "rejected");
                return fallback;
            }
        });

        tools.add(new BaseTool(
                "getTerminalOutput",
                "Return the recent text from the editor's integrated terminal(s) — so "
                        + "you can see what the user just ran and how it failed without asking "
                        + "them to paste it. `limit` is a best-effort cap (default 3). NOTE: on "
                        + "JetBrains this is the visible terminal screen text (no per-command "
                        + "structure or exit codes — that needs shell integration not available "
                        + "here). Empty if there is no terminal open yet.",
                terminalSchema()) {
            @Override public Object call(Map<String, Object> args) {
                if (args == null) args = new LinkedHashMap<>();
                int limit = 3;
                Object l = args.get("limit");
                if (l instanceof Number) limit = Math.max(1, ((Number) l).intValue());
                Map<String, Object> res = editor.getTerminalOutput(limit);
                if (res != null) return res;
                Map<String, Object> fallback = new LinkedHashMap<>();
                fallback.put("terminals", new ArrayList<>());
                return fallback;
            }
        });

        return tools;
    }

    private static Map<String, Object> terminalSchema() {
        Map<String, Object> limit = new LinkedHashMap<>();
        limit.put("type", "number");
        limit.put("description", "Best-effort cap on how much recent output to return (default 3).");
        Map<String, Object> props = new LinkedHashMap<>();
        props.put("limit", limit);
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("type", "object");
        s.put("properties", props);
        return s;
    }

    private static Map<String, Object> openMultiDiffSchema() {
        Map<String, Object> fileProps = new LinkedHashMap<>();
        fileProps.put("path", strProp("Absolute path of the file."));
        fileProps.put("modifiedText", strProp("Proposed new content for this file."));
        fileProps.put("originalText", strProp("Original content; defaults to the file on disk."));
        Map<String, Object> fileItem = new LinkedHashMap<>();
        fileItem.put("type", "object");
        fileItem.put("properties", fileProps);
        fileItem.put("required", new ArrayList<>(Arrays.asList("path", "modifiedText")));

        Map<String, Object> filesProp = new LinkedHashMap<>();
        filesProp.put("type", "array");
        filesProp.put("items", fileItem);
        filesProp.put("description", "The changeset: one entry per file.");

        Map<String, Object> props = new LinkedHashMap<>();
        props.put("files", filesProp);
        props.put("title", strProp("Review dialog title (optional)."));
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("type", "object");
        s.put("properties", props);
        s.put("required", new ArrayList<>(Arrays.asList("files")));
        return s;
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
