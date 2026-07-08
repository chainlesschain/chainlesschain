package com.chainlesschain.ide;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/**
 * In-memory activity log for the IDE bridge — a bounded ring buffer of events
 * (tool calls) that the "Show Activity" dialog + status renders from. The Java
 * twin of the VS Code extension's activity-log.js (which feeds its webview
 * dashboard). Pure (no IntelliJ SDK), so it's unit-testable; McpServer records
 * into it via an {@link com.chainlesschain.ide.McpServer.ActivityListener} and
 * the glue renders {@link #recent}/{@link #counts}.
 *
 * Thread-safe: McpServer serves tool calls on a pooled thread while the EDT
 * reads for the dialog, so record/read are synchronized.
 */
public final class ActivityLog {

    /** One recorded event. */
    public static final class Entry {
        public final long ts;
        public final String type;    // "tool" | "connect"
        public final String tool;    // nullable (connect has none)
        public final boolean ok;
        public final String summary; // short arg summary, nullable

        public Entry(long ts, String type, String tool, boolean ok, String summary) {
            this.ts = ts;
            this.type = type;
            this.tool = tool;
            this.ok = ok;
            this.summary = summary;
        }
    }

    /** Rolling totals. */
    public static final class Counts {
        public final int tool;
        public final int connect;
        public final int error;

        Counts(int tool, int connect, int error) {
            this.tool = tool;
            this.connect = connect;
            this.error = error;
        }
    }

    private final int max;
    private final Deque<Entry> entries = new ArrayDeque<Entry>();
    private int toolCount, connectCount, errorCount;

    public ActivityLog(int max) {
        this.max = max <= 0 ? 200 : max;
    }

    /** Append an event; drops the oldest past the cap. Returns the stored entry. */
    public synchronized Entry record(long ts, String type, String tool, boolean ok, String summary) {
        Entry e = new Entry(ts, type, tool, ok, summary);
        entries.addLast(e);
        while (entries.size() > max) entries.pollFirst();
        if ("tool".equals(type)) toolCount++;
        if ("connect".equals(type)) connectCount++;
        if (!ok) errorCount++;
        return e;
    }

    /** The most recent {@code n} entries, newest first. */
    public synchronized List<Entry> recent(int n) {
        List<Entry> out = new ArrayList<Entry>();
        java.util.Iterator<Entry> it = entries.descendingIterator();
        while (it.hasNext() && out.size() < n) out.add(it.next());
        return out;
    }

    public synchronized Counts counts() {
        return new Counts(toolCount, connectCount, errorCount);
    }

    public synchronized int size() {
        return entries.size();
    }

    /**
     * A plain-text report the "Show Activity" dialog shows: a header line with
     * the running totals, then the most recent {@code n} calls newest-first
     * (HH:mm:ss · ✓/✗ tool · summary). Timestamps use the supplied formatter so
     * the caller controls the zone (and tests stay deterministic).
     */
    public synchronized String formatReport(int bridgePort, int recentN, TimeFmt fmt) {
        Counts c = counts();
        StringBuilder sb = new StringBuilder("ChainlessChain IDE bridge — activity\n\n");
        sb.append(bridgePort > 0
                ? "bridge on 127.0.0.1:" + bridgePort + " (server \"ide\")\n"
                : "bridge stopped\n");
        sb.append("tool calls: ").append(c.tool)
          .append("   ·   connections: ").append(c.connect)
          .append("   ·   errors: ").append(c.error).append("\n\n");
        List<Entry> recent = recent(recentN);
        if (recent.isEmpty()) {
            sb.append("(no tool calls yet — the agent hasn't used the IDE bridge)\n");
            return sb.toString();
        }
        sb.append("recent (newest first):\n");
        for (Entry e : recent) {
            String name = "tool".equals(e.type) ? (e.tool == null ? "?" : e.tool) : "connection";
            sb.append("  ").append(fmt.format(e.ts))
              .append("  ").append(e.ok ? "✓" : "✗")
              .append(" ").append(name);
            if (e.summary != null && !e.summary.isEmpty()) sb.append("  ").append(e.summary);
            sb.append("\n");
        }
        return sb.toString();
    }

    /** Time formatter seam (the glue passes a local HH:mm:ss; tests a stub). */
    public interface TimeFmt {
        String format(long ts);
    }

    /** Short, non-sensitive summary of a tool call's args (mirrors VS summarizeArgs). */
    public static String summarizeArgs(String toolName, java.util.Map<String, Object> args) {
        if (args == null) return "";
        Object path = args.get("path");
        if (("openDiff".equals(toolName) || "getDiagnostics".equals(toolName))
                && path instanceof String) {
            return shortenPath((String) path);
        }
        return "";
    }

    static String shortenPath(String p) {
        if (p == null) return "";
        String[] parts = p.replace('\\', '/').split("/");
        List<String> nonEmpty = new ArrayList<String>();
        for (String s : parts) if (!s.isEmpty()) nonEmpty.add(s);
        if (nonEmpty.size() <= 2) return p;
        return "…/" + nonEmpty.get(nonEmpty.size() - 2) + "/" + nonEmpty.get(nonEmpty.size() - 1);
    }
}
