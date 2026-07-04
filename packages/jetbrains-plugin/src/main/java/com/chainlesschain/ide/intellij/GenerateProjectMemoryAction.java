package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.ProjectMemory;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.progress.ProgressIndicator;
import com.intellij.openapi.progress.Task;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.ui.popup.JBPopupFactory;
import org.jetbrains.annotations.NotNull;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * Tools-menu action: generate/refresh the project's cc.md via
 * {@code chainlesschain init} (VS Code "Generate Project Memory" parity).
 * Mode chooser (offline census vs --ai refine), then the CLI runs as a
 * background task and the captured tail shows in a dialog.
 */
public final class GenerateProjectMemoryAction extends AnAction {

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        Project project = e.getProject();
        if (project == null) return;
        List<String[]> modes = ProjectMemory.initModes();
        List<String> labels = new ArrayList<>();
        for (String[] m : modes) labels.add(m[0] + "  —  " + m[1]);
        JBPopupFactory.getInstance()
                .createPopupChooserBuilder(labels)
                .setTitle("Generate project memory (cc.md) how?")
                .setItemChosenCallback(label -> {
                    boolean ai = labels.indexOf(label) == 1;
                    runInit(project, ai);
                })
                .createPopup()
                .showCenteredInCurrentWindow(project);
    }

    private static void runInit(Project project, boolean ai) {
        final File cwd = project.getBasePath() != null ? new File(project.getBasePath()) : null;
        new Task.Backgroundable(project,
                "ChainlessChain: generating project memory" + (ai ? " (--ai)" : ""), false) {
            private String out;

            @Override
            public void run(@NotNull ProgressIndicator indicator) {
                // --ai runs a bounded headless agent — give it real time.
                out = AgentChatSession.runCapture(
                        ProjectMemory.buildInitArgs(ai, false), cwd, ai ? 600_000 : 120_000);
            }

            @Override
            public void onFinished() {
                String text = out == null ? "" : out.trim();
                if (text.isEmpty()) {
                    Messages.showWarningDialog(project,
                            "chainlesschain init produced no output — is the cc CLI installed?",
                            "Generate Project Memory");
                } else {
                    Messages.showInfoMessage(project, tail(text, 30),
                            "Generate Project Memory (cc.md)");
                }
            }
        }.queue();
    }

    /** Last {@code n} lines — init prints a census; the tail has the summary. */
    private static String tail(String text, int n) {
        String[] lines = text.split("\n", -1);
        if (lines.length <= n) return text;
        StringBuilder sb = new StringBuilder("…\n");
        for (int i = lines.length - n; i < lines.length; i++) {
            sb.append(lines[i]);
            if (i < lines.length - 1) sb.append('\n');
        }
        return sb.toString();
    }
}
