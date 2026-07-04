package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.ProjectMemory;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.progress.ProgressIndicator;
import com.intellij.openapi.progress.Task;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import org.jetbrains.annotations.NotNull;

import java.io.File;

/**
 * Tools-menu action: show the effective project-memory file chain via
 * {@code chainlesschain memory files} (VS Code "Show Project Memory Files"
 * parity). Captured off the EDT; result shows in a dialog.
 */
public final class ShowMemoryFilesAction extends AnAction {

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        Project project = e.getProject();
        if (project == null) return;
        final File cwd = project.getBasePath() != null ? new File(project.getBasePath()) : null;
        new Task.Backgroundable(project, "ChainlessChain: listing memory files", false) {
            private String out;

            @Override
            public void run(@NotNull ProgressIndicator indicator) {
                out = AgentChatSession.runCapture(ProjectMemory.buildMemoryFilesArgs(), cwd, 30_000);
            }

            @Override
            public void onFinished() {
                String text = out == null ? "" : out.trim();
                if (text.isEmpty()) {
                    Messages.showWarningDialog(project,
                            "chainlesschain memory files produced no output — is the cc CLI installed?",
                            "Project Memory Files");
                } else {
                    Messages.showInfoMessage(project, text, "Project Memory Files");
                }
            }
        }.queue();
    }
}
