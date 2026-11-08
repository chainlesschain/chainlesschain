package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.SessionModelInputs;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogBuilder;
import com.intellij.openapi.ui.Messages;
import org.jetbrains.annotations.NotNull;

import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import java.io.File;

/** Current chat session only; all diagnostic authority remains in the CLI journal. */
public final class ModelInputDiagnosticsAction extends AnAction implements DumbAware {
    @Override public void actionPerformed(@NotNull AnActionEvent event) {
        Project project = event.getProject();
        if (project == null) return;
        String sessionId = ChatToolWindowFactory.activeSessionIdOrNullFor(project);
        if (sessionId == null || sessionId.isBlank()) {
            Messages.showInfoMessage(project, "Open a ChainlessChain conversation first.", "Model Input Diagnostics");
            return;
        }
        File cwd = project.getBasePath() == null ? null : new File(project.getBasePath());
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            SessionModelInputs result;
            try {
                String json = AgentChatSession.runCapture(SessionModelInputs.arguments(sessionId), cwd, 30_000);
                result = SessionModelInputs.parse(json, sessionId);
            } catch (RuntimeException failure) {
                // CLI stderr, invalid JSON and arbitrary exception text never enter the UI.
                result = null;
            }
            SessionModelInputs captured = result;
            ApplicationManager.getApplication().invokeLater(() -> {
                if (project.isDisposed()) return;
                if (!sessionId.equals(ChatToolWindowFactory.activeSessionIdOrNullFor(project))) {
                    Messages.showInfoMessage(project, "The current conversation changed. Open diagnostics again.", "Model Input Diagnostics");
                    return;
                }
                if (captured == null) {
                    Messages.showErrorDialog(project, SessionModelInputs.UNAVAILABLE, "Model Input Diagnostics");
                    return;
                }
                JTextArea text = new JTextArea(captured.describe(), 28, 95);
                text.setEditable(false);
                text.setCaretPosition(0);
                text.setName("chainlesschain.modelInputs.summary");
                text.getAccessibleContext().setAccessibleName("Current session model input diagnostic summaries");
                DialogBuilder dialog = new DialogBuilder(project);
                dialog.setTitle("ChainlessChain - Current Session Model Inputs");
                dialog.setCenterPanel(new JScrollPane(text));
                dialog.removeAllActions();
                dialog.addCloseButton();
                dialog.show();
            });
        });
    }
}
