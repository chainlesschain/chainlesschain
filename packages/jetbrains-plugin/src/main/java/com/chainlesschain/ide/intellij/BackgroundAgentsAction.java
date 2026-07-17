package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.BackgroundAgents;
import com.chainlesschain.ide.BackgroundSessionPipeClient;
import com.chainlesschain.ide.MiniJson;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.ui.DialogBuilder;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.project.Project;
import org.jetbrains.annotations.NotNull;

import javax.swing.DefaultComboBoxModel;
import javax.swing.JButton;
import javax.swing.JComboBox;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Font;
import java.util.List;
import java.util.Map;

/**
 * Background Agents panel (Tools menu): list `cc agent --bg` supervisor
 * sessions from the state dir, inspect one (details + log tail), send a
 * follow-up prompt / stop the current turn over the session transport
 * (one-shot pipe connections — same NDJSON protocol `cc attach` speaks),
 * and stop / rename / resume via `cc daemon … --json`. Dialog-form parity
 * with VS Code's chainlesschain.background.agents webview (which holds a
 * live attachment; here every action is a short-lived connection and the
 * Refresh button re-reads state + log). Pure cores: {@link BackgroundAgents}
 * + {@link BackgroundSessionPipeClient}.
 */
public final class BackgroundAgentsAction extends AnAction {

    private static final long PIPE_TIMEOUT_MS = 5000;
    private static final long CLI_TIMEOUT_MS = 15000;
    private static final int LOG_LINES = 120;

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        Project project = e.getProject();

        JComboBox<String> picker = new JComboBox<>();
        JTextArea detail = new JTextArea(24, 96);
        detail.setEditable(false);
        detail.setFont(new Font(Font.MONOSPACED, Font.PLAIN, detail.getFont().getSize()));
        JScrollPane scroll = new JScrollPane(detail);
        scroll.setPreferredSize(new Dimension(860, 460));

        final java.util.concurrent.atomic.AtomicReference<List<BackgroundAgents.Session>> sessions =
                new java.util.concurrent.atomic.AtomicReference<>(List.of());
        // Guards the picker's ActionListener while refresh() swaps the model +
        // selection programmatically — otherwise that fires the listener and
        // re-tails the same log the refresh just rendered (a second file read).
        final java.util.concurrent.atomic.AtomicBoolean syncing =
                new java.util.concurrent.atomic.AtomicBoolean(false);

        // State listing + formatDetail (which tails the log file) are file I/O —
        // gathered on a pooled thread, rendered on the EDT (the old inline run
        // froze the dialog for as long as the state dir / log read took).
        Runnable refresh = () -> {
            final int keep = picker.getSelectedIndex();
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                long now = System.currentTimeMillis();
                List<BackgroundAgents.Session> list =
                        BackgroundAgents.list(BackgroundAgents.defaultDir(), now);
                DefaultComboBoxModel<String> model = new DefaultComboBoxModel<>();
                for (BackgroundAgents.Session s : list) {
                    model.addElement(BackgroundAgents.formatRow(s, now));
                }
                int selIdx = keep >= 0 && keep < list.size() ? keep : (list.isEmpty() ? -1 : 0);
                final String detailText = selIdx < 0
                        ? null
                        : BackgroundAgents.formatDetail(list.get(selIdx), now, LOG_LINES);
                final int idx = selIdx;
                ApplicationManager.getApplication().invokeLater(() -> {
                    sessions.set(list);
                    syncing.set(true);
                    try {
                        picker.setModel(model);
                        if (idx >= 0) picker.setSelectedIndex(idx);
                    } finally {
                        syncing.set(false);
                    }
                    detail.setText(detailText == null
                            ? CcBundle.message("bg.agents.empty") : detailText);
                    detail.setCaretPosition(detail.getDocument().getLength());
                });
            });
        };

        picker.addActionListener(ev -> {
            if (syncing.get()) return; // programmatic refresh already rendered detail
            final BackgroundAgents.Session sel = selected(sessions.get(), picker);
            if (sel == null) return;
            // formatDetail tails the log file — off the EDT, render when done
            // (skipped if the user has already moved to another row).
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                final String text =
                        BackgroundAgents.formatDetail(sel, System.currentTimeMillis(), LOG_LINES);
                ApplicationManager.getApplication().invokeLater(() -> {
                    if (selected(sessions.get(), picker) == sel) {
                        detail.setText(text);
                        detail.setCaretPosition(detail.getDocument().getLength());
                    }
                });
            });
        });

        JButton refreshBtn = new JButton(CcBundle.message("bg.agents.refresh"));
        refreshBtn.addActionListener(ev -> refresh.run());
        JButton promptBtn = new JButton(CcBundle.message("bg.agents.prompt"));
        promptBtn.addActionListener(ev -> {
            BackgroundAgents.Session sel = selected(sessions.get(), picker);
            if (sel == null) return;
            if (!sel.interactive) {
                detail.setText(CcBundle.message("bg.agents.notInteractive", sel.id));
                return;
            }
            String text = Messages.showInputDialog(project,
                    CcBundle.message("bg.agents.prompt.ask"),
                    CcBundle.message("bg.agents.prompt"), null);
            if (text == null || text.trim().isEmpty()) return;
            Map<String, Object> msg = MiniJson.obj();
            msg.put("type", "prompt");
            msg.put("text", text.trim());
            pipeAction(sel, msg, detail, refresh);
        });
        JButton stopTurnBtn = new JButton(CcBundle.message("bg.agents.stopTurn"));
        stopTurnBtn.addActionListener(ev -> {
            BackgroundAgents.Session sel = selected(sessions.get(), picker);
            if (sel == null || !sel.interactive) return;
            Map<String, Object> msg = MiniJson.obj();
            msg.put("type", "stop");
            pipeAction(sel, msg, detail, refresh);
        });
        JButton stopBtn = new JButton(CcBundle.message("bg.agents.stop"));
        stopBtn.addActionListener(ev -> {
            BackgroundAgents.Session sel = selected(sessions.get(), picker);
            if (sel == null) return;
            cliAction(List.of("daemon", "stop", sel.id, "--json"), detail, refresh);
        });
        JButton renameBtn = new JButton(CcBundle.message("bg.agents.rename"));
        renameBtn.addActionListener(ev -> {
            BackgroundAgents.Session sel = selected(sessions.get(), picker);
            if (sel == null) return;
            String title = Messages.showInputDialog(project,
                    CcBundle.message("bg.agents.rename.ask"),
                    CcBundle.message("bg.agents.rename"), null, sel.title, null);
            if (title == null || title.trim().isEmpty()) return;
            cliAction(List.of("daemon", "rename", sel.id, title.trim(), "--json"), detail, refresh);
        });
        JButton resumeBtn = new JButton(CcBundle.message("bg.agents.resume"));
        resumeBtn.addActionListener(ev -> {
            BackgroundAgents.Session sel = selected(sessions.get(), picker);
            if (sel == null || sel.sessionId == null) return;
            // A running session normally can't be resumed — EXCEPT when it is
            // blocked on a human (waiting_permission / needs_input / pending
            // approvals): that one needs the affordance to get unblocked.
            if ("running".equals(sel.status)
                    && !BackgroundAgents.needsAttention(sel.phase, sel.pendingApprovals)) {
                return;
            }
            String text = Messages.showInputDialog(project,
                    CcBundle.message("bg.agents.resume.ask"),
                    CcBundle.message("bg.agents.resume"), null);
            if (text == null || text.trim().isEmpty()) return;
            cliAction(List.of("daemon", "resume", sel.id, text.trim(), "--json"), detail, refresh);
        });

        JPanel buttons = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
        buttons.add(refreshBtn);
        buttons.add(promptBtn);
        buttons.add(stopTurnBtn);
        buttons.add(stopBtn);
        buttons.add(renameBtn);
        buttons.add(resumeBtn);

        JPanel top = new JPanel(new BorderLayout(6, 6));
        top.add(picker, BorderLayout.CENTER);
        top.add(buttons, BorderLayout.SOUTH);

        JPanel root = new JPanel(new BorderLayout(8, 8));
        root.add(top, BorderLayout.NORTH);
        root.add(scroll, BorderLayout.CENTER);

        refresh.run();

        DialogBuilder builder = new DialogBuilder(project);
        builder.setTitle(CcBundle.message("bg.agents.title"));
        builder.setCenterPanel(root);
        builder.addCloseButton();
        builder.show();
    }

    private static BackgroundAgents.Session selected(
            List<BackgroundAgents.Session> sessions, JComboBox<String> picker) {
        int i = picker.getSelectedIndex();
        return i >= 0 && i < sessions.size() ? sessions.get(i) : null;
    }

    /** One-shot transport action off-EDT, then re-render on the EDT. */
    private static void pipeAction(BackgroundAgents.Session sel, Map<String, Object> msg,
                                   JTextArea detail, Runnable refresh) {
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            String line;
            try {
                Map<String, Object> reply = BackgroundSessionPipeClient.sendOneShot(
                        sel.pipePath, sel.token, msg, PIPE_TIMEOUT_MS);
                line = "→ " + MiniJson.stringify(reply);
            } catch (Exception ex) {
                line = "✕ " + ex.getMessage();
            }
            final String out = line;
            ApplicationManager.getApplication().invokeLater(() -> {
                refresh.run();
                detail.append("\n" + out);
                detail.setCaretPosition(detail.getDocument().getLength());
            });
        });
    }

    /** `cc daemon …` off-EDT, then re-render on the EDT. */
    private static void cliAction(List<String> args, JTextArea detail, Runnable refresh) {
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            String out = AgentChatSession.runCapture(args, null, CLI_TIMEOUT_MS);
            final String line = out == null || out.isEmpty() ? "✕ cc " + String.join(" ", args)
                    : "→ " + out.trim();
            ApplicationManager.getApplication().invokeLater(() -> {
                refresh.run();
                detail.append("\n" + line);
                detail.setCaretPosition(detail.getDocument().getLength());
            });
        });
    }
}
