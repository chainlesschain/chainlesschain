package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.AutomationCenter;
import com.chainlesschain.ide.MiniJson;
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
import javax.swing.JTextArea;
import javax.swing.event.DocumentEvent;
import java.awt.BorderLayout;
import java.awt.FlowLayout;
import java.awt.Font;
import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/** JetBrains Automation Center over the same CLI-owned projection as VS Code. */
public final class AutomationCenterToolWindowFactory implements ToolWindowFactory, DumbAware {

    static final String TOOL_WINDOW_ID = "ChainlessChain Automation";
    private static final long CLI_TIMEOUT_MS = 30_000;
    private static final int REFRESH_MS = 15_000;

    @Override
    public void createToolWindowContent(@NotNull Project project,
            @NotNull ToolWindow toolWindow) {
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
        private final JButton createBtn = new JButton("New routine");
        private final JButton runBtn = new JButton("Run now");
        private final JButton retryBtn = new JButton("Retry failed");
        private final JButton pauseBtn = new JButton("Pause");
        private final JButton resumeBtn = new JButton("Resume");
        private final JButton disableBtn = new JButton("Disable");
        private final JButton deleteBtn = new JButton("Delete");
        private final JButton editBtn = new JButton("Edit routine");
        private final Alarm alarm;
        private final AtomicBoolean inFlight = new AtomicBoolean(false);
        private final AtomicBoolean syncing = new AtomicBoolean(false);
        private volatile AutomationCenter.Snapshot snapshot = AutomationCenter.parse(null);
        private List<AutomationCenter.Item> visible = new ArrayList<>();

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
            picker.setName("chainlesschain.automation.items");
            picker.getAccessibleContext().setAccessibleName(
                    "ChainlessChain automation items");

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
            createBtn.addActionListener(event -> createRoutine());
            runBtn.addActionListener(event -> action("run_now"));
            retryBtn.addActionListener(event -> action("retry_failed"));
            pauseBtn.addActionListener(event -> action("pause"));
            resumeBtn.addActionListener(event -> action("resume"));
            disableBtn.addActionListener(event -> action("disable"));
            deleteBtn.addActionListener(event -> action("delete"));
            editBtn.addActionListener(event -> action("edit"));
            createBtn.setName("chainlesschain.automation.createRoutine");
            runBtn.setName("chainlesschain.automation.runNow");
            retryBtn.setName("chainlesschain.automation.retryFailed");
            pauseBtn.setName("chainlesschain.automation.pause");
            resumeBtn.setName("chainlesschain.automation.resume");
            disableBtn.setName("chainlesschain.automation.disable");
            deleteBtn.setName("chainlesschain.automation.delete");
            editBtn.setName("chainlesschain.automation.editRoutine");

            JPanel actions = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
            actions.add(refresh);
            actions.add(createBtn);
            actions.add(runBtn);
            actions.add(retryBtn);
            actions.add(pauseBtn);
            actions.add(resumeBtn);
            actions.add(disableBtn);
            actions.add(deleteBtn);
            actions.add(editBtn);
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
                    snapshot = next;
                    inFlight.set(false);
                    applyFilter();
                });
            });
        }

        private void applyFilter() {
            AutomationCenter.Item selected = selected();
            String keepKey = selected == null
                    ? null : selected.kind + "\0" + selected.id;
            visible = snapshot.connected
                    ? AutomationCenter.filter(snapshot.items, search.getText())
                    : new ArrayList<>();
            syncing.set(true);
            try {
                picker.removeAllItems();
                int select = -1;
                for (int i = 0; i < visible.size(); i++) {
                    AutomationCenter.Item item = visible.get(i);
                    picker.addItem(item.name + " · " + item.kind + " · "
                            + item.status + " · preflight " + item.securityState);
                    if ((item.kind + "\0" + item.id).equals(keepKey)) select = i;
                }
                if (!visible.isEmpty()) picker.setSelectedIndex(select >= 0 ? select : 0);
            } finally {
                syncing.set(false);
            }
            summary.setText(snapshot.connected
                    ? snapshot.total + " items · " + snapshot.flowCount + " flows · "
                            + snapshot.routineCount + " routines · " + snapshot.active
                            + " active · " + snapshot.paused + " paused · "
                            + snapshot.needsAttention + " need attention"
                    : "Automation Center unavailable: " + snapshot.error);
            syncSelection();
        }

        private AutomationCenter.Item selected() {
            int index = picker.getSelectedIndex();
            return index >= 0 && index < visible.size() ? visible.get(index) : null;
        }

        private void syncSelection() {
            AutomationCenter.Item item = selected();
            detail.setText(item == null ? "No automation item." : AutomationCenter.detail(item));
            createBtn.setEnabled(snapshot.connected && snapshot.createRoutine != null);
            runBtn.setEnabled(available(item, "run_now"));
            retryBtn.setEnabled(available(item, "retry_failed"));
            pauseBtn.setEnabled(available(item, "pause"));
            resumeBtn.setEnabled(available(item, "resume"));
            disableBtn.setEnabled(available(item, "disable"));
            deleteBtn.setEnabled(available(item, "delete"));
            editBtn.setEnabled(available(item, "edit"));
        }

        private static boolean available(AutomationCenter.Item item, String action) {
            return item != null && item.actions.get(action) != null
                    && item.actions.get(action).available;
        }

        private void action(String action) {
            AutomationCenter.Snapshot rendered = snapshot;
            AutomationCenter.Item item = selected();
            if (item == null || !available(item, action)
                    || !inFlight.compareAndSet(false, true)) return;
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                AutomationCenter.Snapshot current = read();
                AutomationCenter.ActionPreview preview = AutomationCenter.recheck(
                        rendered, current, item.kind, item.id, action,
                        rendered.revision, item.revision);
                ApplicationManager.getApplication().invokeLater(() -> {
                    if (preview == null) {
                        snapshot = current;
                        inFlight.set(false);
                        applyFilter();
                        Messages.showWarningDialog(project,
                                "Automation changed or this action is no longer available.",
                                "Automation Center");
                        return;
                    }
                    String input = null;
                    if (preview.jsonStdin) {
                        input = routineDefinition(item.definition);
                        if (input == null) {
                            inFlight.set(false);
                            return;
                        }
                    } else {
                        int answer = Messages.showYesNoDialog(project,
                                "Run “" + action.replace('_', ' ') + "” for "
                                        + item.kind + " " + item.id
                                        + "? The CLI will enforce the exact revision.",
                                "Automation Center", null);
                        if (answer != Messages.YES) {
                            inFlight.set(false);
                            return;
                        }
                    }
                    final String payload = input;
                    ApplicationManager.getApplication().executeOnPooledThread(() -> {
                        String output = preview.jsonStdin
                                ? AgentChatSession.runCaptureInput(
                                        preview.argv, payload, cwd(), CLI_TIMEOUT_MS)
                                : AgentChatSession.runCapture(
                                        preview.argv, cwd(),
                                        "routine".equals(item.kind)
                                                && "run_now".equals(action)
                                                        ? 10 * 60_000
                                                        : CLI_TIMEOUT_MS);
                        finishMutation(output);
                    });
                });
            });
        }

        private void createRoutine() {
            AutomationCenter.Snapshot rendered = snapshot;
            if (!rendered.connected || rendered.createRoutine == null
                    || !inFlight.compareAndSet(false, true)) return;
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                AutomationCenter.Snapshot current = read();
                AutomationCenter.ActionPreview preview =
                        AutomationCenter.recheckCreateRoutine(rendered, current);
                ApplicationManager.getApplication().invokeLater(() -> {
                    if (preview == null) {
                        snapshot = current;
                        inFlight.set(false);
                        applyFilter();
                        Messages.showWarningDialog(project,
                                "Routine catalog changed; refreshed without creating it.",
                                "Automation Center");
                        return;
                    }
                    String definition = routineDefinition(null);
                    if (definition == null) {
                        inFlight.set(false);
                        return;
                    }
                    ApplicationManager.getApplication().executeOnPooledThread(() ->
                            finishMutation(AgentChatSession.runCaptureInput(
                                    preview.argv, definition, cwd(), CLI_TIMEOUT_MS)));
                });
            });
        }

        private void finishMutation(String output) {
            AutomationCenter.Snapshot next = read();
            ApplicationManager.getApplication().invokeLater(() -> {
                snapshot = next;
                inFlight.set(false);
                applyFilter();
                if (output.isEmpty()) Messages.showErrorDialog(project,
                        "Automation action failed. Refresh for the current CLI state.",
                        "Automation Center");
            });
        }

        @SuppressWarnings("unchecked")
        private String routineDefinition(Map<String, Object> current) {
            String name = Messages.showInputDialog(project, "Routine name",
                    "Automation Center", null,
                    current == null ? "" : String.valueOf(current.getOrDefault("name", "")),
                    null);
            if (name == null) return null;
            String prompt = Messages.showInputDialog(project, "Agent prompt",
                    "Automation Center", null,
                    current == null ? "" : String.valueOf(current.getOrDefault("prompt", "")),
                    null);
            if (prompt == null) return null;
            Map<String, Object> oldTrigger = current != null
                    && current.get("trigger") instanceof Map
                    ? (Map<String, Object>) current.get("trigger") : Map.of();
            String kind = Messages.showInputDialog(project,
                    "Trigger kind: cron, once, webhook, or github",
                    "Automation Center", null,
                    String.valueOf(oldTrigger.getOrDefault("kind", "webhook")), null);
            if (kind == null) return null;
            kind = kind.trim().toLowerCase();
            Map<String, Object> trigger = new LinkedHashMap<>();
            trigger.put("kind", kind);
            if ("cron".equals(kind)) {
                String cron = Messages.showInputDialog(project, "Five-field cron expression",
                        "Automation Center", null,
                        String.valueOf(oldTrigger.getOrDefault("cron", "0 9 * * *")), null);
                if (cron == null) return null;
                trigger.put("cron", cron);
            } else if ("once".equals(kind)) {
                String at = Messages.showInputDialog(project,
                        "One-shot ISO timestamp or epoch milliseconds",
                        "Automation Center", null,
                        String.valueOf(oldTrigger.getOrDefault("at", "")), null);
                if (at == null) return null;
                trigger.put("at", at);
            } else if ("github".equals(kind)) {
                String repo = Messages.showInputDialog(project, "Repository (owner/name)",
                        "Automation Center", null,
                        String.valueOf(oldTrigger.getOrDefault("repo", "")), null);
                if (repo == null) return null;
                Object oldEvents = oldTrigger.get("events");
                String eventDefault = oldEvents instanceof List
                        ? String.join(",", ((List<Object>) oldEvents).stream()
                                .map(String::valueOf).toList())
                        : "PushEvent,PullRequestEvent";
                String events = Messages.showInputDialog(project,
                        "Optional comma-separated GitHub event types",
                        "Automation Center", null, eventDefault, null);
                if (events == null) return null;
                trigger.put("repo", repo);
                trigger.put("events", Arrays.stream(events.split(","))
                        .map(String::trim).filter(value -> !value.isEmpty()).toList());
            }
            Map<String, Object> definition = MiniJson.obj();
            definition.put("name", name);
            definition.put("prompt", prompt);
            definition.put("trigger", trigger);
            return MiniJson.stringify(definition);
        }
    }
}
