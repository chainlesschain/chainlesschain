package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.FixWithCc;
import com.intellij.codeInsight.daemon.impl.HighlightInfo;
import com.intellij.codeInsight.intention.IntentionAction;
import com.intellij.lang.annotation.HighlightSeverity;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.editor.impl.DocumentMarkupModel;
import com.intellij.openapi.editor.markup.MarkupModel;
import com.intellij.openapi.editor.markup.RangeHighlighter;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.psi.PsiFile;
import com.intellij.util.IncorrectOperationException;
import org.jetbrains.annotations.NotNull;

import java.util.ArrayList;
import java.util.List;

/**
 * "Fix with ChainlessChain" intention — the JetBrains counterpart of the VS Code
 * Fix-with-cc quick-fix. On a line carrying an error/warning, offers a lightbulb
 * action that reveals the chat tool window and seeds it with a fix request
 * scoped to this file + those problems (via the @file reference the CLI expands).
 * Pure prompt construction lives in {@link FixWithCc}; this is the SDK glue.
 */
public final class FixWithCcIntention implements IntentionAction, DumbAware {

    @Override
    public @NotNull String getText() {
        return "Fix with ChainlessChain";
    }

    @Override
    public @NotNull String getFamilyName() {
        return "ChainlessChain";
    }

    @Override
    public boolean startInWriteAction() {
        return false;
    }

    @Override
    public boolean isAvailable(@NotNull Project project, Editor editor, PsiFile file) {
        return editor != null && file != null && !collectAtCaret(project, editor).isEmpty();
    }

    @Override
    public void invoke(@NotNull Project project, Editor editor, PsiFile file)
            throws IncorrectOperationException {
        if (editor == null || file == null) return;
        List<FixWithCc.Diag> diags = collectAtCaret(project, editor);
        if (diags.isEmpty()) return;
        String prompt = FixWithCc.formatFixPrompt(relPath(project, file), diags);
        if (prompt.isEmpty()) return;
        ChatToolWindowFactory.onPanel(project, panel -> panel.seedActiveInput(prompt));
    }

    /** Error/warning diagnostics on the caret's line, as plain Diag structs. */
    private List<FixWithCc.Diag> collectAtCaret(Project project, Editor editor) {
        List<FixWithCc.Diag> out = new ArrayList<>();
        Document doc = editor.getDocument();
        int len = doc.getTextLength();
        int offset = Math.max(0, Math.min(editor.getCaretModel().getOffset(), len));
        int caretLine = doc.getLineNumber(offset);
        MarkupModel mm = DocumentMarkupModel.forDocument(doc, project, false);
        if (mm == null) return out;
        for (RangeHighlighter h : mm.getAllHighlighters()) {
            Object tooltip = h.getErrorStripeTooltip();
            if (!(tooltip instanceof HighlightInfo)) continue;
            HighlightInfo info = (HighlightInfo) tooltip;
            if (info.getDescription() == null) continue;
            // errors + warnings only (skip weak warnings / infos)
            if (info.getSeverity().compareTo(HighlightSeverity.WARNING) < 0) continue;
            int start = info.getStartOffset();
            if (start < 0 || start > len) continue;
            if (doc.getLineNumber(start) != caretLine) continue;
            String sev = info.getSeverity().compareTo(HighlightSeverity.ERROR) >= 0
                    ? "Error" : "Warning";
            out.add(new FixWithCc.Diag(caretLine, sev, info.getDescription(), null, null));
        }
        return out;
    }

    /** Workspace-relative, forward-slashed path (for the @file reference). */
    private String relPath(Project project, PsiFile file) {
        VirtualFile vf = file.getVirtualFile();
        if (vf == null) return file.getName();
        String base = project.getBasePath();
        String path = vf.getPath();
        if (base != null && path.startsWith(base)) {
            String rel = path.substring(base.length());
            return rel.startsWith("/") ? rel.substring(1) : rel;
        }
        return path;
    }
}
