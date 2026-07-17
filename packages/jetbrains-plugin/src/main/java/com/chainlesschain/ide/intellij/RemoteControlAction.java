package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.CliLauncher;
import com.chainlesschain.ide.QrCode;
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
    /** Ensures the JVM-exit tree-kill is registered at most once. */
    private static final java.util.concurrent.atomic.AtomicBoolean SHUTDOWN_HOOK_INSTALLED =
            new java.util.concurrent.atomic.AtomicBoolean(false);

    /**
     * A child process is NOT killed on JVM exit, so closing the IDE would leak
     * a live {@code cc remote-control} host (WS port + pairing state). Register
     * one IDE-shutdown task that tree-kills whatever host is alive.
     */
    private static void ensureShutdownHook() {
        if (!SHUTDOWN_HOOK_INSTALLED.compareAndSet(false, true)) return;
        com.intellij.openapi.util.ShutDownTracker.getInstance().registerShutdownTask(() -> {
            Process proc = host;
            if (proc != null && proc.isAlive()) {
                stopping = true;
                proc.descendants().forEach(ProcessHandle::destroyForcibly);
                proc.destroyForcibly();
            }
        });
    }

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        Project project = e.getProject();
        Process live = host;
        boolean running = live != null && live.isAlive();
        String[] options = running
                ? new String[] { "Show pairing QR", "Copy pairing URI", "Show host status",
                        "Stop this host", "Relay settings…", "Cancel" }
                : new String[] { "Start host", "Show host status",
                        "Relay settings…", "Cancel" };
        int pick = Messages.showDialog(project,
                running
                        ? "Remote-control host is running (port "
                                + (pairing != null ? pairing.get("port") : "?")
                                + "). Paired devices can observe, prompt, approve and interrupt."
                        : "Start a remote-control host so a phone or web panel can pair"
                                + " with this machine and drive its agent sessions."
                                + describeRelay(),
                "ChainlessChain Remote Control", options, 0, null);
        if (pick < 0 || "Cancel".equals(options[pick])) return;
        String action = options[pick];
        if ("Start host".equals(action)) start(project);
        else if ("Show pairing QR".equals(action)) reshowPairing(project);
        else if ("Copy pairing URI".equals(action)) copyPairingUri(project);
        else if ("Show host status".equals(action)) showStatus(project);
        else if ("Stop this host".equals(action)) stopOwn(project);
        else if ("Relay settings…".equals(action)) relaySettings(project);
    }

    private static void reshowPairing(Project project) {
        Map<String, Object> p = pairing;
        if (p == null || p.get("pairingUri") == null) {
            Messages.showInfoMessage(project,
                    "No pairing URI yet — the host is still starting.", "Remote Control");
            return;
        }
        showPairing(project, p);
    }

    // ---- relay (E2EE cross-network) settings — persisted app-wide ----

    private static final String RELAY_URL_KEY = "chainlesschain.remote.relayUrl";
    private static final String PEER_ID_KEY = "chainlesschain.remote.peerId";

    private static String storedRelayUrl() {
        String v = com.intellij.ide.util.PropertiesComponent.getInstance()
                .getValue(RELAY_URL_KEY);
        return v == null ? "" : v.trim();
    }

    private static String storedPeerId() {
        String v = com.intellij.ide.util.PropertiesComponent.getInstance()
                .getValue(PEER_ID_KEY);
        return v == null ? "" : v.trim();
    }

    private static String describeRelay() {
        String url = storedRelayUrl();
        return url.isEmpty()
                ? "\n\nPairing: direct LAN (no relay configured)."
                : "\n\nPairing: relay (E2EE) via " + url + ".";
    }

    /**
     * Two-field relay settings prompt persisted via {@link
     * com.intellij.ide.util.PropertiesComponent} (application level — the
     * relay is a machine/account property, not per-project). Blank clears a
     * value; cleared settings defer to the CLI's env/config resolution. The
     * values apply to the NEXT host start ({@code --relay-url}/{@code
     * --peer-id} flags win over env/config, matching CLI precedence).
     */
    private static void relaySettings(Project project) {
        String url = Messages.showInputDialog(project,
                "Relay server URL for cross-network pairing (E2EE), e.g."
                        + " wss://relay.example.com. Leave blank for direct LAN pairing"
                        + " or the CLI's own CC_REMOTE_SESSION_RELAY_URL /"
                        + " remoteControl.relayUrl config.",
                "Remote Control — Relay", null, storedRelayUrl(), null);
        if (url == null) return; // canceled — keep both values untouched
        String peer = Messages.showInputDialog(project,
                "Stable peer id for relay pairing (optional). Leave blank and the"
                        + " CLI auto-generates one when a relay is configured.",
                "Remote Control — Peer Id", null, storedPeerId(), null);
        if (peer == null) return;
        com.intellij.ide.util.PropertiesComponent props =
                com.intellij.ide.util.PropertiesComponent.getInstance();
        props.setValue(RELAY_URL_KEY, url.trim(), "");
        props.setValue(PEER_ID_KEY, peer.trim(), "");
        boolean live = host != null && host.isAlive();
        Messages.showInfoMessage(project,
                (url.trim().isEmpty()
                        ? "Relay cleared — next host uses direct LAN pairing (or the CLI's env/config)."
                        : "Relay saved: " + url.trim())
                        + (live ? "\n\nThe running host keeps its current mode —"
                                + " stop and start it to apply." : ""),
                "Remote Control");
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

    /** Cap the pre-pairing stdout buffer: a host that never emits parseable
     *  pairing JSON (format drift / error banner) must not grow it forever. */
    private static final int PAIRING_BUFFER_CAP = 64 * 1024;

    private static void start(Project project) {
        if (host != null && host.isAlive()) return;
        stopping = false;
        pairing = null;
        // resolveBinary() can run up to 4×12s `cc --version` probes on first use,
        // and pb.start() spawns a process — neither may run on the EDT (the whole
        // IDE would freeze). Resolve + spawn off-EDT; only dialogs hop back.
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            List<String> cmd = new ArrayList<String>();
            if (File.separatorChar == '\\') {
                cmd.add("cmd.exe");
                cmd.add("/c");
            }
            cmd.add(AgentChatSession.resolveBinary());
            cmd.addAll(RemoteHandoff.buildRemoteControlStartArgs(storedRelayUrl(), storedPeerId()));
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
                ApplicationManager.getApplication().invokeLater(() ->
                        Messages.showErrorDialog(project,
                                "Could not start the remote-control host: " + ex.getMessage(),
                                "Remote Control"));
                return;
            }
            host = proc;
            ensureShutdownHook();
            Thread pump = new Thread(() -> pumpHostStdout(project, proc),
                    "cc-remote-control-pump");
            pump.setDaemon(true);
            pump.start();
        });
    }

    /** Read the host's stdout, surface the pairing URI once, warn on exit. */
    private static void pumpHostStdout(Project project, Process proc) {
        StringBuilder buffer = new StringBuilder();
        boolean bufferCapped = false;
        try (BufferedReader r = new BufferedReader(new InputStreamReader(
                proc.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) {
                if (pairing != null || bufferCapped) continue; // drain only
                buffer.append(line).append('\n');
                Map<String, Object> parsed =
                        RemoteHandoff.extractFirstJsonObject(buffer.toString());
                if (parsed != null && parsed.get("pairingUri") != null) {
                    pairing = parsed;
                    final Map<String, Object> p = parsed;
                    ApplicationManager.getApplication().invokeLater(
                            () -> showPairing(project, p));
                } else if (buffer.length() > PAIRING_BUFFER_CAP) {
                    bufferCapped = true; // give up parsing; keep draining to EOF
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
    }

    private static void showPairing(Project project, Map<String, Object> parsed) {
        String note = RemoteHandoff.formatPairingNote(parsed);
        JTextArea area = new JTextArea(note == null ? "" : note, 8, 80);
        area.setEditable(false);
        area.setLineWrap(true);
        area.setFont(new Font(Font.MONOSPACED, Font.PLAIN, area.getFont().getSize()));
        JScrollPane scroll = new JScrollPane(area);
        scroll.setPreferredSize(new Dimension(760, 180));
        javax.swing.JPanel panel = new javax.swing.JPanel(new java.awt.BorderLayout(0, 8));
        javax.swing.JLabel qrLabel = pairingQrLabel(parsed.get("pairingUri"));
        if (qrLabel != null) panel.add(qrLabel, java.awt.BorderLayout.NORTH);
        panel.add(scroll, java.awt.BorderLayout.CENTER);
        DialogBuilder b = new DialogBuilder(project);
        b.setTitle("Remote Control — Pairing");
        b.setCenterPanel(panel);
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

    /**
     * In-dialog QR of the one-time pairing URI (gap #2 — no CLI terminal
     * needed). Deliberately black-on-white regardless of IDE theme: scanners
     * need the contrast. Null when the URI is missing or exceeds QR capacity
     * (dialog falls back to text-only).
     */
    private static javax.swing.JLabel pairingQrLabel(Object uri) {
        if (uri == null || String.valueOf(uri).isEmpty()) return null;
        QrCode qr = QrCode.encode(String.valueOf(uri));
        if (qr == null) return null;
        final int scale = 4;
        final int border = 4;
        int dim = (qr.size + border * 2) * scale;
        java.awt.image.BufferedImage img = new java.awt.image.BufferedImage(
                dim, dim, java.awt.image.BufferedImage.TYPE_INT_RGB);
        java.awt.Graphics2D g = img.createGraphics();
        try {
            g.setColor(java.awt.Color.WHITE);
            g.fillRect(0, 0, dim, dim);
            g.setColor(java.awt.Color.BLACK);
            for (int y = 0; y < qr.size; y++) {
                for (int x = 0; x < qr.size; x++) {
                    if (qr.modules[y][x]) {
                        g.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
                    }
                }
            }
        } finally {
            g.dispose();
        }
        javax.swing.JLabel label = new javax.swing.JLabel(new javax.swing.ImageIcon(img));
        label.setHorizontalAlignment(javax.swing.SwingConstants.CENTER);
        return label;
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
