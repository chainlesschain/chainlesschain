package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.ManagedCli;
import com.chainlesschain.ide.ManagedCliRuntime;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.progress.ProgressIndicator;
import com.intellij.openapi.progress.Task;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import org.jetbrains.annotations.NotNull;

import java.util.Map;

/**
 * Tools → "ChainlessChain: Install Managed CLI…" (gap #2 插件托管/内置 CLI).
 * Downloads, verifies and installs a plugin-managed copy of the
 * {@code chainlesschain} npm package under
 * {@code ~/.chainlesschain/ide/managed-cli-jetbrains}, then re-points binary
 * resolution (which consults the managed copy ONLY after every global probe
 * fails — an explicit configured cc path is never replaced).
 *
 * <p>All decisions live in the pure {@link ManagedCli}/{@link ManagedCliRuntime}
 * twins; this action is glue: node preflight, ONE confirm dialog (version +
 * size + target dir), {@link Task.Backgroundable} progress, https-only
 * download with a 64 MB cap and ≤3 redirects.
 */
public final class InstallManagedCliAction extends AnAction {

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        final Project project = e.getProject();
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            // 1. Node preflight — a managed copy runs as `node <entry>`; without a
            //    usable node the download would be pointless (明确诊断).
            String nodeOut = ManagedCliRuntime.probeNodeVersionOutput();
            Map<String, Object> nodeDiag = ManagedCli.managedNodeDiagnostic(
                    nodeOut, ManagedCliRuntime.MIN_NODE_VERSION);
            if (!Boolean.TRUE.equals(nodeDiag.get("ok"))) {
                final String msg = "node-too-old".equals(nodeDiag.get("reason"))
                        ? CcBundle.message("managedCli.nodeTooOld",
                                nodeDiag.get("version"), ManagedCliRuntime.MIN_NODE_VERSION)
                        : CcBundle.message("managedCli.noNode",
                                ManagedCliRuntime.MIN_NODE_VERSION);
                ApplicationManager.getApplication().invokeLater(() ->
                        Messages.showWarningDialog(project, msg,
                                CcBundle.message("managedCli.confirm.title")));
                return;
            }

            // 2. Resolve the plan from the npm registry (fail-closed, off-EDT).
            Map<String, Object> meta;
            try {
                meta = ManagedCliRuntime.fetchJsonHttps(ManagedCli.registryMetaUrl("latest"));
            } catch (Throwable t) {
                meta = null;
            }
            final Map<String, Object> metaFinal = meta;
            final Map<String, Object> plan =
                    ManagedCli.planManagedInstall("latest", meta, null);
            if (!Boolean.TRUE.equals(plan.get("ok"))) {
                ApplicationManager.getApplication().invokeLater(() ->
                        Messages.showErrorDialog(project,
                                CcBundle.message("managedCli.plan.fail",
                                        String.valueOf(plan.get("error"))),
                                CcBundle.message("managedCli.confirm.title")));
                return;
            }
            final String version = String.valueOf(plan.get("version"));
            final String size = humanSize(metaFinal);
            final String rootDir = ManagedCliRuntime.defaultRootDir();

            // 3. ONE confirm dialog: version + size + target dir.
            ApplicationManager.getApplication().invokeLater(() -> {
                int r = Messages.showYesNoDialog(project,
                        CcBundle.message("managedCli.confirm.body", version, size, rootDir),
                        CcBundle.message("managedCli.confirm.title"),
                        Messages.getQuestionIcon());
                if (r != Messages.YES) return;
                new Task.Backgroundable(project,
                        CcBundle.message("managedCli.task.install"), true) {
                    @Override
                    public void run(@NotNull ProgressIndicator indicator) {
                        indicator.setIndeterminate(true);
                        ManagedCliRuntime.Io io = new ManagedCliRuntime.Io();
                        io.fetchJson = url -> metaFinal; // already fetched + planned
                        io.fetchBuffer = url -> {
                            try {
                                return ManagedCliRuntime.fetchBufferHttps(
                                        url, ManagedCliRuntime.MAX_DOWNLOAD_BYTES);
                            } catch (Exception ex) {
                                throw new RuntimeException(ex);
                            }
                        };
                        io.report = step -> indicator.setText2(step);
                        Map<String, Object> res = ManagedCliRuntime.runManagedInstall(
                                rootDir, "latest", null, io);
                        ApplicationManager.getApplication().invokeLater(() ->
                                showResult(project, res));
                    }
                }.queue();
            });
        });
    }

    private static void showResult(Project project, Map<String, Object> res) {
        if (Boolean.TRUE.equals(res.get("ok"))) {
            // Re-point resolution immediately (re-installs the supplier per the
            // current settings; the supplier re-reads state on every resolve).
            CcSettings settings = CcSettings.getInstance();
            settings.applyToRuntime();
            String msg = CcBundle.message("managedCli.install.ok",
                    res.get("version"), res.get("command"));
            if (!settings.isManagedCliEnabled()) {
                msg += CcBundle.message("managedCli.install.ok.disabledNote");
            }
            Messages.showInfoMessage(project, msg,
                    CcBundle.message("managedCli.confirm.title"));
        } else {
            Messages.showErrorDialog(project,
                    CcBundle.message("managedCli.install.fail",
                            String.valueOf(res.get("step")),
                            String.valueOf(res.get("error"))),
                    CcBundle.message("managedCli.confirm.title"));
        }
    }

    /** Human unpackedSize from the registry manifest, or a localized "unknown". */
    private static String humanSize(Map<String, Object> meta) {
        try {
            Object dist = meta == null ? null : meta.get("dist");
            Object sz = dist instanceof Map ? ((Map<?, ?>) dist).get("unpackedSize") : null;
            if (sz instanceof Number) {
                long bytes = ((Number) sz).longValue();
                if (bytes >= 1024 * 1024) {
                    return String.format(java.util.Locale.ROOT, "~%.1f MB",
                            bytes / (1024.0 * 1024.0));
                }
                if (bytes >= 1024) {
                    return String.format(java.util.Locale.ROOT, "~%d KB", bytes / 1024);
                }
                if (bytes > 0) return bytes + " B";
            }
        } catch (Throwable ignored) {
            // fall through to unknown
        }
        return CcBundle.message("managedCli.size.unknown");
    }
}
