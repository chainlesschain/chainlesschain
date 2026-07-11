package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.ManagedCliRuntime;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import org.jetbrains.annotations.NotNull;

import java.util.Map;

/**
 * Tools → "ChainlessChain: Roll Back Managed CLI" — one-step rollback of the
 * plugin-managed cc copy to {@code previousVersion} (gated: nothing happens
 * without a recorded previous version whose dir is still on disk; rolling
 * back consumes the slot). All decisions live in the pure
 * {@link ManagedCliRuntime#runManagedRollback} twin.
 */
public final class RollbackManagedCliAction extends AnAction {

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        final Project project = e.getProject();
        final String rootDir = ManagedCliRuntime.defaultRootDir();
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            Map<String, Object> state =
                    ManagedCliRuntime.readManagedState(rootDir, ManagedCliRuntime.REAL);
            final Object current = state == null ? null : state.get("version");
            final Object previous = state == null ? null : state.get("previousVersion");
            if (!(previous instanceof String) || ((String) previous).isEmpty()) {
                ApplicationManager.getApplication().invokeLater(() ->
                        Messages.showInfoMessage(project,
                                CcBundle.message("managedCli.rollback.none"),
                                CcBundle.message("managedCli.rollback.confirm.title")));
                return;
            }
            ApplicationManager.getApplication().invokeLater(() -> {
                int r = Messages.showYesNoDialog(project,
                        CcBundle.message("managedCli.rollback.confirm.body",
                                current, previous),
                        CcBundle.message("managedCli.rollback.confirm.title"),
                        Messages.getQuestionIcon());
                if (r != Messages.YES) return;
                ApplicationManager.getApplication().executeOnPooledThread(() -> {
                    Map<String, Object> res = ManagedCliRuntime.runManagedRollback(
                            rootDir, new ManagedCliRuntime.Io());
                    ApplicationManager.getApplication().invokeLater(() -> {
                        if (Boolean.TRUE.equals(res.get("ok"))) {
                            CcSettings.getInstance().applyToRuntime();
                            Messages.showInfoMessage(project,
                                    CcBundle.message("managedCli.rollback.ok",
                                            res.get("version")),
                                    CcBundle.message("managedCli.rollback.confirm.title"));
                        } else {
                            Messages.showErrorDialog(project,
                                    CcBundle.message("managedCli.rollback.fail",
                                            String.valueOf(res.get("reason"))),
                                    CcBundle.message("managedCli.rollback.confirm.title"));
                        }
                    });
                });
            });
        });
    }
}
