package com.chainlesschain.ide.intellij;

import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import org.jetbrains.annotations.NotNull;

/**
 * §6 reopen-closed action: reveal the chat tool window and re-open the most
 * recently closed conversation, resuming it (VS Code parity:
 * {@code Ctrl/Cmd+Shift+T}). SDK-bound glue.
 */
public final class ReopenClosedConversationAction extends AnAction implements DumbAware {
    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        Project project = e.getProject();
        if (project == null) return;
        ChatToolWindowFactory.onPanel(project, ChatToolWindowFactory.ChatPanel::reopenClosed);
    }
}
