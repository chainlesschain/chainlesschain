package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.LlmConfig;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.progress.ProgressIndicator;
import com.intellij.openapi.progress.Task;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogWrapper;
import com.intellij.openapi.ui.Messages;
import org.jetbrains.annotations.NotNull;

import javax.swing.JComboBox;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JPanel;
import java.awt.BorderLayout;

/**
 * Tools-menu guided LLM setup (mirrors the VS Code wizard): provider →
 * model → API key → base URL, written through `cc config set` (single
 * source of truth: ~/.chainlesschain/config.json, shared with the CLI and
 * the VS Code extension — the key never enters IDE settings), then verified
 * with `cc llm test`. SDK-bound glue; all logic lives in the pure-JDK
 * {@link LlmConfig}.
 */
public final class ConfigureLlmAction extends AnAction {
    private static String title() {
        return CcBundle.message("llm.dialogTitle");
    }

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        runWizard(e.getProject());
    }

    /** Run the guided LLM-config wizard. Public so the chat panel can offer a
     *  quick entry (a "⚙ LLM" button + an error hint) into it. */
    public static void runWizard(Project project) {
        // Pre-read existing config so re-running PRE-FILLS instead of forcing a
        // full re-type ("更新后又要重新配置模型和key"). The API key is never read
        // into the UI — only its presence — so "blank = keep" stays secure.
        final String curProvider = LlmConfig.getConfiguredProvider();
        final String curModel = LlmConfig.getConfiguredModel();
        final String curBaseUrl = LlmConfig.getConfiguredBaseUrl();
        final String curVision = LlmConfig.getConfiguredVisionModel();
        final boolean curHasKey = LlmConfig.hasConfiguredApiKey();

        String[] labels = new String[LlmConfig.PRESETS.length];
        int curIdx = 0;
        for (int i = 0; i < LlmConfig.PRESETS.length; i++) {
            LlmConfig.Preset p = LlmConfig.PRESETS[i];
            labels[i] = p.label
                    + CcBundle.message("llm.preset.detail", p.defaultModel,
                            p.needsKey ? CcBundle.message("llm.preset.needsKey")
                                    : CcBundle.message("llm.preset.noKey"))
                    + (p.id.equals(curProvider) ? CcBundle.message("llm.preset.current") : "");
            if (p.id.equals(curProvider)) curIdx = i;
        }
        int idx = chooseProvider(project, labels, curIdx);
        if (idx < 0) return;
        LlmConfig.Preset preset = LlmConfig.PRESETS[idx];

        // Same provider as before → pre-fill current model/baseUrl/vision and
        // allow keeping the stored key. Switched provider → use preset defaults.
        boolean sameProvider = preset.id.equals(curProvider);
        String modelDefault = (sameProvider && curModel != null) ? curModel : preset.defaultModel;
        String model = Messages.showInputDialog(project,
                CcBundle.message("llm.prompt.model", preset.id), title(), null, modelDefault, null);
        if (model == null) return;

        String apiKey = "";
        if (preset.needsKey) {
            boolean canKeep = sameProvider && curHasKey;
            apiKey = Messages.showPasswordDialog(
                    canKeep
                            ? CcBundle.message("llm.prompt.apiKey.keep", preset.label)
                            : CcBundle.message("llm.prompt.apiKey.new", preset.label),
                    title());
            if (apiKey == null) return; // cancelled
            // Blank + canKeep → applyConfig omits llm.apiKey, keeping the stored
            // one (buildConfigSetArgs skips blank values).
            if (apiKey.trim().isEmpty() && !canKeep) {
                Messages.showWarningDialog(project,
                        CcBundle.message("llm.warn.noKey"), title());
                return;
            }
        }

        String baseUrlDefault = (sameProvider && curBaseUrl != null) ? curBaseUrl : preset.baseUrl;
        String baseUrl = Messages.showInputDialog(project,
                CcBundle.message("llm.prompt.baseUrl"), title(), null, baseUrlDefault, null);
        if (baseUrl == null) return;

        // Vision (image-recognition) model — often differs from the text model.
        // Blank = reuse the text model / the CLI's own default vision model.
        String visionDefault = (sameProvider && curVision != null)
                ? curVision : LlmConfig.suggestVisionModel(preset.id);
        String visionModel = Messages.showInputDialog(project,
                CcBundle.message("llm.prompt.vision"),
                title(), null, visionDefault, null);
        if (visionModel == null) return;

        configureAndVerify(project, preset, model, apiKey, baseUrl, visionModel);
    }

    /**
     * Dedicated entry to set ONLY the image-recognition (vision) model, without
     * re-running the full wizard or re-typing the API key. Prefills the current
     * value (or the configured provider's suggestion); blank clears it.
     */
    public static void configureVisionModel(Project project) {
        new Task.Backgroundable(project, CcBundle.message("llm.task.readVision"), false) {
            @Override
            public void run(@NotNull ProgressIndicator indicator) {
                String current = LlmConfig.getConfiguredVisionModel();
                String provider = LlmConfig.getConfiguredProvider();
                final String prefill = (current != null && !current.trim().isEmpty())
                        ? current
                        : LlmConfig.suggestVisionModel(provider == null ? "" : provider);
                ApplicationManager.getApplication().invokeLater(() -> {
                    String vision = Messages.showInputDialog(project,
                            CcBundle.message("llm.prompt.vision"),
                            title(), null, prefill, null);
                    if (vision == null) return; // cancelled
                    applyVisionModel(project, vision);
                });
            }
        }.queue();
    }

    private static void applyVisionModel(Project project, String visionModel) {
        final String fVision = visionModel;
        new Task.Backgroundable(project, CcBundle.message("llm.task.writeVision"), false) {
            @Override
            public void run(@NotNull ProgressIndicator indicator) {
                final String err = LlmConfig.setVisionModel(fVision);
                ApplicationManager.getApplication().invokeLater(() -> {
                    if (err != null) {
                        Messages.showErrorDialog(project, CcBundle.message("llm.error.visionWrite", err), title());
                    } else if (fVision == null || fVision.trim().isEmpty()) {
                        Messages.showInfoMessage(project,
                                CcBundle.message("llm.info.visionCleared"), title());
                    } else {
                        Messages.showInfoMessage(project,
                                CcBundle.message("llm.info.visionSet", fVision.trim()), title());
                    }
                });
            }
        }.queue();
    }

    /** Blocking provider chooser (combo box) — replaces the deprecated
     *  Messages.showChooseDialog; returns the selected index or -1 if cancelled. */
    private static int chooseProvider(Project project, String[] labels, int defaultIdx) {
        final JComboBox<String> combo = new JComboBox<>(labels);
        combo.setSelectedIndex(defaultIdx >= 0 && defaultIdx < labels.length ? defaultIdx : 0);
        DialogWrapper dlg = new DialogWrapper(project, true) {
            {
                setTitle(title());
                init();
            }
            @Override
            protected JComponent createCenterPanel() {
                JPanel p = new JPanel(new BorderLayout(8, 8));
                p.add(new JLabel(CcBundle.message("llm.chooser.label")), BorderLayout.NORTH);
                p.add(combo, BorderLayout.CENTER);
                return p;
            }
        };
        return dlg.showAndGet() ? combo.getSelectedIndex() : -1;
    }

    private static void configureAndVerify(Project project, LlmConfig.Preset preset,
                                    String model, String apiKey, String baseUrl, String visionModel) {
        final String fModel = model, fKey = apiKey, fBaseUrl = baseUrl, fVision = visionModel;
        new Task.Backgroundable(project, CcBundle.message("llm.task.writeConfig"), false) {
            @Override
            public void run(@NotNull ProgressIndicator indicator) {
                final String applyError =
                        LlmConfig.applyConfig(preset.id, fModel, fKey, fBaseUrl, fVision);
                final LlmConfig.CliResult test =
                        applyError == null ? LlmConfig.testLlm() : null;
                final String visionNote = (fVision != null && !fVision.trim().isEmpty())
                        ? CcBundle.message("llm.result.visionNote", fVision) : "";
                ApplicationManager.getApplication().invokeLater(() -> {
                    if (applyError != null) {
                        Messages.showErrorDialog(project, CcBundle.message("llm.error.configWrite", applyError), title());
                    } else if (test.ok) {
                        Messages.showInfoMessage(project,
                                CcBundle.message("llm.info.configured", preset.id, fModel, visionNote), title());
                    } else {
                        Messages.showWarningDialog(project,
                                CcBundle.message("llm.warn.testFailed", test.output), title());
                    }
                });
            }
        }.queue();
    }
}
