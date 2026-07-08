package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.CliVersionCheck;
import com.chainlesschain.ide.WhatsNew;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogBuilder;
import com.intellij.openapi.ui.Messages;
import org.jetbrains.annotations.NotNull;

import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import javax.swing.SwingUtilities;
import java.awt.Dimension;
import java.awt.Font;
import java.io.File;
import java.util.List;

/**
 * Tools-menu "What's New": render the cc CLI's own release notes
 * ({@code cc changelog --json}, shipped offline with the npm package since
 * 0.162.151) in a scrollable dialog — VS Code 0.37.3 whats-new panel parity;
 * replaces relying on the static Marketplace change-notes for CLI news. CLI
 * captures run off the EDT; the dialog is shown back on it. SDK-bound glue —
 * the arg builder / parser / renderer are the pure {@link WhatsNew}.
 */
public final class ShowWhatsNewAction extends AnAction {

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        final Project project = e.getProject();
        if (project == null) return;
        final File cwd = project.getBasePath() != null
                ? new File(project.getBasePath()) : null;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            String versionOut = AgentChatSession.runCapture(
                    java.util.Collections.singletonList("--version"), cwd, 12000);
            final String installed = CliVersionCheck.parseVersion(versionOut);
            if (!WhatsNew.supportsChangelog(versionOut)) {
                SwingUtilities.invokeLater(() -> Messages.showInfoMessage(project,
                        CcBundle.message("whatsnew.needCli", WhatsNew.MIN_CHANGELOG_CLI,
                                installed != null
                                        ? CcBundle.message("whatsnew.installedNote", installed)
                                        : CcBundle.message("whatsnew.noCliNote"),
                                CliVersionCheck.UPGRADE_COMMAND),
                        CcBundle.message("whatsnew.dialogTitle")));
                return;
            }
            String out = AgentChatSession.runCapture(
                    WhatsNew.buildChangelogArgs(5), cwd, 15000);
            final List<WhatsNew.Release> releases = WhatsNew.parseChangelogJson(out);
            SwingUtilities.invokeLater(() -> {
                if (releases.isEmpty()) {
                    Messages.showInfoMessage(project,
                            CcBundle.message("whatsnew.noData"),
                            CcBundle.message("whatsnew.dialogTitle"));
                    return;
                }
                showDialog(project, WhatsNew.changelogToText(releases, installed));
            });
        });
    }

    /** Scrollable read-only text dialog (monospace keeps the markdown readable). */
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
        b.setTitle("cc CLI — What's New");
        b.setCenterPanel(scroll);
        b.addOkAction();
        b.show();
    }
}
