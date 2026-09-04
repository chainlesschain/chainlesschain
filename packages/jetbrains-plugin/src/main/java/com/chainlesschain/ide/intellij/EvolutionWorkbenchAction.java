package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.EvolutionWorkbench;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
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

/**
 * Governed Evolution Workbench reviewer surface. Every read and mutation goes
 * through a fixed {@code cc evolution workbench} command. The CLI deployment
 * host retains the projection, resolves the human identity, signs decisions,
 * performs active-state readback, and owns all durable writers.
 */
public final class EvolutionWorkbenchAction extends AnAction implements DumbAware {
    private static final long CLI_TIMEOUT_MS = 30_000;

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

        Runnable syncButtons = () -> {
            List<EvolutionWorkbench.Candidate> selected = selected(table, model);
            EvolutionWorkbench.Candidate one = selected.size() == 1 ? selected.get(0) : null;
            details.setEnabled(one != null);
            compare.setEnabled(selected.size() == 2);
            approve.setEnabled(one != null && "pending".equals(one.status));
            reject.setEnabled(one != null && "pending".equals(one.status));
            rollback.setEnabled(one != null && !one.active && one.humanApproved
                    && projection[0] != null && projection[0].activeCandidate() != null);
        };

        Runnable load = () -> {
            refresh.setEnabled(false);
            status.setText("Loading verified projection from the CLI…");
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                String raw = run(EvolutionWorkbench.buildListArgs(), cwd);
                EvolutionWorkbench.Projection parsed =
                        EvolutionWorkbench.parseProjection(raw);
                ApplicationManager.getApplication().invokeLater(() -> {
                    projection[0] = parsed;
                    model.setRows(parsed == null ? List.of() : parsed.candidates);
                    status.setText(parsed == null
                            ? "Evolution Workbench unavailable or projection validation failed."
                            : parsed.candidates.size() + " of " + parsed.total
                                    + " verified version(s)"
                                    + (parsed.hasMore ? " (bounded first page)" : "") + " · "
                                    + EvolutionWorkbench.shortDigest(parsed.projectionDigest)
                                    + " | "
                                    + EvolutionWorkbench.describeGovernance(parsed.governance));
                    refresh.setEnabled(true);
                    syncButtons.run();
                });
            });
        };

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
            compare.setEnabled(false);
            status.setText("Comparing exact packet digests…");
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                String raw = run(args, cwd);
                String text = EvolutionWorkbench.formatComparison(
                        raw, current, selected.get(0), selected.get(1));
                ApplicationManager.getApplication().invokeLater(() -> {
                    if (text == null) {
                        status.setText("Comparison failed validation or the CLI rejected it.");
                    } else {
                        showText(project, "Evolution version comparison", text);
                        status.setText("Comparison verified by exact projection and packet digests.");
                    }
                    syncButtons.run();
                });
            });
        });

        approve.addActionListener(ignored -> review(
                project, cwd, projection[0], selectedOne(table, model), "approve", status, load));
        reject.addActionListener(ignored -> review(
                project, cwd, projection[0], selectedOne(table, model), "reject", status, load));
        rollback.addActionListener(ignored -> rollback(
                project, cwd, projection[0], selectedOne(table, model), status, load));

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
        builder.show();
    }

    private static void review(Project project, File cwd,
            EvolutionWorkbench.Projection projection,
            EvolutionWorkbench.Candidate candidate, String decision,
            JLabel status, Runnable reload) {
        if (projection == null || candidate == null) return;
        String reason = Messages.showInputDialog(project,
                "Enter the human reason for this " + decision + " decision:",
                "Evolution Workbench review", Messages.getQuestionIcon());
        if (reason == null) return;
        List<String> args;
        try {
            args = EvolutionWorkbench.buildReviewArgs(
                    projection, candidate, decision, reason);
        } catch (IllegalArgumentException invalid) {
            status.setText(invalid.getMessage());
            return;
        }
        int confirmed = Messages.showYesNoDialog(project,
                capitalize(decision) + " exact packet\n" + candidate.packetDigest
                        + "\n\nThe CLI will resolve and persist the authenticated human identity.",
                "Confirm governed review", Messages.getWarningIcon());
        if (confirmed != Messages.YES) return;
        mutate(args, cwd, status, reload);
    }

    private static void rollback(Project project, File cwd,
            EvolutionWorkbench.Projection projection,
            EvolutionWorkbench.Candidate target, JLabel status, Runnable reload) {
        if (projection == null || target == null) return;
        String reason = Messages.showInputDialog(project,
                "Enter the human reason for this rollback:",
                "Evolution Workbench rollback", Messages.getQuestionIcon());
        if (reason == null) return;
        List<String> args;
        try {
            args = EvolutionWorkbench.buildRollbackArgs(projection, target, reason);
        } catch (IllegalArgumentException invalid) {
            status.setText(invalid.getMessage());
            return;
        }
        EvolutionWorkbench.Candidate active = projection.activeCandidate();
        int confirmed = Messages.showYesNoDialog(project,
                "Rollback exact active packet\n" + active.packetDigest
                        + "\nto approved packet\n" + target.packetDigest
                        + "\n\nThe CLI will re-read active state before committing.",
                "Confirm governed rollback", Messages.getWarningIcon());
        if (confirmed != Messages.YES) return;
        mutate(args, cwd, status, reload);
    }

    private static void mutate(
            List<String> args, File cwd, JLabel status, Runnable reload) {
        status.setText("Waiting for durable CLI authority…");
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            String planDigest = EvolutionWorkbench.parseMutationPlanDigest(run(args, cwd));
            ApplicationManager.getApplication().invokeLater(() -> {
                if (planDigest == null) {
                    status.setText("Mutation was rejected or lacked a valid durable plan receipt.");
                } else {
                    status.setText("Durably settled: "
                            + EvolutionWorkbench.shortDigest(planDigest));
                    reload.run();
                }
            });
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
        try {
            return AgentChatSession.runCapture(args, cwd, CLI_TIMEOUT_MS);
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
