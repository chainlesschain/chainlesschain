package com.chainlesschain.ide.intellij;

import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowManager;
import org.jetbrains.annotations.NotNull;

/**
 * Tools-menu "Sessions Workbench": reveals the
 * {@link SessionsWorkbenchToolWindowFactory} tool window (gap #3 unified
 * cross-surface session entry — chat / cross-IDE / background / remote).
 */
public final class SessionsWorkbenchAction extends AnAction implements DumbAware {

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        Project project = e.getProject();
        if (project == null) return;
        ToolWindow tw = ToolWindowManager.getInstance(project)
                .getToolWindow(SessionsWorkbenchToolWindowFactory.TOOL_WINDOW_ID);
        if (tw != null) tw.activate(null, true, true);
    }
}
