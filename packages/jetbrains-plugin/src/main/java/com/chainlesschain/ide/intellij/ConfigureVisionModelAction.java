package com.chainlesschain.ide.intellij;

import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import org.jetbrains.annotations.NotNull;

/**
 * Tools-menu entry to set ONLY the image-recognition (vision) model
 * ({@code llm.visionModel}) — a dedicated shortcut so the user does not have to
 * re-run the full Configure-LLM wizard (and re-type the API key) just to change
 * which model handles pasted screenshots. Thin glue; the flow lives in
 * {@link ConfigureLlmAction#configureVisionModel}.
 */
public final class ConfigureVisionModelAction extends AnAction {
    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        ConfigureLlmAction.configureVisionModel(e.getProject());
    }
}
