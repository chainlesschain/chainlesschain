package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link ChatEvents} layer. */
class ChatEventsTest {

    private static Map<String, Object> usage(long input, long output, long cached) {
        Map<String, Object> u = new LinkedHashMap<>();
        u.put("input_tokens", input);
        u.put("output_tokens", output);
        u.put("cache_read_input_tokens", cached);
        return u;
    }

    // ── formatTokens ────────────────────────────────────────────────────────

    @Test
    void formatTokensUnderOneThousandIsVerbatim() {
        assertEquals("456", ChatEvents.formatTokens(456));
    }

    @Test
    void formatTokensUnderTenThousandKeepsOneDecimal() {
        assertEquals("2.3k", ChatEvents.formatTokens(2345));
    }

    @Test
    void formatTokensAtOrAboveTenThousandDropsTheDecimal() {
        assertEquals("12k", ChatEvents.formatTokens(12345));
        assertEquals("123k", ChatEvents.formatTokens(123456));
    }

    @Test
    void formatTokensExactlyOneThousandIsOneDecimalK() {
        assertEquals("1.0k", ChatEvents.formatTokens(1000));
    }

    // ── TokenTally ──────────────────────────────────────────────────────────

    @Test
    void tokenTallyAccumulatesAndShowsCached() {
        ChatEvents.TokenTally t = new ChatEvents.TokenTally();
        t.add(usage(12000L, 300L, 900L));
        t.add(usage(345L, 156L, 0L));
        assertEquals("thinking… · 12k→456 tokens (900 cached)", t.statusLine());
    }

    @Test
    void tokenTallyOmitsCachedWhenZero() {
        ChatEvents.TokenTally noCache = new ChatEvents.TokenTally();
        noCache.add(usage(345L, 156L, 0L));
        assertEquals("thinking… · 345→156 tokens", noCache.statusLine());
    }

    @Test
    void tokenTallyIgnoresNullPayload() {
        ChatEvents.TokenTally t = new ChatEvents.TokenTally();
        t.add(usage(12000L, 300L, 900L));
        t.add(usage(345L, 156L, 0L));
        t.add(null);
        assertEquals("thinking… · 12k→456 tokens (900 cached)", t.statusLine());
    }

    // ── readyLine ───────────────────────────────────────────────────────────

    @Test
    void readyLineFromUsage() {
        assertEquals("ready · 12k→300 tokens", ChatEvents.readyLine(usage(12000L, 300L, 900L)));
    }

    @Test
    void readyLineWithoutUsageIsPlainReady() {
        assertEquals("ready", ChatEvents.readyLine(null));
    }

    // ── mapAgentEvent ───────────────────────────────────────────────────────

    @Test
    void tokenUsageEventMapsToUsageKindCarryingTheSameUsageMap() {
        ChatEvents.TurnState st = new ChatEvents.TurnState();
        Map<String, Object> u = usage(12000L, 300L, 900L);
        Map<String, Object> evt = new LinkedHashMap<>();
        evt.put("type", "token_usage");
        evt.put("usage", u);
        Map<String, Object> mapped = ChatEvents.mapAgentEvent(evt, st);
        assertEquals("usage", mapped.get("kind"));
        assertSame(u, mapped.get("usage"));
    }

    @Test
    void tokenUsageEventWithoutUsageIsUiSilent() {
        ChatEvents.TurnState st = new ChatEvents.TurnState();
        Map<String, Object> evt = new LinkedHashMap<>();
        evt.put("type", "token_usage");
        assertNull(ChatEvents.mapAgentEvent(evt, st));
    }

    @Test
    void iterationWarningMapsToWarningInfoLine() {
        ChatEvents.TurnState st = new ChatEvents.TurnState();
        Map<String, Object> evt = new LinkedHashMap<>();
        evt.put("type", "iteration_warning");
        evt.put("message", "iteration 20/25");
        Map<String, Object> warn = ChatEvents.mapAgentEvent(evt, st);
        assertEquals("info", warn.get("kind"));
        assertEquals("⚠ iteration 20/25", warn.get("text"));
    }

    @Test
    void iterationWarningWithoutMessageUsesDefaultText() {
        ChatEvents.TurnState st = new ChatEvents.TurnState();
        Map<String, Object> evt = new LinkedHashMap<>();
        evt.put("type", "iteration_warning");
        Map<String, Object> warn = ChatEvents.mapAgentEvent(evt, st);
        assertTrue(String.valueOf(warn.get("text")).startsWith("⚠ approaching"),
                String.valueOf(warn.get("text")));
    }

    @Test
    void nullEventMapsToNull() {
        assertNull(ChatEvents.mapAgentEvent(null, new ChatEvents.TurnState()));
    }

    // ── buildSessionArgs (unambiguous from source) ──────────────────────────

    @Test
    void buildSessionArgsEmitsProviderModelResumeTrimmed() {
        assertEquals(
                List.of("--provider", "openai", "--model", "gpt", "--resume", "sess-1"),
                ChatEvents.buildSessionArgs("  openai ", " gpt", "sess-1"));
    }

    @Test
    void buildSessionArgsSkipsBlankAndNullValues() {
        assertTrue(ChatEvents.buildSessionArgs(null, "   ", "").isEmpty());
    }

    // ── summarizeToolArgs (unambiguous from source) ─────────────────────────

    @Test
    void summarizeToolArgsPicksFirstPresentKeyByPriority() {
        Map<String, Object> args = new LinkedHashMap<>();
        args.put("command", "ls");
        args.put("path", "/a/b");
        // "path" has priority over "command".
        assertEquals("/a/b", ChatEvents.summarizeToolArgs(args));
    }

    @Test
    void summarizeToolArgsTruncatesBeyondEightyChars() {
        Map<String, Object> args = new LinkedHashMap<>();
        args.put("path", "x".repeat(200));
        String s = ChatEvents.summarizeToolArgs(args);
        assertEquals(81, s.length()); // 80 chars + "…"
        assertTrue(s.endsWith("…"));
    }

    @Test
    void summarizeToolArgsForNonMapIsEmpty() {
        assertEquals("", ChatEvents.summarizeToolArgs("not a map"));
    }
}
