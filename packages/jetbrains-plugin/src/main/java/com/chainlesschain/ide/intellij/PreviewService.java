package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.MiniJson;
import com.chainlesschain.ide.PreviewDetect;
import com.intellij.execution.configurations.GeneralCommandLine;
import com.intellij.execution.process.OSProcessHandler;
import com.intellij.execution.process.ProcessEvent;
import com.intellij.execution.process.ProcessListener;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.Key;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowManager;
import com.intellij.ui.content.Content;
import com.intellij.ui.content.ContentFactory;
import org.jetbrains.annotations.NotNull;

import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.SwingConstants;
import javax.swing.SwingUtilities;
import java.awt.BorderLayout;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * §2 App Preview — runs the project's dev script ({@link PreviewDetect#pickDevScript})
 * via {@code npm run <script>}, watches its output for the first local server URL
 * ({@link PreviewDetect#detectServerUrl}), and shows it: embedded in the preview
 * tool window via JCEF when supported, else opened in the external browser.
 *
 * Protocol/detection logic is the pure {@link PreviewDetect}; this is process +
 * JCEF + tool-window glue. One preview per project; {@link #start} is idempotent
 * (re-focuses a running preview).
 */
public final class PreviewService {

    static final String TOOL_WINDOW_ID = "ChainlessChain Preview";

    private final Project project;
    private OSProcessHandler handler;
    private volatile boolean urlFound;
    private Object browser; // JBCefBrowser, held opaquely (JCEF may be absent)

    public PreviewService(Project project) {
        this.project = project;
    }

    public static PreviewService getInstance(Project project) {
        return project.getService(PreviewService.class);
    }

    public synchronized boolean isRunning() {
        return handler != null && !handler.isProcessTerminated();
    }

    /** Start (or re-focus) the dev-server preview. */
    public synchronized void start() {
        if (isRunning()) {
            revealToolWindow();
            setStatus("Preview already running.");
            return;
        }
        String base = project.getBasePath();
        if (base == null) {
            setStatus("No project base path.");
            return;
        }
        PreviewDetect.DevScript ds = pickScript(base);
        if (ds == null) {
            setStatus("No dev script found in package.json (tried dev/start/serve/...).");
            return;
        }
        String script = ds.script;
        GeneralCommandLine cmd = new GeneralCommandLine();
        if (File.separatorChar == '\\') {
            cmd.setExePath("cmd.exe");
            cmd.addParameters("/c", "npm", "run", script);
        } else {
            cmd.setExePath("npm");
            cmd.addParameters("run", script);
        }
        cmd.setWorkDirectory(base);
        cmd.setCharset(StandardCharsets.UTF_8);
        try {
            handler = new OSProcessHandler(cmd);
        } catch (Exception e) {
            setStatus("Failed to start `npm run " + script + "`: " + e.getMessage());
            return;
        }
        urlFound = false;
        revealToolWindow();
        setStatus("Starting `npm run " + script + "` — waiting for server URL…");
        handler.addProcessListener(new ProcessListener() {
            @Override
            public void onTextAvailable(@NotNull ProcessEvent event, @NotNull Key outputType) {
                if (urlFound) return;
                String url = PreviewDetect.detectServerUrl(event.getText());
                if (url != null) {
                    urlFound = true;
                    SwingUtilities.invokeLater(() -> showUrl(url));
                }
            }

            @Override
            public void processTerminated(@NotNull ProcessEvent event) {
                if (!urlFound) {
                    SwingUtilities.invokeLater(() ->
                            setStatus("Dev server exited (" + event.getExitCode()
                                    + ") before a URL was detected."));
                }
            }
        });
        handler.startNotify();
    }

    /** Stop the dev server (kills the process tree) and clear the preview. */
    public synchronized void stop() {
        if (handler != null) {
            Process proc = handler.getProcess();
            if (proc != null) {
                // destroyProcess() only ends the immediate process (cmd.exe / npm);
                // the actual dev server is a grandchild (cmd/sh → npm → node) that
                // would be orphaned holding the port. Kill the descendant tree too.
                try {
                    proc.descendants().forEach(ProcessHandle::destroy);
                } catch (Exception ignore) {
                    // best-effort — fall through to destroyProcess()
                }
            }
            handler.destroyProcess();
            handler = null;
        }
        disposeBrowser();
        setStatus("Preview stopped.");
    }

    // ---- internals ------------------------------------------------------

    private PreviewDetect.DevScript pickScript(String base) {
        try {
            Path pkg = Paths.get(base, "package.json");
            if (!Files.isRegularFile(pkg)) return null;
            String json = new String(Files.readAllBytes(pkg), StandardCharsets.UTF_8);
            Map<String, Object> root = MiniJson.parseObject(json);
            Object scriptsObj = root == null ? null : root.get("scripts");
            Map<String, String> scripts = new LinkedHashMap<>();
            if (scriptsObj instanceof Map) {
                for (Map.Entry<?, ?> e : ((Map<?, ?>) scriptsObj).entrySet()) {
                    if (e.getKey() != null && e.getValue() != null) {
                        scripts.put(String.valueOf(e.getKey()), String.valueOf(e.getValue()));
                    }
                }
            }
            return PreviewDetect.pickDevScript(scripts);
        } catch (Exception e) {
            return null;
        }
    }

    private void showUrl(String url) {
        setStatus("Preview: " + url);
        if (tryEmbed(url)) return;
        // JCEF unavailable → external browser.
        com.intellij.ide.BrowserUtil.browse(url);
        setContent(centeredLabel("Opened preview in your browser: " + url
                + "  (embedded preview needs JCEF support)."));
    }

    /** Best-effort JCEF embed. Returns false if JCEF is unavailable on this IDE/runtime. */
    private boolean tryEmbed(String url) {
        try {
            if (!com.intellij.ui.jcef.JBCefApp.isSupported()) return false;
            com.intellij.ui.jcef.JBCefBrowser b = new com.intellij.ui.jcef.JBCefBrowser(url);
            this.browser = b;
            setContent(b.getComponent());
            return true;
        } catch (Throwable t) {
            return false; // JCEF classes/native missing → fall back
        }
    }

    private void disposeBrowser() {
        if (browser instanceof com.intellij.ui.jcef.JBCefBrowser) {
            try {
                ((com.intellij.ui.jcef.JBCefBrowser) browser).dispose();
            } catch (Throwable ignored) {
                // already disposed
            }
        }
        browser = null;
        setContent(centeredLabel("No preview running."));
    }

    private void revealToolWindow() {
        ToolWindow tw = ToolWindowManager.getInstance(project).getToolWindow(TOOL_WINDOW_ID);
        if (tw != null) tw.activate(null, true, false);
    }

    private void setStatus(String text) {
        ApplicationManager.getApplication().invokeLater(() -> {
            ToolWindow tw = ToolWindowManager.getInstance(project).getToolWindow(TOOL_WINDOW_ID);
            if (tw != null) tw.setTitle(text);
        });
    }

    private void setContent(java.awt.Component component) {
        ToolWindow tw = ToolWindowManager.getInstance(project).getToolWindow(TOOL_WINDOW_ID);
        if (tw == null) return;
        JPanel wrap = new JPanel(new BorderLayout());
        wrap.add(component, BorderLayout.CENTER);
        Content content = ContentFactory.getInstance().createContent(wrap, "", false);
        tw.getContentManager().removeAllContents(true);
        tw.getContentManager().addContent(content);
    }

    private static JLabel centeredLabel(String text) {
        JLabel l = new JLabel(text, SwingConstants.CENTER);
        l.setEnabled(false);
        return l;
    }
}
