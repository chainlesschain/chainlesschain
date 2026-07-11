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
 *
 * Usage attribution (用量归因): newer CLIs additionally return an ADDITIVE
 * {@code attribution} section on {@code cc session usage --json} (byOrigin /
 * bySkill / bySubagent roll-ups + per-tool / MCP-server call counts with a
 * turn-approximated token figure). When present it is rendered as extra
 * report sections plus derived high-cost hints; when absent (old CLI) the
 * report output is byte-identical to the pre-attribution renderer
 * (snapshot-locked in UsageReportTest).
 */
public final class UsageReport {

    private UsageReport() {}

    private static final long DAY_MS = 24L * 60 * 60 * 1000;

    // ── Attribution thresholds — keep in LOCK-STEP with the VS Code twin ────
    // (packages/vscode-extension/src/usage-report.js exports the same five).

    /** Max rows rendered per attribution table before folding into "…N more". */
    public static final int ATTRIBUTION_MAX_ROWS = 10;
    /** Sub-agent-heavy hint: subagent share of attributed tokens above this. */
    public static final double SUBAGENT_SHARE_HINT_THRESHOLD = 0.4;
    /** Cache-miss hint: cacheRead below this fraction of input tokens… */
    public static final double CACHE_MISS_MAX_READ_RATIO = 0.25;
    /** …but only once input volume is large enough for the ratio to mean much. */
    public static final long CACHE_MISS_MIN_INPUT_TOKENS = 10000;
    /** Long-context hint: average input tokens per LLM call above this. */
    public static final long LONG_CONTEXT_AVG_INPUT_TOKENS = 50000;

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
        Map<String, Object> attribution = normalizeAttribution(usage.get("attribution"));
        if (attribution == null) {
            // Old CLI (no attribution section): keep the legacy tail
            // byte-identical (UsageReportTest snapshot-locks this).
            sb.append("\nPer-skill / per-subagent / per-plugin attribution needs CLI-side"
                    + " event tagging (not recorded yet).\n");
        } else {
            appendAttribution(sb, attribution, total, usage);
        }
        return sb.toString();
    }

    // ── Usage attribution (additive section from newer CLIs) ────────────────

    /**
     * Tolerant normalization of the CLI's additive {@code attribution}
     * section. Returns null when the section is absent/malformed (old CLI)
     * so the renderer keeps the legacy output byte-identical. Row lists keep
     * only Map rows (junk entries dropped), mirroring the VS Code twin.
     */
    static Map<String, Object> normalizeAttribution(Object o) {
        if (!(o instanceof Map)) return null;
        Map<String, Object> a = asMap(o);
        Map<String, Object> n = new LinkedHashMap<String, Object>();
        n.put("byOrigin", mapRows(a.get("byOrigin")));
        n.put("bySkill", mapRows(a.get("bySkill")));
        n.put("bySubagent", mapRows(a.get("bySubagent")));
        Map<String, Object> rawTools = asMap(a.get("tools"));
        Map<String, Object> tools = new LinkedHashMap<String, Object>();
        tools.put("totalCalls", num(rawTools.get("totalCalls")));
        tools.put("totalErrors", num(rawTools.get("totalErrors")));
        tools.put("byTool", mapRows(rawTools.get("byTool")));
        tools.put("byMcpServer", mapRows(rawTools.get("byMcpServer")));
        n.put("tools", tools);
        return n;
    }

    /**
     * Derive one-line high-cost hints from the parsed usage map. Only
     * computed when the CLI reported an attribution section (new CLI), and
     * each hint only fires when the fields it reads actually exist — no
     * guessing on old data. Same three rules + thresholds as the VS twin.
     */
    public static List<String> deriveUsageHints(Map<String, Object> usage) {
        List<String> hints = new ArrayList<String>();
        if (usage == null) return hints;
        Map<String, Object> a = normalizeAttribution(usage.get("attribution"));
        if (a == null) return hints;
        Map<String, Object> total = asMap(usage.get("total"));

        // 1. Sub-agent-heavy: subagent share of attributed tokens.
        List<Map<String, Object>> byOrigin = rowsOf(a.get("byOrigin"));
        long attributedTotal = sumBy(byOrigin, "totalTokens");
        Map<String, Object> sub = null;
        for (Map<String, Object> r : byOrigin) {
            if ("subagent".equals(r.get("origin"))) { sub = r; break; }
        }
        if (sub != null && attributedTotal > 0) {
            double share = num(sub.get("totalTokens")) / (double) attributedTotal;
            if (share > SUBAGENT_SHARE_HINT_THRESHOLD) {
                hints.add("Sub-agent-heavy: "
                        + String.format(java.util.Locale.ROOT, "%.0f", share * 100)
                        + "% of attributed tokens (" + fmt(num(sub.get("totalTokens")))
                        + " of " + fmt(attributedTotal)
                        + ") came from sub-agents (threshold "
                        + (long) (SUBAGENT_SHARE_HINT_THRESHOLD * 100)
                        + "%) — review spawn_sub_agent fan-out if unintended.");
            }
        }

        // 2. High cache-miss: only when the provider reports cache fields at all.
        if (total.get("cacheReadTokens") instanceof Number
                && total.get("cacheCreationTokens") instanceof Number
                && num(total.get("cacheReadTokens")) + num(total.get("cacheCreationTokens")) > 0) {
            long input = num(total.get("inputTokens"));
            long cacheRead = num(total.get("cacheReadTokens"));
            if (input >= CACHE_MISS_MIN_INPUT_TOKENS
                    && cacheRead < CACHE_MISS_MAX_READ_RATIO * input) {
                String pct = input > 0
                        ? String.format(java.util.Locale.ROOT, "%.1f",
                                cacheRead / (double) input * 100)
                        : "0";
                hints.add("High cache-miss: only " + fmt(cacheRead)
                        + " cache-read vs " + fmt(input) + " input tokens (" + pct
                        + "%, threshold " + (long) (CACHE_MISS_MAX_READ_RATIO * 100)
                        + "%) — stable prompt prefixes may not be cache-aligned.");
            }
        }

        // 3. Long-context sessions: average input per LLM call.
        long calls = num(total.get("calls"));
        if (total.get("inputTokens") instanceof Number && calls > 0) {
            double avg = num(total.get("inputTokens")) / (double) calls;
            if (avg > LONG_CONTEXT_AVG_INPUT_TOKENS) {
                hints.add("Long-context: average input per LLM call is "
                        + fmt(Math.round(avg)) + " tokens (threshold "
                        + fmt(LONG_CONTEXT_AVG_INPUT_TOKENS)
                        + ") — consider compacting or splitting long sessions.");
            }
        }

        return hints;
    }

    /** Append the attribution sections (attribution known non-null). */
    private static void appendAttribution(StringBuilder sb, Map<String, Object> a,
            Map<String, Object> total, Map<String, Object> usage) {
        // ── By origin ──
        sb.append("\nBy origin:\n");
        List<Map<String, Object>> byOrigin = rowsOf(a.get("byOrigin"));
        if (byOrigin.isEmpty()) {
            sb.append("  (no attributed token_usage events recorded)\n");
        } else {
            long originTotal = sumBy(byOrigin, "totalTokens");
            for (Map<String, Object> r : byOrigin) {
                String share = originTotal > 0
                        ? String.format(java.util.Locale.ROOT, "%.1f%%",
                                num(r.get("totalTokens")) / (double) originTotal * 100)
                        : "—";
                sb.append("  ").append(pad(cell(r.get("origin"), "?"), 14))
                        .append(" ").append(pad(fmt(num(r.get("totalTokens"))), 14)).append(" tokens")
                        .append("  ").append(pad(share, 6))
                        .append("  in ").append(fmt(num(r.get("inputTokens"))))
                        .append("  out ").append(fmt(num(r.get("outputTokens"))))
                        .append("  calls ").append(fmt(num(r.get("calls")))).append('\n');
            }
        }

        // ── By skill ──
        sb.append("\nBy skill:\n");
        List<Map<String, Object>> bySkill = rowsOf(a.get("bySkill"));
        if (bySkill.isEmpty()) {
            sb.append("  (no skill-attributed usage (isolated skill runs) recorded)\n");
        } else {
            List<Map<String, Object>> top = capTop(bySkill);
            List<Map<String, Object>> others = capOthers(bySkill);
            for (Map<String, Object> r : top) {
                sb.append("  ").append(pad(cell(r.get("skill"), "?"), 26))
                        .append(" ").append(pad(fmt(num(r.get("totalTokens"))), 14)).append(" tokens")
                        .append("  in ").append(fmt(num(r.get("inputTokens"))))
                        .append("  out ").append(fmt(num(r.get("outputTokens"))))
                        .append("  calls ").append(fmt(num(r.get("calls")))).append('\n');
            }
            if (others != null) {
                sb.append("  ").append(pad("…" + others.size() + " more", 26))
                        .append(" ").append(pad(fmt(sumBy(others, "totalTokens")), 14)).append(" tokens")
                        .append("  in ").append(fmt(sumBy(others, "inputTokens")))
                        .append("  out ").append(fmt(sumBy(others, "outputTokens")))
                        .append("  calls ").append(fmt(sumBy(others, "calls"))).append('\n');
            }
        }

        // ── By sub-agent ──
        sb.append("\nBy subagent:\n");
        List<Map<String, Object>> bySubagent = rowsOf(a.get("bySubagent"));
        if (bySubagent.isEmpty()) {
            sb.append("  (no sub-agent-attributed usage recorded)\n");
        } else {
            List<Map<String, Object>> top = capTop(bySubagent);
            List<Map<String, Object>> others = capOthers(bySubagent);
            for (Map<String, Object> r : top) {
                sb.append("  ").append(pad(cell(r.get("subagentId"), "?"), 24))
                        .append(" ").append(pad(cell(r.get("role"), ""), 12))
                        .append(" ").append(pad(cell(r.get("origin"), "?"), 10))
                        .append(" ").append(pad(fmt(num(r.get("totalTokens"))), 14)).append(" tokens")
                        .append("  calls ").append(fmt(num(r.get("calls")))).append('\n');
            }
            if (others != null) {
                sb.append("  ").append(pad("…" + others.size() + " more", 24))
                        .append(" ").append(pad("", 12)).append(" ").append(pad("", 10))
                        .append(" ").append(pad(fmt(sumBy(others, "totalTokens")), 14)).append(" tokens")
                        .append("  calls ").append(fmt(sumBy(others, "calls"))).append('\n');
            }
        }

        // ── Tool calls ──
        Map<String, Object> tools = asMap(a.get("tools"));
        List<Map<String, Object>> byTool = rowsOf(tools.get("byTool"));
        if (byTool.isEmpty()) {
            sb.append("\nTool calls:\n  (no tool_call events recorded)\n");
        } else {
            sb.append("\nTool calls: ").append(fmt(num(tools.get("totalCalls"))))
                    .append(" calls · ").append(fmt(num(tools.get("totalErrors"))))
                    .append(" errors across ").append(fmt(byTool.size())).append(" tool(s)\n");
            List<Map<String, Object>> top = capTop(byTool);
            List<Map<String, Object>> others = capOthers(byTool);
            for (Map<String, Object> r : top) {
                sb.append("  ").append(pad(cell(r.get("tool"), "?"), 28))
                        .append(" ").append(pad(cell(r.get("mcpServer"), ""), 12))
                        .append("  calls ").append(pad(fmt(num(r.get("calls"))), 6))
                        .append("  errors ").append(pad(fmt(num(r.get("errors"))), 4))
                        .append("  turn tokens ≈ ").append(fmt(num(r.get("turnTokens")))).append('\n');
            }
            if (others != null) {
                // turnTokens is per-row non-summable (see the note) → never totalled.
                sb.append("  ").append(pad("…" + others.size() + " more", 28))
                        .append(" ").append(pad("", 12))
                        .append("  calls ").append(pad(fmt(sumBy(others, "calls")), 6))
                        .append("  errors ").append(pad(fmt(sumBy(others, "errors")), 4))
                        .append("  turn tokens ≈ —\n");
            }
            List<Map<String, Object>> byServer = rowsOf(tools.get("byMcpServer"));
            if (!byServer.isEmpty()) {
                sb.append("  MCP servers:\n");
                List<Map<String, Object>> sTop = capTop(byServer);
                List<Map<String, Object>> sOthers = capOthers(byServer);
                for (Map<String, Object> r : sTop) {
                    sb.append("    ").append(pad(cell(r.get("server"), "?"), 26))
                            .append("  calls ").append(pad(fmt(num(r.get("calls"))), 6))
                            .append("  errors ").append(pad(fmt(num(r.get("errors"))), 4))
                            .append("  turn tokens ≈ ").append(fmt(num(r.get("turnTokens")))).append('\n');
                }
                if (sOthers != null) {
                    sb.append("    ").append(pad("…" + sOthers.size() + " more", 26))
                            .append("  calls ").append(pad(fmt(sumBy(sOthers, "calls")), 6))
                            .append("  errors ").append(pad(fmt(sumBy(sOthers, "errors")), 4))
                            .append("  turn tokens ≈ —\n");
                }
            }
            sb.append("  Note: \"turn tokens ≈\" is an approximation — every token_usage event in a\n")
                    .append("  turn is attributed to EVERY tool that ran in that turn, so a turn's tokens\n")
                    .append("  count once per distinct tool/server; do not sum that column across rows\n")
                    .append("  (it is not a partition).\n");
        }

        // ── Hints ──
        List<String> hints = deriveUsageHints(usage);
        if (!hints.isEmpty()) {
            sb.append("\nHints:\n");
            for (String h : hints) sb.append("  - ").append(h).append('\n');
        }
    }

    /** Row lists keep only Map rows (junk entries dropped). */
    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> mapRows(Object o) {
        List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
        if (o instanceof List) {
            for (Object row : (List<?>) o) {
                if (row instanceof Map) out.add((Map<String, Object>) row);
            }
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> rowsOf(Object o) {
        return o instanceof List ? (List<Map<String, Object>>) o
                : new ArrayList<Map<String, Object>>();
    }

    /** Top-N rows (all rows when under the cap). */
    private static List<Map<String, Object>> capTop(List<Map<String, Object>> rows) {
        return rows.size() <= ATTRIBUTION_MAX_ROWS
                ? rows : rows.subList(0, ATTRIBUTION_MAX_ROWS);
    }

    /** Folded remainder, or null when under the cap. */
    private static List<Map<String, Object>> capOthers(List<Map<String, Object>> rows) {
        return rows.size() <= ATTRIBUTION_MAX_ROWS
                ? null : rows.subList(ATTRIBUTION_MAX_ROWS, rows.size());
    }

    private static long sumBy(List<Map<String, Object>> rows, String key) {
        long n = 0;
        for (Map<String, Object> r : rows) n += num(r.get(key));
        return n;
    }

    /** One-line, length-capped rendering of a (possibly hostile) name cell. */
    private static String cell(Object o, String fallback) {
        String s = o == null ? "" : String.valueOf(o);
        s = s.replaceAll("[\\r\\n]+", " ");
        if (s.isEmpty()) return fallback;
        return s.length() > 60 ? s.substring(0, 60) : s;
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
