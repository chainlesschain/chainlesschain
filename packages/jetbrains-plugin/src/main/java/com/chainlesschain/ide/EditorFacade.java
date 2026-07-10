package com.chainlesschain.ide;

import java.util.List;
import java.util.Map;

/**
 * The small editor surface the IDE tools need. Implemented for IntelliJ by
 * {@code com.chainlesschain.ide.intellij.IntellijEditorFacade} (SDK-bound) and
 * by fakes in tests. Keeping the tools against this interface lets the protocol
 * layer compile + run without the IntelliJ SDK.
 */
public interface EditorFacade {

    /** { file, languageId, selection:{start,end}, text } or null when no editor. */
    Map<String, Object> getSelection();

    /** { file, languageId, isDirty, cursor:{line,character} } or null when no editor. */
    default Map<String, Object> getActiveFile() {
        Map<String, Object> sel = getSelection();
        if (sel == null) return null;
        Map<String, Object> out = new java.util.LinkedHashMap<String, Object>();
        out.put("file", sel.get("file"));
        out.put("languageId", sel.get("languageId"));
        Object range = sel.get("selection");
        Object cursor = null;
        if (range instanceof Map) cursor = ((Map<?, ?>) range).get("start");
        out.put("cursor", cursor);
        return out;
    }

    /** [{ file, severity, message, line, character, source? }], optionally scoped. */
    List<Map<String, Object>> getDiagnostics(String path);

    /** [{ file, active, languageId? }]. */
    List<Map<String, Object>> getOpenEditors();

    /**
     * Open a native diff for review and BLOCK until the user accepts/rejects.
     * @return { outcome:"accepted"|"rejected", path, finalText? }
     */
    Map<String, Object> openDiff(String path, String modifiedText, String originalText, String title);

    /**
     * §4: open a native multi-file diff for a changeset and BLOCK until the user
     * decides — accept all, pick a subset, or reject. Chosen files are written.
     * Default impl rejects (so non-IntelliJ fakes need not implement it).
     * @return { outcome:"accepted"|"partial"|"rejected", written:[path…], count }
     */
    default Map<String, Object> openMultiDiff(List<MultiDiff.FileChange> files, String title) {
        Map<String, Object> r = new java.util.LinkedHashMap<String, Object>();
        r.put("outcome", "rejected");
        r.put("written", new java.util.ArrayList<String>());
        r.put("count", 0);
        return r;
    }

    /** Whether {@link #getTerminalOutput(int)} is wired — gates the tool's exposure. */
    default boolean supportsTerminalOutput() {
        return false;
    }

    /**
     * Recent integrated-terminal context: the buffer tail of up to {@code limit}
     * terminal tabs. Same field names as the VS Code twin's per-command records
     * ({ terminal, command, exitCode, output }) — here command/exitCode stay
     * null and `output` is the buffer tail (the JetBrains terminal has no
     * per-command shell integration API). Empty list when no terminal is open.
     * @return { terminals: [{ terminal, command, exitCode, output }] }
     */
    default Map<String, Object> getTerminalOutput(int limit) {
        Map<String, Object> out = new java.util.LinkedHashMap<String, Object>();
        out.put("terminals", new java.util.ArrayList<Map<String, Object>>());
        return out;
    }
}
