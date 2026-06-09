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
}
