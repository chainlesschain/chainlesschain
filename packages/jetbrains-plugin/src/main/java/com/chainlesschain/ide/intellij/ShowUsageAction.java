package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.SessionList;
import com.chainlesschain.ide.UsageReport;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogBuilder;
import com.intellij.openapi.ui.Messages;
import org.jetbrains.annotations.NotNull;

import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import java.awt.Dimension;
import java.awt.Font;
import java.io.File;
import java.util.List;
import java.util.Map;

/**
 * Token usage report (Tools menu, P1 #6 用量 UI) — joins
 * {@code cc session usage --json} with {@code cc session list --json} off-EDT
 * and shows the {@link UsageReport} text in a monospace dialog. VS Code twin:
 * {@code chainlesschain.usage.show} (markdown preview there).
 */
public final class ShowUsageAction extends AnAction {

    private static final long CLI_TIMEOUT_MS = 30000;
    private static final int LIMIT = 1000;

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        Project project = e.getProject();
        final File cwd = project != null && project.getBasePath() != null
                ? new File(project.getBasePath()) : null;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            String usageOut = AgentChatSession.runCapture(
                    UsageReport.buildUsageArgs(LIMIT), cwd, CLI_TIMEOUT_MS);
            String listOut = AgentChatSession.runCapture(
                    UsageReport.buildSessionListArgs(LIMIT), cwd, CLI_TIMEOUT_MS);
            Map<String, Object> usage = UsageReport.parseUsageJson(usageOut);
            List<SessionList.SessionItem> sessions =
                    SessionList.parseSessionList(listOut);
            final String report =
                    UsageReport.render(usage, sessions, System.currentTimeMillis());
            ApplicationManager.getApplication().invokeLater(() -> {
                if (report == null) {
                    Messages.showInfoMessage(project,
                            "Could not read token usage — is the cc CLI installed"
                                    + " and on PATH?",
                            "Token Usage");
                    return;
                }
                JTextArea area = new JTextArea(report, 28, 100);
                area.setEditable(false);
                area.setFont(new Font(Font.MONOSPACED, Font.PLAIN,
                        area.getFont().getSize()));
                JScrollPane scroll = new JScrollPane(area);
                scroll.setPreferredSize(new Dimension(880, 480));
                DialogBuilder b = new DialogBuilder(project);
                b.setTitle("ChainlessChain — Token Usage");
                b.setCenterPanel(scroll);
                b.addOkAction().setText("Close");
                b.show();
            });
        });
    }
}
