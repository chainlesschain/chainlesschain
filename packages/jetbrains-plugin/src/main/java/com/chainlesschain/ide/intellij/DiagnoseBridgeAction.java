package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.CliVersionCheck;
import com.chainlesschain.ide.IdeDoctor;
import com.chainlesschain.ide.RemoteDoctor;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogBuilder;
import org.jetbrains.annotations.NotNull;

import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import javax.swing.SwingUtilities;
import java.awt.Dimension;
import java.awt.Font;
import java.io.File;
import java.net.InetSocketAddress;
import java.net.Socket;

/**
 * Tools-menu "Diagnose Bridge": this project's bridge state + the CLI's own
 * discovery view ({@code cc ide status} / {@code doctor} / {@code jetbrains})
 * in one scrollable report — when a terminal {@code cc agent} won't
 * auto-connect, the WHY lives on the CLI side (VS Code
 * chainlesschain.ide.doctor parity, plus the IDEA-only built-in-MCP probe).
 * The three CLI captures run off the EDT; the dialog is shown back on it.
 */
public final class DiagnoseBridgeAction extends AnAction {

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        final Project project = e.getProject();
        if (project == null) return;
        final IdeBridgeService svc = IdeBridgeService.getInstance(project);
        final int port = svc != null ? svc.getPort() : -1;
        final File cwd = project.getBasePath() != null
                ? new File(project.getBasePath()) : null;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            String status = AgentChatSession.runCapture(IdeDoctor.buildStatusArgs(), cwd, 15000);
            String doctor = AgentChatSession.runCapture(IdeDoctor.buildDoctorArgs(), cwd, 15000);
            String jb = AgentChatSession.runCapture(IdeDoctor.buildJetbrainsArgs(), cwd, 15000);
            final String remote = remoteDoctorSection(project, port);
            final String report = IdeDoctor.formatReport(port, status, doctor, jb)
                    + "\n\n── Remote / WSL Doctor (P2 #12) ──\n" + remote;
            SwingUtilities.invokeLater(() -> showDialog(project, report));
        });
    }

    // Min cc version this plugin build targets (advisory; mirrors the VS twin).
    private static final String MIN_CLI_VERSION = "0.162.47";

    /** Gather real environment signals and render the Remote/WSL Doctor section. */
    private static String remoteDoctorSection(Project project, int port) {
        RemoteDoctor.Signals s = new RemoteDoctor.Signals();
        s.isWsl = System.getenv("WSL_DISTRO_NAME") != null;
        String base = project.getBasePath();
        s.remoteUncPath = (base != null && base.replace('\\', '/').toLowerCase()
                .startsWith("//wsl")) ? base : null;
        s.isRemote = s.isWsl || s.remoteUncPath != null;
        String ver = null;
        try {
            File cwd = base != null ? new File(base) : null;
            String out = AgentChatSession.runCapture(
                    java.util.Collections.singletonList("--version"), cwd, 12000);
            if (AgentChatSession.looksLikeCcVersion(out)) ver = CliVersionCheck.parseVersion(out);
        } catch (Throwable ignored) {
            /* CLI probe best-effort */
        }
        s.cliFound = ver != null;
        s.cliVersion = ver;
        s.minCliVersion = MIN_CLI_VERSION;
        s.bridgePort = Math.max(port, 0);
        s.portProbe = probePort(port);
        return RemoteDoctor.analyze(s).summary;
    }

    /** Quick loopback probe: does something accept a TCP connection on {@code port}? */
    private static String probePort(int port) {
        if (port <= 0) return "stopped";
        try (Socket sock = new Socket()) {
            sock.connect(new InetSocketAddress("127.0.0.1", port), 600);
            return "listening";
        } catch (Exception e) {
            return "unknown";
        }
    }

    /** Scrollable read-only text dialog (monospace keeps the columns aligned). */
    private static void showDialog(Project project, String text) {
        JTextArea area = new JTextArea(text);
        area.setEditable(false);
        area.setLineWrap(true);
        area.setWrapStyleWord(true);
        area.setFont(new Font(Font.MONOSPACED, Font.PLAIN, area.getFont().getSize()));
        area.setCaretPosition(0);
        JScrollPane scroll = new JScrollPane(area);
        scroll.setPreferredSize(new Dimension(640, 480));
        DialogBuilder b = new DialogBuilder(project);
        b.setTitle("ChainlessChain IDE Bridge — Diagnostics");
        b.setCenterPanel(scroll);
        b.addOkAction();
        b.show();
    }
}
