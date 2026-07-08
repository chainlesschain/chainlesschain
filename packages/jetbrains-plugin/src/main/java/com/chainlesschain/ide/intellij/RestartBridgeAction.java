package com.chainlesschain.ide.intellij;

import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.Project;
import org.jetbrains.annotations.NotNull;

import javax.swing.SwingUtilities;

/**
 * Tools-menu "Restart Bridge": tear down + re-listen the IDE-bridge MCP server
 * and rewrite its discovery lockfile (VS Code's chainlesschain.ide.restart
 * parity). {@link IdeBridgeService#restart()} existed but was only reachable
 * indirectly (LLM reconfigure) — this exposes it for when the bridge got into
 * a bad state (port conflict, stale lockfile, agent can't connect). The
 * stop/start does socket work — run it off the EDT; report the result back on it.
 */
public final class RestartBridgeAction extends AnAction {

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        final Project project = e.getProject();
        if (project == null) return;
        final IdeBridgeService svc = IdeBridgeService.getInstance(project);
        if (svc == null) return;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            svc.restart();
            final int port = svc.getPort();
            SwingUtilities.invokeLater(() -> com.intellij.openapi.ui.Messages.showInfoMessage(
                    project,
                    port > 0
                            ? "ChainlessChain IDE bridge restarted on 127.0.0.1:" + port
                                    + " (server \"ide\")。已在跑的 cc agent 需重启才会重连。"
                            : "ChainlessChain IDE bridge 重启失败 — 详见 IDE 日志(Help → Show Log)。",
                    "ChainlessChain IDE Bridge"));
        });
    }
}
