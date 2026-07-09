package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link ActivityLog} layer. */
class ActivityLogTest {

    private static ActivityLog seededLog() {
        ActivityLog log = new ActivityLog(3); // small cap to test eviction
        log.record(1000L, "tool", "getSelection", true, "");
        log.record(2000L, "tool", "openDiff", true, "…/src/a.js");
        log.record(3000L, "tool", "getDiagnostics", false, "…/src/b.js");
        return log;
    }

    @Test
    void countsTrackToolCallsAndErrors() {
        ActivityLog.Counts c = seededLog().counts();
        assertEquals(3, c.tool);
        assertEquals(1, c.error);
    }

    @Test
    void recentReturnsNewestFirst() {
        List<ActivityLog.Entry> recent = seededLog().recent(10);
        assertEquals(3, recent.size());
        assertEquals("getDiagnostics", recent.get(0).tool);
    }

    @Test
    void ringBufferEvictsOldestPastCapButTotalsKeepCounting() {
        ActivityLog log = seededLog();
        log.record(4000L, "tool", "getOpenEditors", true, "");
        assertEquals(3, log.size());
        assertEquals(4, log.counts().tool);
        assertEquals("getOpenEditors", log.recent(1).get(0).tool);
        assertTrue(log.recent(10).stream().noneMatch(e -> "getSelection".equals(e.tool)));
    }

    @Test
    void formatReportShowsTotalsNewestFirstAndFailureMarker() {
        ActivityLog log = seededLog();
        log.record(4000L, "tool", "getOpenEditors", true, "");
        ActivityLog.TimeFmt fmt = ts -> "T" + ts;
        String report = log.formatReport(51234, 10, fmt);
        assertTrue(report.contains("bridge on 127.0.0.1:51234"), report);
        assertTrue(report.contains("tool calls: 4"), report);
        assertTrue(report.contains("errors: 1"), report);
        assertTrue(report.indexOf("getOpenEditors") < report.indexOf("openDiff"), report);
        assertTrue(report.contains("✗ getDiagnostics"), report);
    }

    @Test
    void formatReportForEmptyLogAndStoppedBridge() {
        ActivityLog empty = new ActivityLog(10);
        ActivityLog.TimeFmt fmt = ts -> "T" + ts;
        String er = empty.formatReport(-1, 10, fmt);
        assertTrue(er.contains("bridge stopped"), er);
        assertTrue(er.contains("no tool calls yet"), er);
    }

    @Test
    void summarizeArgsShortensOnlyDiffAndDiagnosticsPaths() {
        Map<String, Object> args = new HashMap<>();
        args.put("path", "/home/u/proj/src/deep/file.js");
        assertEquals("…/deep/file.js", ActivityLog.summarizeArgs("openDiff", args));
        assertEquals("", ActivityLog.summarizeArgs("getSelection", args));
        assertEquals("", ActivityLog.summarizeArgs("openDiff", null));
    }

    @Test
    void shortenPathLeavesShortPathUnchanged() {
        assertEquals("a/b", ActivityLog.shortenPath("a/b"));
    }
}
