package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * Session-scoped introspection (`cc cost <id>` / `cc context <id>`) args and the
 * `cc context --json` parser — the Java twin of the VS Code extension's
 * introspect-commands.js. The chat tool window defers to the CLI for pricing /
 * context-window math (single source of truth) rather than recomputing it, and
 * renders a persistent context-window indicator from {@link #parseContextStatus}.
 *
 * Pure (no IntelliJ SDK); parsing reuses {@link MiniJson}.
 */
public final class IntrospectArgs {
    private IntrospectArgs() {}

    /**
     * Build CLI args for an introspection command scoped to a session.
     * {@code cost} → {@code cost <id>}; {@code context} →
     * {@code context <id> [--model m] [--provider p] [--json]}.
     */
    public static List<String> build(String kind, String sessionId, String model, String provider, boolean json) {
        String id = sessionId == null ? "" : sessionId.trim();
        if ("cost".equals(kind)) {
            return new ArrayList<String>(Arrays.asList("cost", id));
        }
        List<String> args = new ArrayList<String>(Arrays.asList("context", id));
        if (notBlank(model)) {
            args.add("--model");
            args.add(model.trim());
        }
        if (notBlank(provider)) {
            args.add("--provider");
            args.add(provider.trim());
        }
        if (json) {
            args.add("--json");
        }
        return args;
    }

    /** Compact context-window status for the persistent indicator. */
    public static final class ContextStatus {
        public final long total;
        public final long window;
        public final int pct;
        public final boolean overflow;

        ContextStatus(long total, long window, int pct, boolean overflow) {
            this.total = total;
            this.window = window;
            this.pct = pct;
            this.overflow = overflow;
        }
    }

    /**
     * Parse {@code cc context --json} stdout into {@link ContextStatus}, or null
     * when the text is not the expected JSON / is missing the window or total.
     * CLI shape: {@code { contextWindow, totalTokens, overflows, … }}.
     */
    public static ContextStatus parseContextStatus(String text) {
        Map<String, Object> data;
        try {
            data = MiniJson.parseObject(text);
        } catch (RuntimeException e) {
            return null;
        }
        if (data == null) return null;
        Long total = asLong(data.get("totalTokens"));
        Long window = asLong(data.get("contextWindow"));
        if (total == null || window == null || window <= 0) return null;
        int pct = (int) Math.round((total * 100.0) / window);
        boolean overflow = Boolean.TRUE.equals(data.get("overflows")) || total > window;
        return new ContextStatus(total, window, pct, overflow);
    }

    private static Long asLong(Object o) {
        return (o instanceof Number) ? Long.valueOf(((Number) o).longValue()) : null;
    }

    private static boolean notBlank(String s) {
        return s != null && !s.trim().isEmpty();
    }
}
