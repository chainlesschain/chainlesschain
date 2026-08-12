package com.chainlesschain.ide.intellij;

import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowManager;
import org.jetbrains.annotations.NotNull;

/** Tools-menu entry for the Automation Center tool window. */
public final class AutomationCenterAction extends AnAction implements DumbAware {
    @Override
    public void actionPerformed(@NotNull AnActionEvent event) {
        Project project = event.getProject();
        if (project == null) return;
        ToolWindow window = ToolWindowManager.getInstance(project)
                .getToolWindow(AutomationCenterToolWindowFactory.TOOL_WINDOW_ID);
        if (window != null) window.show();
    }
}
