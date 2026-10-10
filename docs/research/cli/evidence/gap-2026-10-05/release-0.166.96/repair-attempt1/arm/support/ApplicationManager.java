package com.intellij.openapi.application;

import java.util.ArrayDeque;
import javax.swing.SwingUtilities;

/** Only the IDEA scheduler is substituted. No IDEA runtime or GUI is launched. */
public final class ApplicationManager {
    private static final QueuedApplication APP = new QueuedApplication();
    public static QueuedApplication getApplication() { return APP; }
    public static final class QueuedApplication {
        private final ArrayDeque<Runnable> queue = new ArrayDeque<>();
        public void invokeLater(Runnable runnable) {
            if (!SwingUtilities.isEventDispatchThread()) throw new AssertionError("Schedule outside EDT");
            queue.add(runnable);
        }
        public int size() { return queue.size(); }
        public void drain() {
            if (!SwingUtilities.isEventDispatchThread()) throw new AssertionError("Dispatch outside EDT");
            while (!queue.isEmpty()) queue.remove().run();
        }
    }
}
