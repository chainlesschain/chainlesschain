package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

final class UsageReportTest {

    private static final long NOW = java.time.Instant.parse("2026-07-10T12:00:00Z").toEpochMilli();

    private static final String USAGE_JSON = "{"
            + "\"total\":{\"inputTokens\":1000,\"outputTokens\":500,\"totalTokens\":1500,\"calls\":12},"
            + "\"skipped\":1,"
            + "\"sessions\":["
            + "  {\"sessionId\":\"s-recent\",\"total\":{\"totalTokens\":600,\"calls\":5}},"
            + "  {\"sessionId\":\"s-week\",\"total\":{\"totalTokens\":400,\"calls\":4}},"
            + "  {\"sessionId\":\"s-old\",\"total\":{\"totalTokens\":300,\"calls\":2}},"
            + "  {\"sessionId\":\"s-unknown\",\"total\":{\"totalTokens\":200,\"calls\":1}}"
            + "],"
            + "\"byModel\":[{\"provider\":\"volcengine\",\"model\":\"doubao-pro\","
            + "\"inputTokens\":900,\"outputTokens\":450,\"totalTokens\":1350,\"calls\":10}]"
            + "}";

    private static final String LIST_JSON = "["
            + "{\"id\":\"s-recent\",\"title\":\"Fix tests\",\"updated_at\":\"2026-07-10T10:00:00.000Z\"},"
            + "{\"id\":\"s-week\",\"title\":\"Refactor\",\"updated_at\":\"2026-07-07T12:00:00.000Z\"},"
            + "{\"id\":\"s-old\",\"title\":\"\",\"updated_at\":\"2026-05-31 12:00:00\"}"
            + "]";

    @Test
    void buildsCliArgv() {
        assertEquals(Arrays.asList("session", "usage", "--json", "--limit", "1000"),
                UsageReport.buildUsageArgs(1000));
        assertEquals(Arrays.asList("session", "list", "--json", "-n", "50"),
                UsageReport.buildSessionListArgs(50));
    }

    @Test
    void parsesTolerantly() {
        assertNull(UsageReport.parseUsageJson("not json"));
        assertNull(UsageReport.parseUsageJson("{\"nope\":1}"));
        assertNotNull(UsageReport.parseUsageJson(USAGE_JSON));
    }

    @Test
    void rendersWindowsModelsAndTopSessions() {
        Map<String, Object> usage = UsageReport.parseUsageJson(USAGE_JSON);
        List<SessionList.SessionItem> sessions = SessionList.parseSessionList(LIST_JSON);
        String report = UsageReport.render(usage, sessions, NOW);
        assertNotNull(report);
        // All-time line straight from the CLI rollup.
        assertTrue(report.contains("All time: 1,500 tokens"));
        assertTrue(report.contains("1 unreadable skipped"));
        // 24h window: only s-recent (2h old).
        assertTrue(report.contains("Last 24 h"));
        assertTrue(report.replaceAll("\\s+", " ")
                .contains("Last 24 h 600 tokens 5 calls 1 sessions"));
        // 7d window: s-recent + s-week cumulative; s-old is 40d out and its
        // SQLite-datetime timestamp still parses (else it would silently drop
        // out of ALL windows AND the list — the render must not throw).
        assertTrue(report.replaceAll("\\s+", " ")
                .contains("Last 7 days 1,000 tokens 9 calls 2 sessions"));
        assertTrue(report.replaceAll("\\s+", " ")
                .contains("Last 30 days 1,000 tokens 9 calls 2 sessions"));
        // Model rollup + top-session join.
        assertTrue(report.contains("volcengine"));
        assertTrue(report.contains("doubao-pro"));
        assertTrue(report.contains("Fix tests"));
        assertTrue(report.contains("attribution needs CLI-side"));
        // Unreadable usage → null (dialog shows the install hint instead).
        assertNull(UsageReport.render(null, sessions, NOW));
    }

    // ── Usage attribution (用量归因) — additive `attribution` section ──────

    /** Exact render of USAGE_JSON+LIST_JSON BEFORE the attribution feature
     *  landed (captured byte-for-byte from the pre-change UsageReport). An
     *  attribution-less payload (old CLI) must keep producing exactly this. */
    private static final String PRE_ATTRIBUTION_SNAPSHOT = String.join("\n",
            "ChainlessChain — Token Usage",
            "",
            "All time: 1,500 tokens  ·  in 1,000 / out 500  ·  12 LLM calls  ·  4 sessions  ·  1 unreadable skipped",
            "",
            "Activity windows (bucketed by each session's LAST activity time —",
            "the usage store has no per-event timestamps; treat as approximations):",
            "  Last 24 h     600            tokens  5        calls  1     sessions",
            "  Last 7 days   1,000          tokens  9        calls  2     sessions",
            "  Last 30 days  1,000          tokens  9        calls  2     sessions",
            "",
            "By provider / model:",
            "  volcengine doubao-pro                 1,350          tokens  in 900  out 450  calls 10",
            "",
            "Top sessions:",
            "  s-recent                 600          tokens  5      calls  2026-07-10T10:00:00.000Z  Fix tests",
            "  s-week                   400          tokens  4      calls  2026-07-07T12:00:00.000Z  Refactor",
            "  s-old                    300          tokens  2      calls  2026-05-31 12:00:00",
            "  s-unknown                200          tokens  1      calls",
            "",
            "Per-skill / per-subagent / per-plugin attribution needs CLI-side event tagging (not recorded yet).",
            "");

    /** Attribution section mirroring the VS Code twin's fixture numbers. */
    private static String attributionJson() {
        return "{"
                + "\"byOrigin\":["
                + "  {\"origin\":\"subagent\",\"inputTokens\":70000,\"outputTokens\":4000,"
                + "   \"totalTokens\":74000,\"cacheReadTokens\":0,\"cacheCreationTokens\":0,\"calls\":3},"
                + "  {\"origin\":\"main\",\"inputTokens\":50000,\"outputTokens\":4000,"
                + "   \"totalTokens\":54000,\"cacheReadTokens\":0,\"cacheCreationTokens\":0,\"calls\":8},"
                + "  {\"origin\":\"skill\",\"inputTokens\":10,\"outputTokens\":5,\"totalTokens\":15,\"calls\":1}"
                + "],"
                + "\"bySkill\":[{\"skill\":\"csv-clean\",\"inputTokens\":10,\"outputTokens\":5,"
                + "  \"totalTokens\":15,\"calls\":1}],"
                + "\"bySubagent\":[{\"subagentId\":\"sub-1\",\"role\":\"researcher\",\"origin\":\"subagent\","
                + "  \"inputTokens\":70000,\"outputTokens\":4000,\"totalTokens\":74000,\"calls\":3}],"
                + "\"tools\":{\"totalCalls\":7,\"totalErrors\":2,"
                + "  \"byTool\":["
                + "    {\"tool\":\"read_file\",\"mcpServer\":null,\"calls\":4,\"errors\":1,\"turnTokens\":600},"
                + "    {\"tool\":\"mcp__github__search\",\"mcpServer\":\"github\",\"calls\":3,\"errors\":1,\"turnTokens\":150}"
                + "  ],"
                + "  \"byMcpServer\":[{\"server\":\"github\",\"calls\":3,\"errors\":1,\"turnTokens\":150}]}"
                + "}";
    }

    /** Usage payload with cache-reporting totals + the attribution section
     *  (avg input/call 60k → all three hints fire, like the VS fixture). */
    private static String attributedUsageJson() {
        return "{"
                + "\"total\":{\"inputTokens\":120000,\"outputTokens\":8000,\"totalTokens\":128000,"
                + "\"cacheReadTokens\":2000,\"cacheCreationTokens\":5000,\"calls\":2},"
                + "\"sessions\":[],\"byModel\":[],"
                + "\"attribution\":" + attributionJson()
                + "}";
    }

    /** Minimal usage payload for hint-boundary probes. */
    private static Map<String, Object> hintUsage(String totalJson, String byOriginJson) {
        return UsageReport.parseUsageJson("{"
                + "\"total\":" + totalJson + ","
                + "\"sessions\":[],\"byModel\":[],"
                + "\"attribution\":{\"byOrigin\":" + byOriginJson
                + ",\"bySkill\":[],\"bySubagent\":[],\"tools\":{}}"
                + "}");
    }

    @Test
    void thresholdConstantsMatchVsCodeTwin() {
        assertEquals(10, UsageReport.ATTRIBUTION_MAX_ROWS);
        assertEquals(0.4, UsageReport.SUBAGENT_SHARE_HINT_THRESHOLD);
        assertEquals(0.25, UsageReport.CACHE_MISS_MAX_READ_RATIO);
        assertEquals(10000L, UsageReport.CACHE_MISS_MIN_INPUT_TOKENS);
        assertEquals(50000L, UsageReport.LONG_CONTEXT_AVG_INPUT_TOKENS);
    }

    @Test
    void attributionParsingIsTolerant() {
        // absent → null (old CLI)
        assertNull(UsageReport.normalizeAttribution(null));
        // malformed (non-object) → null, no throw
        assertNull(UsageReport.normalizeAttribution("garbage"));
        assertNull(UsageReport.normalizeAttribution(Arrays.asList(1, 2)));
        // junk rows dropped, tool totals coerced
        Map<String, Object> a = UsageReport.normalizeAttribution(MiniJson.parse(
                "{\"byOrigin\":[{\"origin\":\"main\",\"totalTokens\":5},null,\"junk\",42],"
                        + "\"tools\":{\"totalCalls\":\"nope\",\"byTool\":[7]}}"));
        assertNotNull(a);
        assertEquals(1, ((List<?>) a.get("byOrigin")).size());
        assertEquals(0, ((List<?>) a.get("bySkill")).size());
        @SuppressWarnings("unchecked")
        Map<String, Object> tools = (Map<String, Object>) a.get("tools");
        assertEquals(0L, tools.get("totalCalls")); // non-number → 0
        assertEquals(0, ((List<?>) tools.get("byTool")).size());
    }

    @Test
    void absentAttributionKeepsLegacyOutputByteIdentical() {
        Map<String, Object> usage = UsageReport.parseUsageJson(USAGE_JSON);
        List<SessionList.SessionItem> sessions = SessionList.parseSessionList(LIST_JSON);
        assertEquals(PRE_ATTRIBUTION_SNAPSHOT, UsageReport.render(usage, sessions, NOW));
    }

    @Test
    void rendersAttributionSections() {
        String report = UsageReport.render(
                UsageReport.parseUsageJson(attributedUsageJson()),
                SessionList.parseSessionList("[]"), NOW);
        String squashed = report.replaceAll("\\s+", " ");
        // By origin with share % (74,000 / 128,015 = 57.8%).
        assertTrue(report.contains("By origin:"));
        assertTrue(squashed.contains("subagent 74,000 tokens 57.8% in 70,000 out 4,000 calls 3"));
        assertTrue(squashed.contains("main 54,000 tokens 42.2% in 50,000 out 4,000 calls 8"));
        // By skill / By subagent.
        assertTrue(report.contains("By skill:"));
        assertTrue(squashed.contains("csv-clean 15 tokens in 10 out 5 calls 1"));
        assertTrue(report.contains("By subagent:"));
        assertTrue(squashed.contains("sub-1 researcher subagent 74,000 tokens calls 3"));
        // Tool calls: totals header + per-tool rows + MCP bucket + caveat.
        assertTrue(report.contains("Tool calls: 7 calls · 2 errors across 2 tool(s)"));
        assertTrue(squashed.contains("read_file calls 4 errors 1 turn tokens ≈ 600"));
        assertTrue(squashed.contains("mcp__github__search github calls 3 errors 1 turn tokens ≈ 150"));
        assertTrue(report.contains("MCP servers:"));
        assertTrue(squashed.contains("github calls 3 errors 1 turn tokens ≈ 150"));
        assertTrue(report.contains("do not sum that column across rows"));
        assertTrue(report.contains("approximation"));
        // The stale footer is replaced when attribution is rendered.
        assertFalse(report.contains("needs CLI-side event tagging"));
    }

    @Test
    void rendersEmptyStatePlaceholders() {
        String report = UsageReport.render(UsageReport.parseUsageJson("{"
                + "\"total\":{\"totalTokens\":1,\"calls\":1},\"sessions\":[],\"byModel\":[],"
                + "\"attribution\":{\"byOrigin\":[],\"bySkill\":[],\"bySubagent\":[],\"tools\":{}}"
                + "}"), SessionList.parseSessionList("[]"), NOW);
        assertTrue(report.contains("(no attributed token_usage events recorded)"));
        assertTrue(report.contains("(no skill-attributed usage (isolated skill runs) recorded)"));
        assertTrue(report.contains("(no sub-agent-attributed usage recorded)"));
        assertTrue(report.contains("(no tool_call events recorded)"));
        assertFalse(report.contains("needs CLI-side event tagging"));
    }

    @Test
    void capsTablesAtMaxRowsAndFoldsOthers() {
        int max = UsageReport.ATTRIBUTION_MAX_ROWS;
        StringBuilder skills = new StringBuilder("[");
        for (int i = 0; i < max + 2; i++) {
            if (i > 0) skills.append(',');
            skills.append("{\"skill\":\"skill-").append(i)
                    .append("\",\"inputTokens\":10,\"outputTokens\":5,\"totalTokens\":15,\"calls\":1}");
        }
        skills.append(']');
        StringBuilder toolRows = new StringBuilder("[");
        for (int i = 0; i < max + 3; i++) {
            if (i > 0) toolRows.append(',');
            toolRows.append("{\"tool\":\"tool-").append(i)
                    .append("\",\"mcpServer\":null,\"calls\":2,\"errors\":1,\"turnTokens\":50}");
        }
        toolRows.append(']');
        String report = UsageReport.render(UsageReport.parseUsageJson("{"
                + "\"total\":{\"totalTokens\":1,\"calls\":1},\"sessions\":[],\"byModel\":[],"
                + "\"attribution\":{\"byOrigin\":[],\"bySkill\":" + skills
                + ",\"bySubagent\":[],\"tools\":{\"totalCalls\":1,\"totalErrors\":0,"
                + "\"byTool\":" + toolRows + ",\"byMcpServer\":[]}}"
                + "}"), SessionList.parseSessionList("[]"), NOW);
        String squashed = report.replaceAll("\\s+", " ");
        // skills: row max-1 shown, row max folded; sums 2 rows × (15/10/5/1).
        assertTrue(report.contains("skill-" + (max - 1)));
        assertFalse(report.contains("skill-" + max));
        assertTrue(squashed.contains("…2 more 30 tokens in 20 out 10 calls 2"));
        // tools: calls/errors summed, turnTokens NEVER summed (—).
        assertTrue(report.contains("tool-" + (max - 1)));
        assertFalse(report.contains("tool-" + max));
        assertTrue(squashed.contains("…3 more calls 6 errors 3 turn tokens ≈ —"));
    }

    @Test
    void toleratesHostileNames() {
        String report = UsageReport.render(UsageReport.parseUsageJson("{"
                + "\"total\":{\"totalTokens\":1,\"calls\":1},\"sessions\":[],\"byModel\":[],"
                + "\"attribution\":{\"byOrigin\":[],"
                + "\"bySkill\":[{\"skill\":\"evil\\nskill\\rnext" + "x".repeat(80) + "\",\"totalTokens\":1,\"calls\":1}],"
                + "\"bySubagent\":[],\"tools\":{}}"
                + "}"), SessionList.parseSessionList("[]"), NOW);
        // newlines collapsed to a space → the name stays on ONE report line…
        assertTrue(report.contains("evil skill next"));
        // …and the 60-char cap holds (80 x's would overflow it).
        assertFalse(report.contains("x".repeat(61)));
    }

    @Test
    void hintsAbsentWithoutAttribution() {
        assertTrue(UsageReport.deriveUsageHints(null).isEmpty());
        assertTrue(UsageReport.deriveUsageHints(
                UsageReport.parseUsageJson(USAGE_JSON)).isEmpty());
    }

    @Test
    void subagentShareHintBoundary() {
        String quietTotal = "{\"inputTokens\":100,\"outputTokens\":10,\"totalTokens\":110,\"calls\":12}";
        String origins40 = "[{\"origin\":\"subagent\",\"totalTokens\":40,\"inputTokens\":0,\"outputTokens\":0,\"calls\":1},"
                + "{\"origin\":\"main\",\"totalTokens\":60,\"inputTokens\":0,\"outputTokens\":0,\"calls\":1}]";
        String origins41 = "[{\"origin\":\"subagent\",\"totalTokens\":41,\"inputTokens\":0,\"outputTokens\":0,\"calls\":1},"
                + "{\"origin\":\"main\",\"totalTokens\":59,\"inputTokens\":0,\"outputTokens\":0,\"calls\":1}]";
        // exactly at the threshold (40 of 100) → strict > → silent
        assertTrue(UsageReport.deriveUsageHints(hintUsage(quietTotal, origins40)).isEmpty());
        List<String> fired = UsageReport.deriveUsageHints(hintUsage(quietTotal, origins41));
        assertEquals(1, fired.size());
        assertTrue(fired.get(0).contains("Sub-agent-heavy: 41%"));
        assertTrue(fired.get(0).contains("41 of 100"));
    }

    @Test
    void cacheMissHintBoundary() {
        long input = UsageReport.CACHE_MISS_MIN_INPUT_TOKENS;
        long lowRead = (long) Math.floor(UsageReport.CACHE_MISS_MAX_READ_RATIO * input) - 1;
        long atRatio = (long) (UsageReport.CACHE_MISS_MAX_READ_RATIO * input);
        // fires: cache fields present, big input, low reads
        List<String> fired = UsageReport.deriveUsageHints(hintUsage(
                "{\"inputTokens\":" + input + ",\"outputTokens\":0,\"totalTokens\":" + input
                        + ",\"cacheReadTokens\":" + lowRead + ",\"cacheCreationTokens\":100,\"calls\":1000}",
                "[]"));
        assertEquals(1, fired.size());
        assertTrue(fired.get(0).contains("High cache-miss"));
        assertTrue(fired.get(0).contains("2,499 cache-read"));
        // no cache fields at all (old provider) → silent
        assertTrue(UsageReport.deriveUsageHints(hintUsage(
                "{\"inputTokens\":" + input + ",\"outputTokens\":0,\"totalTokens\":" + input + ",\"calls\":1000}",
                "[]")).isEmpty());
        // cache reported but reads exactly AT the ratio → strict < → silent
        assertTrue(UsageReport.deriveUsageHints(hintUsage(
                "{\"inputTokens\":" + input + ",\"outputTokens\":0,\"totalTokens\":" + input
                        + ",\"cacheReadTokens\":" + atRatio + ",\"cacheCreationTokens\":100,\"calls\":1000}",
                "[]")).isEmpty());
        // input below the floor → silent
        assertTrue(UsageReport.deriveUsageHints(hintUsage(
                "{\"inputTokens\":" + (input - 1) + ",\"outputTokens\":0,\"totalTokens\":" + (input - 1)
                        + ",\"cacheReadTokens\":0,\"cacheCreationTokens\":100,\"calls\":1000}",
                "[]")).isEmpty());
    }

    @Test
    void longContextHintBoundary() {
        long th = UsageReport.LONG_CONTEXT_AVG_INPUT_TOKENS;
        // avg == threshold → strict > → silent
        assertTrue(UsageReport.deriveUsageHints(hintUsage(
                "{\"inputTokens\":" + (th * 2) + ",\"outputTokens\":0,\"totalTokens\":" + (th * 2) + ",\"calls\":2}",
                "[]")).isEmpty());
        List<String> fired = UsageReport.deriveUsageHints(hintUsage(
                "{\"inputTokens\":" + (th * 2 + 2) + ",\"outputTokens\":0,\"totalTokens\":" + (th * 2 + 2) + ",\"calls\":2}",
                "[]"));
        assertEquals(1, fired.size());
        assertTrue(fired.get(0).contains("Long-context"));
        assertTrue(fired.get(0).contains("50,001"));
    }

    @Test
    void allThreeHintsRenderIntoTheReport() {
        String report = UsageReport.render(
                UsageReport.parseUsageJson(attributedUsageJson()),
                SessionList.parseSessionList("[]"), NOW);
        assertTrue(report.contains("Hints:"));
        assertTrue(report.contains("- Sub-agent-heavy: 58%"));
        assertTrue(report.contains("- High cache-miss: only 2,000 cache-read"));
        assertTrue(report.contains("- Long-context: average input per LLM call is 60,000"));
    }
}
