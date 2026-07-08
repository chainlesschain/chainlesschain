package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Read-only "cc team" monitor — parse the {@code cc team run --state <file>}
 * v2 snapshot and render it for an in-IDE view (Phase-4 Agent-Team parity; the
 * CLI runs the team, the IDE watches). The Java twin of the VS Code
 * extension's team-monitor.js. Pure (no IntelliJ SDK): tolerant parser + text
 * report; TeamMonitorAction drives the file pick + dialog around it.
 *
 * State file: {@code { version, registry:{ tasks:{ tasks:[task…] } }, members,
 * budget } } where each task is { id, title, status, metadata:{ key,
 * dependsOn, lease:{holder,expiresAt}, attempts } }.
 */
public final class TeamMonitor {

    private TeamMonitor() {}

    /** One flattened task row. */
    public static final class Task {
        public final String id;
        public final String title;
        public final String status;
        public final String holder;       // nullable
        public final Long leaseExpiresAt; // nullable
        public final List<String> dependsOn;
        public final int attempts;

        Task(String id, String title, String status, String holder, Long leaseExpiresAt,
             List<String> dependsOn, int attempts) {
            this.id = id;
            this.title = title;
            this.status = status;
            this.holder = holder;
            this.leaseExpiresAt = leaseExpiresAt;
            this.dependsOn = dependsOn;
            this.attempts = attempts;
        }
    }

    /** Parse result: {@code ok} tasks, or {@code !ok} with a human error. */
    public static final class State {
        public final boolean ok;
        public final String error;      // when !ok
        public final long version;
        public final List<Task> tasks;

        State(boolean ok, String error, long version, List<Task> tasks) {
            this.ok = ok;
            this.error = error;
            this.version = version;
            this.tasks = tasks;
        }
    }

    /** Status-count rollup + live/stale lease split + done%. */
    public static final class Summary {
        public final Map<String, Integer> counts; // by status
        public final int active;  // in_progress with a live lease
        public final int stale;   // in_progress with an expired lease (crashed holder)
        public final int total;
        public final int donePct;

        Summary(Map<String, Integer> counts, int active, int stale, int total, int donePct) {
            this.counts = counts;
            this.active = active;
            this.stale = stale;
            this.total = total;
            this.donePct = donePct;
        }
    }

    public static final String[] STATUSES =
            { "pending", "in_progress", "completed", "cancelled", "blocked" };

    /** Tolerant parse — {@code !ok} with a message instead of throwing. */
    @SuppressWarnings("unchecked")
    public static State parse(String json) {
        Object root;
        try {
            root = MiniJson.parse(json == null ? "" : json.trim());
        } catch (RuntimeException e) {
            return new State(false, "not JSON — is this a cc team --state file?", 0, null);
        }
        if (!(root instanceof Map)) {
            return new State(false, "empty or non-object state", 0, null);
        }
        Map<String, Object> snap = (Map<String, Object>) root;
        List<?> rawTasks = tasksArray(snap);
        if (rawTasks == null) {
            return new State(false,
                    "no task graph in this file — pass the path you gave `cc team run --state`.",
                    0, null);
        }
        List<Task> tasks = new ArrayList<Task>();
        for (Object o : rawTasks) {
            if (!(o instanceof Map)) continue;
            Map<?, ?> t = (Map<?, ?>) o;
            Map<?, ?> md = t.get("metadata") instanceof Map ? (Map<?, ?>) t.get("metadata") : null;
            Map<?, ?> lease = md != null && md.get("lease") instanceof Map
                    ? (Map<?, ?>) md.get("lease") : null;
            String id = str(t.get("id"), "");
            List<String> deps = new ArrayList<String>();
            if (md != null && md.get("dependsOn") instanceof List) {
                for (Object d : (List<?>) md.get("dependsOn")) deps.add(String.valueOf(d));
            }
            String holder = lease != null && lease.get("holder") != null
                    ? String.valueOf(lease.get("holder")) : null;
            Long exp = lease != null && lease.get("expiresAt") instanceof Number
                    ? ((Number) lease.get("expiresAt")).longValue() : null;
            int attempts = md != null && md.get("attempts") instanceof Number
                    ? ((Number) md.get("attempts")).intValue() : 0;
            tasks.add(new Task(id, str(t.get("title"), id.isEmpty() ? "(untitled)" : id),
                    str(t.get("status"), "pending"), holder, exp, deps, attempts));
        }
        long version = snap.get("version") instanceof Number
                ? ((Number) snap.get("version")).longValue() : 1;
        return new State(true, null, version, tasks);
    }

    /** Roll a parsed state up into counts + progress ({@code nowMs} judges lease liveness). */
    public static Summary summarize(State state, long nowMs) {
        Map<String, Integer> counts = new LinkedHashMap<String, Integer>();
        for (String s : STATUSES) counts.put(s, 0);
        int active = 0, stale = 0;
        List<Task> tasks = state != null && state.tasks != null ? state.tasks
                : new ArrayList<Task>();
        for (Task t : tasks) {
            if (counts.containsKey(t.status)) counts.put(t.status, counts.get(t.status) + 1);
            if ("in_progress".equals(t.status) && t.holder != null) {
                if (t.leaseExpiresAt != null && t.leaseExpiresAt <= nowMs) stale++;
                else active++;
            }
        }
        int total = tasks.size();
        int donePct = total == 0 ? 0 : Math.round(counts.get("completed") * 100f / total);
        return new Summary(counts, active, stale, total, donePct);
    }

    /** The plain-text report the dialog shows (status-ordered task list + counts). */
    public static String formatReport(State state, long nowMs) {
        if (state == null || !state.ok) {
            return "cc team monitor\n\n" + (state == null ? "no state" : state.error) + "\n";
        }
        Summary s = summarize(state, nowMs);
        StringBuilder sb = new StringBuilder("cc team monitor\n\n");
        sb.append(s.donePct).append("% done · ")
          .append(s.counts.get("completed")).append("/").append(s.total).append(" tasks · ")
          .append(s.active).append(" active");
        if (s.stale > 0) sb.append(" · ").append(s.stale).append(" stale lease");
        if (s.counts.get("blocked") > 0) sb.append(" · ").append(s.counts.get("blocked")).append(" blocked");
        sb.append("\n\n");
        // Status order for readability: active work first, done last.
        String[] order = { "in_progress", "pending", "blocked", "completed", "cancelled" };
        for (String st : order) {
            for (Task t : state.tasks) {
                if (!st.equals(t.status)) continue;
                sb.append("  [").append(pad(st)).append("] ").append(t.title);
                if (t.attempts > 1) sb.append(" (×").append(t.attempts).append(")");
                if (!t.dependsOn.isEmpty()) sb.append("  ⇠ ").append(String.join(", ", t.dependsOn));
                if (t.holder != null) {
                    boolean expired = t.leaseExpiresAt != null && t.leaseExpiresAt <= nowMs;
                    sb.append("  @").append(t.holder).append(expired ? " (stale)" : "");
                }
                sb.append("\n");
            }
        }
        if (state.tasks.isEmpty()) sb.append("  (no tasks in this state file yet)\n");
        return sb.toString();
    }

    // --- internals -----------------------------------------------------------

    private static List<?> tasksArray(Map<String, Object> snap) {
        Object registry = snap.get("registry");
        if (!(registry instanceof Map)) return null;
        Object tasksObj = ((Map<?, ?>) registry).get("tasks");
        if (!(tasksObj instanceof Map)) return null;
        Object arr = ((Map<?, ?>) tasksObj).get("tasks");
        return arr instanceof List ? (List<?>) arr : null;
    }

    private static String str(Object v, String dflt) {
        return v == null || String.valueOf(v).isEmpty() ? dflt : String.valueOf(v);
    }

    private static String pad(String s) {
        StringBuilder b = new StringBuilder(s);
        while (b.length() < 11) b.append(' ');
        return b.toString();
    }
}
