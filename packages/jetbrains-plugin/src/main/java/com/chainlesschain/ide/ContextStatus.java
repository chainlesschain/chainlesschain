package com.chainlesschain.ide;

import java.util.Map;

/**
 * Local context-window math — the Java twin of the VS Code extension's
 * {@code introspect-commands.js contextStatusFromUsage}. The LAST LLM call's
 * usage (a {@code token_usage} event) IS the live context size: prompt tokens
 * (fresh + cached + cache-creation) plus the completion. Once the model's
 * window size is known (ONE {@code cc context --json} probe, cached per
 * session), the per-turn indicator needs no CLI spawn at all — on Windows
 * each cold {@code cc} spawn costs seconds, once per turn.
 *
 * Pure JDK; returns null whenever the inputs cannot produce a meaningful
 * status (callers fall back to the authoritative CLI probe).
 */
public final class ContextStatus {

    private ContextStatus() {}

    /**
     * Derive the indicator from accumulated usage + a known window size, or
     * null (no usage / non-positive window / zero total — fall back to the CLI).
     */
    public static IntrospectArgs.ContextStatus fromUsage(Map<String, Object> usage, long window) {
        if (usage == null || window <= 0) return null;
        long total = num(usage.get("input_tokens"))
                + num(usage.get("cache_read_input_tokens"))
                + num(usage.get("cache_creation_input_tokens"))
                + num(usage.get("output_tokens"));
        if (total <= 0) return null;
        int pct = (int) Math.round((total * 100.0) / window);
        return new IntrospectArgs.ContextStatus(total, window, pct, total > window);
    }

    private static long num(Object v) {
        return v instanceof Number ? ((Number) v).longValue() : 0L;
    }
}
