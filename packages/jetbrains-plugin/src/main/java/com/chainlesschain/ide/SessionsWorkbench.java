package com.chainlesschain.ide;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Unified sessions workbench core (gap #3 「跨端 Remote/Cloud Session 入口」) —
 * aggregates the four session-ish surfaces the IDE knows about into one row
 * model for a single tool-window table:
 *
 * <ul>
 *   <li><b>chat</b> — saved CLI sessions ({@code cc session list --json}, via
 *       {@link SessionList});</li>
 *   <li><b>ide</b> — the shared cross-IDE index
 *       ({@code ~/.chainlesschain/ide/session-index.json}, via
 *       {@link IdeSessionIndex} — carries lifecycle status incl.
 *       {@code waiting_approval});</li>
 *   <li><b>background</b> — {@code cc agent --bg} supervisor sessions (state
 *       dir, via {@link BackgroundAgents});</li>
 *   <li><b>remote</b> — {@code cc remote-control status --json} pairing hosts
 *       (via {@link RemoteHandoff}).</li>
 * </ul>
 *
 * The row model {@code {id, kind, title, workspace, status, lastActivity,
 * waitingApproval, actions}} is the contract shared with the VS Code twin —
 * keep the field names identical. Dedup rule: a background agent referencing
 * chat session X merges/annotates the chat row (the background row wins and
 * carries {@code sessionId}); ide-index rows annotate same-id chat rows. Sort:
 * {@code waitingApproval} first, then running, then {@code lastActivity} desc.
 *
 * <p>Pure JDK — no IntelliJ SDK, no process spawning, no clock reads (callers
 * pass {@code now}); JUnit + smoke tested. The Swing glue lives in
 * {@code intellij/SessionsWorkbenchToolWindowFactory}.
 */
public final class SessionsWorkbench {

    private SessionsWorkbench() {}

    public static final String KIND_CHAT = "chat";
    public static final String KIND_IDE = "ide";
    public static final String KIND_BACKGROUND = "background";
    public static final String KIND_REMOTE = "remote";
    /** Display-only pseudo-kind for a failed source (panel still renders). */
    public static final String KIND_WARNING = "warning";

    // Action ids (the glue maps these to buttons / cc commands).
    public static final String ACT_RESUME = "resume";
    public static final String ACT_RENAME = "rename";
    public static final String ACT_DELETE = "delete";
    public static final String ACT_ATTACH = "attach";
    public static final String ACT_STOP = "stop";
    public static final String ACT_LOGS = "logs";
    public static final String ACT_STATUS = "status";

    /** One unified row — field names match the VS Code twin's model. */
    public static final class Row {
        public final String id;
        public final String kind;
        public final String title;
        public final String workspace;
        public final String status;
        /** Epoch ms; 0 when unknown. */
        public final long lastActivity;
        public final boolean waitingApproval;
        /** Allowed action ids for this row (immutable). */
        public final List<String> actions;
        /** Background rows: the chat session they run ("" otherwise). */
        public final String sessionId;

        Row(String id, String kind, String title, String workspace, String status,
                long lastActivity, boolean waitingApproval, List<String> actions,
                String sessionId) {
            this.id = id == null ? "" : id;
            this.kind = kind == null ? "" : kind;
            this.title = title == null ? "" : title;
            this.workspace = workspace == null ? "" : workspace;
            this.status = status == null ? "" : status;
            this.lastActivity = lastActivity;
            this.waitingApproval = waitingApproval;
            this.actions = Collections.unmodifiableList(
                    new ArrayList<String>(actions == null ? List.of() : actions));
            this.sessionId = sessionId == null ? "" : sessionId;
        }
    }

    // ---------------------------------------------------------------- actions

    /**
     * Action ids per kind: chat/ide {@code resume/rename/delete}; background
     * running {@code attach/stop/rename}, otherwise (finished/lost/stopped)
     * {@code resume/logs/rename}; remote {@code status/stop}; warning none.
     */
    public static List<String> actionsFor(String kind, String status) {
        if (KIND_CHAT.equals(kind) || KIND_IDE.equals(kind)) {
            return Arrays.asList(ACT_RESUME, ACT_RENAME, ACT_DELETE);
        }
        if (KIND_BACKGROUND.equals(kind)) {
            return "running".equals(status)
                    ? Arrays.asList(ACT_ATTACH, ACT_STOP, ACT_RENAME)
                    : Arrays.asList(ACT_RESUME, ACT_LOGS, ACT_RENAME);
        }
        if (KIND_REMOTE.equals(kind)) {
            return Arrays.asList(ACT_STATUS, ACT_STOP);
        }
        return List.of();
    }

    // ------------------------------------------------------- source → rows

    /** Rows from {@code cc session list --json} stdout (empty on malformed). */
    public static List<Row> chatRows(String sessionListStdout) {
        List<Row> out = new ArrayList<Row>();
        for (SessionList.SessionItem s : SessionList.parseSessionList(sessionListStdout)) {
            out.add(new Row(s.id, KIND_CHAT, s.title, "", "",
                    parseTimestamp(s.updatedAt), false,
                    actionsFor(KIND_CHAT, ""), ""));
        }
        return out;
    }

    /** Rows from {@link IdeSessionIndex#read} output (already normalized maps). */
    public static List<Row> ideRows(List<Map<String, Object>> indexRows) {
        List<Row> out = new ArrayList<Row>();
        if (indexRows == null) return out;
        for (Map<String, Object> r : indexRows) {
            if (r == null) continue;
            String id = str(r.get("id"));
            if (id.isEmpty()) continue;
            String status = str(r.get("status"));
            out.add(new Row(id, KIND_IDE, str(r.get("title")), str(r.get("workspace")),
                    status, parseTimestamp(str(r.get("updatedAt"))),
                    "waiting_approval".equals(status),
                    actionsFor(KIND_IDE, status), ""));
        }
        return out;
    }

    /** Rows from {@link BackgroundAgents#list} (display-corrected sessions). */
    public static List<Row> backgroundRows(List<BackgroundAgents.Session> sessions) {
        List<Row> out = new ArrayList<Row>();
        if (sessions == null) return out;
        for (BackgroundAgents.Session s : sessions) {
            if (s == null || s.id == null || s.id.isEmpty()) continue;
            long last = Math.max(s.startedAt, s.endedAt);
            // Canonical blocking signals (waiting_permission / needs_input /
            // pendingApprovals>0), not just the legacy *approval* phase label.
            out.add(new Row(s.id, KIND_BACKGROUND,
                    s.title == null ? "" : s.title, s.cwd == null ? "" : s.cwd,
                    s.status, last,
                    BackgroundAgents.needsAttention(s.phase, s.pendingApprovals),
                    actionsFor(KIND_BACKGROUND, s.status),
                    s.sessionId == null ? "" : s.sessionId));
        }
        return out;
    }

    /** Rows from {@code cc remote-control status --json} stdout (empty on malformed). */
    public static List<Row> remoteRows(String statusStdout) {
        List<Row> out = new ArrayList<Row>();
        for (Map<String, Object> h : RemoteHandoff.parseRemoteControlStatus(statusStdout)) {
            Object port = h.get("port");
            if (!(port instanceof Number)) continue;
            boolean alive = Boolean.TRUE.equals(h.get("alive"));
            String mode = h.get("mode") instanceof String ? (String) h.get("mode") : "?";
            String status = alive ? "running" : "stale";
            out.add(new Row("remote:" + ((Number) port).longValue(), KIND_REMOTE,
                    "remote-control host (" + mode + ", port "
                            + ((Number) port).longValue() + ")",
                    str(h.get("wsUrl")), status,
                    parseTimestamp(str(h.get("startedAt"))), false,
                    actionsFor(KIND_REMOTE, status), str(h.get("agentSessionId"))));
        }
        return out;
    }

    /** Display-only row for a source that failed to load (panel still renders). */
    public static Row warningRow(String source, String message) {
        String src = source == null || source.isEmpty() ? "?" : source;
        return new Row("warning:" + src, KIND_WARNING,
                (message == null || message.isEmpty() ? "source failed" : message),
                "", "error", 0L, false, List.of(), "");
    }

    /** Port of a {@code remote:<port>} row id (0 when not a remote row id). */
    public static long remotePort(String rowId) {
        if (rowId == null || !rowId.startsWith("remote:")) return 0L;
        try {
            return Long.parseLong(rowId.substring("remote:".length()));
        } catch (NumberFormatException e) {
            return 0L;
        }
    }

    // ------------------------------------------------------------- aggregate

    /**
     * Merge the four sources (+ optional warning rows) into one sorted list.
     *
     * <p>Dedup: an ide-index row with the same id as a chat row replaces it
     * (the index knows status/workspace; title/lastActivity fall back to the
     * chat row when the index has none). A background row whose
     * {@code sessionId} matches a chat/ide row absorbs that row — the
     * background row wins, keeps its own id, carries {@code sessionId}, and
     * inherits title/workspace when it has none of its own.
     */
    public static List<Row> aggregate(List<Row> chat, List<Row> ide,
            List<Row> background, List<Row> remote, List<Row> warnings) {
        LinkedHashMap<String, Row> byId = new LinkedHashMap<String, Row>();
        if (chat != null) {
            for (Row r : chat) if (r != null && !r.id.isEmpty()) byId.put(r.id, r);
        }
        if (ide != null) {
            for (Row r : ide) {
                if (r == null || r.id.isEmpty()) continue;
                Row prev = byId.get(r.id);
                if (prev == null) {
                    byId.put(r.id, r);
                } else {
                    byId.put(r.id, new Row(r.id, KIND_IDE,
                            !r.title.isEmpty() ? r.title : prev.title,
                            !r.workspace.isEmpty() ? r.workspace : prev.workspace,
                            r.status,
                            Math.max(r.lastActivity, prev.lastActivity),
                            r.waitingApproval,
                            actionsFor(KIND_IDE, r.status), ""));
                }
            }
        }
        if (background != null) {
            for (Row r : background) {
                if (r == null || r.id.isEmpty()) continue;
                Row absorbed = r.sessionId.isEmpty() ? null : byId.remove(r.sessionId);
                if (absorbed != null) {
                    r = new Row(r.id, KIND_BACKGROUND,
                            !r.title.isEmpty() ? r.title : absorbed.title,
                            !r.workspace.isEmpty() ? r.workspace : absorbed.workspace,
                            r.status,
                            Math.max(r.lastActivity, absorbed.lastActivity),
                            r.waitingApproval || absorbed.waitingApproval,
                            r.actions, r.sessionId);
                }
                byId.put(r.id, r);
            }
        }
        if (remote != null) {
            for (Row r : remote) if (r != null && !r.id.isEmpty()) byId.put(r.id, r);
        }
        List<Row> out = new ArrayList<Row>();
        if (warnings != null) {
            for (Row r : warnings) if (r != null) out.add(r);
        }
        List<Row> data = new ArrayList<Row>(byId.values());
        data.sort(ROW_ORDER);
        out.addAll(data);
        return out;
    }

    /**
     * Row order: warnings first (a failed source must be visible), then
     * waiting-approval rows, then running rows, then lastActivity desc; id
     * breaks the tie deterministically.
     */
    public static final Comparator<Row> ROW_ORDER = new Comparator<Row>() {
        @Override
        public int compare(Row a, Row b) {
            int w = Boolean.compare(KIND_WARNING.equals(b.kind), KIND_WARNING.equals(a.kind));
            if (w != 0) return w;
            int ap = Boolean.compare(b.waitingApproval, a.waitingApproval);
            if (ap != 0) return ap;
            int run = Boolean.compare("running".equals(b.status), "running".equals(a.status));
            if (run != 0) return run;
            int act = Long.compare(b.lastActivity, a.lastActivity);
            if (act != 0) return act;
            return a.id.compareTo(b.id);
        }
    };

    // ---------------------------------------------------------------- filter

    /**
     * Case-insensitive substring filter over title/workspace/id. A null/blank
     * query returns the input order untouched.
     */
    public static List<Row> filter(List<Row> rows, String query) {
        List<Row> out = new ArrayList<Row>();
        if (rows == null) return out;
        String q = query == null ? "" : query.trim().toLowerCase();
        for (Row r : rows) {
            if (r == null) continue;
            if (q.isEmpty()
                    || r.title.toLowerCase().contains(q)
                    || r.workspace.toLowerCase().contains(q)
                    || r.id.toLowerCase().contains(q)) {
                out.add(r);
            }
        }
        return out;
    }

    // ------------------------------------------------------------------ time

    /**
     * Compact relative time: "" (unknown), {@code just now} (&lt;60s or clock
     * skew), {@code Nm ago}, {@code Nh ago}, {@code Nd ago} (&lt;7d), else the
     * UTC calendar date ({@code yyyy-MM-dd}).
     */
    public static String formatRelativeTime(long nowMs, long thenMs) {
        if (thenMs <= 0) return "";
        long delta = nowMs - thenMs;
        if (delta < 60_000L) return "just now"; // includes small clock skew (delta < 0)
        long min = delta / 60_000L;
        if (min < 60) return min + "m ago";
        long hours = min / 60;
        if (hours < 24) return hours + "h ago";
        long days = hours / 24;
        if (days < 7) return days + "d ago";
        return LocalDate.ofInstant(Instant.ofEpochMilli(thenMs), ZoneOffset.UTC).toString();
    }

    /**
     * Tolerant timestamp → epoch ms: ISO instants ({@code 2026-07-11T01:02:03Z}
     * with/without millis), SQLite {@code yyyy-MM-dd HH:mm:ss} (treated as
     * UTC — the CLI store writes UTC), bare dates; 0 for anything else.
     */
    public static long parseTimestamp(String raw) {
        String s = raw == null ? "" : raw.trim();
        if (s.isEmpty()) return 0L;
        String iso = s.replace(' ', 'T');
        try { // bare yyyy-MM-dd
            if (iso.length() == 10) {
                return LocalDate.parse(iso).atStartOfDay(ZoneOffset.UTC)
                        .toInstant().toEpochMilli();
            }
        } catch (RuntimeException ignored) {
            return 0L;
        }
        try { // …Z instants (with/without millis)
            return Instant.parse(iso).toEpochMilli();
        } catch (RuntimeException ignored) {
            // fall through
        }
        try { // explicit ±hh:mm offsets
            return java.time.OffsetDateTime.parse(iso).toInstant().toEpochMilli();
        } catch (RuntimeException ignored) {
            // fall through
        }
        try { // no zone at all (SQLite datetime) → the CLI store writes UTC
            return Instant.parse(iso + "Z").toEpochMilli();
        } catch (RuntimeException ignored) {
            return 0L;
        }
    }

    // --------------------------------------------------------------- display

    /** Number of display columns produced by {@link #toColumns}. */
    public static final int COLUMN_COUNT = 5;

    /**
     * Shape one row into the table's display columns
     * {@code [kind, title-or-id, status, workspace, relative time]} — plain
     * text, no HTML (the glue feeds a Swing table model).
     */
    public static String[] toColumns(Row r, long nowMs) {
        if (r == null) return new String[] { "", "", "", "", "" };
        String status = r.status.isEmpty() ? "-" : r.status;
        if (r.waitingApproval) status = status + " ⚠ approval";
        return new String[] {
                r.kind,
                r.title.isEmpty() ? r.id : r.title,
                status,
                r.workspace,
                formatRelativeTime(nowMs, r.lastActivity),
        };
    }

    /** Multi-line plain-text detail for the selected row (dialog / tooltip). */
    public static String describe(Row r, long nowMs) {
        if (r == null) return "";
        StringBuilder sb = new StringBuilder();
        sb.append(r.id).append('\n');
        sb.append("kind: ").append(r.kind).append('\n');
        if (!r.title.isEmpty()) sb.append("title: ").append(r.title).append('\n');
        sb.append("status: ").append(r.status.isEmpty() ? "-" : r.status);
        if (r.waitingApproval) sb.append(" (waiting approval)");
        sb.append('\n');
        if (!r.workspace.isEmpty()) sb.append("workspace: ").append(r.workspace).append('\n');
        if (!r.sessionId.isEmpty()) sb.append("session: ").append(r.sessionId).append('\n');
        String rel = formatRelativeTime(nowMs, r.lastActivity);
        if (!rel.isEmpty()) sb.append("last activity: ").append(rel).append('\n');
        sb.append("actions: ").append(String.join(", ", r.actions));
        return sb.toString();
    }

    private static String str(Object v) {
        if (v == null) return "";
        String s = String.valueOf(v).trim();
        return "null".equals(s) ? "" : s;
    }
}
