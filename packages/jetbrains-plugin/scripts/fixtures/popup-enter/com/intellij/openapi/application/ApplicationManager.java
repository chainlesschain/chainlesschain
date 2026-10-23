package com.intellij.openapi.application;

import java.util.ArrayDeque;

/** Controllable IDE invokeLater boundary; popup hierarchy and actions use real Swing. */
public final class ApplicationManager {
    private static final Application APPLICATION = new Application();
    public static Application getApplication() { return APPLICATION; }

    public static final class Application {
        private final ArrayDeque<Runnable> pending = new ArrayDeque<>();
        public void invokeLater(Runnable action) { pending.add(action); }
        public int pendingCount() { return pending.size(); }
        public void runNext() { pending.remove().run(); }
        public void clear() { pending.clear(); }
    }
}
