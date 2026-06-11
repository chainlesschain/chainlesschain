package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.LlmConfig;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.progress.ProgressIndicator;
import com.intellij.openapi.progress.Task;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import org.jetbrains.annotations.NotNull;

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
        Project project = e.getProject();

        String[] labels = new String[LlmConfig.PRESETS.length];
        for (int i = 0; i < LlmConfig.PRESETS.length; i++) {
            LlmConfig.Preset p = LlmConfig.PRESETS[i];
            labels[i] = p.label + "  —  默认 " + p.defaultModel + (p.needsKey ? " (需 API key)" : " (免 key)");
        }
        int idx = Messages.showChooseDialog(project,
                "选择 LLM 提供商(写入 ~/.chainlesschain/config.json,CLI 与各编辑器共用)",
                TITLE, Messages.getQuestionIcon(), labels, labels[0]);
        if (idx < 0) return;
        LlmConfig.Preset preset = LlmConfig.PRESETS[idx];

        String model = Messages.showInputDialog(project,
                "模型名(" + preset.id + ")", TITLE, null, preset.defaultModel, null);
        if (model == null) return;

        String apiKey = "";
        if (preset.needsKey) {
            apiKey = Messages.showPasswordDialog(
                    preset.label + " 的 API key(只写入本机 config.json,不进 IDE 设置)", TITLE);
            if (apiKey == null || apiKey.trim().isEmpty()) {
                Messages.showWarningDialog(project,
                        "未输入 API key — 配置已取消(该提供商必须有 key)。", TITLE);
                return;
            }
        }

        String baseUrl = Messages.showInputDialog(project,
                "Base URL(回车用默认)", TITLE, null, preset.baseUrl, null);
        if (baseUrl == null) return;

        final String fModel = model, fKey = apiKey, fBaseUrl = baseUrl;
        new Task.Backgroundable(project, "ChainlessChain: 写入 LLM 配置并验证连通…", false) {
            @Override
            public void run(@NotNull ProgressIndicator indicator) {
                final String applyError =
                        LlmConfig.applyConfig(preset.id, fModel, fKey, fBaseUrl);
                final LlmConfig.CliResult test =
                        applyError == null ? LlmConfig.testLlm() : null;
                ApplicationManager.getApplication().invokeLater(() -> {
                    if (applyError != null) {
                        Messages.showErrorDialog(project, "LLM 配置写入失败:" + applyError, TITLE);
                    } else if (test.ok) {
                        Messages.showInfoMessage(project,
                                "LLM 配置完成并连通 ✓ (" + preset.id + " · " + fModel + ")。"
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
