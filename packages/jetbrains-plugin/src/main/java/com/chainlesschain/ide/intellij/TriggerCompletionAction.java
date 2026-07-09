package com.chainlesschain.ide.intellij;

import com.intellij.openapi.actionSystem.ActionManager;
import com.intellij.openapi.actionSystem.ActionUpdateThread;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.actionSystem.CommonDataKeys;
import org.jetbrains.annotations.NotNull;

/**
 * "Trigger ChainlessChain Completion" — fires an explicit inline-completion
 * request at the caret, which {@link CcInlineCompletionProvider} answers with
 * ghost text. This is the manual trigger (default Alt+\, matching the VS Code
 * keybinding); nothing runs on ordinary typing.
 *
 * It delegates to the platform's own "Call Inline Completion" action rather than
 * constructing the request itself — that keeps us off the deprecated
 * DirectCall/handler API and rides the platform's maintained trigger path across
 * IDE versions. Fails quiet when there is no editor (no error, just nothing).
 */
public final class TriggerCompletionAction extends AnAction {

    /** Platform action that raises a manual (DirectCall) inline-completion event. */
    private static final String PLATFORM_TRIGGER_ID = "CallInlineCompletionAction";

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        if (e.getData(CommonDataKeys.EDITOR) == null) return;
        AnAction delegate = ActionManager.getInstance().getAction(PLATFORM_TRIGGER_ID);
        if (delegate != null) delegate.actionPerformed(e);
    }

    @Override
    public void update(@NotNull AnActionEvent e) {
        e.getPresentation().setEnabled(e.getData(CommonDataKeys.EDITOR) != null);
    }

    @Override
    public @NotNull ActionUpdateThread getActionUpdateThread() {
        return ActionUpdateThread.BGT;
    }
}
