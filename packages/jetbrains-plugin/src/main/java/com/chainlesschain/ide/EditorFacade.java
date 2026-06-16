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

    /**
     * Recent integrated-terminal text (best-effort). JetBrains has no VS Code-style
     * shell integration, so this returns the visible terminal screen text rather
     * than structured per-command output. Default impl returns no terminals.
     * @return { terminals: [ { name, text } … ] }
     */
    default Map<String, Object> getTerminalOutput(int limit) {
        Map<String, Object> r = new java.util.LinkedHashMap<String, Object>();
        r.put("terminals", new java.util.ArrayList<Object>());
        return r;
    }
}
