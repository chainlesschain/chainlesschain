package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.EvolutionWorkbench;
import com.chainlesschain.ide.EvolutionWorkbenchSession;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.application.ModalityState;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogBuilder;
import com.intellij.openapi.ui.Messages;
import com.intellij.ui.components.JBScrollPane;
import com.intellij.ui.table.JBTable;
import org.jetbrains.annotations.NotNull;

import javax.swing.JButton;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JTextArea;
import javax.swing.ListSelectionModel;
import javax.swing.table.AbstractTableModel;
import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Font;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/**
 * Governed Evolution Workbench reviewer surface. Every read and mutation goes
 * through a fixed {@code cc evolution workbench} command. The CLI deployment
 * host retains the projection, resolves the human identity, signs decisions,
 * performs active-state readback, and owns all durable writers.
 */
public final class EvolutionWorkbenchAction extends AnAction implements DumbAware {
    private static final long CLI_TIMEOUT_MS = 30_000;
    private static final long SNAPSHOT_TIMEOUT_MS = 45_000;

    @Override
    public void actionPerformed(@NotNull AnActionEvent event) {
        Project project = event.getProject();
        File cwd = project != null && project.getBasePath() != null
                ? new File(project.getBasePath()) : null;
        Model model = new Model();
        JBTable table = new JBTable(model);
        table.setSelectionMode(ListSelectionModel.MULTIPLE_INTERVAL_SELECTION);
        JLabel status = new JLabel(" ");
        JButton refresh = new JButton("Refresh");
        JButton details = new JButton("Evidence / Diff");
        JButton compare = new JButton("Compare selected");
        JButton approve = new JButton("Approve…");
        JButton reject = new JButton("Reject…");
        JButton rollback = new JButton("Rollback to selected…");
        EvolutionWorkbench.Projection[] projection = new EvolutionWorkbench.Projection[] {null};
        EvolutionWorkbenchSession session = new EvolutionWorkbenchSession();

        Runnable syncButtons = () -> {
            List<EvolutionWorkbench.Candidate> selected = selected(table, model);
            EvolutionWorkbench.Candidate one = selected.size() == 1 ? selected.get(0) : null;
            boolean available = session.canBegin();
            refresh.setEnabled(available);
            details.setEnabled(available && one != null);
            compare.setEnabled(available && selected.size() == 2);
            approve.setEnabled(available && one != null && "pending".equals(one.status));
            reject.setEnabled(available && one != null && "pending".equals(one.status));
            rollback.setEnabled(available && one != null && !one.active && one.humanApproved
                    && "approved".equals(one.status)
                    && projection[0] != null && projection[0].activeCandidate() != null);
        };

        Consumer<String> loadSnapshot = notice -> {
            long operation = session.begin();
            if (operation == 0) return;
            projection[0] = null;
            model.setRows(List.of());
            syncButtons.run();
            status.setText("Loading verified projection from the CLI…");
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                long deadline = System.nanoTime()
                        + TimeUnit.MILLISECONDS.toNanos(SNAPSHOT_TIMEOUT_MS);
                EvolutionWorkbench.Projection parsed = EvolutionWorkbench.loadProjection(args -> {
                    long remaining = TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime());
                    if (remaining <= 0 || !session.isCurrent(operation)) return null;
                    String raw = run(args, cwd, Math.min(CLI_TIMEOUT_MS, remaining));
                    return System.nanoTime() < deadline && session.isCurrent(operation) ? raw : null;
                });
                // This callback only updates Swing state. It must run while the
                // modal Workbench is open, including its initial background read.
                ApplicationManager.getApplication().invokeLater(() -> {
                    if (!session.finish(operation)) return;
                    projection[0] = parsed;
                    model.setRows(parsed == null ? List.of() : parsed.candidates);
                    String summary = parsed == null
                            ? "Evolution Workbench unavailable, timed out, or changed while reading. Refresh to retry."
                            : parsed.total
                                    + " verified version(s)"
                                    + " · "
                                    + EvolutionWorkbench.shortDigest(parsed.projectionDigest)
                                    + " | "
                                    + EvolutionWorkbench.describeGovernance(parsed.governance);
                    status.setText(notice == null ? summary : notice + " | " + summary);
                    syncButtons.run();
                }, ModalityState.any());
            });
        };
        Runnable load = () -> loadSnapshot.accept(null);

        table.getSelectionModel().addListSelectionListener(ignored -> syncButtons.run());
        refresh.addActionListener(ignored -> load.run());
        details.addActionListener(ignored -> {
            List<EvolutionWorkbench.Candidate> selected = selected(table, model);
            if (selected.size() == 1) {
                showText(project, "Evolution evidence and diff",
                        EvolutionWorkbench.describe(selected.get(0)));
            }
        });
        compare.addActionListener(ignored -> {
            List<EvolutionWorkbench.Candidate> selected = selected(table, model);
            EvolutionWorkbench.Projection current = projection[0];
            if (current == null || selected.size() != 2) return;
            List<String> args;
            try {
                args = EvolutionWorkbench.buildCompareArgs(
                        current, selected.get(0), selected.get(1));
            } catch (IllegalArgumentException invalid) {
                status.setText(invalid.getMessage());
                return;
            }
            long operation = session.begin();
            if (operation == 0) return;
            syncButtons.run();
            status.setText("Comparing exact packet digests…");
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                String raw = run(args, cwd);
                String text = EvolutionWorkbench.formatComparison(
                        raw, current, selected.get(0), selected.get(1));
                ApplicationManager.getApplication().invokeLater(() -> {
                    if (!session.finish(operation)) return;
                    if (text == null) {
                        status.setText("Comparison failed validation or the CLI rejected it.");
                    } else {
                        showText(project, "Evolution version comparison", text);
                        status.setText("Comparison verified by exact projection and packet digests.");
                    }
                    syncButtons.run();
                }, ModalityState.any());
            });
        });

        Consumer<String> decide = decision -> {
            long operation = session.begin();
            if (operation == 0) return;
            syncButtons.run();
            boolean dispatched = false;
            try {
                List<String> args = "rollback".equals(decision)
                        ? confirmRollback(project, projection[0], selectedOne(table, model), status)
                        : confirmReview(project, projection[0], selectedOne(table, model), decision, status);
                if (args != null && session.isCurrent(operation)) {
                    mutate(args, cwd, status, loadSnapshot, session, operation);
                    dispatched = true;
                }
            } finally {
                if (!dispatched && session.finish(operation)) syncButtons.run();
            }
        };
        approve.addActionListener(ignored -> decide.accept("approve"));
        reject.addActionListener(ignored -> decide.accept("reject"));
        rollback.addActionListener(ignored -> decide.accept("rollback"));

        JPanel buttons = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
        buttons.add(refresh);
        buttons.add(details);
        buttons.add(compare);
        buttons.add(approve);
        buttons.add(reject);
        buttons.add(rollback);

        JBScrollPane scroll = new JBScrollPane(table);
        scroll.setPreferredSize(new Dimension(980, 460));
        JPanel root = new JPanel(new BorderLayout(8, 8));
        root.add(buttons, BorderLayout.NORTH);
        root.add(scroll, BorderLayout.CENTER);
        root.add(status, BorderLayout.SOUTH);

        syncButtons.run();
        load.run();
        DialogBuilder builder = new DialogBuilder(project);
        builder.setTitle("ChainlessChain — Evolution Workbench");
        builder.setCenterPanel(root);
        builder.addCloseButton();
        try {
            builder.show();
        } finally {
            session.close();
        }
    }

    private static List<String> confirmReview(Project project,
            EvolutionWorkbench.Projection projection,
            EvolutionWorkbench.Candidate candidate, String decision,
            JLabel status) {
        if (projection == null || candidate == null) return null;
        String reason = Messages.showInputDialog(project,
                "Enter the human reason for this " + decision + " decision:",
                "Evolution Workbench review", Messages.getQuestionIcon());
        if (reason == null) return null;
        List<String> args;
        try {
            args = EvolutionWorkbench.buildReviewArgs(
                    projection, candidate, decision, reason);
        } catch (IllegalArgumentException invalid) {
            status.setText(invalid.getMessage());
            return null;
        }
        int confirmed = Messages.showYesNoDialog(project,
                capitalize(decision) + " exact packet\n" + candidate.packetDigest
                        + "\n\nThe CLI will resolve and persist the authenticated human identity.",
                "Confirm governed review", Messages.getWarningIcon());
        return confirmed == Messages.YES ? args : null;
    }

    private static List<String> confirmRollback(Project project,
            EvolutionWorkbench.Projection projection,
            EvolutionWorkbench.Candidate target, JLabel status) {
        if (projection == null || target == null) return null;
        String reason = Messages.showInputDialog(project,
                "Enter the human reason for this rollback:",
                "Evolution Workbench rollback", Messages.getQuestionIcon());
        if (reason == null) return null;
        List<String> args;
        try {
            args = EvolutionWorkbench.buildRollbackArgs(projection, target, reason);
        } catch (IllegalArgumentException invalid) {
            status.setText(invalid.getMessage());
            return null;
        }
        EvolutionWorkbench.Candidate active = projection.activeCandidate();
        int confirmed = Messages.showYesNoDialog(project,
                "Rollback exact active packet\n" + active.packetDigest
                        + "\nto approved packet\n" + target.packetDigest
                        + "\n\nThe CLI will re-read active state before committing.",
                "Confirm governed rollback", Messages.getWarningIcon());
        return confirmed == Messages.YES ? args : null;
    }

    private static void mutate(
            List<String> args, File cwd, JLabel status, Consumer<String> reload,
            EvolutionWorkbenchSession session, long operation) {
        status.setText("Waiting for durable CLI authority…");
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            String planDigest = EvolutionWorkbench.parseMutationPlanDigest(run(args, cwd));
            ApplicationManager.getApplication().invokeLater(() -> {
                if (!session.finish(operation)) return;
                // A lost response does not prove rejection. Read current state without
                // replaying the mutation, and retain the warning after refresh.
                reload.accept(planDigest == null
                        ? "Result not confirmed. Check the refreshed state before retrying."
                        : "Durably settled: " + EvolutionWorkbench.shortDigest(planDigest));
            }, ModalityState.any());
        });
    }

    private static void showText(Project project, String title, String content) {
        JTextArea area = new JTextArea(content == null ? "" : content, 30, 110);
        area.setEditable(false);
        area.setLineWrap(false);
        area.setFont(new Font(Font.MONOSPACED, Font.PLAIN, area.getFont().getSize()));
        JBScrollPane scroll = new JBScrollPane(area);
        scroll.setPreferredSize(new Dimension(900, 540));
        DialogBuilder builder = new DialogBuilder(project);
        builder.setTitle(title);
        builder.setCenterPanel(scroll);
        builder.addCloseButton();
        builder.show();
    }

    private static String run(List<String> args, File cwd) {
        return run(args, cwd, CLI_TIMEOUT_MS);
    }

    private static String run(List<String> args, File cwd, long timeoutMs) {
        try {
            return AgentChatSession.runCapture(args, cwd, timeoutMs);
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static EvolutionWorkbench.Candidate selectedOne(JBTable table, Model model) {
        List<EvolutionWorkbench.Candidate> selected = selected(table, model);
        return selected.size() == 1 ? selected.get(0) : null;
    }

    private static List<EvolutionWorkbench.Candidate> selected(JBTable table, Model model) {
        ArrayList<EvolutionWorkbench.Candidate> result = new ArrayList<>();
        for (int viewIndex : table.getSelectedRows()) {
            int index = table.convertRowIndexToModel(viewIndex);
            if (index >= 0 && index < model.rows.size()) result.add(model.rows.get(index));
        }
        return result;
    }

    private static String capitalize(String value) {
        return value == null || value.isEmpty()
                ? "" : Character.toUpperCase(value.charAt(0)) + value.substring(1);
    }

    private static final class Model extends AbstractTableModel {
        private static final String[] COLUMNS = {
                "Candidate", "Status", "Active", "Receipts", "Completed",
                "Failed / blocked", "Cost"
        };
        private List<EvolutionWorkbench.Candidate> rows = List.of();

        void setRows(List<EvolutionWorkbench.Candidate> value) {
            rows = value == null ? List.of() : List.copyOf(value);
            fireTableDataChanged();
        }

        @Override public int getRowCount() { return rows.size(); }
        @Override public int getColumnCount() { return COLUMNS.length; }
        @Override public String getColumnName(int column) { return COLUMNS[column]; }

        @Override
        public Object getValueAt(int rowIndex, int columnIndex) {
            EvolutionWorkbench.Candidate row = rows.get(rowIndex);
            switch (columnIndex) {
                case 0: return row.candidateId;
                case 1: return row.status;
                case 2: return row.active ? "yes" : "";
                case 3: return row.receiptCount;
                case 4: return row.completed;
                case 5: return row.failedOrBlocked;
                case 6: return String.format(java.util.Locale.ROOT,
                        "$%.4f", row.totalCostUsd);
                default: return "";
            }
        }
    }
}
