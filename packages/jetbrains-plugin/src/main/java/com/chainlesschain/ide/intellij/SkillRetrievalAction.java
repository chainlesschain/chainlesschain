package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.SkillRetrieval;
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
import java.util.List;

/** Read-only canonical Skill retrieval surface backed by the CLI router. */
public final class SkillRetrievalAction extends AnAction implements DumbAware {
    private static final long CLI_TIMEOUT_MS = 30_000;

    @Override
    public void actionPerformed(@NotNull AnActionEvent event) {
        Project project = event.getProject();
        String query = Messages.showInputDialog(project,
                "Describe the capability you need:",
                "ChainlessChain — Search Skills", Messages.getQuestionIcon());
        if (query == null) return;
        List<String> args;
        try {
            args = SkillRetrieval.buildSearchArgs(query, 20);
        } catch (IllegalArgumentException invalid) {
            Messages.showErrorDialog(project, invalid.getMessage(), "Skill Retrieval");
            return;
        }
        File cwd = project != null && project.getBasePath() != null
                ? new File(project.getBasePath()) : null;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            String raw = run(args, cwd);
            SkillRetrieval.Result result = SkillRetrieval.parseResult(raw);
            ApplicationManager.getApplication().invokeLater(() -> show(project, result));
        });
    }

    private static void show(Project project, SkillRetrieval.Result result) {
        if (result == null) {
            Messages.showErrorDialog(project,
                    "The CLI failed or returned invalid canonical retrieval evidence.",
                    "Skill Retrieval");
            return;
        }
        if (result.candidates.isEmpty()) {
            Messages.showInfoMessage(project,
                    "No digest-bound Skills matched “" + result.query + "”.",
                    "Skill Retrieval");
            return;
        }
        Model model = new Model(result);
        JBTable table = new JBTable(model);
        table.setSelectionMode(ListSelectionModel.SINGLE_SELECTION);
        table.setRowSelectionInterval(0, 0);
        JLabel status = new JLabel(result.abstained()
                ? "Router abstained: narrow the query before execution."
                : result.candidates.size() + " verified candidate(s) · "
                        + result.rejectedCount + " rejected before recall");
        JButton inspect = new JButton("Inspect routing evidence");
        inspect.addActionListener(ignored -> {
            int view = table.getSelectedRow();
            if (view < 0) return;
            SkillRetrieval.Candidate selected = model.row(table.convertRowIndexToModel(view));
            showText(project, "Skill routing evidence",
                    SkillRetrieval.describe(result, selected));
        });
        JPanel actions = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
        actions.add(inspect);
        JPanel root = new JPanel(new BorderLayout(8, 8));
        JBScrollPane scroll = new JBScrollPane(table);
        scroll.setPreferredSize(new Dimension(900, 420));
        root.add(actions, BorderLayout.NORTH);
        root.add(scroll, BorderLayout.CENTER);
        root.add(status, BorderLayout.SOUTH);
        DialogBuilder builder = new DialogBuilder(project);
        builder.setTitle("ChainlessChain — Skill Retrieval (inspect only)");
        builder.setCenterPanel(root);
        builder.addCloseButton();
        builder.show();
    }

    private static void showText(Project project, String title, String content) {
        JTextArea area = new JTextArea(content, 24, 105);
        area.setEditable(false);
        area.setLineWrap(false);
        area.setFont(new Font(Font.MONOSPACED, Font.PLAIN, area.getFont().getSize()));
        JBScrollPane scroll = new JBScrollPane(area);
        scroll.setPreferredSize(new Dimension(860, 440));
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

    private static final class Model extends AbstractTableModel {
        private static final String[] COLUMNS = {
                "Selected", "Skill", "Version", "Namespace", "Score", "Digest"
        };
        private final SkillRetrieval.Result result;

        private Model(SkillRetrieval.Result result) {
            this.result = result;
        }

        SkillRetrieval.Candidate row(int index) {
            return result.candidates.get(index);
        }

        @Override public int getRowCount() { return result.candidates.size(); }
        @Override public int getColumnCount() { return COLUMNS.length; }
        @Override public String getColumnName(int column) { return COLUMNS[column]; }

        @Override
        public Object getValueAt(int rowIndex, int columnIndex) {
            SkillRetrieval.Candidate row = row(rowIndex);
            switch (columnIndex) {
                case 0: return row.digest.equals(result.selectedDigest) ? "yes" : "";
                case 1: return row.displayName;
                case 2: return row.version;
                case 3: return row.namespace;
                case 4: return String.format(java.util.Locale.ROOT, "%.3f", row.score);
                case 5: return SkillRetrieval.shortDigest(row.digest);
                default: return "";
            }
        }
    }
}
