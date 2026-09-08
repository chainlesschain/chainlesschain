package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.LlmConfig;
import com.chainlesschain.ide.LlmConnectionPanel;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.application.ModalityState;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogWrapper;
import com.intellij.openapi.ui.Messages;
import org.jetbrains.annotations.NotNull;
import javax.swing.Action;
import javax.swing.JComponent;
import java.util.concurrent.Callable;

/** One native form, with atomic CLI writes and explicit readback. */
public final class ConfigureLlmAction extends AnAction {
    @Override public void actionPerformed(@NotNull AnActionEvent event) { runWizard(event.getProject()); }
    public static boolean runWizard(Project project) {
        ConnectionDialog dialog = new ConnectionDialog(project);
        dialog.show();
        return dialog.saved;
    }

    private static final class ConnectionDialog extends DialogWrapper {
        private final LlmConnectionPanel form = new LlmConnectionPanel(CcBundle::message);
        private boolean closed, saved;
        ConnectionDialog(Project project) {
            super(project, true);
            setTitle(CcBundle.message("llm.dialogTitle"));
            setCancelButtonText(CcBundle.message("llm.form.close"));
            init();
            form.onReload(this::reload); form.onSave(this::save); form.onTest(this::test);
            reload();
        }
        @Override protected JComponent createCenterPanel() { return form; }
        @Override protected Action @NotNull [] createActions() { return new Action[]{getCancelAction()}; }
        @Override protected String getDimensionServiceKey() { return "ChainlessChain.LlmConnection"; }
        @Override protected void dispose() { closed = true; form.clearSecret(); super.dispose(); }

        private void background(String status, Callable<Runnable> operation) {
            form.setBusy(true); form.notice(status);
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                Runnable result;
                try { result = operation.call(); }
                catch (Exception error) { result = () -> form.notice(CcBundle.message("llm.form.readFailed")); }
                final Runnable finish = result;
                ApplicationManager.getApplication().invokeLater(() -> {
                    if (closed) return;
                    try { finish.run(); } finally { form.setBusy(false); }
                }, ModalityState.any());
            });
        }
        private void reload() {
            background(CcBundle.message("llm.form.loading"), () -> {
                LlmConfig.Connection saved = LlmConfig.readConnection();
                return () -> form.load(saved);
            });
        }
        private void save() {
            LlmConfig.Connection submitted = form.connection();
            boolean allowHttp = form.allowHttp();
            String validation = LlmConfig.validateConnection(submitted, allowHttp);
            if (validation != null) { form.notice(validation); return; }
            if (form.needsNewKey()) { form.notice(CcBundle.message("llm.form.newKeyRequired")); return; }
            String key = form.apiKey();
            background(CcBundle.message("llm.form.saving"), () -> {
                String error = LlmConfig.saveConnection(submitted, key, allowHttp);
                if (error != null) return () -> form.notice(CcBundle.message("llm.error.configWrite", error));
                LlmConfig.Connection confirmed = new LlmConfig.Connection(submitted.provider, submitted.model,
                        LlmConfig.normalizedBaseUrl(submitted.baseUrl), submitted.visionModel,
                        !"ollama".equals(submitted.provider));
                return () -> { saved = true; form.load(confirmed); form.notice(CcBundle.message("llm.form.saved")); };
            });
        }
        private void test() {
            background(CcBundle.message("llm.form.testing"), () -> {
                LlmConfig.CliResult result = LlmConfig.testLlm();
                return () -> form.notice(CcBundle.message(result.ok ? "llm.form.testPassed" : "llm.form.testFailed", result.output));
            });
        }
    }

    public static void configureVisionModel(Project project) {
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            final String current = LlmConfig.getConfiguredVisionModel();
            ApplicationManager.getApplication().invokeLater(() -> {
                if (project != null && project.isDisposed()) return;
                String vision = Messages.showInputDialog(project, CcBundle.message("llm.prompt.vision"),
                        CcBundle.message("llm.dialogTitle"), null, current == null ? "" : current, null);
                if (vision == null) return;
                ApplicationManager.getApplication().executeOnPooledThread(() -> {
                    String error = LlmConfig.setVisionModel(vision);
                    ApplicationManager.getApplication().invokeLater(() -> {
                        if (project != null && project.isDisposed()) return;
                        if (error != null) Messages.showErrorDialog(project, CcBundle.message("llm.error.visionWrite", error), CcBundle.message("llm.dialogTitle"));
                        else Messages.showInfoMessage(project, CcBundle.message(vision.trim().isEmpty() ? "llm.info.visionCleared" : "llm.info.visionSet", vision.trim()), CcBundle.message("llm.dialogTitle"));
                    }, ModalityState.any());
                });
            }, ModalityState.any());
        });
    }
}
