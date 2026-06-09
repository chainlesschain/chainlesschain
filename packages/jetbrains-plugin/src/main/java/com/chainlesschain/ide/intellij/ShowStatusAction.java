package com.chainlesschain.ide.intellij;

import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import org.jetbrains.annotations.NotNull;

/** Tools-menu action reporting the bridge's current status. SDK-bound. */
public final class ShowStatusAction extends AnAction {
    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        Project project = e.getProject();
        if (project == null) return;
        IdeBridgeService svc = IdeBridgeService.getInstance(project);
        String msg = (svc != null && svc.getPort() > 0)
                ? "ChainlessChain IDE bridge running on 127.0.0.1:" + svc.getPort() + " (server \"ide\")."
                : "ChainlessChain IDE bridge is stopped.";
        Messages.showInfoMessage(project, msg, "ChainlessChain IDE Bridge");
    }
}
