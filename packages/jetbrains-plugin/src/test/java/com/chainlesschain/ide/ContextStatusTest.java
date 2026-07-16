package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link ContextStatus} — the local (spawn-free) context-window math, kept
 * behaviorally identical to the VS Code twin's contextStatusFromUsage
 * (introspect-commands.js): total = input + cache_read + cache_creation +
 * output; null whenever the inputs cannot produce a meaningful status.
 */
final class ContextStatusTest {

    private static Map<String, Object> usage(Object in, Object cacheRead,
            Object cacheCreate, Object out) {
        Map<String, Object> u = new LinkedHashMap<>();
        if (in != null) u.put("input_tokens", in);
        if (cacheRead != null) u.put("cache_read_input_tokens", cacheRead);
        if (cacheCreate != null) u.put("cache_creation_input_tokens", cacheCreate);
        if (out != null) u.put("output_tokens", out);
        return u;
    }

    @Test
    void sumsAllFourUsageComponents() {
        IntrospectArgs.ContextStatus st =
                ContextStatus.fromUsage(usage(1000L, 2000L, 500L, 250L), 10_000L);
        assertEquals(3750L, st.total);
        assertEquals(10_000L, st.window);
        assertEquals(38, st.pct); // round(37.5)
        assertFalse(st.overflow);
    }

    @Test
    void missingComponentsCountAsZero() {
        IntrospectArgs.ContextStatus st =
                ContextStatus.fromUsage(usage(120_000L, null, null, null), 200_000L);
        assertEquals(120_000L, st.total);
        assertEquals(60, st.pct);
    }

    @Test
    void overflowWhenTotalExceedsWindow() {
        IntrospectArgs.ContextStatus st =
                ContextStatus.fromUsage(usage(9_000L, 2_000L, 0L, 100L), 10_000L);
        assertTrue(st.overflow);
        assertEquals(111, st.pct);
    }

    @Test
    void nullWhenInputsCannotProduceAStatus() {
        assertNull(ContextStatus.fromUsage(null, 10_000L), "no usage");
        assertNull(ContextStatus.fromUsage(usage(100L, 0L, 0L, 0L), 0L), "no window");
        assertNull(ContextStatus.fromUsage(usage(100L, 0L, 0L, 0L), -5L), "bad window");
        assertNull(ContextStatus.fromUsage(usage(0L, 0L, 0L, 0L), 10_000L), "zero total");
        assertNull(ContextStatus.fromUsage(usage("x", null, null, null), 10_000L),
                "non-numeric fields count as 0 → zero total → null");
    }
}
