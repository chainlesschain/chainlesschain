package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.BackgroundAgents;
import com.chainlesschain.ide.BackgroundSessionPipeClient;
import com.chainlesschain.ide.IdeSessionIndex;
import com.chainlesschain.ide.MiniJson;
import com.chainlesschain.ide.RemoteHandoff;
import com.chainlesschain.ide.SessionList;
import com.chainlesschain.ide.SessionsWorkbench;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * "ChainlessChain Sessions" tool window — the unified sessions workbench
 * (gap #3 跨端 Remote/Cloud Session 入口): one searchable table over chat
 * sessions ({@code cc session list --json}), the cross-IDE session index,
 * {@code cc agent --bg} background agents and {@code cc remote-control}
 * pairing hosts. Aggregation/dedup/sort/filter/rendering live in the pure
 * {@link SessionsWorkbench}; this glue owns Swing, the 15s auto-refresh (only
 * while the window is visible) and routes the per-row actions:
 *
 * <ul>
 *   <li>resume (chat/ide) → the deep-link take-over path
 *       ({@code ChatToolWindowFactory.onPanel(...).resumeSession});</li>
 *   <li>attach (running background) → one-shot session-transport prompt, the
 *       same path {@link BackgroundAgentsAction} uses;</li>
 *   <li>resume/rename/stop (background) → {@code cc daemon … --json} off-EDT;</li>
 *   <li>rename (chat/ide) → shared IDE-index overlay
 *       ({@link IdeSessionIndex#renameDefault});</li>
 *   <li>delete (chat/ide) → {@code cc session delete --force} + index prune;</li>
 *   <li>status/stop (remote) → {@code cc remote-control status/stop --json}.</li>
 * </ul>
 *
 * All data loading and every cc spawn run off-EDT; a failed source degrades to
 * a warning row (the panel always renders).
 */
public final class SessionsWorkbenchToolWindowFactory implements ToolWindowFactory, DumbAware {

    static final String TOOL_WINDOW_ID = "ChainlessChain Sessions";

    private static final int REFRESH_MS = 15_000;
    private static final long CLI_TIMEOUT_MS = 15_000;
    private static final long PIPE_TIMEOUT_MS = 5_000;
    private static final int LIST_LIMIT = 50;
    private static final int LOG_LINES = 200;

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

        private final JButton resumeBtn = new JButton(CcBundle.message("sessions.wb.resume"));
        private final JButton attachBtn = new JButton(CcBundle.message("sessions.wb.attach"));
        private final JButton renameBtn = new JButton(CcBundle.message("sessions.wb.rename"));
        private final JButton deleteBtn = new JButton(CcBundle.message("sessions.wb.delete"));
        private final JButton stopBtn = new JButton(CcBundle.message("sessions.wb.stop"));
        private final JButton logsBtn = new JButton(CcBundle.message("sessions.wb.logs"));
        private final JButton statusBtn = new JButton(CcBundle.message("sessions.wb.status"));

        /** Last full (unfiltered) aggregate — filter re-applies locally. */
        private List<SessionsWorkbench.Row> all = new ArrayList<>();

        Panel(Project project, ToolWindow toolWindow) {
            this.project = project;
            this.toolWindow = toolWindow;
            Disposable parent = toolWindow.getDisposable();
            this.alarm = new Alarm(Alarm.ThreadToUse.SWING_THREAD, parent);

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
            actions.add(renameBtn);
            actions.add(deleteBtn);
            actions.add(stopBtn);
            actions.add(logsBtn);
            actions.add(statusBtn);

            JPanel top = new JPanel(new BorderLayout(6, 6));
            top.add(search, BorderLayout.CENTER);
            top.add(actions, BorderLayout.SOUTH);

            table.setSelectionMode(ListSelectionModel.SINGLE_SELECTION);
            table.getSelectionModel().addListSelectionListener(ev -> syncButtons());

            resumeBtn.addActionListener(ev -> onResume());
            attachBtn.addActionListener(ev -> onAttach());
            renameBtn.addActionListener(ev -> onRename());
            deleteBtn.addActionListener(ev -> onDelete());
            stopBtn.addActionListener(ev -> onStop());
            logsBtn.addActionListener(ev -> onLogs());
            statusBtn.addActionListener(ev -> onRemoteStatus());
            syncButtons();

            root.add(top, BorderLayout.NORTH);
            root.add(new JBScrollPane(table), BorderLayout.CENTER);
            root.add(note, BorderLayout.SOUTH);
        }

        // -------------------------------------------------- refresh loop

        void scheduleTick(int delayMs) {
            alarm.addRequest(this::tick, delayMs);
        }

        private void tick() {
            // Only poll while the window is showing — a hidden workbench must
            // not keep spawning cc every 15s. The alarm dies with the window.
            if (toolWindow.isVisible()) load();
            scheduleTick(REFRESH_MS);
        }

        /** Gather the four sources off-EDT; each failure degrades to a warning row. */
        private void load() {
            if (!inFlight.compareAndSet(false, true)) return;
            final File cwd = project.getBasePath() != null
                    ? new File(project.getBasePath()) : null;
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                long now = System.currentTimeMillis();
                List<SessionsWorkbench.Row> warnings = new ArrayList<>();
                List<SessionsWorkbench.Row> chat = List.of();
                List<SessionsWorkbench.Row> ide = List.of();
                List<SessionsWorkbench.Row> background = List.of();
                List<SessionsWorkbench.Row> remote = List.of();
                try {
                    String out = AgentChatSession.runCapture(
                            SessionList.buildListArgs(LIST_LIMIT), cwd, CLI_TIMEOUT_MS);
                    if (out == null || out.trim().isEmpty()) {
                        warnings.add(SessionsWorkbench.warningRow("chat",
                                CcBundle.message("sessions.wb.warn.chat")));
                    } else {
                        chat = SessionsWorkbench.chatRows(out);
                    }
                } catch (Throwable t) {
                    warnings.add(SessionsWorkbench.warningRow("chat",
                            CcBundle.message("sessions.wb.warn.chat")));
                }
                try {
                    ide = SessionsWorkbench.ideRows(
                            IdeSessionIndex.read(IdeSessionIndex.defaultFile()));
                } catch (Throwable t) {
                    warnings.add(SessionsWorkbench.warningRow("ide",
                            CcBundle.message("sessions.wb.warn.ide")));
                }
                try {
                    background = SessionsWorkbench.backgroundRows(
                            BackgroundAgents.list(BackgroundAgents.defaultDir(), now));
                } catch (Throwable t) {
                    warnings.add(SessionsWorkbench.warningRow("background",
                            CcBundle.message("sessions.wb.warn.background")));
                }
                try {
                    String out = AgentChatSession.runCapture(
                            RemoteHandoff.buildRemoteControlStatusArgs(), cwd, CLI_TIMEOUT_MS);
                    if (out == null) {
                        warnings.add(SessionsWorkbench.warningRow("remote",
                                CcBundle.message("sessions.wb.warn.remote")));
                    } else {
                        remote = SessionsWorkbench.remoteRows(out);
                    }
                } catch (Throwable t) {
                    warnings.add(SessionsWorkbench.warningRow("remote",
                            CcBundle.message("sessions.wb.warn.remote")));
                }
                final List<SessionsWorkbench.Row> merged =
                        SessionsWorkbench.aggregate(chat, ide, background, remote, warnings);
                ApplicationManager.getApplication().invokeLater(() -> {
                    all = merged;
                    applyFilter();
                    inFlight.set(false);
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
            resumeBtn.setEnabled(acts.contains(SessionsWorkbench.ACT_RESUME));
            attachBtn.setEnabled(acts.contains(SessionsWorkbench.ACT_ATTACH));
            renameBtn.setEnabled(acts.contains(SessionsWorkbench.ACT_RENAME));
            deleteBtn.setEnabled(acts.contains(SessionsWorkbench.ACT_DELETE));
            stopBtn.setEnabled(acts.contains(SessionsWorkbench.ACT_STOP));
            logsBtn.setEnabled(acts.contains(SessionsWorkbench.ACT_LOGS));
            statusBtn.setEnabled(acts.contains(SessionsWorkbench.ACT_STATUS));
        }

        // -------------------------------------------------------- actions

        private void onResume() {
            SessionsWorkbench.Row r = selected();
            if (r == null) return;
            if (SessionsWorkbench.KIND_BACKGROUND.equals(r.kind)) {
                // Finished background agent → cc daemon resume <id> <prompt>.
                String prompt = Messages.showInputDialog(project,
                        CcBundle.message("sessions.wb.resume.ask"),
                        CcBundle.message("sessions.wb.resume"), null);
                if (prompt == null || prompt.trim().isEmpty()) return;
                cliAction(List.of("daemon", "resume", r.id, prompt.trim(), "--json"));
                return;
            }
            // chat/ide → resume in a new chat tab (deep-link take-over path).
            ChatToolWindowFactory.onPanel(project, panel -> panel.resumeSession(r.id));
        }

        private void onAttach() {
            SessionsWorkbench.Row r = selected();
            if (r == null) return;
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                BackgroundAgents.Session live = findBackground(r.id);
                ApplicationManager.getApplication().invokeLater(() -> {
                    if (live == null || !live.interactive) {
                        Messages.showInfoMessage(project,
                                CcBundle.message("sessions.wb.notInteractive", r.id),
                                CcBundle.message("sessions.wb.title"));
                        return;
                    }
                    String prompt = Messages.showInputDialog(project,
                            CcBundle.message("sessions.wb.attach.ask"),
                            CcBundle.message("sessions.wb.attach"), null);
                    if (prompt == null || prompt.trim().isEmpty()) return;
                    Map<String, Object> msg = MiniJson.obj();
                    msg.put("type", "prompt");
                    msg.put("text", prompt.trim());
                    pipeAction(live, msg);
                });
            });
        }

        private void onRename() {
            SessionsWorkbench.Row r = selected();
            if (r == null) return;
            String title = Messages.showInputDialog(project,
                    CcBundle.message("sessions.wb.rename.ask"),
                    CcBundle.message("sessions.wb.rename"), null, r.title, null);
            if (title == null || title.trim().isEmpty()) return;
            final String next = title.trim();
            if (SessionsWorkbench.KIND_BACKGROUND.equals(r.kind)) {
                cliAction(List.of("daemon", "rename", r.id, next, "--json"));
            } else {
                // chat/ide: the title lives in the shared IDE index as an
                // overlay (the CLI store has no rename command).
                ApplicationManager.getApplication().executeOnPooledThread(() -> {
                    boolean ok = IdeSessionIndex.renameDefault(r.id, next);
                    afterAction(ok ? "→ " + r.id + " = \"" + next + "\"" : "✕ rename");
                });
            }
        }

        private void onDelete() {
            SessionsWorkbench.Row r = selected();
            if (r == null) return;
            int yes = Messages.showYesNoDialog(project,
                    CcBundle.message("sessions.wb.delete.confirm", r.id),
                    CcBundle.message("sessions.wb.delete"), null);
            if (yes != Messages.YES) return;
            final File cwd = project.getBasePath() != null
                    ? new File(project.getBasePath()) : null;
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                String out = AgentChatSession.runCapture(
                        SessionList.buildDeleteArgs(r.id), cwd, CLI_TIMEOUT_MS);
                boolean indexDeleted = IdeSessionIndex.removeDefault(r.id);
                afterAction((out != null && !out.isEmpty()) || indexDeleted
                        ? "→ deleted " + r.id : "✕ delete " + r.id);
            });
        }

        private void onStop() {
            SessionsWorkbench.Row r = selected();
            if (r == null) return;
            if (SessionsWorkbench.KIND_REMOTE.equals(r.kind)) {
                long port = SessionsWorkbench.remotePort(r.id);
                if (port > 0) {
                    cliAction(RemoteHandoff.buildRemoteControlStopArgs(port));
                }
            } else {
                cliAction(List.of("daemon", "stop", r.id, "--json"));
            }
        }

        private void onLogs() {
            SessionsWorkbench.Row r = selected();
            if (r == null) return;
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                BackgroundAgents.Session live = findBackground(r.id);
                final String tail = live == null ? "" : BackgroundAgents.tailLog(live.logFile, LOG_LINES);
                ApplicationManager.getApplication().invokeLater(() ->
                        showTextDialog(CcBundle.message("sessions.wb.logs.title", r.id),
                                tail.isEmpty() ? CcBundle.message("sessions.wb.logs.empty") : tail));
            });
        }

        private void onRemoteStatus() {
            final File cwd = project.getBasePath() != null
                    ? new File(project.getBasePath()) : null;
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                String out = AgentChatSession.runCapture(
                        RemoteHandoff.buildRemoteControlStatusArgs(), cwd, CLI_TIMEOUT_MS);
                final List<Map<String, Object>> hosts =
                        RemoteHandoff.parseRemoteControlStatus(out);
                ApplicationManager.getApplication().invokeLater(() -> {
                    if (hosts.isEmpty()) {
                        Messages.showInfoMessage(project,
                                CcBundle.message("sessions.wb.remote.none"),
                                CcBundle.message("sessions.wb.title"));
                        return;
                    }
                    StringBuilder sb = new StringBuilder();
                    for (Map<String, Object> h : hosts) {
                        sb.append(RemoteHandoff.formatStatusLine(h)).append('\n');
                    }
                    showTextDialog(CcBundle.message("sessions.wb.status.title"), sb.toString());
                });
            });
        }

        // -------------------------------------------------------- helpers

        /** Fresh state-dir read (rows don't carry transport endpoints). */
        private static BackgroundAgents.Session findBackground(String id) {
            for (BackgroundAgents.Session s : BackgroundAgents.list(
                    BackgroundAgents.defaultDir(), System.currentTimeMillis())) {
                if (s.id.equals(id)) return s;
            }
            return null;
        }

        /** One-shot session-transport action off-EDT (BackgroundAgentsAction path). */
        private void pipeAction(BackgroundAgents.Session sel, Map<String, Object> msg) {
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                String line;
                try {
                    Map<String, Object> reply = BackgroundSessionPipeClient.sendOneShot(
                            sel.pipePath, sel.token, msg, PIPE_TIMEOUT_MS);
                    line = "→ " + MiniJson.stringify(reply);
                } catch (Exception ex) {
                    line = "✕ " + ex.getMessage();
                }
                afterAction(line);
            });
        }

        /** {@code cc <args>} off-EDT, then refresh + note (BackgroundAgentsAction path). */
        private void cliAction(List<String> args) {
            final File cwd = project.getBasePath() != null
                    ? new File(project.getBasePath()) : null;
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                String out = AgentChatSession.runCapture(args, cwd, CLI_TIMEOUT_MS);
                afterAction(out == null || out.isEmpty()
                        ? "✕ cc " + String.join(" ", args)
                        : "→ " + firstLine(out.trim()));
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

        private static final String[] HEADERS = {
                CcBundle.message("sessions.wb.col.kind"),
                CcBundle.message("sessions.wb.col.title"),
                CcBundle.message("sessions.wb.col.status"),
                CcBundle.message("sessions.wb.col.workspace"),
                CcBundle.message("sessions.wb.col.updated"),
        };

        void setRows(List<SessionsWorkbench.Row> next) {
            rows = next == null ? new ArrayList<>() : next;
            fireTableDataChanged();
        }

        @Override public int getRowCount() { return rows.size(); }
        @Override public int getColumnCount() { return SessionsWorkbench.COLUMN_COUNT; }
        @Override public String getColumnName(int c) { return HEADERS[c]; }
        @Override public boolean isCellEditable(int r, int c) { return false; }

        @Override
        public Object getValueAt(int r, int c) {
            if (r < 0 || r >= rows.size()) return "";
            String[] cols = SessionsWorkbench.toColumns(rows.get(r), System.currentTimeMillis());
            return c >= 0 && c < cols.length ? cols[c] : "";
        }
    }
}
