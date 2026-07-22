package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.PrStatus;
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
import java.util.Map;

/** Read-only PR/CI status; merge and push remain CLI/approval controlled. */
public final class PrStatusAction extends AnAction {
    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        Project project = e.getProject();
        File cwd = project != null && project.getBasePath() != null
                ? new File(project.getBasePath()) : null;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            String raw = AgentChatSession.runCapture(PrStatus.buildArgs(), cwd, 30000);
            Map<String, Object> status = PrStatus.parse(raw);
            String report = PrStatus.render(status);
            ApplicationManager.getApplication().invokeLater(() -> {
                if (report == null) {
                    Messages.showWarningDialog(project,
                            "PR status unavailable — no linked PR, invalid JSON, or gh is not authenticated.\n\n"
                                    + (raw == null ? "" : raw),
                            "PR / CI Status");
                    return;
                }
                JTextArea area = new JTextArea(report, 24, 96);
                area.setEditable(false);
                area.setLineWrap(true);
                area.setWrapStyleWord(true);
                area.setFont(new Font(Font.MONOSPACED, Font.PLAIN, area.getFont().getSize()));
                JScrollPane scroll = new JScrollPane(area);
                scroll.setPreferredSize(new Dimension(860, 440));
                DialogBuilder dialog = new DialogBuilder(project);
                dialog.setTitle("ChainlessChain — PR / CI Status");
                dialog.setCenterPanel(scroll);
                dialog.addOkAction().setText("Close");
                dialog.show();
            });
        });
    }
}
