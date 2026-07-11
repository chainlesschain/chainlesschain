package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.ActivityLog;
import com.chainlesschain.ide.IdeTools;
import com.chainlesschain.ide.LockfileWriter;
import com.chainlesschain.ide.McpServer;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.project.Project;

import java.util.ArrayList;
import java.util.List;

/**
 * Project-scoped owner of the IDE-bridge MCP server + lockfile. Started by
 * {@link IdeBridgeStartup} when a project opens, torn down on project dispose.
 * SDK-bound (IntelliJ Platform); the server/lockfile/tools it drives are the
 * vscode-free, interop-tested core.
 */
public final class IdeBridgeService implements Disposable {

    private static final Logger LOG = Logger.getInstance(IdeBridgeService.class);

    private final Project project;
    private final LockfileWriter lockfile = new LockfileWriter();
    // Ring buffer of tool-call activity for the "Show Activity" dialog (VS Code
    // dashboard parity). Project-lived so counts survive a bridge restart.
    private final ActivityLog activity = new ActivityLog(200);
    private McpServer server;
    private int port = -1;
    private String token;

    public IdeBridgeService(Project project) {
        this.project = project;
    }

    public static IdeBridgeService getInstance(Project project) {
        return project.getService(IdeBridgeService.class);
    }

    public synchronized void start() {
        if (server != null) return;
        try {
            // Sweep lockfiles left by crashed/force-killed instances (ephemeral
            // ports mean each crash leaves a distinct orphan that normal shutdown
            // never cleans).
            try {
                int pruned = lockfile.pruneStale();
                if (pruned > 0) LOG.info("pruned " + pruned + " stale IDE lockfile(s)");
            } catch (Exception ignore) {
                // best-effort — pruning must never block bridge start
            }
            token = LockfileWriter.generateToken();
            IntellijEditorFacade facade = new IntellijEditorFacade(project);
            // PSI-backed semantic tools (hover/definition/references/rename
            // preview/call hierarchy/symbol info/project model) — conditional
            // registration, same as the terminal/preview tools.
            PsiSemanticFacade semantics = new PsiSemanticFacade(project);
            // Workspace roots computed BEFORE the tools are built: they bound
            // where the path-taking tools (openDiff / openMultiDiff /
            // getDiagnostics) may operate (IdePathGuard).
            List<String> folders = new ArrayList<>();
            String base = project.getBasePath();
            if (base != null) folders.add(base);
            server = new McpServer(IdeTools.build(facade, semantics, folders), token);
            // Record every tool call for the "Show Activity" dialog. Fires on a
            // pooled server thread; ActivityLog is synchronized.
            server.setActivityListener((tool, ok, args) -> activity.record(
                    System.currentTimeMillis(), "tool", tool, ok,
                    ActivityLog.summarizeArgs(tool, args)));
            port = server.start("127.0.0.1", 0);

            long pid = ProcessHandle.current().pid();
            lockfile.write(port, token, folders, server.url(), System.currentTimeMillis(), pid);
            LOG.info("ChainlessChain IDE bridge up on " + server.url() + " (server \"ide\")");

            // Warm up discovery of IDEA's OWN built-in MCP server (IDEA 2025.2+)
            // off the EDT, so the first chat spawn can inject its endpoint as
            // server `idea`. No-op when unsupported / disabled.
            com.chainlesschain.ide.JetbrainsMcpLocator.refreshAsync();
            BridgeStatusBarWidgetFactory.refresh(project);
        } catch (Exception e) {
            LOG.warn("ChainlessChain IDE bridge failed to start: " + e.getMessage(), e);
            stop();
        }
    }

    public synchronized void stop() {
        if (port > 0) {
            lockfile.remove(port);
            port = -1;
        }
        if (server != null) {
            server.stop();
            server = null;
        }
        BridgeStatusBarWidgetFactory.refresh(project);
    }

    public synchronized void restart() {
        stop();
        start();
    }

    public synchronized int getPort() { return port; }

    public synchronized String getToken() { return token; }

    /** The tool-call activity ring buffer (for the "Show Activity" dialog). */
    public ActivityLog getActivity() { return activity; }

    @Override
    public void dispose() {
        stop();
    }
}
