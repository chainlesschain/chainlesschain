package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.StatusBarText;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.wm.StatusBar;
import com.intellij.openapi.wm.StatusBarWidget;
import com.intellij.openapi.wm.StatusBarWidgetFactory;
import com.intellij.openapi.wm.WindowManager;
import com.intellij.util.Consumer;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.awt.Component;
import java.awt.event.MouseEvent;

/**
 * Always-visible status-bar widget (VS Code ui/status-bar.js parity): bridge
 * running state + port, plus the active conversation's approval mode so
 * auto-accept / bypass can't go unnoticed once set. Pull model — the text is
 * re-derived from {@link IdeBridgeService} + the chat panel registry on every
 * repaint; state changes call {@link #refresh(Project)} to trigger one. All
 * strings come from the pure {@link StatusBarText} core.
 */
public final class BridgeStatusBarWidgetFactory implements StatusBarWidgetFactory {

    static final String WIDGET_ID = "chainlesschain.ide.statusBar";

    @Override
    public @NotNull String getId() {
        return WIDGET_ID;
    }

    @Override
    public @NotNull String getDisplayName() {
        return "ChainlessChain IDE Bridge";
    }

    @Override
    public boolean isAvailable(@NotNull Project project) {
        return true;
    }

    @Override
    public @NotNull StatusBarWidget createWidget(@NotNull Project project) {
        return new Widget(project);
    }

    @Override
    public void disposeWidget(@NotNull StatusBarWidget widget) {
        Disposer.dispose(widget);
    }

    @Override
    public boolean canBeEnabledOn(@NotNull StatusBar statusBar) {
        return true;
    }

    /**
     * Repaint the widget after a state change (bridge start/stop, approval-mode
     * change, tab switch). Safe from any thread; no-op once the project is gone.
     */
    static void refresh(Project project) {
        if (project == null || project.isDisposed()) return;
        ApplicationManager.getApplication().invokeLater(() -> {
            if (project.isDisposed()) return;
            StatusBar statusBar = WindowManager.getInstance().getStatusBar(project);
            if (statusBar != null) statusBar.updateWidget(WIDGET_ID);
        });
    }

    private static final class Widget implements StatusBarWidget, StatusBarWidget.TextPresentation {

        private final Project project;

        Widget(Project project) {
            this.project = project;
        }

        @Override
        public @NotNull String ID() {
            return WIDGET_ID;
        }

        @Override
        public void install(@NotNull StatusBar statusBar) {
        }

        @Override
        public void dispose() {
        }

        @Override
        public StatusBarWidget.WidgetPresentation getPresentation() {
            return this;
        }

        @Override
        public @NotNull String getText() {
            return StatusBarText.label(port(), mode());
        }

        @Override
        public float getAlignment() {
            return Component.CENTER_ALIGNMENT;
        }

        @Override
        public @Nullable String getTooltipText() {
            return StatusBarText.tooltip(port(), mode());
        }

        @Override
        public @Nullable Consumer<MouseEvent> getClickConsumer() {
            return e -> {
                int port = port();
                String msg = port > 0
                        ? "ChainlessChain IDE bridge running on 127.0.0.1:" + port + " (server \"ide\").\n"
                          + StatusBarText.modeLine(mode())
                        : "ChainlessChain IDE bridge is stopped.";
                Messages.showInfoMessage(project, msg, "ChainlessChain IDE Bridge");
            };
        }

        private int port() {
            if (project.isDisposed()) return -1;
            IdeBridgeService svc = IdeBridgeService.getInstance(project);
            return svc != null ? svc.getPort() : -1;
        }

        private String mode() {
            if (project.isDisposed()) return "default";
            return ChatToolWindowFactory.activeModeFor(project);
        }
    }
}
