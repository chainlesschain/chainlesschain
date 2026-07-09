package com.chainlesschain.ide;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Background-agents panel core — list the {@code cc agent --bg} supervisor
 * sessions straight from the state directory
 * ({@code ~/.chainlesschain/background-agents/}), apply the same
 * stale-heartbeat display correction the CLI's {@code cc daemon status}
 * performs (display-only; the IDE never persists it), summarize, tail logs,
 * and render a text report for the dialog view. The Java twin of the VS Code
 * extension's background-agents.js. Pure (no IntelliJ SDK); the dialog glue
 * and the one-shot pipe client live elsewhere.
 */
public final class BackgroundAgents {

    /** Heartbeat staleness threshold, mirroring the CLI supervisor. */
    public static final long HEARTBEAT_STALE_MS = 120_000L;

    private BackgroundAgents() {}

    /** One listed session (normalized, display-corrected). */
    public static final class Session {
        public final String id;
        public final String status;
        public final String lostReason;   // nullable
        public final String phase;        // nullable
        public final int turnCount;       // -1 when absent
        public final String title;
        public final String cwd;
        public final String sessionId;    // nullable
        public final long startedAt;      // 0 when absent
        public final long endedAt;        // 0 when absent
        public final Integer exitCode;    // nullable
        public final String logFile;
        public final String pipePath;     // nullable — transport endpoint
        public final String token;        // nullable — transport auth
        public final boolean interactive;

        Session(String id, String status, String lostReason, String phase, int turnCount,
                String title, String cwd, String sessionId, long startedAt, long endedAt,
                Integer exitCode, String logFile, String pipePath, String token,
                boolean interactive) {
            this.id = id;
            this.status = status;
            this.lostReason = lostReason;
            this.phase = phase;
            this.turnCount = turnCount;
            this.title = title;
            this.cwd = cwd;
            this.sessionId = sessionId;
            this.startedAt = startedAt;
            this.endedAt = endedAt;
            this.exitCode = exitCode;
            this.logFile = logFile;
            this.pipePath = pipePath;
            this.token = token;
            this.interactive = interactive;
        }
    }

    /** Default state directory ({@code ~/.chainlesschain/background-agents}). */
    public static Path defaultDir() {
        return Paths.get(System.getProperty("user.home"), ".chainlesschain", "background-agents");
    }

    /**
     * Display-only status correction: a "running" session whose heartbeat is
     * older than {@link #HEARTBEAT_STALE_MS} is shown as {@code lost}. (The
     * pid-liveness probe the CLI adds is skipped here — no portable Java
     * signal-0; the heartbeat covers the practical cases within 2 minutes.)
     * Returns {@code [status, lostReasonOrNull]}.
     */
    public static String[] effectiveStatus(String status, long heartbeatAt, long now) {
        if (!"running".equals(status)) {
            return new String[] { status == null || status.isEmpty() ? "?" : status, null };
        }
        if (heartbeatAt > 0 && now - heartbeatAt > HEARTBEAT_STALE_MS) {
            return new String[] { "lost", "heartbeat-stale" };
        }
        return new String[] { "running", null };
    }

    /**
     * List sessions in {@code dir}, newest first. Tolerant: unreadable or
     * malformed state files are skipped; a missing dir yields an empty list.
     */
    public static List<Session> list(Path dir, long now) {
        List<Session> out = new ArrayList<>();
        if (dir == null || !Files.isDirectory(dir)) return out;
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir, "*.json")) {
            for (Path file : stream) {
                String name = file.getFileName().toString();
                if (name.contains(".job.")) continue;
                Session s = readOne(file, dir, now);
                if (s != null) out.add(s);
            }
        } catch (IOException ignored) {
            return out;
        }
        out.sort(Comparator.comparingLong((Session s) -> s.startedAt).reversed());
        return out;
    }

    private static Session readOne(Path file, Path dir, long now) {
        Map<String, Object> state;
        try {
            state = MiniJson.parseObject(Files.readString(file, StandardCharsets.UTF_8));
        } catch (Exception e) {
            return null;
        }
        if (state == null || !(state.get("id") instanceof String)) return null;
        String id = (String) state.get("id");
        long heartbeatAt = asLong(state.get("heartbeatAt"));
        String[] eff = effectiveStatus(asString(state.get("status")), heartbeatAt, now);
        String pipe = null;
        String token = null;
        Object transport = state.get("transport");
        if (transport instanceof Map) {
            Object p = ((Map<?, ?>) transport).get("pipe");
            Object t = ((Map<?, ?>) transport).get("token");
            if (p instanceof String) pipe = (String) p;
            if (t instanceof String) token = (String) t;
        }
        Object exit = state.get("exitCode");
        Integer exitCode = exit instanceof Number ? ((Number) exit).intValue() : null;
        String logFile = asString(state.get("logFile"));
        if (logFile == null || logFile.isEmpty()) {
            logFile = dir.resolve(id + ".log").toString();
        }
        boolean interactive = "running".equals(eff[0]) && pipe != null && !pipe.isEmpty();
        return new Session(
                id, eff[0], eff[1],
                asString(state.get("phase")),
                (int) asLong(state.get("turnCount"), -1L),
                asString(state.get("title"), ""),
                asString(state.get("cwd"), ""),
                asString(state.get("sessionId")),
                asLong(state.get("startedAt")),
                asLong(state.get("endedAt")),
                exitCode, logFile, pipe, token, interactive);
    }

    /** Status → count rollup (insertion-ordered). */
    public static Map<String, Integer> summarize(List<Session> sessions) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (Session s : sessions) counts.merge(s.status, 1, Integer::sum);
        return counts;
    }

    /** Compact elapsed string ("42s" / "3m 12s" / "1h 4m"). */
    public static String formatElapsed(long startedAt, long endedAt, long now) {
        long end = endedAt > 0 ? endedAt : now;
        long start = startedAt > 0 ? startedAt : end;
        long sec = Math.max(0, Math.round((end - start) / 1000.0));
        if (sec < 60) return sec + "s";
        long min = sec / 60;
        if (min < 60) return min + "m " + (sec % 60) + "s";
        return (min / 60) + "h " + (min % 60) + "m";
    }

    /** Last {@code lines} lines of a log file ("" when unreadable). */
    public static String tailLog(String logFile, int lines) {
        String text;
        try {
            text = Files.readString(Paths.get(logFile), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
        String[] parts = text.split("\r?\n", -1);
        int limit = Math.max(1, lines);
        int from = Math.max(0, parts.length - limit);
        StringBuilder sb = new StringBuilder();
        for (int i = from; i < parts.length; i++) {
            if (i > from) sb.append('\n');
            sb.append(parts[i]);
        }
        return sb.toString();
    }

    /** One-line list row for the report / combo box. */
    public static String formatRow(Session s, long now) {
        StringBuilder sb = new StringBuilder();
        sb.append(String.format("%-9s", s.status));
        sb.append("  ").append(formatElapsed(s.startedAt, s.endedAt, now));
        sb.append("  ").append(s.title == null || s.title.isEmpty() ? s.id : s.title);
        if (s.phase != null) {
            sb.append("  (").append(s.phase);
            if (s.turnCount > 0) sb.append(" · turn ").append(s.turnCount);
            sb.append(')');
        }
        if (s.lostReason != null) sb.append("  [").append(s.lostReason).append(']');
        if (s.interactive) sb.append("  ⇄");
        return sb.toString();
    }

    /** Multi-line detail block for one session (id/cwd/session/log tail). */
    public static String formatDetail(Session s, long now, int logLines) {
        StringBuilder sb = new StringBuilder();
        sb.append(s.id).append('\n');
        sb.append("status: ").append(s.status);
        if (s.lostReason != null) sb.append(" (").append(s.lostReason).append(')');
        if (s.exitCode != null) sb.append(" · exit ").append(s.exitCode);
        sb.append(" · ").append(formatElapsed(s.startedAt, s.endedAt, now)).append('\n');
        if (s.cwd != null && !s.cwd.isEmpty()) sb.append("cwd: ").append(s.cwd).append('\n');
        if (s.sessionId != null) sb.append("session: ").append(s.sessionId).append('\n');
        sb.append("interactive: ").append(s.interactive ? "yes ⇄" : "no").append('\n');
        String tail = tailLog(s.logFile, logLines);
        sb.append('\n').append(tail.isEmpty() ? "(no log output)" : tail);
        return sb.toString();
    }

    private static String asString(Object v) {
        return v instanceof String ? (String) v : null;
    }

    private static String asString(Object v, String fallback) {
        return v instanceof String ? (String) v : fallback;
    }

    private static long asLong(Object v) {
        return asLong(v, 0L);
    }

    private static long asLong(Object v, long fallback) {
        return v instanceof Number ? ((Number) v).longValue() : fallback;
    }
}
