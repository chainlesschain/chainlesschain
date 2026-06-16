package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.Mentions;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.actionSystem.CommonDataKeys;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.editor.LogicalPosition;
import com.intellij.openapi.editor.SelectionModel;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vfs.VirtualFile;
import org.jetbrains.annotations.NotNull;

/**
 * §5 keybinding — insert an {@code @file} reference for the current editor into
 * the chat input. With a selection, emits {@code @<path>#L<start>-<end>} (single
 * line {@code #L<n>}) so the shared {@code cc} expander expands only those lines
 * (VS Code parity: {@code insert-reference.js}). Computed at action time, so the
 * reference is concrete regardless of later focus. SDK-bound glue.
 */
public final class InsertFileReferenceAction extends AnAction implements DumbAware {
    @Override
    public void update(@NotNull AnActionEvent e) {
        e.getPresentation().setEnabled(e.getData(CommonDataKeys.EDITOR) != null);
    }

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        Project project = e.getProject();
        Editor editor = e.getData(CommonDataKeys.EDITOR);
        if (project == null || editor == null) return;

        VirtualFile vf = FileDocumentManager.getInstance().getFile(editor.getDocument());
        if (vf == null) return;
        String rel = toProjectRelative(project, vf.getPath());

        SelectionModel sel = editor.getSelectionModel();
        String ref;
        if (sel.hasSelection()) {
            LogicalPosition start = editor.offsetToLogicalPosition(sel.getSelectionStart());
            LogicalPosition end = editor.offsetToLogicalPosition(sel.getSelectionEnd());
            ref = Mentions.formatInsertReference(rel, start.line, start.column, end.line, end.column);
        } else {
            ref = Mentions.formatInsertReference(rel, 0, 0, 0, 0);
        }
        final String reference = ref;
        ChatToolWindowFactory.onPanel(project, panel -> panel.seedActiveInput(reference));
    }

    /** Project-relative, forward-slashed path; falls back to the basename. */
    private static String toProjectRelative(Project project, String absPath) {
        String p = absPath.replace('\\', '/');
        String base = project.getBasePath();
        if (base != null) {
            String b = base.replace('\\', '/');
            if (!b.endsWith("/")) b = b + "/";
            if (p.startsWith(b)) return p.substring(b.length());
        }
        int slash = p.lastIndexOf('/');
        return slash >= 0 ? p.substring(slash + 1) : p;
    }
}
