package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

/** Pure coverage for the dashboard HTML renderer ({@link DashboardHtml}). */
class DashboardHtmlTest {

    private static final DashboardHtml.TimeFmt FIXED = ts -> "12:34:56";

    private static ActivityLog.Counts counts(int tool, int connect, int error) {
        // Counts has a package-private ctor; ActivityLog records to reach it.
        ActivityLog log = new ActivityLog(10);
        for (int i = 0; i < tool; i++) log.record(0, "tool", "getSelection", true, "");
        for (int i = 0; i < connect; i++) log.record(0, "connect", null, true, "");
        for (int i = 0; i < error; i++) log.record(0, "tool", "openDiff", false, "");
        // errorCount counts !ok; the error loop above already produced `error`
        // failing tool entries, so tool total = tool + error. Re-derive counts.
        return log.counts();
    }

    @Test
    void runningBridgeShowsPortAndRunningLabel() {
        String html = DashboardHtml.page(true, 51234, null, new ActivityLog(1).counts(),
                List.of(), FIXED, false);
        assertTrue(html.contains("51234"), "port shown");
        assertTrue(html.contains("Running"), "running label");
        assertTrue(html.contains("dot on"), "running dot");
    }

    @Test
    void stoppedBridgeShowsDashAndStoppedLabel() {
        String html = DashboardHtml.page(false, -1, null, new ActivityLog(1).counts(),
                List.of(), FIXED, false);
        assertTrue(html.contains("Stopped"), "stopped label");
        assertTrue(html.contains("dot off"), "stopped dot");
        assertTrue(html.contains(">—<"), "em-dash for no port");
        assertFalse(html.contains(">-1<"), "raw -1 not shown");
    }

    @Test
    void countCardsReflectTheTotals() {
        ActivityLog log = new ActivityLog(20);
        log.record(0, "tool", "getSelection", true, "");
        log.record(0, "tool", "openDiff", false, ""); // an error
        String html = DashboardHtml.page(true, 5000, null, log.counts(),
                log.recent(10), FIXED, false);
        assertTrue(html.contains("Tool calls"), "tool-calls card");
        assertTrue(html.contains("Errors"), "errors card");
    }

    @Test
    void emptyStreamShowsThePlaceholder() {
        String html = DashboardHtml.page(true, 5000, null, new ActivityLog(1).counts(),
                List.of(), FIXED, false);
        assertTrue(html.contains("No tool calls yet"), "empty placeholder");
    }

    @Test
    void recentEntriesRenderTimeStatusToolAndSummary() {
        ActivityLog.Entry ok = new ActivityLog.Entry(0, "tool", "getDiagnostics", true, "…/src/App.java");
        ActivityLog.Entry bad = new ActivityLog.Entry(0, "tool", "openDiff", false, "");
        String html = DashboardHtml.page(true, 5000, null, counts(1, 0, 1),
                List.of(ok, bad), FIXED, false);
        assertTrue(html.contains("12:34:56"), "formatted time");
        assertTrue(html.contains("getDiagnostics"), "ok tool name");
        assertTrue(html.contains("openDiff"), "err tool name");
        assertTrue(html.contains("…/src/App.java"), "summary");
        assertTrue(html.contains("\"ok\""), "ok status class");
        assertTrue(html.contains("\"err\""), "err status class");
    }

    @Test
    void htmlIsEscapedToPreventInjection() {
        ActivityLog.Entry evil = new ActivityLog.Entry(0, "tool", "<script>x</script>", true, "a<b>&\"c");
        String html = DashboardHtml.page(true, 5000, "C:\\code\\<x>", new ActivityLog(1).counts(),
                List.of(evil), FIXED, false);
        assertFalse(html.contains("<script>x</script>"), "raw script tag must not appear");
        assertTrue(html.contains("&lt;script&gt;"), "tool name escaped");
        assertTrue(html.contains("a&lt;b&gt;&amp;&quot;c"), "summary escaped");
        assertTrue(html.contains("&lt;x&gt;"), "workspace escaped");
    }

    @Test
    void darkAndLightUseDifferentBackgrounds() {
        ActivityLog.Counts c = new ActivityLog(1).counts();
        String dark = DashboardHtml.page(true, 5000, null, c, List.of(), FIXED, true);
        String light = DashboardHtml.page(true, 5000, null, c, List.of(), FIXED, false);
        assertTrue(dark.contains("#2b2d30"), "dark background");
        assertTrue(light.contains("#ffffff"), "light background");
    }
}
