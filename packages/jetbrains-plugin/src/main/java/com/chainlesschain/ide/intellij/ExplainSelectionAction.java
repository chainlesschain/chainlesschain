package com.chainlesschain.ide.intellij;

import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.actionSystem.CommonDataKeys;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import org.jetbrains.annotations.NotNull;

/**
 * §5 selection action — "Explain": reveal the chat tool window and seed the
 * active conversation with an Explain prompt over {@code @selection} (the CLI's
 * IDE bridge expands the live selection). VS Code parity. SDK-bound glue.
 */
public final class ExplainSelectionAction extends AnAction implements DumbAware {
    @Override
    public void update(@NotNull AnActionEvent e) {
        Editor editor = e.getData(CommonDataKeys.EDITOR);
        e.getPresentation().setEnabled(editor != null && editor.getSelectionModel().hasSelection());
    }

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        Project project = e.getProject();
        if (project == null) return;
        ChatToolWindowFactory.onPanel(project,
                panel -> panel.seedActiveInput("Explain the selected code:\n@selection"));
    }
}
