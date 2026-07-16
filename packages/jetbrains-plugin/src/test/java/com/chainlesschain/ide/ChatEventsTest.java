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

    // ── stream_retry + budget events (byte-identical to the VS mapper) ──────

    @Test
    void streamRetryMapsToInfoWithAttempt() {
        ChatEvents.TurnState st = new ChatEvents.TurnState();
        Map<String, Object> evt = new LinkedHashMap<>();
        evt.put("type", "stream_retry");
        evt.put("attempt", 2L);
        evt.put("message", "API connection dropped - retrying");
        Map<String, Object> ui = ChatEvents.mapAgentEvent(evt, st);
        assertEquals("info", ui.get("kind"));
        assertEquals("⚠ API connection dropped - retrying (attempt 2)", ui.get("text"));
    }

    @Test
    void streamRetryWithoutFieldsUsesDefaultWording() {
        ChatEvents.TurnState st = new ChatEvents.TurnState();
        Map<String, Object> evt = new LinkedHashMap<>();
        evt.put("type", "stream_retry");
        Map<String, Object> ui = ChatEvents.mapAgentEvent(evt, st);
        assertEquals("⚠ API connection dropped — retrying", ui.get("text"));
    }

    @Test
    void iterationBudgetExhaustedMapsToInfo() {
        ChatEvents.TurnState st = new ChatEvents.TurnState();
        Map<String, Object> evt = new LinkedHashMap<>();
        evt.put("type", "iteration_budget_exhausted");
        evt.put("budget", 50L);
        assertEquals("⏹ turn budget exhausted (50 turns)",
                ChatEvents.mapAgentEvent(evt, st).get("text"));
        evt.remove("budget");
        assertEquals("⏹ turn budget exhausted",
                ChatEvents.mapAgentEvent(evt, st).get("text"));
    }

    @Test
    void costBudgetExhaustedMapsToInfoWithTwoDecimalDollars() {
        ChatEvents.TurnState st = new ChatEvents.TurnState();
        Map<String, Object> evt = new LinkedHashMap<>();
        evt.put("type", "cost_budget_exhausted");
        evt.put("spent_usd", 0.52);
        evt.put("limit_usd", 1L); // integer limit still renders "$1.00"
        assertEquals("⏹ cost budget exhausted ($0.52 of $1.00)",
                ChatEvents.mapAgentEvent(evt, st).get("text"));
        evt.remove("limit_usd"); // one figure missing → no parenthetical
        assertEquals("⏹ cost budget exhausted",
                ChatEvents.mapAgentEvent(evt, st).get("text"));
    }

    @Test
    void budgetResultAfterStreamedTextShowsOnlyTheStopReason() {
        // The error_max_* result carries the FULL final text in evt.result —
        // repainting it would duplicate everything that already streamed.
        ChatEvents.TurnState st = new ChatEvents.TurnState();
        Map<String, Object> delta = new LinkedHashMap<>();
        delta.put("type", "text_delta");
        delta.put("text", "streamed body");
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("delta", delta);
        Map<String, Object> stream = new LinkedHashMap<>();
        stream.put("type", "stream_event");
        stream.put("event", event);
        ChatEvents.mapAgentEvent(stream, st); // sets sawDelta

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("type", "result");
        result.put("subtype", "error_max_turns");
        result.put("is_error", true);
        result.put("result", "streamed body");
        Map<String, Object> ui = ChatEvents.mapAgentEvent(result, st);
        assertEquals("turn_end", ui.get("kind"));
        assertEquals(Boolean.TRUE, ui.get("isError"));
        assertEquals("⏹ stopped: turn budget exhausted", ui.get("text"));
    }

    @Test
    void budgetResultWithoutStreamedTextKeepsTheResultPlusReason() {
        ChatEvents.TurnState st = new ChatEvents.TurnState();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("type", "result");
        result.put("subtype", "error_max_budget");
        result.put("is_error", true);
        result.put("result", "partial answer");
        Map<String, Object> ui = ChatEvents.mapAgentEvent(result, st);
        assertEquals("partial answer\n⏹ stopped: cost budget exhausted", ui.get("text"));

        Map<String, Object> empty = new LinkedHashMap<>();
        empty.put("type", "result");
        empty.put("subtype", "error_max_budget");
        empty.put("is_error", true);
        empty.put("result", "");
        assertEquals("⏹ stopped: cost budget exhausted",
                ChatEvents.mapAgentEvent(empty, new ChatEvents.TurnState()).get("text"));
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
