package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.PolicyViewer;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogBuilder;
import org.jetbrains.annotations.NotNull;

import javax.swing.JButton;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Font;
import java.io.File;
import java.util.List;

/**
 * Permissions and Policy viewer (Tools menu, gap #10) — read-only monospace
 * dialog over the four cc policy surfaces ({@code permissions list --json},
 * {@code permissions recent --json}, {@code auto-mode config --json},
 * {@code auto-mode defaults}), gathered sequentially off-EDT and rendered by
 * the pure {@link PolicyViewer} core (summary line + grouped rules with
 * source/managed badges + recent denials + risk→decision matrix +
 * fine-grained rules + precedence chain). Same dialog shape as
 * {@link ShowUsageAction}, plus a Refresh button that re-gathers in place.
 * A failed/malformed source degrades to a warning entry — the other sections
 * still render.
 */
public final class PolicyViewerAction extends AnAction implements DumbAware {

    private static final long CLI_TIMEOUT_MS = 15_000;
    private static final int DENIAL_LIMIT = 50;

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        Project project = e.getProject();
        final File cwd = project != null && project.getBasePath() != null
                ? new File(project.getBasePath()) : null;

        final JTextArea area = new JTextArea(CcBundle.message("policy.loading"), 28, 110);
        area.setEditable(false);
        area.setFont(new Font(Font.MONOSPACED, Font.PLAIN, area.getFont().getSize()));
        JScrollPane scroll = new JScrollPane(area);
        scroll.setPreferredSize(new Dimension(920, 500));

        final JButton refreshBtn = new JButton(CcBundle.message("policy.refresh"));
        final Runnable gather = () -> {
            refreshBtn.setEnabled(false);
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                PolicyViewer.PermissionsSection perm = PolicyViewer.parsePermissions(
                        run(PolicyViewer.buildPermissionsListArgs(), cwd));
                List<PolicyViewer.Denial> denials = PolicyViewer.parseDenials(
                        run(PolicyViewer.buildRecentDenialsArgs(DENIAL_LIMIT), cwd));
                PolicyViewer.AutoModeSection auto = PolicyViewer.parseAutoMode(
                        run(PolicyViewer.buildAutoModeConfigArgs(), cwd));
                List<String> precedence = PolicyViewer.parsePrecedence(
                        run(PolicyViewer.buildAutoModeDefaultsArgs(), cwd));
                long now = System.currentTimeMillis();
                final String text = PolicyViewer.summaryLine(perm, denials, auto)
                        + "\n\n"
                        + PolicyViewer.describe(perm, denials, auto, precedence, now);
                ApplicationManager.getApplication().invokeLater(() -> {
                    area.setText(text);
                    area.setCaretPosition(0);
                    refreshBtn.setEnabled(true);
                });
            });
        };
        refreshBtn.addActionListener(ev -> gather.run());

        JPanel buttons = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
        buttons.add(refreshBtn);

        JPanel root = new JPanel(new BorderLayout(8, 8));
        root.add(buttons, BorderLayout.NORTH);
        root.add(scroll, BorderLayout.CENTER);

        gather.run();

        DialogBuilder b = new DialogBuilder(project);
        b.setTitle(CcBundle.message("policy.title"));
        b.setCenterPanel(root);
        b.addCloseButton();
        b.show();
    }

    /** One cc spawn (never on the EDT); null stdout stays null → warning entry. */
    private static String run(List<String> args, File cwd) {
        try {
            return AgentChatSession.runCapture(args, cwd, CLI_TIMEOUT_MS);
        } catch (Throwable t) {
            return null;
        }
    }
}
