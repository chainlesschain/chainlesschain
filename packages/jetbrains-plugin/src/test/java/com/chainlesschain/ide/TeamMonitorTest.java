package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link TeamMonitor} state parser + reporter. */
class TeamMonitorTest {

    private static final String JSON = "{\"version\":2,\"registry\":{\"tasks\":{\"tasks\":["
            + "{\"id\":\"a\",\"title\":\"build\",\"status\":\"completed\","
            + "\"metadata\":{\"key\":\"a\",\"dependsOn\":[]}},"
            + "{\"id\":\"b\",\"title\":\"test\",\"status\":\"in_progress\","
            + "\"metadata\":{\"key\":\"b\",\"dependsOn\":[\"a\"],\"attempts\":2,"
            + "\"lease\":{\"holder\":\"mate-1\",\"expiresAt\":10000}}},"
            + "{\"id\":\"c\",\"title\":\"stalled\",\"status\":\"in_progress\","
            + "\"metadata\":{\"lease\":{\"holder\":\"mate-2\",\"expiresAt\":1000}}},"
            + "{\"id\":\"d\",\"title\":\"waiting\",\"status\":\"blocked\","
            + "\"metadata\":{\"dependsOn\":[\"b\"]}}]}}}";

    @Test
    void parseFlattensTasksAndLeaseMetadata() {
        TeamMonitor.State st = TeamMonitor.parse(JSON);
        assertTrue(st.ok);
        assertEquals(2L, st.version);
        assertEquals(4, st.tasks.size());

        TeamMonitor.Task b = st.tasks.get(1);
        assertEquals("mate-1", b.holder);
        assertEquals(2, b.attempts);
        assertEquals(1, b.dependsOn.size());
        assertEquals("a", b.dependsOn.get(0));
    }

    @Test
    void summarizeCountsAndSplitsLiveVsStaleLeases() {
        TeamMonitor.State st = TeamMonitor.parse(JSON);
        TeamMonitor.Summary s = TeamMonitor.summarize(st, 5000L);
        assertEquals(4, s.total);
        assertEquals(1, (int) s.counts.get("completed"));
        assertEquals(2, (int) s.counts.get("in_progress"));
        assertEquals(1, (int) s.counts.get("blocked"));
        assertEquals(1, s.active);
        assertEquals(1, s.stale);
        assertEquals(25, s.donePct);
    }

    @Test
    void formatReportShowsHeaderHolderStaleAndRetry() {
        String report = TeamMonitor.formatReport(TeamMonitor.parse(JSON), 5000L);
        assertTrue(report.contains("25% done · 1/4 tasks"));
        assertTrue(report.contains("@mate-1"));
        assertTrue(report.contains("(stale)"));
        assertTrue(report.contains("×2"));
    }

    @Test
    void parsesMembersAndBudgetAndReportsThem() {
        String json = "{\"version\":2,\"registry\":{\"tasks\":{\"tasks\":["
                + "{\"id\":\"a\",\"title\":\"build\",\"status\":\"completed\"}]}},"
                + "\"members\":[{\"holder\":\"mate-1\",\"state\":\"working\","
                + "\"completed\":3,\"failed\":1},{\"holder\":\"mate-2\",\"completed\":0}],"
                + "\"budget\":{\"limits\":{\"maxTasks\":10,\"maxUsd\":1},"
                + "\"totals\":{\"tasks\":4,\"tokens\":12345,\"spentUsd\":0.42}}}";
        TeamMonitor.State st = TeamMonitor.parse(json);
        assertTrue(st.ok);
        assertEquals(2, st.members.size());
        assertEquals("mate-1", st.members.get(0).get("holder"));
        assertTrue(st.budget != null && st.budget.get("totals") != null);

        String report = TeamMonitor.formatReport(st, 0L);
        assertTrue(report.contains("budget: 4 tasks/10 · 12k tokens · $0.42 spent of $1.00"),
                report);
        assertTrue(report.contains("@mate-1 (✓3 ✗1)"), report);
        assertTrue(report.contains("@mate-2 (✓0)"), report);
    }

    @Test
    void statesWithoutMembersOrBudgetKeepTheOldReportShape() {
        TeamMonitor.State st = TeamMonitor.parse(JSON);
        assertTrue(st.members.isEmpty());
        assertEquals(null, st.budget);
        String report = TeamMonitor.formatReport(st, 5000L);
        assertFalse(report.contains("budget:"));
        assertFalse(report.contains("members:"));
    }

    @Test
    void parseIsTolerantOfBadInput() {
        assertFalse(TeamMonitor.parse("{bad").ok);
        assertFalse(TeamMonitor.parse("{\"hello\":1}").ok);
        assertFalse(TeamMonitor.parse(null).ok);
    }

    @Test
    void emptyTaskListParsesOkAndSummarizesToZeroPercent() {
        TeamMonitor.State empty = TeamMonitor.parse(
                "{\"version\":2,\"registry\":{\"tasks\":{\"tasks\":[]}}}");
        assertTrue(empty.ok);
        assertEquals(0, TeamMonitor.summarize(empty, 0L).donePct);
    }
}
