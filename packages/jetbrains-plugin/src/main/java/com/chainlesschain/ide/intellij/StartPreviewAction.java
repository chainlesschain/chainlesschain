package com.chainlesschain.ide.intellij;

import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import org.jetbrains.annotations.NotNull;

/** §2: start (or re-focus) the App Preview dev server. SDK-bound glue. */
public final class StartPreviewAction extends AnAction implements DumbAware {
    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        Project project = e.getProject();
        if (project == null) return;
        // start() reads package.json and spawns `npm run` (cmd.exe on Windows,
        // AV-scanned) — off the EDT so the IDE never freezes. Its UI touches are
        // individually EDT-safe (setStatus / revealToolWindow wrap invokeLater).
        ApplicationManager.getApplication().executeOnPooledThread(
                () -> PreviewService.getInstance(project).start());
    }
}
