package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.CliLauncher;
import com.chainlesschain.ide.RemoteHandoff;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.ide.CopyPasteManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogBuilder;
import com.intellij.openapi.ui.Messages;
import org.jetbrains.annotations.NotNull;

import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import java.awt.Dimension;
import java.awt.Font;
import java.awt.datatransfer.StringSelection;
import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Remote Control (Tools menu) — wraps {@code cc remote-control
 * start/status/stop --json}. Starts a pairing host (a long-running child of
 * this IDE process) so a phone / web panel can drive this machine's agent
 * sessions, shows the one-time pairing URI (copyable), lists discovered
 * hosts, and stops them. Pure arg builders/parsers: {@link RemoteHandoff}.
 * The host survives project switches but dies with the IDE; a stale state
 * file left by a hard kill is pruned by {@code status --prune}. VS Code twin:
 * {@code chainlesschain.remote.control}.
 */
public final class RemoteControlAction extends AnAction {

    /** App-wide host child (at most one per IDE process, like the VS twin's per-window host). */
    private static volatile Process host;
    private static volatile Map<String, Object> pairing;
    private static volatile boolean stopping;

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        Project project = e.getProject();
        Process live = host;
        boolean running = live != null && live.isAlive();
        String[] options = running
                ? new String[] { "Copy pairing URI", "Show host status", "Stop this host", "Cancel" }
                : new String[] { "Start host", "Show host status", "Cancel" };
        int pick = Messages.showDialog(project,
                running
                        ? "Remote-control host is running (port "
                                + (pairing != null ? pairing.get("port") : "?")
                                + "). Paired devices can observe, prompt, approve and interrupt."
                        : "Start a remote-control host so a phone or web panel can pair"
                                + " with this machine and drive its agent sessions.",
                "ChainlessChain Remote Control", options, 0, null);
        if (pick < 0 || "Cancel".equals(options[pick])) return;
        String action = options[pick];
        if ("Start host".equals(action)) start(project);
        else if ("Copy pairing URI".equals(action)) copyPairingUri(project);
        else if ("Show host status".equals(action)) showStatus(project);
        else if ("Stop this host".equals(action)) stopOwn(project);
    }

    private static void copyPairingUri(Project project) {
        Map<String, Object> p = pairing;
        Object uri = p == null ? null : p.get("pairingUri");
        if (uri == null) {
            Messages.showInfoMessage(project,
                    "No pairing URI yet — the host is still starting.", "Remote Control");
            return;
        }
        CopyPasteManager.getInstance().setContents(new StringSelection(String.valueOf(uri)));
        Messages.showInfoMessage(project, "Pairing URI copied to the clipboard.\n\n"
                + "It is one-time: after a device joins, run Start again for another device.",
                "Remote Control");
    }

    private static void start(Project project) {
        if (host != null && host.isAlive()) return;
        stopping = false;
        pairing = null;
        List<String> cmd = new ArrayList<String>();
        if (File.separatorChar == '\\') {
            cmd.add("cmd.exe");
            cmd.add("/c");
        }
        cmd.add(AgentChatSession.resolveBinary());
        cmd.addAll(RemoteHandoff.buildRemoteControlStartArgs());
        ProcessBuilder pb = new ProcessBuilder(cmd);
        if (project != null && project.getBasePath() != null) {
            pb.directory(new File(project.getBasePath()));
        }
        CliLauncher.augmentPath(pb);
        pb.redirectErrorStream(false);
        final Process proc;
        try {
            proc = pb.start();
        } catch (IOException ex) {
            Messages.showErrorDialog(project,
                    "Could not start the remote-control host: " + ex.getMessage(),
                    "Remote Control");
            return;
        }
        host = proc;
        Thread pump = new Thread(() -> {
            StringBuilder buffer = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(
                    proc.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) {
                    if (pairing != null) continue; // drain only, JSON already parsed
                    buffer.append(line).append('\n');
                    Map<String, Object> parsed =
                            RemoteHandoff.extractFirstJsonObject(buffer.toString());
                    if (parsed != null && parsed.get("pairingUri") != null) {
                        pairing = parsed;
                        ApplicationManager.getApplication().invokeLater(
                                () -> showPairing(project, parsed));
                    }
                }
            } catch (IOException ignored) {
                // child closed / killed
            }
            if (host == proc && !stopping) {
                host = null;
                pairing = null;
                ApplicationManager.getApplication().invokeLater(() ->
                        Messages.showWarningDialog(project,
                                "The remote-control host exited. Run Remote Control again to"
                                        + " restart it (a restart issues a fresh pairing URI).",
                                "Remote Control"));
            }
        }, "cc-remote-control-pump");
        pump.setDaemon(true);
        pump.start();
    }

    private static void showPairing(Project project, Map<String, Object> parsed) {
        String note = RemoteHandoff.formatPairingNote(parsed);
        JTextArea area = new JTextArea(note == null ? "" : note, 8, 80);
        area.setEditable(false);
        area.setLineWrap(true);
        area.setFont(new Font(Font.MONOSPACED, Font.PLAIN, area.getFont().getSize()));
        JScrollPane scroll = new JScrollPane(area);
        scroll.setPreferredSize(new Dimension(760, 180));
        DialogBuilder b = new DialogBuilder(project);
        b.setTitle("Remote Control — Pairing");
        b.setCenterPanel(scroll);
        b.addOkAction().setText("Copy URI & Close");
        b.addCancelAction().setText("Close");
        if (b.show() == com.intellij.openapi.ui.DialogWrapper.OK_EXIT_CODE) {
            Object uri = parsed.get("pairingUri");
            if (uri != null) {
                CopyPasteManager.getInstance()
                        .setContents(new StringSelection(String.valueOf(uri)));
            }
        }
    }

    private static void showStatus(Project project) {
        final File cwd = project != null && project.getBasePath() != null
                ? new File(project.getBasePath()) : null;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            String out = AgentChatSession.runCapture(
                    RemoteHandoff.buildRemoteControlStatusArgs(), cwd, 30000);
            final List<Map<String, Object>> hosts =
                    RemoteHandoff.parseRemoteControlStatus(out);
            ApplicationManager.getApplication().invokeLater(() -> {
                if (hosts.isEmpty()) {
                    Messages.showInfoMessage(project,
                            "No remote-control hosts running on this machine.",
                            "Remote Control");
                    return;
                }
                StringBuilder sb = new StringBuilder();
                for (Map<String, Object> h : hosts) {
                    sb.append(RemoteHandoff.formatStatusLine(h)).append('\n');
                }
                int stop = Messages.showYesNoDialog(project,
                        sb + "\nStop a host? (stops the FIRST running one listed;"
                                + " use `cc remote-control stop --port <n>` for a specific one)",
                        "Remote-Control Hosts", "Stop First Running", "Close", null);
                if (stop != Messages.YES) return;
                Map<String, Object> target = null;
                for (Map<String, Object> h : hosts) {
                    if (Boolean.TRUE.equals(h.get("alive"))) { target = h; break; }
                }
                if (target == null) return;
                final long port = target.get("port") instanceof Number
                        ? ((Number) target.get("port")).longValue() : 0;
                if (port <= 0) return;
                Map<String, Object> p = pairing;
                if (host != null && p != null && p.get("port") instanceof Number
                        && ((Number) p.get("port")).longValue() == port) {
                    stopOwn(project);
                    return;
                }
                ApplicationManager.getApplication().executeOnPooledThread(() ->
                        AgentChatSession.runCapture(
                                RemoteHandoff.buildRemoteControlStopArgs(port), cwd, 30000));
            });
        });
    }

    private static void stopOwn(Project project) {
        final Process proc = host;
        if (proc == null) return;
        stopping = true;
        Map<String, Object> p = pairing;
        final long port = p != null && p.get("port") instanceof Number
                ? ((Number) p.get("port")).longValue() : 0;
        host = null;
        pairing = null;
        final File cwd = project != null && project.getBasePath() != null
                ? new File(project.getBasePath()) : null;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            // Graceful first: the CLI stop removes the discovery state file.
            if (port > 0) {
                AgentChatSession.runCapture(
                        RemoteHandoff.buildRemoteControlStopArgs(port), cwd, 30000);
            }
            if (proc.isAlive()) {
                // cmd.exe wrapper on Windows — destroy the whole tree so the
                // real node child releases the WS port.
                proc.descendants().forEach(ProcessHandle::destroyForcibly);
                proc.destroyForcibly();
            }
        });
    }
}
