package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.ChromeConnector;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogBuilder;
import com.intellij.openapi.ui.Messages;
import org.jetbrains.annotations.NotNull;

import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import java.awt.Dimension;
import java.awt.Font;
import java.io.File;
import java.util.Map;

/**
 * Chrome connector (Tools menu, P1 #8) — drives {@code cc browse chrome}:
 * launch a debuggable Chrome (dedicated profile keeps login state), then
 * capture a tab's state (console/network/DOM/screenshot) into a monospace
 * report the agent can reproduce via the same CLI command. Pure core:
 * {@link ChromeConnector}. VS Code twin: {@code chainlesschain.chrome.connector}.
 */
public final class ChromeConnectorAction extends AnAction {

    private static final int PORT = 9222;

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        Project project = e.getProject();
        final File cwd = project != null && project.getBasePath() != null
                ? new File(project.getBasePath()) : null;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            String statusOut = AgentChatSession.runCapture(
                    ChromeConnector.buildStatusArgs(PORT), cwd, 15000);
            Map<String, Object> status = ChromeConnector.parseJson(statusOut);
            final boolean connected = status != null
                    && Boolean.TRUE.equals(status.get("ok"));
            ApplicationManager.getApplication().invokeLater(() -> {
                if (!connected) {
                    int r = Messages.showYesNoDialog(project,
                            "No debuggable Chrome on port " + PORT + ".\n\n"
                                    + "Launch a connected Chrome? It uses a DEDICATED"
                                    + " profile — sign in to your sites once there and"
                                    + " the login state persists. Close it when done"
                                    + " (the CDP port is a local control channel).",
                            "Chrome Connector", "Launch", "Cancel", null);
                    if (r != Messages.YES) return;
                    ApplicationManager.getApplication().executeOnPooledThread(() -> {
                        String out = AgentChatSession.runCapture(
                                ChromeConnector.buildLaunchArgs(PORT, null), cwd, 30000);
                        Map<String, Object> res = ChromeConnector.parseJson(out);
                        final boolean ok = res != null && Boolean.TRUE.equals(res.get("ok"));
                        ApplicationManager.getApplication().invokeLater(() ->
                                Messages.showInfoMessage(project, ok
                                        ? "Connected Chrome launched (CDP port " + PORT
                                                + "). Open your page there, then run this"
                                                + " action again to capture its state."
                                        : "Could not launch Chrome — install Chrome/Edge"
                                                + " or set CHROME_PATH.",
                                        "Chrome Connector"));
                    });
                    return;
                }
                int r = Messages.showYesNoCancelDialog(project,
                        "Connected: " + status.get("browser") + " on port " + PORT
                                + ".\n\nCapture the active tab's state?"
                                + " (console/network are observed from attach time —"
                                + " Reload capture catches load-time output)",
                        "Chrome Connector",
                        "Capture", "Capture with Reload", "Cancel", null);
                if (r == Messages.CANCEL) return;
                final boolean reload = r == Messages.NO; // middle button
                capture(project, cwd, reload);
            });
        });
    }

    private static void capture(Project project, File cwd, boolean reload) {
        final String shot = new File(System.getProperty("java.io.tmpdir"),
                "cc-chrome-" + System.currentTimeMillis() + ".png").getAbsolutePath();
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            String out = AgentChatSession.runCapture(
                    ChromeConnector.buildStateArgs(PORT, 0, 3000, reload, shot),
                    cwd, 60000);
            Map<String, Object> state = ChromeConnector.parseJson(out);
            final String report = ChromeConnector.stateToReport(state);
            ApplicationManager.getApplication().invokeLater(() -> {
                try {
                    if (report == null) {
                        Messages.showWarningDialog(project,
                                "Could not capture page state — "
                                        + (state != null && state.get("error") != null
                                                ? state.get("error") : "no output"),
                                "Chrome Connector");
                        return;
                    }
                    JTextArea area = new JTextArea(report, 28, 100);
                    area.setEditable(false);
                    area.setLineWrap(true);
                    area.setFont(new Font(Font.MONOSPACED, Font.PLAIN,
                            area.getFont().getSize()));
                    JScrollPane scroll = new JScrollPane(area);
                    scroll.setPreferredSize(new Dimension(880, 480));
                    DialogBuilder b = new DialogBuilder(project);
                    b.setTitle("Chrome Connector — Page State");
                    b.setCenterPanel(scroll);
                    b.addOkAction().setText("Close");
                    b.show(); // modal — blocks until the user closes it
                } finally {
                    // The screenshot was captured into tmpdir for the report;
                    // it's shown, not persisted — delete it once the dialog closes.
                    new File(shot).delete();
                }
            });
        });
    }
}
