package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.DeliveryWorkflow;
import com.chainlesschain.ide.DeliveryWorkflowController;
import com.chainlesschain.ide.SessionProjection;
import com.chainlesschain.ide.SessionsWorkbench;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.fileChooser.FileChooser;
import com.intellij.openapi.fileChooser.FileChooserDescriptor;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowFactory;
import com.intellij.ui.DocumentAdapter;
import com.intellij.ui.SearchTextField;
import com.intellij.ui.components.JBScrollPane;
import com.intellij.ui.content.Content;
import com.intellij.ui.content.ContentFactory;
import com.intellij.ui.table.JBTable;
import com.intellij.util.Alarm;
import org.jetbrains.annotations.NotNull;

import javax.swing.BorderFactory;
import javax.swing.JButton;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import javax.swing.ListSelectionModel;
import javax.swing.event.DocumentEvent;
import javax.swing.table.AbstractTableModel;
import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Font;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Existing Sessions Workbench UI over the CLI-owned canonical projection.
 * The IDE does not read supervisor/index/remote state files or transport
 * tokens. Mutations go through CLI commands, and every action is revision
 * checked again immediately before dispatch.
 */
public final class SessionsWorkbenchToolWindowFactory implements ToolWindowFactory, DumbAware {

    static final String TOOL_WINDOW_ID = "ChainlessChain Sessions";

    private static final int REFRESH_MS = 15_000;
    private static final long CLI_TIMEOUT_MS = 15_000;
    private static final long DELIVERY_CLI_TIMEOUT_MS = 30_000;
    private static final int LIST_LIMIT = 50;

    @Override
    public void createToolWindowContent(@NotNull Project project, @NotNull ToolWindow toolWindow) {
        Panel panel = new Panel(project, toolWindow);
        Content content = ContentFactory.getInstance().createContent(panel.root, "", false);
        toolWindow.getContentManager().addContent(content);
        panel.scheduleTick(0);
    }

    /** The workbench view: search + refresh + table + per-selection actions. */
    private static final class Panel {
        private final Project project;
        private final ToolWindow toolWindow;
        final JPanel root = new JPanel(new BorderLayout(6, 6));

        private final SearchTextField search = new SearchTextField(false);
        private final Model model = new Model();
        private final JBTable table = new JBTable(model);
        private final JLabel note = new JLabel(" ");
        private final Alarm alarm;
        private final AtomicBoolean inFlight = new AtomicBoolean(false);
        private final AtomicBoolean deliveryInFlight = new AtomicBoolean(false);
        private final DeliveryWorkflowController deliveryController;
        private final JTextArea deliveryText = new JTextArea(7, 80);
        private final JPanel deliveryActions =
                new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
        private final JButton deliverySelectBtn = new JButton("Select state…");
        private final JButton deliveryRefreshBtn = new JButton("Refresh flow");

        private final JButton resumeBtn = new JButton("Dispatch");
        private final JButton attachBtn = new JButton(CcBundle.message("sessions.wb.attach"));
        private final JButton replyBtn = new JButton("Reply");
        private final JButton stopBtn = new JButton(CcBundle.message("sessions.wb.stop"));
        private final JButton logsBtn = new JButton("Peek");
        private final JButton checkpointBtn = new JButton("Checkpoint");

        /** Last full (unfiltered) aggregate — filter re-applies locally. */
        private List<SessionsWorkbench.Row> all = new ArrayList<>();
        private volatile SessionProjection.Snapshot projection =
                SessionProjection.parse(null);

        Panel(Project project, ToolWindow toolWindow) {
            this.project = project;
            this.toolWindow = toolWindow;
            Disposable parent = toolWindow.getDisposable();
            this.alarm = new Alarm(Alarm.ThreadToUse.SWING_THREAD, parent);
            this.deliveryController = new DeliveryWorkflowController(
                    args -> AgentChatSession.runCapture(
                            args, projectDirectory(), DELIVERY_CLI_TIMEOUT_MS),
                    path -> Files.readString(
                            Paths.get(path), StandardCharsets.UTF_8));

            JButton refreshBtn = new JButton(CcBundle.message("sessions.wb.refresh"));
            refreshBtn.addActionListener(ev -> load());
            search.addDocumentListener(new DocumentAdapter() {
                @Override
                protected void textChanged(@NotNull DocumentEvent e) {
                    applyFilter();
                }
            });

            JPanel actions = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
            actions.add(refreshBtn);
            actions.add(resumeBtn);
            actions.add(attachBtn);
            actions.add(replyBtn);
            actions.add(stopBtn);
            actions.add(logsBtn);
            actions.add(checkpointBtn);

            JPanel top = new JPanel(new BorderLayout(6, 6));
            top.add(search, BorderLayout.CENTER);
            top.add(actions, BorderLayout.SOUTH);

            table.setSelectionMode(ListSelectionModel.SINGLE_SELECTION);
            table.getSelectionModel().addListSelectionListener(ev -> syncButtons());

            resumeBtn.addActionListener(ev -> onResume());
            attachBtn.addActionListener(ev -> onAttach());
            replyBtn.addActionListener(ev -> onReply());
            stopBtn.addActionListener(ev -> onStop());
            logsBtn.addActionListener(ev -> onLogs());
            checkpointBtn.addActionListener(ev -> onCheckpoint());
            syncButtons();

            JPanel deliveryPanel = new JPanel(new BorderLayout(6, 6));
            deliveryPanel.setBorder(BorderFactory.createTitledBorder("Delivery flow"));
            JPanel deliveryControls = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
            deliveryControls.add(deliverySelectBtn);
            deliveryControls.add(deliveryRefreshBtn);
            deliverySelectBtn.addActionListener(ev -> onDeliverySelect());
            deliveryRefreshBtn.addActionListener(ev -> {
                String statePath = deliveryController.statePath();
                if (statePath != null) loadDelivery(statePath);
            });
            deliveryText.setEditable(false);
            deliveryText.setLineWrap(true);
            deliveryText.setWrapStyleWord(true);
            deliveryText.setFont(new Font(
                    Font.MONOSPACED, Font.PLAIN, deliveryText.getFont().getSize()));
            deliveryPanel.add(deliveryControls, BorderLayout.NORTH);
            deliveryPanel.add(new JBScrollPane(deliveryText), BorderLayout.CENTER);
            deliveryPanel.add(deliveryActions, BorderLayout.SOUTH);

            JPanel center = new JPanel(new BorderLayout(6, 6));
            center.add(deliveryPanel, BorderLayout.NORTH);
            center.add(new JBScrollPane(table), BorderLayout.CENTER);

            root.add(top, BorderLayout.NORTH);
            root.add(center, BorderLayout.CENTER);
            root.add(note, BorderLayout.SOUTH);
            renderDelivery(null);
        }

        // -------------------------------------------------- refresh loop

        void scheduleTick(int delayMs) {
            alarm.addRequest(this::tick, delayMs);
        }

        private void tick() {
            // Only poll while the window is showing — a hidden workbench must
            // not keep spawning cc every 15s. The alarm dies with the window.
            if (toolWindow.isVisible()) {
                load();
                String deliveryPath = deliveryController.statePath();
                if (deliveryPath != null) loadDelivery(deliveryPath);
            }
            scheduleTick(REFRESH_MS);
        }

        /** Read the one CLI-owned projection; failures clear all stale actions. */
        private void load() {
            if (!inFlight.compareAndSet(false, true)) return;
            final File cwd = project.getBasePath() != null
                    ? new File(project.getBasePath()) : null;
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                SessionProjection.Snapshot next;
                try {
                    String out = AgentChatSession.runCapture(
                            projectionArgs(),
                            cwd, CLI_TIMEOUT_MS);
                    next = SessionProjection.parse(out);
                } catch (Throwable error) {
                    next = SessionProjection.parse(null);
                }
                final SessionProjection.Snapshot parsed = next;
                final List<SessionsWorkbench.Row> rows =
                        SessionsWorkbench.projectionRows(parsed);
                ApplicationManager.getApplication().invokeLater(() -> {
                    try {
                        projection = parsed;
                        all = rows;
                        applyFilter();
                        if (!parsed.connected) {
                            note.setText("Session projection unavailable: " + parsed.error);
                        }
                    } finally {
                        inFlight.set(false);
                    }
                });
            });
        }

        private void applyFilter() {
            String keepId = selectedId();
            model.setRows(SessionsWorkbench.filter(all, search.getText()));
            if (keepId != null) {
                for (int i = 0; i < model.rows.size(); i++) {
                    if (keepId.equals(model.rows.get(i).id)) {
                        table.getSelectionModel().setSelectionInterval(i, i);
                        break;
                    }
                }
            }
            note.setText(CcBundle.message("sessions.wb.count",
                    model.rows.size(), all.size()));
            syncButtons();
        }

        // ------------------------------------------------------ selection

        private File projectDirectory() {
            return project.getBasePath() == null
                    ? null : new File(project.getBasePath());
        }

        private void onDeliverySelect() {
            String statePath = chooseDeliveryFile(
                    "Select a CLI delivery-flow state snapshot",
                    "The IDE reads the projection through cc artifacts delivery-project; "
                            + "it does not mutate the selected JSON directly.");
            if (statePath != null) loadDelivery(statePath);
        }

        private String chooseDeliveryFile(String title, String description) {
            FileChooserDescriptor descriptor =
                    new FileChooserDescriptor(true, false, false, false, false, false)
                            .withTitle(title)
                            .withDescription(description);
            VirtualFile chosen = FileChooser.chooseFile(descriptor, project, null);
            return chosen == null ? null : chosen.getPath();
        }

        private void loadDelivery(String statePath) {
            if (statePath == null || !deliveryInFlight.compareAndSet(false, true)) return;
            renderDelivery(null);
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                String failure = null;
                try {
                    deliveryController.load(statePath);
                } catch (Throwable error) {
                    deliveryController.invalidate(statePath);
                    failure = "Delivery flow unavailable: " + deliveryError(error);
                }
                final String message = failure;
                ApplicationManager.getApplication().invokeLater(() -> {
                    deliveryInFlight.set(false);
                    renderDelivery(message);
                });
            });
        }

        private void onDeliveryRequest(String action) {
            if (deliveryInFlight.get()) return;
            final DeliveryWorkflowController.Confirmation token;
            try {
                token = deliveryController.previewRequest(action);
            } catch (Throwable error) {
                renderDelivery("Delivery request rejected: " + deliveryError(error));
                return;
            }
            int confirmed = Messages.showYesNoDialog(
                    project,
                    "Request \"" + DeliveryWorkflow.actionLabel(token.action)
                            + "\" for " + token.flowId + " at revision "
                            + token.expectedRevision + "? This records a pending "
                            + "coordinator effect only; it does not run PR, CI, merge, "
                            + "or archive operations.",
                    "Confirm Delivery Request",
                    "Request effect", "Cancel", null);
            if (confirmed != Messages.YES) return;
            runDeliveryOperation(
                    () -> deliveryController.confirmRequest(token),
                    "Pending delivery request recorded: " + token.action);
        }

        private void onDeliverySettlement() {
            if (deliveryInFlight.get()) return;
            String resultPath = chooseDeliveryFile(
                    "Select an effect-bound delivery result envelope",
                    "The result JSON must name the exact pending effect. The CLI "
                            + "re-checks the flow revision and state digest before settling.");
            if (resultPath == null || !deliveryInFlight.compareAndSet(false, true)) return;
            renderDelivery(null);
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                DeliveryWorkflowController.Confirmation preview = null;
                String failure = null;
                try {
                    preview = deliveryController.previewSettlement(resultPath);
                } catch (Throwable error) {
                    failure = "Delivery settlement rejected: " + deliveryError(error);
                }
                final DeliveryWorkflowController.Confirmation token = preview;
                final String message = failure;
                ApplicationManager.getApplication().invokeLater(() -> {
                    deliveryInFlight.set(false);
                    renderDelivery(message);
                    if (token == null) return;
                    int confirmed = Messages.showYesNoDialog(
                            project,
                            "Settle the pending " + token.action + " request at revision "
                                    + token.expectedRevision + " with effect "
                                    + token.expectedEffectId + "? The CLI will re-check the "
                                    + "state, effect ID, and unchanged result before settling.",
                            "Confirm Delivery Settlement",
                            "Settle exact effect", "Cancel", null);
                    if (confirmed == Messages.YES) {
                        runDeliveryOperation(
                                () -> deliveryController.confirmSettlement(token),
                                "Delivery effect settled: " + token.action);
                    }
                });
            });
        }

        private void runDeliveryOperation(
                DeliveryOperation operation, String successMessage) {
            if (!deliveryInFlight.compareAndSet(false, true)) return;
            renderDelivery(null);
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                String failure = null;
                try {
                    operation.run();
                } catch (Throwable error) {
                    deliveryController.invalidate(deliveryController.statePath());
                    failure = "Delivery action rejected: " + deliveryError(error);
                }
                final String message = failure;
                ApplicationManager.getApplication().invokeLater(() -> {
                    deliveryInFlight.set(false);
                    renderDelivery(message);
                    note.setText(message == null ? successMessage : message);
                });
            });
        }

        private void renderDelivery(String error) {
            boolean busy = deliveryInFlight.get();
            String statePath = deliveryController.statePath();
            Map<String, Object> current = deliveryController.projection();
            String rendered = DeliveryWorkflow.render(current, statePath);
            deliveryText.setText(error == null ? rendered : error + "\n\n" + rendered);
            deliveryText.setCaretPosition(0);
            deliverySelectBtn.setEnabled(!busy);
            deliveryRefreshBtn.setEnabled(!busy && statePath != null);
            deliveryActions.removeAll();
            if (!busy && current != null) {
                for (String action : DeliveryWorkflow.availableActions(current)) {
                    JButton request = new JButton(
                            "Request: " + DeliveryWorkflow.actionLabel(action));
                    request.addActionListener(ev -> onDeliveryRequest(action));
                    deliveryActions.add(request);
                }
                if (DeliveryWorkflow.pendingEffect(current) != null) {
                    JButton settle = new JButton("Settle from result JSON…");
                    settle.addActionListener(ev -> onDeliverySettlement());
                    deliveryActions.add(settle);
                }
            }
            deliveryActions.revalidate();
            deliveryActions.repaint();
        }

        private static String deliveryError(Throwable error) {
            String message = error == null || error.getMessage() == null
                    ? String.valueOf(error) : error.getMessage();
            message = message.replace('\r', ' ').replace('\n', ' ').trim();
            return message.length() <= 400 ? message : message.substring(0, 400);
        }

        @FunctionalInterface
        private interface DeliveryOperation {
            void run() throws Exception;
        }

        private SessionsWorkbench.Row selected() {
            int i = table.getSelectedRow();
            if (i < 0) return null;
            int m = table.convertRowIndexToModel(i);
            return m >= 0 && m < model.rows.size() ? model.rows.get(m) : null;
        }

        private String selectedId() {
            SessionsWorkbench.Row r = selected();
            return r == null ? null : r.id;
        }

        private void syncButtons() {
            SessionsWorkbench.Row r = selected();
            List<String> acts = r == null ? List.of() : r.actions;
            resumeBtn.setEnabled(acts.contains(SessionsWorkbench.ACT_DISPATCH));
            attachBtn.setEnabled(acts.contains(SessionsWorkbench.ACT_ATTACH));
            replyBtn.setEnabled(acts.contains(SessionsWorkbench.ACT_REPLY));
            stopBtn.setEnabled(acts.contains(SessionsWorkbench.ACT_STOP));
            logsBtn.setEnabled(acts.contains(SessionsWorkbench.ACT_PEEK));
            checkpointBtn.setEnabled(acts.contains(SessionsWorkbench.ACT_CHECKPOINT));
        }

        private SessionsWorkbench.Row selectedFor(String action) {
            SessionsWorkbench.Row row = selected();
            if (row != null && SessionProjection.preview(
                    projection, row.id, action, row.projectionRevision,
                    row.itemRevision) != null) {
                return row;
            }
            note.setText("Session data is disconnected or stale; action was not sent.");
            load();
            return null;
        }

        // -------------------------------------------------------- actions

        private void onResume() {
            SessionsWorkbench.Row r = selectedFor(SessionsWorkbench.ACT_DISPATCH);
            if (r == null) return;
            if (SessionsWorkbench.KIND_BACKGROUND.equals(r.kind)) {
                // Finished background agent → cc daemon resume <id> <prompt>.
                String prompt = Messages.showInputDialog(project,
                        CcBundle.message("sessions.wb.resume.ask"),
                        CcBundle.message("sessions.wb.resume"), null);
                if (prompt == null || prompt.trim().isEmpty()) return;
                cliPreviewAction(r, SessionsWorkbench.ACT_DISPATCH,
                        prompt.trim(), false);
                return;
            }
            // chat/ide → resume in a new chat tab (deep-link take-over path).
            hostPreviewAction(r, SessionsWorkbench.ACT_DISPATCH);
        }

        private void onAttach() {
            SessionsWorkbench.Row r = selectedFor(SessionsWorkbench.ACT_ATTACH);
            if (r != null) terminalPreviewAction(r, SessionsWorkbench.ACT_ATTACH);
        }

        private void onReply() {
            SessionsWorkbench.Row r = selectedFor(SessionsWorkbench.ACT_REPLY);
            if (r != null) terminalPreviewAction(r, SessionsWorkbench.ACT_REPLY);
        }

        private void onStop() {
            SessionsWorkbench.Row r = selectedFor(SessionsWorkbench.ACT_STOP);
            if (r != null) {
                cliPreviewAction(r, SessionsWorkbench.ACT_STOP, null, false);
            }
        }

        private void onLogs() {
            SessionsWorkbench.Row r = selectedFor(SessionsWorkbench.ACT_PEEK);
            if (r != null) {
                cliPreviewAction(r, SessionsWorkbench.ACT_PEEK, null, true);
            }
        }

        private void onCheckpoint() {
            SessionsWorkbench.Row r = selectedFor(SessionsWorkbench.ACT_CHECKPOINT);
            if (r != null) {
                cliPreviewAction(r, SessionsWorkbench.ACT_CHECKPOINT, null, false);
            }
        }

        // -------------------------------------------------------- helpers

        private List<String> projectionArgs() {
            List<String> args = new ArrayList<String>(List.of(
                    "session", "projection", "--json", "-n",
                    String.valueOf(LIST_LIMIT)));
            if (project.getBasePath() != null) {
                args.add("--cwd");
                args.add(project.getBasePath());
            }
            return args;
        }

        private SessionProjection.ActionPreview freshPreview(
                SessionProjection.Snapshot rendered,
                SessionsWorkbench.Row row, String action, File cwd) {
            try {
                String out = AgentChatSession.runCapture(
                        projectionArgs(), cwd, CLI_TIMEOUT_MS);
                SessionProjection.Snapshot current = SessionProjection.parse(out);
                return SessionProjection.recheck(rendered, current,
                        row.id, action, row.projectionRevision,
                        row.itemRevision);
            } catch (Throwable error) {
                return null;
            }
        }

        private static boolean safeTerminalArgs(List<String> args) {
            if (args == null || args.isEmpty() || args.size() > 32) return false;
            for (String arg : args) {
                if (arg == null || arg.indexOf('\0') >= 0
                        || arg.indexOf('\r') >= 0 || arg.indexOf('\n') >= 0) {
                    return false;
                }
            }
            return true;
        }

        private void terminalPreviewAction(SessionsWorkbench.Row row, String action) {
            final SessionProjection.Snapshot rendered = projection;
            final File cwd = project.getBasePath() != null
                    ? new File(project.getBasePath()) : null;
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                SessionProjection.ActionPreview preview =
                        freshPreview(rendered, row, action, cwd);
                List<String> args = preview == null ? List.of()
                        : preview.materialize(null);
                if (preview == null || !"terminal".equals(preview.executor)
                        || !safeTerminalArgs(args)) {
                    afterAction("Session data changed; terminal action was not sent.");
                    return;
                }
                ApplicationManager.getApplication().invokeLater(() ->
                        openPreviewTerminal(args));
            });
        }

        private void openPreviewTerminal(List<String> args) {
            String dir = project.getBasePath() != null
                    ? project.getBasePath() : System.getProperty("user.home");
            StringBuilder command = new StringBuilder(
                    shellToken(AgentChatSession.resolveBinary()));
            for (String arg : args) command.append(' ').append(shellToken(arg));
            try {
                TerminalLauncher.run(project, dir, "ChainlessChain Session",
                        command.toString());
            } catch (Throwable error) {
                Messages.showInfoMessage(project,
                        "Run in a terminal: " + command,
                        CcBundle.message("sessions.wb.title"));
            }
        }

        private void hostPreviewAction(SessionsWorkbench.Row row, String action) {
            final SessionProjection.Snapshot rendered = projection;
            final File cwd = project.getBasePath() != null
                    ? new File(project.getBasePath()) : null;
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                SessionProjection.ActionPreview preview =
                        freshPreview(rendered, row, action, cwd);
                if (preview == null || !"host".equals(preview.executor)) {
                    afterAction("Session data changed; host action was not sent.");
                    return;
                }
                ApplicationManager.getApplication().invokeLater(() ->
                        ChatToolWindowFactory.onPanel(project,
                                panel -> panel.resumeSession(row.sourceId)));
            });
        }

        private static String shellToken(String value) {
            String text = value == null ? "" : value;
            if (File.separatorChar == '\\') {
                return "\"" + text.replace("\"", "\"\"") + "\"";
            }
            return "'" + text.replace("'", "'\"'\"'") + "'";
        }

        private void cliPreviewAction(SessionsWorkbench.Row row,
                String action, String prompt, boolean showOutput) {
            final SessionProjection.Snapshot rendered = projection;
            final File cwd = project.getBasePath() != null
                    ? new File(project.getBasePath()) : null;
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                SessionProjection.ActionPreview preview =
                        freshPreview(rendered, row, action, cwd);
                List<String> args = preview == null ? List.of()
                        : preview.materialize(prompt);
                if (preview == null || !"cli".equals(preview.executor)
                        || args.isEmpty()) {
                    afterAction("Session data changed; action was not sent.");
                    return;
                }
                String out = AgentChatSession.runCapture(args, cwd, CLI_TIMEOUT_MS);
                if (showOutput) {
                    final String text = out == null || out.isEmpty()
                            ? "Unavailable" : out;
                    ApplicationManager.getApplication().invokeLater(() ->
                            showTextDialog("Session " + row.sourceId, text));
                    return;
                }
                afterAction(out == null || out.isEmpty()
                        ? "cc " + String.join(" ", args) + " failed"
                        : firstLine(out.trim()));
            });
        }

        /** Post an action result to the note line and reload (any thread). */
        private void afterAction(String result) {
            ApplicationManager.getApplication().invokeLater(() -> {
                note.setText(result);
                load();
            });
        }

        private void showTextDialog(String title, String text) {
            JTextArea area = new JTextArea(text, 24, 96);
            area.setEditable(false);
            area.setFont(new Font(Font.MONOSPACED, Font.PLAIN, area.getFont().getSize()));
            JScrollPane scroll = new JScrollPane(area);
            scroll.setPreferredSize(new Dimension(860, 460));
            com.intellij.openapi.ui.DialogBuilder b =
                    new com.intellij.openapi.ui.DialogBuilder(project);
            b.setTitle(title);
            b.setCenterPanel(scroll);
            b.addCloseButton();
            b.show();
        }

        private static String firstLine(String s) {
            int nl = s.indexOf('\n');
            return nl >= 0 ? s.substring(0, nl) : s;
        }
    }

    /** Read-only table model over the filtered unified rows. */
    private static final class Model extends AbstractTableModel {
        List<SessionsWorkbench.Row> rows = new ArrayList<>();
        // Columns precomputed once per setRows — getValueAt is called 5×/row on
        // every repaint, so calling toColumns() there recomputed all columns per
        // cell. The "updated" column is relative time, refreshed on the panel's
        // 15s tick (which rebuilds this model), so per-setRows caching is fine.
        private List<String[]> cols = new ArrayList<>();

        private static final String[] HEADERS = {
                CcBundle.message("sessions.wb.col.kind"),
                CcBundle.message("sessions.wb.col.title"),
                CcBundle.message("sessions.wb.col.status"),
                CcBundle.message("sessions.wb.col.workspace"),
                CcBundle.message("sessions.wb.col.updated"),
        };

        void setRows(List<SessionsWorkbench.Row> next) {
            rows = next == null ? new ArrayList<>() : next;
            long now = System.currentTimeMillis();
            List<String[]> c = new ArrayList<>(rows.size());
            for (SessionsWorkbench.Row r : rows) c.add(SessionsWorkbench.toColumns(r, now));
            cols = c;
            fireTableDataChanged();
        }

        @Override public int getRowCount() { return rows.size(); }
        @Override public int getColumnCount() { return SessionsWorkbench.COLUMN_COUNT; }
        @Override public String getColumnName(int c) { return HEADERS[c]; }
        @Override public boolean isCellEditable(int r, int c) { return false; }

        @Override
        public Object getValueAt(int r, int c) {
            if (r < 0 || r >= cols.size()) return "";
            String[] cells = cols.get(r);
            return c >= 0 && c < cells.length ? cells[c] : "";
        }
    }
}
