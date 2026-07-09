package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.ActivityLog;
import com.chainlesschain.ide.DashboardHtml;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowFactory;
import com.intellij.ui.JBColor;
import com.intellij.ui.components.JBScrollPane;
import com.intellij.ui.content.Content;
import com.intellij.ui.content.ContentFactory;
import com.intellij.util.Alarm;
import java.awt.BorderLayout;
import java.awt.Font;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import javax.swing.JPanel;
import javax.swing.JTextArea;
import org.jetbrains.annotations.NotNull;

/**
 * The IDE-bridge dashboard tool window (Settings → open via "Open Dashboard" or
 * the tool-window stripe) — VS Code {@code chainlesschain.ide.openDashboard}
 * parity, a live JCEF webview of status cards + the tool-call stream, replacing
 * the plain-text "Show Activity" dialog with a rich view. Rendering is the pure
 * {@link DashboardHtml}; this glue owns the JCEF browser and a change-detecting
 * refresh loop. Falls back to a monospace text area when JCEF is unavailable.
 */
public final class DashboardToolWindowFactory implements ToolWindowFactory, DumbAware {

    static final String TOOL_WINDOW_ID = "ChainlessChain Dashboard";

    @Override
    public void createToolWindowContent(@NotNull Project project, @NotNull ToolWindow toolWindow) {
        Disposable parent = toolWindow.getDisposable();
        JPanel panel = new JPanel(new BorderLayout());

        Object browser = null;
        JTextArea fallback = null;
        try {
            if (com.intellij.ui.jcef.JBCefApp.isSupported()) {
                com.intellij.ui.jcef.JBCefBrowser b = new com.intellij.ui.jcef.JBCefBrowser();
                Disposer.register(parent, b);
                browser = b;
                panel.add(b.getComponent(), BorderLayout.CENTER);
            }
        } catch (Throwable t) {
            browser = null; // JCEF classes/native missing → text fallback
        }
        if (browser == null) {
            fallback = new JTextArea();
            fallback.setEditable(false);
            fallback.setFont(new Font(Font.MONOSPACED, Font.PLAIN, fallback.getFont().getSize()));
            panel.add(new JBScrollPane(fallback), BorderLayout.CENTER);
        }

        Content content = ContentFactory.getInstance().createContent(panel, "", false);
        toolWindow.getContentManager().addContent(content);

        Alarm alarm = new Alarm(Alarm.ThreadToUse.SWING_THREAD, parent);
        new Refresher(project, browser, fallback, alarm).schedule(0);
    }

    /** Polls the bridge and re-renders only when activity changes (no reload churn). */
    private static final class Refresher {
        private final Project project;
        private final Object browser; // JBCefBrowser or null
        private final JTextArea fallback;
        private final Alarm alarm;
        private String lastSig;

        Refresher(Project project, Object browser, JTextArea fallback, Alarm alarm) {
            this.project = project;
            this.browser = browser;
            this.fallback = fallback;
            this.alarm = alarm;
        }

        void schedule(int delayMs) {
            alarm.addRequest(this::tick, delayMs);
        }

        private void tick() {
            try {
                IdeBridgeService svc = IdeBridgeService.getInstance(project);
                int port = svc == null ? -1 : svc.getPort();
                ActivityLog log = svc == null ? new ActivityLog(1) : svc.getActivity();
                ActivityLog.Counts c = log.counts();
                List<ActivityLog.Entry> recent = log.recent(60);
                String sig = port + "|" + c.tool + "|" + c.connect + "|" + c.error + "|" + log.size()
                        + "|" + (recent.isEmpty() ? 0 : recent.get(0).ts);
                if (!sig.equals(lastSig)) {
                    lastSig = sig;
                    render(port, log, c, recent);
                }
            } catch (Throwable ignore) {
                // best-effort — a dashboard render must never break the IDE
            }
            schedule(1000); // keep the view live
        }

        private void render(int port, ActivityLog log, ActivityLog.Counts c,
                            List<ActivityLog.Entry> recent) {
            String ws = project.getBasePath();
            if (browser instanceof com.intellij.ui.jcef.JBCefBrowser) {
                boolean dark = !JBColor.isBright();
                String html = DashboardHtml.page(
                        port > 0, port, ws, c, recent,
                        ts -> new SimpleDateFormat("HH:mm:ss").format(new Date(ts)), dark);
                ((com.intellij.ui.jcef.JBCefBrowser) browser).loadHTML(html);
            } else if (fallback != null) {
                final SimpleDateFormat hms = new SimpleDateFormat("HH:mm:ss");
                fallback.setText(log.formatReport(port, 60, ts -> hms.format(new Date(ts))));
                fallback.setCaretPosition(0);
            }
        }
    }
}
