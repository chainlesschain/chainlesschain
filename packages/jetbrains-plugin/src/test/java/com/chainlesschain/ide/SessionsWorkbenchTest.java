package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link SessionsWorkbench} — the unified sessions workbench core (gap #3):
 * source parsing, aggregation/dedup, sort precedence, filter, action
 * derivation, relative time and display shaping.
 */
class SessionsWorkbenchTest {

    private static final long NOW = 1_800_000_000_000L;

    // ------------------------------------------------------------ helpers

    private static SessionsWorkbench.Row chat(String id, String title, long last) {
        List<SessionsWorkbench.Row> rows = SessionsWorkbench.chatRows(
                "[{\"id\":\"" + id + "\",\"title\":\"" + title + "\"}]");
        SessionsWorkbench.Row r = rows.get(0);
        return new SessionsWorkbench.Row(r.id, r.kind, r.title, r.workspace, r.status,
                last, r.waitingApproval, r.actions, r.sessionId);
    }

    private static BackgroundAgents.Session bg(String id, String status, String sessionId,
            long startedAt, long endedAt, String phase) {
        return bg(id, status, sessionId, startedAt, endedAt, phase, 0);
    }

    private static BackgroundAgents.Session bg(String id, String status, String sessionId,
            long startedAt, long endedAt, String phase, int pendingApprovals) {
        return new BackgroundAgents.Session(id, status, null, phase, -1, pendingApprovals,
                "", "", sessionId, startedAt, endedAt, null, "", null, null,
                "running".equals(status), null, 0);
    }

    private static Map<String, Object> ideRow(String id, String title, String workspace,
            String status, String updatedAt) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("title", title);
        m.put("workspace", workspace);
        m.put("status", status);
        m.put("updatedAt", updatedAt);
        return m;
    }

    // ------------------------------------------------------ source parsing

    @Test
    void chatRowsParseAndDeriveActions() {
        List<SessionsWorkbench.Row> rows = SessionsWorkbench.chatRows(
                "[{\"id\":\"s1\",\"title\":\"Fix bug\",\"updated_at\":\"2026-07-10 12:00:00\"}]");
        assertEquals(1, rows.size());
        SessionsWorkbench.Row r = rows.get(0);
        assertEquals("s1", r.id);
        assertEquals("chat", r.kind);
        assertEquals("Fix bug", r.title);
        assertTrue(r.lastActivity > 0, "SQLite datetime parsed as UTC epoch");
        assertFalse(r.waitingApproval);
        assertEquals(List.of("resume", "rename", "delete"), r.actions);
    }

    @Test
    void malformedSourcesYieldEmptyNotThrow() {
        assertTrue(SessionsWorkbench.chatRows("not json {{{").isEmpty());
        assertTrue(SessionsWorkbench.chatRows(null).isEmpty());
        assertTrue(SessionsWorkbench.chatRows("{\"an\":\"object\"}").isEmpty());
        assertTrue(SessionsWorkbench.remoteRows("garbage ]]").isEmpty());
        assertTrue(SessionsWorkbench.remoteRows(null).isEmpty());
        assertTrue(SessionsWorkbench.ideRows(null).isEmpty());
        assertTrue(SessionsWorkbench.backgroundRows(null).isEmpty());
        // Rows missing an id are skipped, not fabricated.
        assertTrue(SessionsWorkbench.chatRows("[{\"title\":\"no id\"}]").isEmpty());
    }

    @Test
    void ideRowsCarryStatusAndApprovalFlag() {
        List<SessionsWorkbench.Row> rows = SessionsWorkbench.ideRows(List.of(
                ideRow("s2", "Review", "C:/repo", "waiting_approval",
                        "2026-07-10T12:00:00Z"),
                ideRow("s3", "", "", "running", "2026-07-10T13:00:00Z")));
        assertEquals("ide", rows.get(0).kind);
        assertTrue(rows.get(0).waitingApproval);
        assertEquals("C:/repo", rows.get(0).workspace);
        assertFalse(rows.get(1).waitingApproval);
        assertEquals(List.of("resume", "rename", "delete"), rows.get(1).actions);
    }

    @Test
    void backgroundRowsDeriveStateDependentActions() {
        List<SessionsWorkbench.Row> rows = SessionsWorkbench.backgroundRows(List.of(
                bg("bg1", "running", "s9", NOW - 1000, 0, null),
                bg("bg2", "completed", null, NOW - 9000, NOW - 5000, null),
                bg("bg3", "running", null, NOW - 500, 0, "waiting-approval")));
        assertEquals(List.of("attach", "stop", "rename"), rows.get(0).actions);
        assertEquals(List.of("resume", "logs", "rename"), rows.get(1).actions);
        assertEquals(NOW - 5000, rows.get(1).lastActivity, "endedAt wins for finished");
        assertEquals("s9", rows.get(0).sessionId);
        assertTrue(rows.get(2).waitingApproval, "approval phase flagged");
    }

    @Test
    void backgroundRowsFlagCanonicalBlockingSignals() {
        // waiting_permission / needs_input / pendingApprovals>0 all mean "a
        // human decision is blocking this session" — not just *approval* labels.
        List<SessionsWorkbench.Row> rows = SessionsWorkbench.backgroundRows(List.of(
                bg("bg1", "running", null, NOW - 1000, 0, "waiting_permission"),
                bg("bg2", "running", null, NOW - 900, 0, "needs_input"),
                bg("bg3", "running", null, NOW - 800, 0, "working", 2),
                bg("bg4", "running", null, NOW - 700, 0, "working")));
        assertTrue(rows.get(0).waitingApproval, "waiting_permission flagged");
        assertTrue(rows.get(1).waitingApproval, "needs_input flagged");
        assertTrue(rows.get(2).waitingApproval, "pendingApprovals>0 wins over phase");
        assertFalse(rows.get(3).waitingApproval, "plain working not flagged");
    }

    @Test
    void remoteRowsFromStatusJson() {
        String json = "[{\"port\":18800,\"pid\":42,\"mode\":\"direct\",\"alive\":true,"
                + "\"agentSessionId\":\"s5\",\"wsUrl\":\"ws://192.168.1.2:18800\","
                + "\"startedAt\":\"2026-07-10T12:00:00.000Z\"},"
                + "{\"port\":18801,\"alive\":false,\"mode\":\"relay\"},"
                + "{\"invalid\":true,\"stateFile\":\"x.json\"}]";
        List<SessionsWorkbench.Row> rows = SessionsWorkbench.remoteRows(json);
        assertEquals(2, rows.size(), "invalid state rows skipped");
        assertEquals("remote:18800", rows.get(0).id);
        assertEquals("running", rows.get(0).status);
        assertEquals("stale", rows.get(1).status);
        assertEquals(List.of("status", "stop"), rows.get(0).actions);
        assertEquals("s5", rows.get(0).sessionId);
        assertEquals(18800L, SessionsWorkbench.remotePort(rows.get(0).id));
        assertEquals(0L, SessionsWorkbench.remotePort("s1"));
    }

    // --------------------------------------------------- aggregate / dedup

    @Test
    void ideIndexRowAnnotatesSameIdChatRow() {
        List<SessionsWorkbench.Row> chat = SessionsWorkbench.chatRows(
                "[{\"id\":\"s1\",\"title\":\"CLI title\",\"updated_at\":\"2026-07-01T00:00:00Z\"}]");
        List<SessionsWorkbench.Row> ide = SessionsWorkbench.ideRows(List.of(
                ideRow("s1", "", "C:/repo", "running", "2026-07-02T00:00:00Z")));
        List<SessionsWorkbench.Row> out =
                SessionsWorkbench.aggregate(chat, ide, null, null, null);
        assertEquals(1, out.size(), "same id dedups");
        SessionsWorkbench.Row r = out.get(0);
        assertEquals("ide", r.kind, "index row wins");
        assertEquals("CLI title", r.title, "empty index title falls back to chat");
        assertEquals("C:/repo", r.workspace);
        assertEquals("running", r.status);
        assertEquals(SessionsWorkbench.parseTimestamp("2026-07-02T00:00:00Z"),
                r.lastActivity, "newer timestamp wins");
    }

    @Test
    void backgroundRowAbsorbsItsChatRow() {
        List<SessionsWorkbench.Row> chat = new ArrayList<>();
        chat.add(chat("sX", "Long task", NOW - 50_000));
        chat.add(chat("sY", "Other", NOW - 60_000));
        List<SessionsWorkbench.Row> background = SessionsWorkbench.backgroundRows(
                List.of(bg("bg1", "running", "sX", NOW - 1000, 0, null)));
        List<SessionsWorkbench.Row> out =
                SessionsWorkbench.aggregate(chat, null, background, null, null);
        assertEquals(2, out.size(), "chat row sX merged away");
        SessionsWorkbench.Row merged = out.get(0);
        assertEquals("bg1", merged.id, "background row wins and keeps its id");
        assertEquals("background", merged.kind);
        assertEquals("sX", merged.sessionId, "carries the chat session id");
        assertEquals("Long task", merged.title, "inherits title when it has none");
        assertEquals(List.of("attach", "stop", "rename"), merged.actions);
        assertEquals("sY", out.get(1).id, "unrelated chat row untouched");
    }

    @Test
    void backgroundWithoutSessionIdDoesNotAbsorb() {
        List<SessionsWorkbench.Row> chat = List.of(chat("sX", "Task", NOW));
        List<SessionsWorkbench.Row> background = SessionsWorkbench.backgroundRows(
                List.of(bg("bg1", "completed", null, NOW - 1000, NOW - 500, null)));
        assertEquals(2, SessionsWorkbench.aggregate(
                chat, null, background, null, null).size());
    }

    // ---------------------------------------------------------------- sort

    @Test
    void sortWaitingApprovalThenRunningThenActivity() {
        List<SessionsWorkbench.Row> ide = SessionsWorkbench.ideRows(List.of(
                ideRow("old-running", "", "", "running", "2026-07-01T00:00:00Z"),
                ideRow("new-stopped", "", "", "stopped", "2026-07-09T00:00:00Z"),
                ideRow("approval", "", "", "waiting_approval", "2026-06-01T00:00:00Z"),
                ideRow("older-stopped", "", "", "stopped", "2026-07-08T00:00:00Z")));
        List<SessionsWorkbench.Row> out =
                SessionsWorkbench.aggregate(null, ide, null, null, null);
        assertEquals("approval", out.get(0).id, "waitingApproval first even if oldest");
        assertEquals("old-running", out.get(1).id, "running before idle");
        assertEquals("new-stopped", out.get(2).id, "then lastActivity desc");
        assertEquals("older-stopped", out.get(3).id);
    }

    @Test
    void warningsRenderFirstAndCarryNoActions() {
        SessionsWorkbench.Row warn = SessionsWorkbench.warningRow("chat", "cc failed");
        List<SessionsWorkbench.Row> out = SessionsWorkbench.aggregate(
                List.of(chat("s1", "T", NOW)), null, null, null, List.of(warn));
        assertEquals("warning:chat", out.get(0).id);
        assertEquals("warning", out.get(0).kind);
        assertTrue(out.get(0).actions.isEmpty());
        assertEquals("s1", out.get(1).id, "data rows still render after a source fails");
    }

    // -------------------------------------------------------------- filter

    @Test
    void filterIsCaseInsensitiveOverTitleWorkspaceId() {
        List<SessionsWorkbench.Row> rows = new ArrayList<>();
        rows.add(chat("abc-123", "Fix the LOGIN bug", NOW));
        rows.add(SessionsWorkbench.ideRows(List.of(
                ideRow("def-456", "Refactor", "C:/Repos/ChainLess", "stopped",
                        "2026-07-01T00:00:00Z"))).get(0));
        assertEquals(1, SessionsWorkbench.filter(rows, "login").size());
        assertEquals(1, SessionsWorkbench.filter(rows, "chainless").size());
        assertEquals(1, SessionsWorkbench.filter(rows, "DEF-4").size());
        assertEquals(2, SessionsWorkbench.filter(rows, "").size());
        assertEquals(2, SessionsWorkbench.filter(rows, null).size());
        assertEquals(0, SessionsWorkbench.filter(rows, "zzz").size());
    }

    // ------------------------------------------------------ relative time

    @Test
    void relativeTimeBuckets() {
        assertEquals("", SessionsWorkbench.formatRelativeTime(NOW, 0));
        assertEquals("just now", SessionsWorkbench.formatRelativeTime(NOW, NOW - 10_000));
        assertEquals("just now", SessionsWorkbench.formatRelativeTime(NOW, NOW + 5_000),
                "clock skew never renders negative");
        assertEquals("5m ago", SessionsWorkbench.formatRelativeTime(NOW, NOW - 5 * 60_000L));
        assertEquals("3h ago",
                SessionsWorkbench.formatRelativeTime(NOW, NOW - 3 * 3_600_000L));
        assertEquals("2d ago",
                SessionsWorkbench.formatRelativeTime(NOW, NOW - 2 * 86_400_000L));
        long old = SessionsWorkbench.parseTimestamp("2026-01-05T00:00:00Z");
        assertEquals("2026-01-05", SessionsWorkbench.formatRelativeTime(NOW + 0, old));
    }

    @Test
    void timestampFormatsTolerated() {
        long iso = SessionsWorkbench.parseTimestamp("2026-07-10T12:00:00Z");
        assertTrue(iso > 0);
        assertEquals(iso, SessionsWorkbench.parseTimestamp("2026-07-10 12:00:00"),
                "SQLite datetime treated as UTC");
        assertEquals(iso, SessionsWorkbench.parseTimestamp("2026-07-10T14:00:00+02:00"),
                "explicit offset honored");
        assertEquals(iso - 12 * 3_600_000L, SessionsWorkbench.parseTimestamp("2026-07-10"),
                "bare date = UTC midnight");
        assertEquals(0L, SessionsWorkbench.parseTimestamp("not a time"));
        assertEquals(0L, SessionsWorkbench.parseTimestamp(""));
        assertEquals(0L, SessionsWorkbench.parseTimestamp(null));
    }

    // ------------------------------------------------------------- display

    @Test
    void displayColumnsArePlainText() {
        SessionsWorkbench.Row r = SessionsWorkbench.ideRows(List.of(
                ideRow("s1", "Fix bug", "C:/repo", "waiting_approval",
                        "2026-07-10T12:00:00Z"))).get(0);
        String[] cols = SessionsWorkbench.toColumns(r, NOW);
        assertEquals(SessionsWorkbench.COLUMN_COUNT, cols.length);
        assertEquals("ide", cols[0]);
        assertEquals("Fix bug", cols[1]);
        assertTrue(cols[2].startsWith("waiting_approval"), "status column");
        assertTrue(cols[2].contains("approval"), "approval flag surfaced");
        assertEquals("C:/repo", cols[3]);
        assertFalse(cols[4].isEmpty(), "relative time rendered");
        // Untitled rows fall back to the id.
        String[] untitled = SessionsWorkbench.toColumns(chat("s7", "", NOW), NOW);
        assertEquals("s7", untitled[1]);
        String detail = SessionsWorkbench.describe(r, NOW);
        assertTrue(detail.contains("s1"));
        assertTrue(detail.contains("resume"));
        assertFalse(detail.contains("<"), "no HTML in the detail text");
    }
}
