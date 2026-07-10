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
}
