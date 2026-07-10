package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Usage report (P1 #6 账户/用量 UI) — the Java twin of the VS Code
 * extension's usage-report.js. Joins {@code cc session usage --json}
 * (per-session token totals + per-model rollup) with {@code cc session list
 * --json} (titles + last-activity timestamps) and renders a monospace text
 * report with activity-window buckets (last 24 h / 7 d / 30 d / all time).
 *
 * The usage store records no per-event timestamps, so windows bucket by each
 * SESSION's last-activity time — an approximation the report states openly.
 */
public final class UsageReport {

    private UsageReport() {}

    private static final long DAY_MS = 24L * 60 * 60 * 1000;

    /** {@code cc session usage --json --limit <n>}. */
    public static List<String> buildUsageArgs(int limit) {
        return new ArrayList<String>(Arrays.asList(
                "session", "usage", "--json", "--limit", String.valueOf(limit)));
    }

    /** {@code cc session list --json -n <n>}. */
    public static List<String> buildSessionListArgs(int limit) {
        return new ArrayList<String>(Arrays.asList(
                "session", "list", "--json", "-n", String.valueOf(limit)));
    }

    /** Tolerant parse of {@code session usage --json} (null unless it has a total). */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> parseUsageJson(String text) {
        try {
            Object parsed = MiniJson.parse(text == null ? "" : text.trim());
            if (parsed instanceof Map && ((Map<String, Object>) parsed).get("total") instanceof Map) {
                return (Map<String, Object>) parsed;
            }
        } catch (RuntimeException ignored) {
            // fall through
        }
        return null;
    }

    /**
     * Build the report text, or null when usage is unreadable. {@code nowMs}
     * is injected so tests are deterministic. Session metadata rows come from
     * {@link SessionList#parseSessionList}.
     */
    public static String render(Map<String, Object> usage,
            List<SessionList.SessionItem> sessions, long nowMs) {
        if (usage == null) return null;
        Map<String, Object> total = asMap(usage.get("total"));

        Map<String, SessionList.SessionItem> meta =
                new LinkedHashMap<String, SessionList.SessionItem>();
        if (sessions != null) {
            for (SessionList.SessionItem s : sessions) if (s != null) meta.put(s.id, s);
        }

        long[][] windows = { // {maxAgeMs, tokens, calls, sessions}
                { DAY_MS, 0, 0, 0 },
                { 7 * DAY_MS, 0, 0, 0 },
                { 30 * DAY_MS, 0, 0, 0 },
        };
        List<Map<String, Object>> perSession = new ArrayList<Map<String, Object>>();
        Object sessionsObj = usage.get("sessions");
        int sessionCount = 0;
        if (sessionsObj instanceof List) {
            for (Object row : (List<?>) sessionsObj) {
                if (!(row instanceof Map)) continue;
                Map<String, Object> s = asMap(row);
                Map<String, Object> t = asMap(s.get("total"));
                if (t.isEmpty()) continue;
                sessionCount++;
                String id = String.valueOf(s.get("sessionId"));
                SessionList.SessionItem m = meta.get(id);
                Long ts = m != null ? parseInstantMs(m.updatedAt) : null;
                Map<String, Object> entry = new LinkedHashMap<String, Object>();
                entry.put("id", id);
                entry.put("title", m != null ? m.title : "");
                entry.put("updatedAt", m != null ? m.updatedAt : null);
                entry.put("totalTokens", num(t.get("totalTokens")));
                entry.put("calls", num(t.get("calls")));
                perSession.add(entry);
                if (ts == null) continue;
                long age = nowMs - ts;
                for (long[] w : windows) {
                    if (age <= w[0]) {
                        w[1] += num(t.get("totalTokens"));
                        w[2] += num(t.get("calls"));
                        w[3] += 1;
                    }
                }
            }
        }
        perSession.sort(Comparator.comparingLong(
                (Map<String, Object> e) -> (Long) e.get("totalTokens")).reversed());

        StringBuilder sb = new StringBuilder();
        sb.append("ChainlessChain — Token Usage\n\n");
        sb.append("All time: ").append(fmt(num(total.get("totalTokens"))))
                .append(" tokens  ·  in ").append(fmt(num(total.get("inputTokens"))))
                .append(" / out ").append(fmt(num(total.get("outputTokens"))))
                .append("  ·  ").append(fmt(num(total.get("calls")))).append(" LLM calls")
                .append("  ·  ").append(sessionCount).append(" sessions");
        long skipped = num(usage.get("skipped"));
        if (skipped > 0) sb.append("  ·  ").append(skipped).append(" unreadable skipped");
        sb.append("\n\n");

        sb.append("Activity windows (bucketed by each session's LAST activity time —\n");
        sb.append("the usage store has no per-event timestamps; treat as approximations):\n");
        String[] labels = { "Last 24 h   ", "Last 7 days ", "Last 30 days" };
        for (int i = 0; i < windows.length; i++) {
            sb.append("  ").append(labels[i])
                    .append("  ").append(pad(fmt(windows[i][1]), 14)).append(" tokens")
                    .append("  ").append(pad(fmt(windows[i][2]), 8)).append(" calls")
                    .append("  ").append(pad(String.valueOf(windows[i][3]), 5)).append(" sessions\n");
        }
        sb.append('\n');

        sb.append("By provider / model:\n");
        Object byModel = usage.get("byModel");
        boolean any = false;
        if (byModel instanceof List) {
            for (Object row : (List<?>) byModel) {
                if (!(row instanceof Map)) continue;
                Map<String, Object> m = asMap(row);
                any = true;
                sb.append("  ").append(pad(str(m.get("provider"), "?"), 10))
                        .append(" ").append(pad(str(m.get("model"), "?"), 26))
                        .append(" ").append(pad(fmt(num(m.get("totalTokens"))), 14)).append(" tokens")
                        .append("  in ").append(fmt(num(m.get("inputTokens"))))
                        .append("  out ").append(fmt(num(m.get("outputTokens"))))
                        .append("  calls ").append(fmt(num(m.get("calls")))).append('\n');
            }
        }
        if (!any) sb.append("  (no token_usage events recorded yet)\n");
        sb.append('\n');

        sb.append("Top sessions:\n");
        int shown = 0;
        for (Map<String, Object> e : perSession) {
            if (shown++ >= 10) break;
            String id = String.valueOf(e.get("id"));
            sb.append("  ").append(pad(id.length() > 24 ? id.substring(0, 24) : id, 24))
                    .append(" ").append(pad(fmt((Long) e.get("totalTokens")), 12)).append(" tokens")
                    .append("  ").append(pad(fmt((Long) e.get("calls")), 6)).append(" calls");
            Object up = e.get("updatedAt");
            if (up != null) sb.append("  ").append(up);
            String title = String.valueOf(e.get("title"));
            if (!title.isEmpty()) {
                sb.append("  ").append(title.length() > 40 ? title.substring(0, 40) : title);
            }
            sb.append('\n');
        }
        if (shown == 0) sb.append("  (no sessions with recorded usage)\n");
        sb.append("\nPer-skill / per-subagent / per-plugin attribution needs CLI-side"
                + " event tagging (not recorded yet).\n");
        return sb.toString();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object o) {
        return o instanceof Map ? (Map<String, Object>) o : new LinkedHashMap<String, Object>();
    }

    private static long num(Object o) {
        return o instanceof Number ? ((Number) o).longValue() : 0L;
    }

    private static String str(Object o, String fallback) {
        return o == null || String.valueOf(o).isEmpty() ? fallback : String.valueOf(o);
    }

    private static Long parseInstantMs(String iso) {
        if (iso == null || iso.isEmpty()) return null;
        try {
            return java.time.Instant.parse(iso).toEpochMilli();
        } catch (RuntimeException e) {
            try {
                // `cc session list` may emit "yyyy-MM-dd HH:mm:ss" (SQLite datetime).
                return java.time.LocalDateTime.parse(iso.replace(' ', 'T'))
                        .toInstant(java.time.ZoneOffset.UTC).toEpochMilli();
            } catch (RuntimeException e2) {
                return null;
            }
        }
    }

    private static String fmt(long n) {
        return String.format("%,d", n);
    }

    private static String pad(String s, int width) {
        StringBuilder sb = new StringBuilder(s);
        while (sb.length() < width) sb.append(' ');
        return sb.toString();
    }
}
