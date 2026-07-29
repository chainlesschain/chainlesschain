package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.TeamControl;
import com.chainlesschain.ide.TeamControlCommandRunner;
import com.chainlesschain.ide.TeamMonitor;
import com.intellij.ide.util.PropertiesComponent;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.fileChooser.FileChooser;
import com.intellij.openapi.fileChooser.FileChooserDescriptor;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogBuilder;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.vfs.LocalFileSystem;
import com.intellij.openapi.vfs.VirtualFile;
import org.jetbrains.annotations.NotNull;

import javax.swing.JButton;
import javax.swing.JComboBox;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Font;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * "cc team" Agent View (Tools menu): monitor a durable legacy v6 team state or
 * schema-v1 distributed queue and request human takeover, managed checkpoint
 * recovery, or side-effect adjudication through the CLI.
 *
 * <p>The action never writes the state file. A button click pins the rendered
 * legacy stateId/digest or distributed queue authority plus exact
 * lease/evidence; after the operator supplies a reason and confirms, the file
 * is re-read and CAS-validated immediately before a shell-free
 * {@link ProcessBuilder} invocation. The CLI owns locking and durable state.
 */
public final class TeamMonitorAction extends AnAction {

    private static final String KEY = "cc.team.lastStatePath";

    @Override
    public void actionPerformed(@NotNull AnActionEvent event) {
        final Project project = event.getProject();
        if (project == null) return;

        FileChooserDescriptor descriptor =
                new FileChooserDescriptor(true, false, false, false, false, false)
                        .withTitle("Select a cc team state snapshot")
                        .withDescription(
                                "A legacy `cc team run --state` or distributed "
                                        + "`cc team queue --state` JSON file");
        PropertiesComponent props = PropertiesComponent.getInstance(project);
        VirtualFile toSelect = null;
        String last = props.getValue(KEY);
        if (last != null) toSelect = LocalFileSystem.getInstance().findFileByPath(last);

        VirtualFile chosen = FileChooser.chooseFile(descriptor, project, toSelect);
        if (chosen == null) return;
        final String path = chosen.getPath();
        props.setValue(KEY, path);
        showDialog(project, path);
    }

    private static TeamMonitor.State readState(String path) throws IOException {
        String json = Files.readString(Paths.get(path), StandardCharsets.UTF_8);
        return TeamMonitor.parse(json);
    }

    private static void showDialog(Project project, String path) {
        AtomicReference<TeamMonitor.State> renderedState =
                new AtomicReference<TeamMonitor.State>();
        AtomicBoolean controlBusy = new AtomicBoolean(false);

        JTextArea area = new JTextArea("Loading " + path + " …");
        area.setEditable(false);
        area.setFont(new Font(Font.MONOSPACED, Font.PLAIN, area.getFont().getSize()));
        area.setCaretPosition(0);
        JScrollPane scroll = new JScrollPane(area);
        scroll.setPreferredSize(new Dimension(900, 500));

        JComboBox<TaskChoice> tasks = new JComboBox<TaskChoice>();
        tasks.setPreferredSize(new Dimension(300, tasks.getPreferredSize().height));
        JButton refresh = new JButton("Refresh");
        JButton takeover = new JButton("Take over");
        JButton recover = new JButton("Recover checkpoint");
        JButton retry = new JButton("Retry");
        JButton accept = new JButton("Accept prior effect");
        JButton cancel = new JButton("Cancel task");
        JLabel status = new JLabel(" ");

        Runnable updateControls = () -> {
            TeamMonitor.State state = renderedState.get();
            TaskChoice choice = (TaskChoice) tasks.getSelectedItem();
            TeamMonitor.Task task = choice == null
                    ? null : TeamMonitor.findTask(state, choice.key);
            boolean authorityReady = state != null && state.ok
                    && (state.distributedQueue
                            || state.version == 6 && state.stateId != null);
            boolean ready = !controlBusy.get() && authorityReady && task != null;
            takeover.setEnabled(ready
                    && "in_progress".equals(task.status)
                    && (state.distributedQueue
                            ? task.holder != null && task.leaseId != null
                                    && task.fencingToken instanceof Long
                            : task.attemptDigest != null));
            boolean needsDecision = ready && task.adjudication != null
                    && task.adjudication.required
                    && (state.distributedQueue
                            ? task.evidenceDigest != null
                            : task.adjudicationDigest != null);
            recover.setEnabled(needsDecision && state.distributedQueue
                    && task.checkpointRecoveryRequired);
            retry.setEnabled(needsDecision);
            accept.setEnabled(needsDecision);
            cancel.setEnabled(needsDecision);
            refresh.setEnabled(!controlBusy.get());
            tasks.setEnabled(!controlBusy.get() && tasks.getItemCount() > 0);
        };

        Runnable reload = () -> reload(
                area, tasks, status, renderedState, path, updateControls);
        refresh.addActionListener(ignored -> reload.run());
        tasks.addActionListener(ignored -> updateControls.run());

        takeover.addActionListener(ignored -> control(
                project, path, renderedState.get(), selectedKey(tasks),
                TeamControl.Action.INTERRUPT, null, status, controlBusy,
                updateControls, reload));
        recover.addActionListener(ignored -> control(
                project, path, renderedState.get(), selectedKey(tasks),
                TeamControl.Action.RECOVER, null, status, controlBusy,
                updateControls, reload));
        retry.addActionListener(ignored -> control(
                project, path, renderedState.get(), selectedKey(tasks),
                TeamControl.Action.ADJUDICATE, "retry", status, controlBusy,
                updateControls, reload));
        accept.addActionListener(ignored -> control(
                project, path, renderedState.get(), selectedKey(tasks),
                TeamControl.Action.ADJUDICATE, "accept", status, controlBusy,
                updateControls, reload));
        cancel.addActionListener(ignored -> control(
                project, path, renderedState.get(), selectedKey(tasks),
                TeamControl.Action.ADJUDICATE, "cancel", status, controlBusy,
                updateControls, reload));

        JPanel firstRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
        firstRow.add(new JLabel("Task:"));
        firstRow.add(tasks);
        firstRow.add(refresh);
        firstRow.add(status);
        JPanel secondRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
        secondRow.add(takeover);
        secondRow.add(recover);
        secondRow.add(retry);
        secondRow.add(accept);
        secondRow.add(cancel);
        JPanel top = new JPanel(new BorderLayout(0, 6));
        top.add(firstRow, BorderLayout.NORTH);
        top.add(secondRow, BorderLayout.SOUTH);

        JPanel panel = new JPanel(new BorderLayout(0, 6));
        panel.add(top, BorderLayout.NORTH);
        panel.add(scroll, BorderLayout.CENTER);

        updateControls.run();
        reload.run();

        DialogBuilder builder = new DialogBuilder(project);
        builder.setTitle("ChainlessChain · Team Agent View");
        builder.setCenterPanel(panel);
        builder.addOkAction().setText("Close");
        builder.show();
    }

    /**
     * Pin the rendered authority before prompting. The immutable intent
     * survives refreshes and state-file changes while the modal confirmation
     * is open; {@link TeamControl#execute} rejects it if it became stale.
     */
    private static void control(Project project, String path,
            TeamMonitor.State renderedState, String taskKey, TeamControl.Action action,
            String decision, JLabel status, AtomicBoolean busy,
            Runnable updateControls, Runnable reload) {
        TeamControl.Target pinned;
        if (action == TeamControl.Action.INTERRUPT) {
            pinned = TeamControl.pinInterrupt(renderedState, taskKey);
        } else if (action == TeamControl.Action.RECOVER) {
            pinned = TeamControl.pinRecovery(renderedState, taskKey);
        } else {
            pinned = TeamControl.pinAdjudication(renderedState, taskKey, decision);
        }
        if (!pinned.ok) {
            Messages.showErrorDialog(project, pinned.error, "Team Control");
            return;
        }

        String prompt;
        if (action == TeamControl.Action.INTERRUPT) {
            prompt = "Why are you taking over \"" + pinned.task.title + "\"?";
        } else if (action == TeamControl.Action.RECOVER) {
            prompt = "Why are you recovering the checkpoint for \""
                    + pinned.task.title + "\"?";
        } else {
            prompt = adjudicationPrompt(decision, pinned.task.title);
        }
        String reasonInput = Messages.showInputDialog(
                project, prompt, "Team Control Reason", null);
        if (reasonInput == null) return;
        String reason = TeamControl.normalizeReason(reasonInput);
        if (reason == null) {
            Messages.showErrorDialog(project,
                    "A non-empty reason of at most 500 characters without control "
                            + "characters is required.",
                    "Team Control");
            return;
        }

        String warning = controlWarning(action, decision, pinned.task.title, reason);
        int confirmed = Messages.showYesNoDialog(
                project, warning, "Confirm Team Control", "Continue", "Cancel", null);
        if (confirmed != Messages.YES) return;
        if (!busy.compareAndSet(false, true)) return;
        status.setText("validating authority…");
        updateControls.run();

        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            // Binary probing may take time, so complete it before the final
            // state-file re-read performed inside execute().
            String binary = AgentChatSession.resolveBinary();
            File cwd = project.getBasePath() == null
                    ? parentDirectory(path) : new File(project.getBasePath());
            TeamControl.Result result = TeamControl.execute(
                    path,
                    pinned.intent,
                    reason,
                    TeamMonitorAction::readState,
                    (args, timeoutMs) -> TeamControlCommandRunner.run(
                            TeamControlCommandRunner.resolveCommand(binary),
                            args, cwd, timeoutMs));
            ApplicationManager.getApplication().invokeLater(() -> {
                busy.set(false);
                status.setText(result.ok ? "control recorded" : "control rejected");
                if (result.ok) {
                    Messages.showInfoMessage(project,
                            successMessage(action, decision, pinned.task.title),
                            "Team Control");
                } else {
                    Messages.showErrorDialog(project, result.error, "Team Control");
                }
                updateControls.run();
                reload.run();
            });
        });
    }

    /**
     * Re-read and render off the EDT. Updating the task picker and the state
     * reference happens in the same EDT callback, so a click never combines a
     * task key from one render with authority from another.
     */
    private static void reload(JTextArea area, JComboBox<TaskChoice> tasks,
            JLabel status, AtomicReference<TeamMonitor.State> renderedState,
            String path, Runnable updateControls) {
        status.setText("loading…");
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            TeamMonitor.State state = null;
            String report;
            try {
                state = readState(path);
                report = TeamMonitor.formatReport(state, System.currentTimeMillis());
            } catch (IOException error) {
                report = "cc team monitor\n\ncannot read file: "
                        + TeamControl.safeFailureText(error.getMessage()) + "\n";
            }
            TeamMonitor.State loaded = state;
            String rendered = report;
            ApplicationManager.getApplication().invokeLater(() -> {
                String selected = selectedKey(tasks);
                renderedState.set(loaded);
                area.setText(rendered);
                area.setCaretPosition(0);
                tasks.removeAllItems();
                if (loaded != null && loaded.ok) {
                    for (TeamMonitor.Task task : loaded.tasks) {
                        if (task.key != null) tasks.addItem(new TaskChoice(task));
                    }
                }
                restoreSelection(tasks, selected);
                status.setText(loaded != null && loaded.ok
                        ? loaded.distributedQueue
                                ? "distributed queue control ready"
                                : loaded.version == 6 && loaded.stateId != null
                                        ? "v6 control ready"
                                : "legacy state: monitor only"
                        : "state unavailable");
                updateControls.run();
            });
        });
    }

    private static void restoreSelection(JComboBox<TaskChoice> tasks, String taskKey) {
        if (taskKey == null) return;
        for (int index = 0; index < tasks.getItemCount(); index++) {
            TaskChoice item = tasks.getItemAt(index);
            if (taskKey.equals(item.key)) {
                tasks.setSelectedIndex(index);
                return;
            }
        }
    }

    private static String selectedKey(JComboBox<TaskChoice> tasks) {
        TaskChoice choice = (TaskChoice) tasks.getSelectedItem();
        return choice == null ? null : choice.key;
    }

    private static File parentDirectory(String path) {
        Path parent = Paths.get(path).toAbsolutePath().getParent();
        return parent == null ? null : parent.toFile();
    }

    private static String adjudicationPrompt(String decision, String title) {
        if ("retry".equals(decision)) {
            return "Why is it safe to retry \"" + title + "\"?";
        }
        if ("accept".equals(decision)) {
            return "Why should the prior effect for \"" + title + "\" be accepted?";
        }
        return "Why should \"" + title + "\" remain cancelled?";
    }

    private static String controlWarning(TeamControl.Action action, String decision,
            String title, String reason) {
        String impact;
        if (action == TeamControl.Action.INTERRUPT) {
            impact = "This requests a durable interrupt of the current teammate.";
        } else if (action == TeamControl.Action.RECOVER) {
            impact = "The CLI recovers only the evidence-pinned managed checkpoint; "
                    + "retry still requires its clean Git/worktree gate.";
        } else if ("retry".equals(decision)) {
            impact = "Retry may repeat an external side effect. Confirm only after "
                    + "checking the prior attempt.";
        } else if ("accept".equals(decision)) {
            impact = "Accept records the ambiguous prior effect without rerunning it.";
        } else {
            impact = "Cancel resolves the ambiguity without retrying or accepting it.";
        }
        return impact + "\n\nTask: " + title + "\nReason: " + reason;
    }

    private static String successMessage(TeamControl.Action action, String decision,
            String title) {
        if (action == TeamControl.Action.INTERRUPT) {
            return "Takeover requested for \"" + title + "\".";
        }
        if (action == TeamControl.Action.RECOVER) {
            return "Checkpoint recovery requested for \"" + title + "\".";
        }
        if ("retry".equals(decision)) {
            return "Retry approved for \"" + title + "\".";
        }
        if ("accept".equals(decision)) {
            return "Prior effect accepted for \"" + title + "\".";
        }
        return "Cancellation confirmed for \"" + title + "\".";
    }

    private static final class TaskChoice {
        final String key;
        final String label;

        TaskChoice(TeamMonitor.Task task) {
            this.key = task.key;
            StringBuilder value = new StringBuilder();
            value.append('[').append(task.status).append("] ").append(task.title);
            if (task.holder != null) value.append(" @").append(task.holder);
            if (task.adjudication != null && task.adjudication.required) {
                value.append(" · needs decision");
            }
            this.label = value.toString();
        }

        @Override
        public String toString() {
            return label;
        }
    }
}
