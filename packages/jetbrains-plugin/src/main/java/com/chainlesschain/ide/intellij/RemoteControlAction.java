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
 * this IDE process). Direct mode is loopback unless the user explicitly opts
 * into LAN access; an E2EE relay or that LAN consent lets another device
 * drive this machine's agent sessions. Shows the one-time pairing URI
 * (copyable), lists discovered hosts, and stops them. Pure arg
 * builders/parsers: {@link RemoteHandoff}.
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
     * one JVM-shutdown hook that tree-kills whatever host is alive. Plain JDK
     * {@link Runtime#addShutdownHook} — the platform's ShutDownTracker is
     * {@code @ApiStatus.Internal} (Marketplace verifier flags it) and is itself
     * backed by the same JVM hook mechanism.
     */
    private static void ensureShutdownHook() {
        if (!SHUTDOWN_HOOK_INSTALLED.compareAndSet(false, true)) return;
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            Process proc = host;
            if (proc != null && proc.isAlive()) {
                stopping = true;
                proc.descendants().forEach(ProcessHandle::destroyForcibly);
                proc.destroyForcibly();
            }
        }, "cc-remote-control-host-killer"));
    }

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        Project project = e.getProject();
        Process live = host;
        boolean running = live != null && live.isAlive();
        String[] options = running
                ? new String[] { "Show pairing details", "Copy pairing URI", "Show host status",
                        "Stop this host", "Connection settings…", "Cancel" }
                : new String[] { "Start host", "Show host status",
                        "Connection settings…", "Cancel" };
        int pick = Messages.showDialog(project,
                running
                        ? "Remote-control host is running (port "
                                + (pairing != null ? pairing.get("port") : "?")
                                + "). " + runningAccessDescription()
                        : "Start a remote-control host. Direct mode is loopback-only by"
                                + " default; another device requires an E2EE relay or"
                                + " explicit trusted-LAN consent." + describeConnection(),
                "ChainlessChain Remote Control", options, 0, null);
        if (pick < 0 || "Cancel".equals(options[pick])) return;
        String action = options[pick];
        if ("Start host".equals(action)) start(project);
        else if ("Show pairing details".equals(action)) reshowPairing(project);
        else if ("Copy pairing URI".equals(action)) copyPairingUri(project);
        else if ("Show host status".equals(action)) showStatus(project);
        else if ("Stop this host".equals(action)) stopOwn(project);
        else if ("Connection settings…".equals(action)) connectionSettings(project);
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

    // ---- remote connection settings — persisted app-wide ----

    private static final String RELAY_URL_KEY = "chainlesschain.remote.relayUrl";
    private static final String PEER_ID_KEY = "chainlesschain.remote.peerId";
    private static final String ALLOW_LAN_KEY = "chainlesschain.remote.allowLan";

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

    private static boolean storedAllowLan() {
        return "true".equals(com.intellij.ide.util.PropertiesComponent.getInstance()
                .getValue(ALLOW_LAN_KEY));
    }

    private static String runningAccessDescription() {
        Map<String, Object> p = pairing;
        if (p == null) return "Pairing details are still starting.";
        return RemoteHandoff.isPairingUsableFromAnotherDevice(p)
                ? "A phone or web panel can use the one-time pairing URI."
                : "The pairing URI is loopback-only and can be used only on this machine.";
    }

    private static String describeConnection() {
        String url = storedRelayUrl();
        if (!url.isEmpty()) return "\n\nIDE setting: relay (E2EE) via " + url + ".";
        if (storedAllowLan()) {
            return "\n\nIDE setting: direct LAN explicitly enabled. Use only on a trusted"
                    + " network; direct transport is plaintext ws://.";
        }
        return "\n\nIDE setting: direct loopback (recommended default). Only clients on"
                + " this machine can use its URI.";
    }

    /**
     * Relay fields plus explicit LAN consent, persisted via {@link
     * com.intellij.ide.util.PropertiesComponent} (application level — the
     * connection choice is a machine/account property, not per-project).
     * Blank relay values defer to the CLI's env/config resolution. LAN is off
     * by default and only the explicit trusted-network choice below produces
     * {@code --allow-lan}. Values apply to the NEXT host start.
     */
    private static void connectionSettings(Project project) {
        String url = Messages.showInputDialog(project,
                "Relay server URL for cross-network pairing (E2EE), e.g."
                        + " wss://relay.example.com. Leave blank for direct mode, which"
                        + " remains loopback-only unless LAN access is explicitly enabled"
                        + " in the next step. CLI env/config may also select a relay.",
                "Remote Control — Relay", null, storedRelayUrl(), null);
        if (url == null) return; // canceled — keep both values untouched
        String peer = Messages.showInputDialog(project,
                "Stable peer id for relay pairing (optional). Leave blank and the"
                        + " CLI auto-generates one when a relay is configured.",
                "Remote Control — Peer Id", null, storedPeerId(), null);
        if (peer == null) return;
        String[] lanOptions = new String[] {
                "Loopback only (recommended)",
                "Allow LAN (trusted networks only)",
                "Cancel"
        };
        int lanPick = Messages.showDialog(project,
                "Allow phones and other devices on this local network to connect directly?\n\n"
                        + "This passes --allow-lan, exposes the authenticated listener to"
                        + " the LAN over plaintext ws://, and may require a firewall rule."
                        + " Do not enable it on public or untrusted networks; prefer the"
                        + " E2EE relay there.",
                "Remote Control — LAN Access", lanOptions,
                storedAllowLan() ? 1 : 0, null);
        if (lanPick < 0 || lanPick == 2) return;
        boolean allowLan = lanPick == 1;
        com.intellij.ide.util.PropertiesComponent props =
                com.intellij.ide.util.PropertiesComponent.getInstance();
        props.setValue(RELAY_URL_KEY, url.trim(), "");
        props.setValue(PEER_ID_KEY, peer.trim(), "");
        props.setValue(ALLOW_LAN_KEY, allowLan ? "true" : "", "");
        boolean live = host != null && host.isAlive();
        Messages.showInfoMessage(project,
                (url.trim().isEmpty()
                        ? (allowLan
                                ? "Direct LAN explicitly enabled for the next host on a trusted network."
                                : "Direct mode will remain loopback-only for the next host (recommended).")
                        : "Relay saved: " + url.trim()
                                + (allowLan
                                        ? " (LAN consent is saved for direct mode; this relay start"
                                                + " will not pass --allow-lan)."
                                        : ""))
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
        boolean anotherDevice = RemoteHandoff.isPairingUsableFromAnotherDevice(p);
        Messages.showInfoMessage(project, "Pairing URI copied to the clipboard.\n\n"
                + (anotherDevice
                        ? "It is one-time: after a device joins, run Start again for another device."
                        : "This host is loopback-only: the URI works only for clients on this machine."),
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
            cmd.addAll(RemoteHandoff.buildRemoteControlStartArgs(
                    storedRelayUrl(), storedPeerId(), storedAllowLan()));
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
        javax.swing.JLabel qrLabel = RemoteHandoff.isPairingUsableFromAnotherDevice(parsed)
                ? pairingQrLabel(parsed.get("pairingUri")) : null;
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
