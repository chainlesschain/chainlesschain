package com.chainlesschain.ide.intellij;

import com.intellij.openapi.project.Project;
import com.intellij.terminal.ui.TerminalWidget;
import org.jetbrains.plugins.terminal.TerminalToolWindowManager;

import java.lang.reflect.Method;
import java.util.List;

/**
 * Opens an integrated terminal tab and runs a command in it. SDK-bound AND
 * terminal-plugin-bound: callers must guard with try/catch(Throwable), same
 * contract as {@link TerminalTextReader} — their clipboard/Messages fallback
 * takes over when anything here throws.
 *
 * <p>The tab-creation entry point is resolved reflectively because no single
 * non-deprecated method spans the supported range: 242 only has
 * {@code createShellWidget(...)}, which 2026.x deprecates in favor of a
 * TerminalToolWindowTabsManager builder that is {@code @ApiStatus.Experimental}
 * and absent from 242. Tried in order: {@code createShellWidget} (public on
 * every supported build, deprecated-not-removed), then its delegate
 * {@code createNewSession(String, String, List, boolean, boolean)} (243+) in
 * case a future build drops the former first.
 */
final class TerminalLauncher {

    private TerminalLauncher() {}

    static void run(Project project, String workingDir, String tabName, String cmd)
            throws Exception {
        TerminalToolWindowManager mgr = TerminalToolWindowManager.getInstance(project);
        TerminalWidget widget;
        try {
            Method m = TerminalToolWindowManager.class.getMethod(
                    "createShellWidget",
                    String.class, String.class, boolean.class, boolean.class);
            widget = (TerminalWidget) m.invoke(mgr, workingDir, tabName, true, true);
        } catch (NoSuchMethodException removed) {
            Method m = TerminalToolWindowManager.class.getMethod(
                    "createNewSession",
                    String.class, String.class, List.class, boolean.class, boolean.class);
            widget = (TerminalWidget) m.invoke(mgr, workingDir, tabName, null, true, true);
        }
        widget.sendCommandToExecute(cmd);
    }
}
