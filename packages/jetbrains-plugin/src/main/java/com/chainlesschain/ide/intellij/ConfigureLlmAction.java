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
    private static final String TITLE = "ChainlessChain: Configure LLM";

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
            labels[i] = p.label + "  —  默认 " + p.defaultModel + (p.needsKey ? " (需 API key)" : " (免 key)")
                    + (p.id.equals(curProvider) ? "  ✓ 当前" : "");
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
                "模型名(" + preset.id + ")", TITLE, null, modelDefault, null);
        if (model == null) return;

        String apiKey = "";
        if (preset.needsKey) {
            boolean canKeep = sameProvider && curHasKey;
            apiKey = Messages.showPasswordDialog(
                    canKeep
                            ? preset.label + " 的 API key(留空 = 保留已有的 key,不必重输)"
                            : preset.label + " 的 API key(只写入本机 config.json,不进 IDE 设置)",
                    TITLE);
            if (apiKey == null) return; // cancelled
            // Blank + canKeep → applyConfig omits llm.apiKey, keeping the stored
            // one (buildConfigSetArgs skips blank values).
            if (apiKey.trim().isEmpty() && !canKeep) {
                Messages.showWarningDialog(project,
                        "未输入 API key — 配置已取消(该提供商必须有 key)。", TITLE);
                return;
            }
        }

        String baseUrlDefault = (sameProvider && curBaseUrl != null) ? curBaseUrl : preset.baseUrl;
        String baseUrl = Messages.showInputDialog(project,
                "Base URL(回车用默认)", TITLE, null, baseUrlDefault, null);
        if (baseUrl == null) return;

        // Vision (image-recognition) model — often differs from the text model.
        // Blank = reuse the text model / the CLI's own default vision model.
        String visionDefault = (sameProvider && curVision != null)
                ? curVision : LlmConfig.suggestVisionModel(preset.id);
        String visionModel = Messages.showInputDialog(project,
                "图片识别(视觉)模型(留空 = 与文本模型相同 / 用 CLI 默认)\n"
                        + "看图时自动切到此模型,可与文本模型不同。",
                TITLE, null, visionDefault, null);
        if (visionModel == null) return;

        configureAndVerify(project, preset, model, apiKey, baseUrl, visionModel);
    }

    /**
     * Dedicated entry to set ONLY the image-recognition (vision) model, without
     * re-running the full wizard or re-typing the API key. Prefills the current
     * value (or the configured provider's suggestion); blank clears it.
     */
    public static void configureVisionModel(Project project) {
        new Task.Backgroundable(project, "ChainlessChain: 读取当前视觉模型…", false) {
            @Override
            public void run(@NotNull ProgressIndicator indicator) {
                String current = LlmConfig.getConfiguredVisionModel();
                String provider = LlmConfig.getConfiguredProvider();
                final String prefill = (current != null && !current.trim().isEmpty())
                        ? current
                        : LlmConfig.suggestVisionModel(provider == null ? "" : provider);
                ApplicationManager.getApplication().invokeLater(() -> {
                    String vision = Messages.showInputDialog(project,
                            "图片识别(视觉)模型(留空 = 与文本模型相同 / 用 CLI 默认)\n"
                                    + "看图/粘贴截图时自动切到此模型,可与文本模型不同。",
                            TITLE, null, prefill, null);
                    if (vision == null) return; // cancelled
                    applyVisionModel(project, vision);
                });
            }
        }.queue();
    }

    private static void applyVisionModel(Project project, String visionModel) {
        final String fVision = visionModel;
        new Task.Backgroundable(project, "ChainlessChain: 写入视觉模型…", false) {
            @Override
            public void run(@NotNull ProgressIndicator indicator) {
                final String err = LlmConfig.setVisionModel(fVision);
                ApplicationManager.getApplication().invokeLater(() -> {
                    if (err != null) {
                        Messages.showErrorDialog(project, "视觉模型写入失败:" + err, TITLE);
                    } else if (fVision == null || fVision.trim().isEmpty()) {
                        Messages.showInfoMessage(project,
                                "已清除图片识别模型 —— 看图时复用文本模型 / CLI 默认。", TITLE);
                    } else {
                        Messages.showInfoMessage(project,
                                "图片识别模型已设为 " + fVision.trim()
                                        + " ✓(粘贴截图时自动切到它)。", TITLE);
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
                setTitle(TITLE);
                init();
            }
            @Override
            protected JComponent createCenterPanel() {
                JPanel p = new JPanel(new BorderLayout(8, 8));
                p.add(new JLabel("<html>选择 LLM 提供商<br/>(写入 ~/.chainlesschain/config.json,"
                        + "CLI 与各编辑器共用)</html>"), BorderLayout.NORTH);
                p.add(combo, BorderLayout.CENTER);
                return p;
            }
        };
        return dlg.showAndGet() ? combo.getSelectedIndex() : -1;
    }

    private static void configureAndVerify(Project project, LlmConfig.Preset preset,
                                    String model, String apiKey, String baseUrl, String visionModel) {
        final String fModel = model, fKey = apiKey, fBaseUrl = baseUrl, fVision = visionModel;
        new Task.Backgroundable(project, "ChainlessChain: 写入 LLM 配置并验证连通…", false) {
            @Override
            public void run(@NotNull ProgressIndicator indicator) {
                final String applyError =
                        LlmConfig.applyConfig(preset.id, fModel, fKey, fBaseUrl, fVision);
                final LlmConfig.CliResult test =
                        applyError == null ? LlmConfig.testLlm() : null;
                final String visionNote = (fVision != null && !fVision.trim().isEmpty())
                        ? " · 视觉 " + fVision : "";
                ApplicationManager.getApplication().invokeLater(() -> {
                    if (applyError != null) {
                        Messages.showErrorDialog(project, "LLM 配置写入失败:" + applyError, TITLE);
                    } else if (test.ok) {
                        Messages.showInfoMessage(project,
                                "LLM 配置完成并连通 ✓ (" + preset.id + " · " + fModel + visionNote + ")。"
                                        + "终端里的 cc agent 即刻生效。", TITLE);
                    } else {
                        Messages.showWarningDialog(project,
                                "配置已写入,但连通性测试未通过:" + test.output
                                        + " — 检查 key/网络后可重跑本向导。", TITLE);
                    }
                });
            }
        }.queue();
    }
}
