package com.chainlesschain.ide.intellij;

import com.intellij.openapi.project.Project;
import com.intellij.terminal.ui.TerminalWidget;
import org.jetbrains.plugins.terminal.ShellTerminalWidget;
import org.jetbrains.plugins.terminal.TerminalToolWindowManager;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Reads the integrated terminal tabs' text buffers for the
 * {@code getTerminalOutput} bridge tool. SDK-bound AND terminal-plugin-bound:
 * callers must guard with try/catch(Throwable) — when the bundled terminal
 * plugin is disabled/absent this class fails to link (NoClassDefFoundError)
 * and the facade just reports no terminals. The classic (JediTerm) widget
 * exposes its buffer via {@link ShellTerminalWidget#getText()}; a reworked
 * (frontend-split) terminal tab that can't be adapted is reported by name
 * with empty output rather than dropped, so the agent still sees it exists.
 */
final class TerminalTextReader {

    /** Per-terminal buffer-tail cap — mirrors the VS twin's 16k read cap. */
    private static final int MAX_TAIL_CHARS = 16000;

    private TerminalTextReader() {}

    static List<Map<String, Object>> read(Project project, int limit) {
        List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
        if (project == null || project.isDisposed()) return out;
        TerminalToolWindowManager mgr = TerminalToolWindowManager.getInstance(project);
        for (TerminalWidget widget : mgr.getTerminalWidgets()) {
            if (out.size() >= limit) break;
            if (widget == null) continue;
            String name = "";
            try {
                name = String.valueOf(widget.getTerminalTitle().buildTitle());
            } catch (Throwable ignored) {
                // title is cosmetic
            }
            String text = "";
            try {
                ShellTerminalWidget shell =
                        ShellTerminalWidget.toShellJediTermWidgetOrThrow(widget);
                text = String.valueOf(shell.getText());
            } catch (Throwable ignored) {
                // reworked terminal frontend — no classic buffer bridge
            }
            if (text.length() > MAX_TAIL_CHARS) {
                text = text.substring(text.length() - MAX_TAIL_CHARS);
            }
            Map<String, Object> entry = new LinkedHashMap<String, Object>();
            entry.put("terminal", name);
            entry.put("command", null);
            entry.put("exitCode", null);
            entry.put("output", text);
            out.add(entry);
        }
        return out;
    }
}
