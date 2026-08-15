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
import javax.swing.JComboBox;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import javax.swing.JTextField;
import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Font;
import java.io.File;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Permissions and Policy viewer (Tools menu, gap #10) — monospace
 * dialog over the cc policy/effect surfaces ({@code permissions list --json},
 * {@code permissions recent --json}, {@code auto-mode config --json},
 * {@code auto-mode defaults}, and {@code permissions activity --json}),
 * gathered sequentially off-EDT and rendered by
 * the pure {@link PolicyViewer} core (summary line + grouped rules with
 * source/managed badges + recent denials + risk→decision matrix +
 * fine-grained rules + precedence chain). Same dialog shape as
 * {@link ShowUsageAction}, plus refresh and CLI-authoritative scoped-rule
 * create/revoke controls. The IDE never edits the authority file directly.
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
        final JButton createBtn = new JButton(CcBundle.message("policy.scoped.create"));
        final JButton revokeBtn = new JButton(CcBundle.message("policy.scoped.revoke"));
        final JComboBox<String> decision = new JComboBox<String>(
                new String[] {"allow", "ask", "deny"});
        final JTextField rule = new JTextField("Read(./src/**)", 22);
        final JTextField ttl = new JTextField("15m", 5);
        final JTextField reason = new JTextField("", 14);
        final JTextField revokeId = new JTextField("", 34);
        final JTextField revokeRevision = new JTextField("1", 3);
        final JLabel mutationStatus = new JLabel(" ");
        final AtomicLong scopedGeneration = new AtomicLong(-1L);
        createBtn.setEnabled(false);
        final Runnable gather = () -> {
            refreshBtn.setEnabled(false);
            final String sessionId = ChatToolWindowFactory.activeSessionIdFor(project);
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                PolicyViewer.PermissionsSection perm = PolicyViewer.parsePermissions(
                        run(PolicyViewer.buildPermissionsListArgs(), cwd));
                List<PolicyViewer.Denial> denials = PolicyViewer.parseDenials(
                        run(PolicyViewer.buildRecentDenialsArgs(DENIAL_LIMIT), cwd));
                PolicyViewer.SideEffectSection sideEffects =
                        PolicyViewer.parseSideEffects(run(
                                PolicyViewer.buildPermissionActivityArgs(
                                        sessionId, DENIAL_LIMIT), cwd));
                PolicyViewer.AutoModeSection auto = PolicyViewer.parseAutoMode(
                        run(PolicyViewer.buildAutoModeConfigArgs(), cwd));
                List<String> precedence = PolicyViewer.parsePrecedence(
                        run(PolicyViewer.buildAutoModeDefaultsArgs(), cwd));
                long now = System.currentTimeMillis();
                final String text = PolicyViewer.summaryLine(
                        perm, denials, sideEffects, auto)
                        + "\n\n"
                        + PolicyViewer.describe(
                                perm, denials, sideEffects, auto, precedence, now);
                ApplicationManager.getApplication().invokeLater(() -> {
                    area.setText(text);
                    area.setCaretPosition(0);
                    scopedGeneration.set(perm == null ? -1L : perm.scopedGeneration);
                    createBtn.setEnabled(perm != null);
                    refreshBtn.setEnabled(true);
                });
            });
        };
        refreshBtn.addActionListener(ev -> gather.run());
        createBtn.addActionListener(ev -> {
            final List<String> args;
            try {
                args = PolicyViewer.buildScopedPermissionCreateArgs(
                        String.valueOf(decision.getSelectedItem()), rule.getText(),
                        ttl.getText(), reason.getText(), scopedGeneration.get());
            } catch (IllegalArgumentException invalid) {
                mutationStatus.setText(invalid.getMessage());
                return;
            }
            createBtn.setEnabled(false);
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                String output = run(args, cwd);
                ApplicationManager.getApplication().invokeLater(() -> {
                    mutationStatus.setText(output == null || output.trim().isEmpty()
                            ? CcBundle.message("policy.scoped.failed")
                            : CcBundle.message("policy.scoped.created"));
                    gather.run();
                });
            });
        });
        revokeBtn.addActionListener(ev -> {
            final List<String> args;
            try {
                args = PolicyViewer.buildScopedPermissionRevokeArgs(
                        revokeId.getText(), Long.parseLong(revokeRevision.getText()));
            } catch (IllegalArgumentException invalid) {
                mutationStatus.setText(CcBundle.message("policy.scoped.invalid"));
                return;
            }
            revokeBtn.setEnabled(false);
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                String output = run(args, cwd);
                ApplicationManager.getApplication().invokeLater(() -> {
                    mutationStatus.setText(output == null || output.trim().isEmpty()
                            ? CcBundle.message("policy.scoped.failed")
                            : CcBundle.message("policy.scoped.revoked"));
                    revokeBtn.setEnabled(true);
                    gather.run();
                });
            });
        });

        JPanel buttons = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
        buttons.add(refreshBtn);
        buttons.add(new JLabel(CcBundle.message("policy.scoped.decision")));
        buttons.add(decision);
        buttons.add(rule);
        buttons.add(ttl);
        buttons.add(reason);
        buttons.add(createBtn);

        JPanel revocation = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
        revocation.add(new JLabel(CcBundle.message("policy.scoped.revoke")));
        revocation.add(revokeId);
        revocation.add(revokeRevision);
        revocation.add(revokeBtn);
        revocation.add(mutationStatus);

        JPanel controls = new JPanel(new BorderLayout(0, 4));
        controls.add(buttons, BorderLayout.NORTH);
        controls.add(revocation, BorderLayout.SOUTH);

        JPanel root = new JPanel(new BorderLayout(8, 8));
        root.add(controls, BorderLayout.NORTH);
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
