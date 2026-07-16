package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.CliVersionCheck;
import com.chainlesschain.ide.WhatsNew;
import com.intellij.ide.util.PropertiesComponent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.startup.StartupActivity;
import org.jetbrains.annotations.NotNull;

/**
 * Starts the IDE bridge when a project finishes opening (registered as a
 * postStartupActivity in plugin.xml). The matching teardown is the
 * {@link IdeBridgeService} disposing with the project. SDK-bound.
 */
public final class IdeBridgeStartup implements StartupActivity.DumbAware {

    /** Application-level: the cc version seen on the previous IDE start. */
    private static final String LAST_SEEN_KEY = "cc.lastSeenCcVersion";
    // One nudge per IDE process even with several projects opening in parallel
    // (each project runs this activity; the store-then-compare below would race).
    private static final java.util.concurrent.atomic.AtomicBoolean nudgeChecked =
            new java.util.concurrent.atomic.AtomicBoolean();

    @Override
    public void runActivity(@NotNull Project project) {
        // Load persisted settings and push the cc-path override into the pure
        // layer before any session/capture resolves the binary.
        CcSettings.getInstance().applyToRuntime();
        IdeBridgeService.getInstance(project).start();
        maybeNudgeUpgrade(project);
    }

    /**
     * One-shot cc-upgrade nudge (VS whats-new.js parity): remember the CLI
     * version across IDE starts and, on a REAL upgrade, offer the release
     * notes. First run stores silently; the probe runs off the EDT and every
     * failure is swallowed (best-effort — never disturb startup).
     */
    private static void maybeNudgeUpgrade(Project project) {
        if (!nudgeChecked.compareAndSet(false, true)) return;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                java.io.File cwd = project.getBasePath() != null
                        ? new java.io.File(project.getBasePath()) : null;
                String out = AgentChatSession.runCapture(
                        java.util.Collections.singletonList("--version"), cwd, 12000);
                String current = CliVersionCheck.parseVersion(out);
                if (current == null) return; // cc missing — nothing to remember
                PropertiesComponent props = PropertiesComponent.getInstance();
                String prev = props.getValue(LAST_SEEN_KEY);
                if (!current.equals(prev)) props.setValue(LAST_SEEN_KEY, current);
                if (!WhatsNew.shouldNudgeUpgrade(prev, current)) return;
                ApplicationManager.getApplication().invokeLater(() -> {
                    if (project.isDisposed()) return;
                    com.intellij.notification.Notification n =
                            new com.intellij.notification.Notification(
                                    "ChainlessChain",
                                    CcBundle.message("whatsnew.nudge", prev, current),
                                    com.intellij.notification.NotificationType.INFORMATION);
                    n.addAction(com.intellij.notification.NotificationAction.createSimple(
                            CcBundle.message("whatsnew.nudgeButton"), () -> {
                                n.expire();
                                ShowWhatsNewAction.show(project);
                            }));
                    com.intellij.notification.Notifications.Bus.notify(n, project);
                });
            } catch (Throwable ignored) {
                // best-effort — a version probe must never break startup
            }
        });
    }
}
