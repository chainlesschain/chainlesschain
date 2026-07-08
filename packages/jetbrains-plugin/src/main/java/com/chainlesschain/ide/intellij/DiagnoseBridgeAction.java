package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.IdeDoctor;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogBuilder;
import org.jetbrains.annotations.NotNull;

import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import javax.swing.SwingUtilities;
import java.awt.Dimension;
import java.awt.Font;
import java.io.File;

/**
 * Tools-menu "Diagnose Bridge": this project's bridge state + the CLI's own
 * discovery view ({@code cc ide status} / {@code doctor} / {@code jetbrains})
 * in one scrollable report — when a terminal {@code cc agent} won't
 * auto-connect, the WHY lives on the CLI side (VS Code
 * chainlesschain.ide.doctor parity, plus the IDEA-only built-in-MCP probe).
 * The three CLI captures run off the EDT; the dialog is shown back on it.
 */
public final class DiagnoseBridgeAction extends AnAction {

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        final Project project = e.getProject();
        if (project == null) return;
        final IdeBridgeService svc = IdeBridgeService.getInstance(project);
        final int port = svc != null ? svc.getPort() : -1;
        final File cwd = project.getBasePath() != null
                ? new File(project.getBasePath()) : null;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            String status = AgentChatSession.runCapture(IdeDoctor.buildStatusArgs(), cwd, 15000);
            String doctor = AgentChatSession.runCapture(IdeDoctor.buildDoctorArgs(), cwd, 15000);
            String jb = AgentChatSession.runCapture(IdeDoctor.buildJetbrainsArgs(), cwd, 15000);
            final String report = IdeDoctor.formatReport(port, status, doctor, jb);
            SwingUtilities.invokeLater(() -> showDialog(project, report));
        });
    }

    /** Scrollable read-only text dialog (monospace keeps the columns aligned). */
    private static void showDialog(Project project, String text) {
        JTextArea area = new JTextArea(text);
        area.setEditable(false);
        area.setLineWrap(true);
        area.setWrapStyleWord(true);
        area.setFont(new Font(Font.MONOSPACED, Font.PLAIN, area.getFont().getSize()));
        area.setCaretPosition(0);
        JScrollPane scroll = new JScrollPane(area);
        scroll.setPreferredSize(new Dimension(640, 480));
        DialogBuilder b = new DialogBuilder(project);
        b.setTitle("ChainlessChain IDE Bridge — Diagnostics");
        b.setCenterPanel(scroll);
        b.addOkAction();
        b.show();
    }
}
