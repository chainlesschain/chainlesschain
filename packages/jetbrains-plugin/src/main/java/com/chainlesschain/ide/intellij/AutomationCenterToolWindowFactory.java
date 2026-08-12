package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.AutomationCenter;
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
import com.intellij.util.Alarm;
import org.jetbrains.annotations.NotNull;

import javax.swing.JButton;
import javax.swing.JComboBox;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import javax.swing.event.DocumentEvent;
import java.awt.BorderLayout;
import java.awt.FlowLayout;
import java.awt.Font;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/** JetBrains Automation Center over the same CLI-owned projection as VS Code. */
public final class AutomationCenterToolWindowFactory implements ToolWindowFactory, DumbAware {

    static final String TOOL_WINDOW_ID = "ChainlessChain Automation";
    private static final long CLI_TIMEOUT_MS = 30_000;
    private static final int REFRESH_MS = 15_000;

    @Override
    public void createToolWindowContent(@NotNull Project project, @NotNull ToolWindow toolWindow) {
        Panel panel = new Panel(project, toolWindow);
        Content content = ContentFactory.getInstance().createContent(panel.root, "", false);
        toolWindow.getContentManager().addContent(content);
        panel.schedule(0);
    }

    private static final class Panel {
        private final Project project;
        private final ToolWindow toolWindow;
        final JPanel root = new JPanel(new BorderLayout(6, 6));
        private final SearchTextField search = new SearchTextField(false);
        private final JComboBox<String> picker = new JComboBox<>();
        private final JTextArea detail = new JTextArea(20, 80);
        private final JLabel summary = new JLabel(" ");
        private final JButton runBtn = new JButton("Run now");
        private final JButton pauseBtn = new JButton("Pause");
        private final JButton resumeBtn = new JButton("Resume");
        private final Alarm alarm;
        private final AtomicBoolean inFlight = new AtomicBoolean(false);
        private final AtomicBoolean syncing = new AtomicBoolean(false);
        private volatile AutomationCenter.Snapshot snapshot = AutomationCenter.parse(null);
        private List<AutomationCenter.Flow> visible = new ArrayList<>();

        Panel(Project project, ToolWindow toolWindow) {
            this.project = project;
            this.toolWindow = toolWindow;
            Disposable parent = toolWindow.getDisposable();
            this.alarm = new Alarm(Alarm.ThreadToUse.SWING_THREAD, parent);
            detail.setEditable(false);
            detail.setLineWrap(true);
            detail.setWrapStyleWord(true);
            detail.setFont(new Font(Font.MONOSPACED, Font.PLAIN,
                    detail.getFont().getSize()));
            detail.setName("chainlesschain.automation.detail");
            detail.getAccessibleContext().setAccessibleName(
                    "ChainlessChain automation details");
            picker.setName("chainlesschain.automation.flows");
            picker.getAccessibleContext().setAccessibleName(
                    "ChainlessChain automation flows");

            JButton refresh = new JButton("Refresh");
            refresh.addActionListener(event -> load());
            search.addDocumentListener(new DocumentAdapter() {
                @Override protected void textChanged(@NotNull DocumentEvent event) {
                    applyFilter();
                }
            });
            picker.addActionListener(event -> {
                if (!syncing.get()) syncSelection();
            });
            runBtn.addActionListener(event -> action("run_now"));
            pauseBtn.addActionListener(event -> action("pause"));
            resumeBtn.addActionListener(event -> action("resume"));
            runBtn.setName("chainlesschain.automation.runNow");
            pauseBtn.setName("chainlesschain.automation.pause");
            resumeBtn.setName("chainlesschain.automation.resume");

            JPanel actions = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
            actions.add(refresh);
            actions.add(runBtn);
            actions.add(pauseBtn);
            actions.add(resumeBtn);
            JPanel top = new JPanel(new BorderLayout(6, 6));
            top.add(search, BorderLayout.NORTH);
            top.add(picker, BorderLayout.CENTER);
            top.add(actions, BorderLayout.SOUTH);
            root.add(top, BorderLayout.NORTH);
            root.add(new JBScrollPane(detail), BorderLayout.CENTER);
            root.add(summary, BorderLayout.SOUTH);
            syncSelection();
        }

        private File cwd() {
            return project.getBasePath() == null ? null : new File(project.getBasePath());
        }

        private void schedule(int delayMs) {
            alarm.addRequest(this::tick, delayMs);
        }

        private void tick() {
            if (toolWindow.isVisible()) load();
            schedule(REFRESH_MS);
        }

        private AutomationCenter.Snapshot read() {
            String output = AgentChatSession.runCapture(
                    List.of("automation", "center-projection", "--json"),
                    cwd(), CLI_TIMEOUT_MS);
            return AutomationCenter.parse(output);
        }

        private void load() {
            if (!inFlight.compareAndSet(false, true)) return;
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                AutomationCenter.Snapshot next = read();
                ApplicationManager.getApplication().invokeLater(() -> {
                    try {
                        snapshot = next;
                        applyFilter();
                    } finally {
                        inFlight.set(false);
                    }
                });
            });
        }

        private void applyFilter() {
            String keepId = selected() == null ? null : selected().id;
            visible = snapshot.connected
                    ? AutomationCenter.filter(snapshot.flows, search.getText())
                    : new ArrayList<>();
            syncing.set(true);
            try {
                picker.removeAllItems();
                int select = -1;
                for (int i = 0; i < visible.size(); i++) {
                    AutomationCenter.Flow flow = visible.get(i);
                    picker.addItem(flow.name + " · " + flow.status
                            + " · preflight " + flow.securityState);
                    if (flow.id.equals(keepId)) select = i;
                }
                if (!visible.isEmpty()) picker.setSelectedIndex(select >= 0 ? select : 0);
            } finally {
                syncing.set(false);
            }
            summary.setText(snapshot.connected
                    ? snapshot.total + " flows · " + snapshot.active + " active · "
                            + snapshot.paused + " paused · " + snapshot.needsAttention
                            + " need attention"
                    : "Automation Center unavailable: " + snapshot.error);
            syncSelection();
        }

        private AutomationCenter.Flow selected() {
            int index = picker.getSelectedIndex();
            return index >= 0 && index < visible.size() ? visible.get(index) : null;
        }

        private void syncSelection() {
            AutomationCenter.Flow flow = selected();
            detail.setText(flow == null ? "No automation flow." : AutomationCenter.detail(flow));
            runBtn.setEnabled(available(flow, "run_now"));
            pauseBtn.setEnabled(available(flow, "pause"));
            resumeBtn.setEnabled(available(flow, "resume"));
        }

        private static boolean available(AutomationCenter.Flow flow, String action) {
            return flow != null && flow.actions.get(action) != null
                    && flow.actions.get(action).available;
        }

        private void action(String action) {
            AutomationCenter.Snapshot rendered = snapshot;
            AutomationCenter.Flow flow = selected();
            if (flow == null || !available(flow, action)) return;
            inFlight.set(true);
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                AutomationCenter.Snapshot current = read();
                AutomationCenter.ActionPreview preview = AutomationCenter.recheck(
                        rendered, current, flow.id, action, rendered.revision, flow.revision);
                if (preview == null) {
                    ApplicationManager.getApplication().invokeLater(() -> {
                        snapshot = current;
                        inFlight.set(false);
                        applyFilter();
                        Messages.showWarningDialog(project,
                                "Automation changed or this action is no longer available.",
                                "Automation Center");
                    });
                    return;
                }
                ApplicationManager.getApplication().invokeLater(() -> {
                    int answer = Messages.showYesNoDialog(project,
                            "Run “" + action.replace('_', ' ') + "” for " + flow.id
                                    + "? The CLI will enforce the exact revision, live permissions, and budget.",
                            "Automation Center", null);
                    if (answer != Messages.YES) {
                        inFlight.set(false);
                        return;
                    }
                    ApplicationManager.getApplication().executeOnPooledThread(() -> {
                        String output = AgentChatSession.runCapture(
                                preview.argv, cwd(), CLI_TIMEOUT_MS);
                        AutomationCenter.Snapshot next = read();
                        ApplicationManager.getApplication().invokeLater(() -> {
                            snapshot = next;
                            inFlight.set(false);
                            applyFilter();
                            if (output.isEmpty()) Messages.showErrorDialog(project,
                                    "Automation action failed. Refresh for the current CLI state.",
                                    "Automation Center");
                        });
                    });
                });
            });
        }
    }
}
