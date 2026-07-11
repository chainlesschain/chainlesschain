package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.Artifacts;
import com.intellij.ide.BrowserUtil;
import com.intellij.ide.actions.RevealFileAction;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.ide.CopyPasteManager;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogBuilder;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.vfs.LocalFileSystem;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.ui.components.JBScrollPane;
import com.intellij.ui.table.JBTable;
import org.jetbrains.annotations.NotNull;

import javax.swing.JButton;
import javax.swing.JComboBox;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JTextField;
import javax.swing.ListSelectionModel;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import javax.swing.table.AbstractTableModel;
import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.datatransfer.StringSelection;
import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * Artifacts drawer (Tools menu, gap #9) — browse the agent-published
 * deliverable store over {@code cc artifacts}: searchable/kind-filterable
 * metadata table (title/kind/size/mime/created — payload bytes are never read
 * for listing), Open (text/image → IDE editor via
 * {@code LocalFileSystem.refreshAndFindFileByNioFile} + FileEditorManager;
 * html → external browser), Reveal in folder ({@link RevealFileAction}),
 * Copy path, and Remove (confirm → {@code cc artifacts remove <id>} off-EDT →
 * refresh). Dialog form deliberately (same shape as
 * {@link BackgroundAgentsAction} — less code than a tool window and the drawer
 * is a short-lived pick-and-act surface, not a monitor). Parsing/filtering/
 * previewability/action derivation live in the pure {@link Artifacts} core;
 * the list load and every cc spawn run off-EDT.
 */
public final class ArtifactsAction extends AnAction implements DumbAware {

    private static final long CLI_TIMEOUT_MS = 15_000;

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        Project project = e.getProject();
        final File cwd = project != null && project.getBasePath() != null
                ? new File(project.getBasePath()) : null;

        final Model model = new Model();
        final JBTable table = new JBTable(model);
        table.setSelectionMode(ListSelectionModel.SINGLE_SELECTION);
        final JTextField search = new JTextField();
        final JComboBox<String> kind = new JComboBox<>();
        kind.addItem(CcBundle.message("artifacts.kind.all"));
        for (String k : Artifacts.KINDS) kind.addItem(k);
        final JLabel note = new JLabel(" ");

        final List<Artifacts.Row>[] all = uncheckedRowsRef();
        all[0] = new ArrayList<>();

        final JButton refreshBtn = new JButton(CcBundle.message("artifacts.refresh"));
        final JButton openBtn = new JButton(CcBundle.message("artifacts.open"));
        final JButton revealBtn = new JButton(CcBundle.message("artifacts.reveal"));
        final JButton copyBtn = new JButton(CcBundle.message("artifacts.copyPath"));
        final JButton removeBtn = new JButton(CcBundle.message("artifacts.remove"));

        Runnable syncButtons = () -> {
            Artifacts.Row r = selected(table, model);
            List<String> acts = r == null ? List.of() : Artifacts.actionsFor(r);
            openBtn.setEnabled(acts.contains(Artifacts.ACT_OPEN)
                    || acts.contains(Artifacts.ACT_OPEN_EXTERNAL));
            revealBtn.setEnabled(acts.contains(Artifacts.ACT_REVEAL));
            copyBtn.setEnabled(acts.contains(Artifacts.ACT_COPY_PATH));
            removeBtn.setEnabled(acts.contains(Artifacts.ACT_REMOVE));
        };

        Runnable applyFilter = () -> {
            String k = kind.getSelectedIndex() <= 0
                    ? "" : String.valueOf(kind.getSelectedItem());
            model.setRows(Artifacts.filter(all[0], search.getText(), k));
            note.setText(CcBundle.message("artifacts.count",
                    model.rows.size(), all[0].size()));
            syncButtons.run();
        };

        /* Load the metadata list off-EDT; a failure degrades to a note line. */
        Runnable load = () -> ApplicationManager.getApplication().executeOnPooledThread(() -> {
            String out = AgentChatSession.runCapture(
                    Artifacts.buildListArgs(), cwd, CLI_TIMEOUT_MS);
            final List<Artifacts.Row> rows =
                    out == null ? null : Artifacts.parseList(out);
            ApplicationManager.getApplication().invokeLater(() -> {
                if (rows == null) {
                    note.setText(CcBundle.message("artifacts.loadFailed"));
                    return;
                }
                all[0] = rows;
                applyFilter.run();
                if (rows.isEmpty()) {
                    note.setText(CcBundle.message("artifacts.empty"));
                }
            });
        });

        search.getDocument().addDocumentListener(new DocumentListener() {
            @Override public void insertUpdate(DocumentEvent ev) { applyFilter.run(); }
            @Override public void removeUpdate(DocumentEvent ev) { applyFilter.run(); }
            @Override public void changedUpdate(DocumentEvent ev) { applyFilter.run(); }
        });
        kind.addActionListener(ev -> applyFilter.run());
        table.getSelectionModel().addListSelectionListener(ev -> syncButtons.run());
        refreshBtn.addActionListener(ev -> load.run());

        openBtn.addActionListener(ev -> {
            Artifacts.Row r = selected(table, model);
            File f = storedFile(r, note);
            if (r == null || f == null) return;
            String cls = Artifacts.previewClass(r.mime, r.file);
            if (Artifacts.PREVIEW_HTML.equals(cls)) {
                BrowserUtil.browse(f);
                return;
            }
            // text + image both open in the IDE (it has an image viewer)
            VirtualFile vf = LocalFileSystem.getInstance()
                    .refreshAndFindFileByNioFile(f.toPath());
            if (vf == null) {
                note.setText(CcBundle.message("artifacts.missing", f.getPath()));
                return;
            }
            if (project != null) {
                FileEditorManager.getInstance(project).openFile(vf, true);
            } else {
                RevealFileAction.openFile(f); // no project → best effort
            }
        });
        revealBtn.addActionListener(ev -> {
            File f = storedFile(selected(table, model), note);
            if (f != null) RevealFileAction.openFile(f);
        });
        copyBtn.addActionListener(ev -> {
            Artifacts.Row r = selected(table, model);
            String path = r == null ? null : Artifacts.storedPath(storeDir(), r);
            if (path == null) return;
            CopyPasteManager.getInstance().setContents(new StringSelection(path));
            note.setText(CcBundle.message("artifacts.copied", path));
        });
        removeBtn.addActionListener(ev -> {
            Artifacts.Row r = selected(table, model);
            if (r == null) return;
            int yes = Messages.showYesNoDialog(project,
                    CcBundle.message("artifacts.remove.confirm", r.id),
                    CcBundle.message("artifacts.remove"), null);
            if (yes != Messages.YES) return;
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                String out = AgentChatSession.runCapture(
                        Artifacts.buildRemoveArgs(r.id), cwd, CLI_TIMEOUT_MS);
                ApplicationManager.getApplication().invokeLater(() -> {
                    note.setText(out == null || out.isEmpty()
                            ? "✕ cc artifacts remove " + r.id
                            : "→ " + out.trim());
                    load.run();
                });
            });
        });

        JPanel buttons = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
        buttons.add(refreshBtn);
        buttons.add(openBtn);
        buttons.add(revealBtn);
        buttons.add(copyBtn);
        buttons.add(removeBtn);
        buttons.add(kind);

        JPanel top = new JPanel(new BorderLayout(6, 6));
        top.add(search, BorderLayout.CENTER);
        top.add(buttons, BorderLayout.SOUTH);

        JBScrollPane scroll = new JBScrollPane(table);
        scroll.setPreferredSize(new Dimension(880, 420));

        JPanel root = new JPanel(new BorderLayout(8, 8));
        root.add(top, BorderLayout.NORTH);
        root.add(scroll, BorderLayout.CENTER);
        root.add(note, BorderLayout.SOUTH);

        syncButtons.run();
        load.run();

        DialogBuilder builder = new DialogBuilder(project);
        builder.setTitle(CcBundle.message("artifacts.title"));
        builder.setCenterPanel(root);
        builder.addCloseButton();
        builder.show();
    }

    // ------------------------------------------------------------- helpers

    private static Artifacts.Row selected(JBTable table, Model model) {
        int i = table.getSelectedRow();
        if (i < 0) return null;
        int m = table.convertRowIndexToModel(i);
        return m >= 0 && m < model.rows.size() ? model.rows.get(m) : null;
    }

    private static String storeDir() {
        return Artifacts.defaultArtifactsDir(
                System.getenv("CC_ARTIFACTS_DIR"), System.getProperty("user.home"));
    }

    /** Stored payload file of a row, or null (+ note) when absent on disk. */
    private static File storedFile(Artifacts.Row r, JLabel note) {
        if (r == null) return null;
        String path = Artifacts.storedPath(storeDir(), r);
        if (path == null) return null;
        File f = new File(path);
        if (!f.isFile()) {
            note.setText(CcBundle.message("artifacts.missing", path));
            return null;
        }
        return f;
    }

    @SuppressWarnings("unchecked")
    private static List<Artifacts.Row>[] uncheckedRowsRef() {
        return new List[1];
    }

    /** Read-only table model over the filtered artifact rows (metadata only). */
    private static final class Model extends AbstractTableModel {
        List<Artifacts.Row> rows = new ArrayList<>();

        private static final String[] HEADERS = {
                CcBundle.message("artifacts.col.title"),
                CcBundle.message("artifacts.col.kind"),
                CcBundle.message("artifacts.col.size"),
                CcBundle.message("artifacts.col.mime"),
                CcBundle.message("artifacts.col.created"),
        };

        void setRows(List<Artifacts.Row> next) {
            rows = next == null ? new ArrayList<>() : next;
            fireTableDataChanged();
        }

        @Override public int getRowCount() { return rows.size(); }
        @Override public int getColumnCount() { return Artifacts.COLUMN_COUNT; }
        @Override public String getColumnName(int c) { return HEADERS[c]; }
        @Override public boolean isCellEditable(int r, int c) { return false; }

        @Override
        public Object getValueAt(int r, int c) {
            if (r < 0 || r >= rows.size()) return "";
            String[] cols = Artifacts.toColumns(rows.get(r), System.currentTimeMillis());
            return c >= 0 && c < cols.length ? cols[c] : "";
        }
    }
}
