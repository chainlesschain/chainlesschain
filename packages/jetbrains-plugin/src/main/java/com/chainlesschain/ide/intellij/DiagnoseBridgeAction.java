package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.CliVersionCheck;
import com.chainlesschain.ide.IdeDoctor;
import com.chainlesschain.ide.RemoteDoctor;
import com.chainlesschain.ide.RemoteDoctorFixes;
import com.chainlesschain.ide.RuntimeCompatibility;
import com.intellij.ide.plugins.IdeaPluginDescriptor;
import com.intellij.ide.plugins.PluginManagerCore;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationInfo;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.extensions.PluginId;
import com.intellij.openapi.fileChooser.FileChooserFactory;
import com.intellij.openapi.fileChooser.FileSaverDescriptor;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.ide.CopyPasteManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogBuilder;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.vfs.LocalFileSystem;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.openapi.vfs.VirtualFileWrapper;
import org.jetbrains.annotations.NotNull;

import javax.swing.JButton;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import javax.swing.SwingUtilities;
import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Font;
import java.awt.datatransfer.StringSelection;
import java.io.File;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Tools-menu "Diagnose Bridge": this project's bridge state + the CLI's own
 * discovery view ({@code cc ide status} / {@code doctor} / {@code jetbrains})
 * in one scrollable report — when a terminal {@code cc agent} won't
 * auto-connect, the WHY lives on the CLI side (VS Code
 * chainlesschain.ide.doctor parity, plus the IDEA-only built-in-MCP probe).
 * The three CLI captures run off the EDT; the dialog is shown back on it.
 *
 * <p>Gap #12 adds the one-click fix flow under the report (pure
 * classification: {@link RemoteDoctorFixes}): "Apply safe fixes" (allowlisted
 * npm install in a VISIBLE terminal + bridge restart via the existing
 * IdeBridgeService path, after ONE confirmation listing exactly what runs),
 * "Save firewall fix script (.ps1)" (generated, elevation-checked, idempotent
 * — saved where the user chooses and opened for review, NEVER executed by the
 * plugin) and "Copy .wslconfig patch" (clipboard only). The plugin never
 * executes admin operations itself.
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
            String cliVersionText = AgentChatSession.runCapture(
                    java.util.Collections.singletonList("--version"), cwd, 12000);
            final RuntimeCompatibility.Result compatibility =
                    RuntimeCompatibility.evaluate(
                            cliVersionText,
                            RuntimeCompatibility.MIN_CLI_VERSION,
                            port,
                            null);
            final RemoteDoctor.Result remote =
                    remoteDoctorResult(project, port, cliVersionText);
            final String report = IdeDoctor.formatReport(
                    port, status, doctor, jb, compatibility,
                    pluginVersion(), ApplicationInfo.getInstance().getFullVersion())
                    + "\n\n── Remote / WSL Doctor (P2 #12) ──\n" + remote.summary;
            final List<RemoteDoctorFixes.Fix> fixes =
                    RemoteDoctorFixes.classifyFixes(remote.checks);
            SwingUtilities.invokeLater(() -> showDialog(project, cwd, report, remote, fixes));
        });
    }

    /** Gather real environment signals and run the Remote/WSL Doctor analysis. */
    private static RemoteDoctor.Result remoteDoctorResult(
            Project project, int port, String versionOut) {
        RemoteDoctor.Signals s = new RemoteDoctor.Signals();
        s.isWsl = System.getenv("WSL_DISTRO_NAME") != null;
        String base = project.getBasePath();
        s.remoteUncPath = (base != null && base.replace('\\', '/').toLowerCase()
                .startsWith("//wsl")) ? base : null;
        s.isRemote = s.isWsl || s.remoteUncPath != null;
        // JetBrains Remote Development frontend? Plugins run on the HOST
        // backend — plain system-property probes (no SDK class needed; the
        // remote-dev runtime sets remote.development, and the thin client's
        // platform prefix is JetBrainsClient). Absent properties → false, so
        // the check is simply omitted on a normal local IDE.
        s.remoteDevClient = System.getProperty("remote.development") != null
                || "JetBrainsClient".equals(System.getProperty("idea.platform.prefix"));
        String ver = AgentChatSession.looksLikeCcVersion(versionOut)
                ? CliVersionCheck.parseVersion(versionOut) : null;
        s.cliFound = ver != null;
        s.cliVersion = ver;
        s.minCliVersion = RuntimeCompatibility.MIN_CLI_VERSION;
        s.bridgePort = Math.max(port, 0);
        s.portProbe = probePort(port);
        return RemoteDoctor.analyze(s);
    }

    private static String pluginVersion() {
        IdeaPluginDescriptor descriptor = PluginManagerCore.getPlugin(
                PluginId.getId("com.chainlesschain.ide"));
        return descriptor == null ? "unknown" : descriptor.getVersion();
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

    /**
     * Scrollable read-only report (monospace keeps the columns aligned) plus
     * the gap #12 fix buttons — each only present when the classification says
     * it applies, so an all-ok report shows no fix row at all.
     */
    private static void showDialog(Project project, File cwd, String text,
            RemoteDoctor.Result remote, List<RemoteDoctorFixes.Fix> fixes) {
        JTextArea area = new JTextArea(text);
        area.setEditable(false);
        area.setLineWrap(true);
        area.setWrapStyleWord(true);
        area.setFont(new Font(Font.MONOSPACED, Font.PLAIN, area.getFont().getSize()));
        area.setCaretPosition(0);
        JScrollPane scroll = new JScrollPane(area);
        scroll.setPreferredSize(new Dimension(640, 480));

        JPanel root = new JPanel(new BorderLayout(6, 6));
        root.add(scroll, BorderLayout.CENTER);

        List<RemoteDoctorFixes.Fix> autos = new ArrayList<>();
        for (RemoteDoctorFixes.Fix f : fixes) {
            if (RemoteDoctorFixes.KIND_AUTO.equals(f.kind)) autos.add(f);
        }
        final String script = RemoteDoctorFixes.buildFirewallFixScript(remote.checks);
        final RemoteDoctorFixes.WslConfigPatch patch =
                RemoteDoctorFixes.buildWslConfigPatch(remote.checks);

        JPanel buttons = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 2));
        if (!autos.isEmpty()) {
            JButton apply = new JButton(
                    CcBundle.message("doctor.fix.applySafe", autos.size()));
            apply.addActionListener(ev -> applySafeFixes(project, cwd, autos));
            buttons.add(apply);
        }
        if (script != null) {
            JButton save = new JButton(CcBundle.message("doctor.fix.savePs1"));
            save.addActionListener(ev -> saveFirewallScript(project, script));
            buttons.add(save);
        }
        if (patch != null) {
            JButton copy = new JButton(CcBundle.message("doctor.fix.copyWsl"));
            copy.addActionListener(ev -> {
                CopyPasteManager.getInstance().setContents(new StringSelection(patch.ini));
                Messages.showInfoMessage(project,
                        CcBundle.message("doctor.fix.copyWsl.copied",
                                patch.targetPathHint, patch.postStep, patch.note),
                        CcBundle.message("doctor.fix.title"));
            });
            buttons.add(copy);
        }
        if (buttons.getComponentCount() > 0) {
            root.add(buttons, BorderLayout.SOUTH);
        }

        DialogBuilder b = new DialogBuilder(project);
        b.setTitle("ChainlessChain IDE Bridge — Diagnostics");
        b.setCenterPanel(root);
        b.addOkAction();
        b.show();
    }

    /**
     * Never silent: ONE confirmation dialog listing exactly what will run,
     * then the allowlisted npm command goes to a VISIBLE integrated terminal
     * (clipboard fallback when the terminal plugin is absent) and the bridge
     * restart reuses the existing IdeBridgeService path off-EDT — exactly what
     * RestartBridgeAction does.
     */
    private static void applySafeFixes(Project project, File cwd,
            List<RemoteDoctorFixes.Fix> autos) {
        StringBuilder lines = new StringBuilder();
        for (RemoteDoctorFixes.Fix f : autos) {
            lines.append(RemoteDoctorFixes.ACT_TERMINAL.equals(f.actionType)
                    ? CcBundle.message("doctor.fix.terminal.line", f.command)
                    : CcBundle.message("doctor.fix.restart.line")).append('\n');
        }
        int r = Messages.showYesNoDialog(project,
                CcBundle.message("doctor.fix.applySafe.confirm",
                        autos.size(), lines.toString().trim()),
                CcBundle.message("doctor.fix.title"), null);
        if (r != Messages.YES) return;
        for (RemoteDoctorFixes.Fix f : autos) {
            if (RemoteDoctorFixes.ACT_TERMINAL.equals(f.actionType)) {
                // Defense in depth: re-check the allowlist at the execution
                // boundary — nothing outside it ever reaches a shell.
                if (!RemoteDoctorFixes.AUTO_COMMAND_ALLOWLIST.matcher(f.command).matches()
                        || !runInTerminal(project, cwd, f.command)) {
                    CopyPasteManager.getInstance()
                            .setContents(new StringSelection(f.command));
                    Messages.showInfoMessage(project,
                            CcBundle.message("doctor.fix.terminal.fallback", f.command),
                            CcBundle.message("doctor.fix.title"));
                }
            } else if (RemoteDoctorFixes.ACT_IDE_ACTION.equals(f.actionType)
                    && RemoteDoctorFixes.ACTION_RESTART_BRIDGE.equals(f.command)) {
                restartBridge(project);
            }
        }
    }

    /** Open an integrated terminal and run the (allowlisted) command visibly.
     *  Terminal-plugin classes may be absent — Throwable-guarded. */
    private static boolean runInTerminal(Project project, File cwd, String cmd) {
        try {
            String dir = cwd != null ? cwd.getAbsolutePath()
                    : System.getProperty("user.home");
            TerminalLauncher.run(project, dir, "ChainlessChain Doctor", cmd);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    /** Restart the bridge off-EDT via the existing service path (RestartBridgeAction parity). */
    private static void restartBridge(Project project) {
        IdeBridgeService svc = IdeBridgeService.getInstance(project);
        if (svc == null) return;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            svc.restart();
            final int port = svc.getPort();
            SwingUtilities.invokeLater(() -> Messages.showInfoMessage(project,
                    port > 0
                            ? CcBundle.message("bridge.restart.ok", port)
                            : CcBundle.message("bridge.restart.fail"),
                    "ChainlessChain IDE Bridge"));
        });
    }

    /**
     * Save the generated .ps1 where the user chooses (ASCII bytes, UTF-8-no-BOM
     * compatible) and open it in the editor for review. The plugin NEVER runs
     * it — the info message says to review then run from an elevated
     * PowerShell.
     */
    private static void saveFirewallScript(Project project, String script) {
        FileSaverDescriptor descriptor = newPs1SaverDescriptor(
                CcBundle.message("doctor.fix.savePs1.title"),
                CcBundle.message("doctor.fix.savePs1.desc"));
        VirtualFileWrapper wrapper = FileChooserFactory.getInstance()
                .createSaveFileDialog(descriptor, project)
                .save((VirtualFile) null, "cc-ide-firewall-fix.ps1");
        if (wrapper == null) return;
        final File target = wrapper.getFile();
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            String failure = null;
            try {
                java.nio.file.Files.write(target.toPath(),
                        script.getBytes(StandardCharsets.UTF_8));
            } catch (Exception ex) {
                failure = String.valueOf(ex.getMessage());
            }
            final String error = failure;
            SwingUtilities.invokeLater(() -> {
                if (error != null) {
                    Messages.showErrorDialog(project,
                            CcBundle.message("doctor.fix.savePs1.failed", error),
                            CcBundle.message("doctor.fix.title"));
                    return;
                }
                VirtualFile vf = LocalFileSystem.getInstance()
                        .refreshAndFindFileByNioFile(target.toPath());
                if (vf != null) {
                    FileEditorManager.getInstance(project).openFile(vf, true);
                }
                Messages.showInfoMessage(project,
                        CcBundle.message("doctor.fix.savePs1.saved", target.getPath()),
                        CcBundle.message("doctor.fix.title"));
            });
        });
    }

    /**
     * .ps1-filtered save descriptor, constructor resolved reflectively: 2024.3+
     * has the exact (title, description, extension) constructor, while 242 only
     * has the varargs one that 2026.x deprecates — referencing either directly
     * would break the floor build or trip the Marketplace verifier.
     */
    private static FileSaverDescriptor newPs1SaverDescriptor(String title, String desc) {
        try {
            return FileSaverDescriptor.class
                    .getConstructor(String.class, String.class, String.class)
                    .newInstance(title, desc, "ps1");
        } catch (ReflectiveOperationException pre243) {
            try {
                return FileSaverDescriptor.class
                        .getConstructor(String.class, String.class, String[].class)
                        .newInstance(title, desc, new String[] { "ps1" });
            } catch (ReflectiveOperationException e) {
                throw new IllegalStateException(
                        "No usable FileSaverDescriptor constructor", e);
            }
        }
    }
}
