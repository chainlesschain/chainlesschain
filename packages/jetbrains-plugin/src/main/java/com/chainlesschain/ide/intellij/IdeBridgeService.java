package com.chainlesschain.ide.intellij;

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
            token = LockfileWriter.generateToken();
            IntellijEditorFacade facade = new IntellijEditorFacade(project);
            server = new McpServer(IdeTools.build(facade), token);
            port = server.start("127.0.0.1", 0);

            List<String> folders = new ArrayList<>();
            String base = project.getBasePath();
            if (base != null) folders.add(base);

            long pid = ProcessHandle.current().pid();
            lockfile.write(port, token, folders, server.url(), System.currentTimeMillis(), pid);
            LOG.info("ChainlessChain IDE bridge up on " + server.url() + " (server \"ide\")");
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
    }

    public synchronized void restart() {
        stop();
        start();
    }

    public synchronized int getPort() { return port; }

    public synchronized String getToken() { return token; }

    @Override
    public void dispose() {
        stop();
    }
}
