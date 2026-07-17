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

    /**
     * Pid identity tolerance (VS twin PID_IDENTITY_TOLERANCE_MS): a pid alone
     * does not identify a process — after the worker dies the OS can hand the
     * same pid to an unrelated process. Reuse is one-sided (the impostor can
     * only have been created AFTER startedAt), so compare the pid's real
     * creation time against the state file's startedAt with this slack.
     */
    public static final long PID_IDENTITY_TOLERANCE_MS = 60_000L;

    /** How much of a log file the tail reader is willing to read (the old
     *  whole-file readString turned multi-MB logs into EDT-visible stalls). */
    static final int TAIL_READ_BYTES = 64 * 1024;

    private BackgroundAgents() {}

    /** One listed session (normalized, display-corrected). */
    public static final class Session {
        public final String id;
        public final String status;
        public final String lostReason;   // nullable
        public final String phase;        // nullable
        public final int turnCount;       // -1 when absent
        /** Approval requests blocking the worker (state pendingApprovals; 0 = none). */
        public final int pendingApprovals;
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
        /** Unanswered ask_user_question parked by the worker (state pendingQuestion.question); nullable. */
        public final String pendingQuestion;
        /** Count of irreversible ops whose outcome is unknown after a resume (0 = none). */
        public final int uncertainSideEffects;

        Session(String id, String status, String lostReason, String phase, int turnCount,
                int pendingApprovals,
                String title, String cwd, String sessionId, long startedAt, long endedAt,
                Integer exitCode, String logFile, String pipePath, String token,
                boolean interactive, String pendingQuestion, int uncertainSideEffects) {
            this.id = id;
            this.status = status;
            this.lostReason = lostReason;
            this.phase = phase;
            this.turnCount = turnCount;
            this.pendingApprovals = pendingApprovals;
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
            this.pendingQuestion = pendingQuestion;
            this.uncertainSideEffects = uncertainSideEffects;
        }

        /** True when a human decision is blocking this session. */
        public boolean needsAttention() {
            return "running".equals(status)
                    && BackgroundAgents.needsAttention(phase, pendingApprovals);
        }
    }

    /** Default state directory ({@code ~/.chainlesschain/background-agents}). */
    public static Path defaultDir() {
        return Paths.get(System.getProperty("user.home"), ".chainlesschain", "background-agents");
    }

    /** One OS pid probe answer: liveness + creation time (null when unknown). */
    public static final class PidInfo {
        public final boolean alive;
        public final Long startMs; // nullable — creation time not determinable

        public PidInfo(boolean alive, Long startMs) {
            this.alive = alive;
            this.startMs = startMs;
        }
    }

    /** OS probe seam — injected in tests, {@link #probePid} in production. */
    public interface PidProbe {
        PidInfo probe(long pid);
    }

    /** Real OS probe via ProcessHandle. Kept tiny — the decision math is pure. */
    public static PidInfo probePid(long pid) {
        if (pid <= 0) return new PidInfo(false, null);
        try {
            java.util.Optional<ProcessHandle> h = ProcessHandle.of(pid);
            if (h.isEmpty() || !h.get().isAlive()) return new PidInfo(false, null);
            Long start = h.get().info().startInstant()
                    .map(java.time.Instant::toEpochMilli).orElse(null);
            return new PidInfo(true, start);
        } catch (Throwable t) {
            // probe failure = unknown → fail open (display-only correction)
            return new PidInfo(true, null);
        }
    }

    /**
     * Pure pid-identity decision (VS twin isSameProcess/effectiveStatus): the
     * lost-reason for a "running" session's pid probe answer, or null when the
     * pid still looks like the session's own worker. Unknown creation time or
     * unknown startedAt fails OPEN — this layer is display-only.
     */
    public static String pidLostReason(boolean alive, Long processStartMs, long stateStartedAtMs) {
        if (!alive) return "process-exited";
        if (stateStartedAtMs <= 0 || processStartMs == null) return null;
        return processStartMs <= stateStartedAtMs + PID_IDENTITY_TOLERANCE_MS
                ? null : "pid-reused";
    }

    /**
     * Display-only status correction: a "running" session whose heartbeat is
     * older than {@link #HEARTBEAT_STALE_MS} is shown as {@code lost}.
     * Returns {@code [status, lostReasonOrNull]}.
     */
    public static String[] effectiveStatus(String status, long heartbeatAt, long now) {
        return effectiveStatus(status, heartbeatAt, now, 0L, 0L, null);
    }

    /**
     * Full correction incl. pid identity (VS twin parity): after the heartbeat
     * check, a state pid that is gone → {@code lost/process-exited}; alive but
     * created well after startedAt → {@code lost/pid-reused} (the OS reused the
     * worker's pid). A state without a pid, or a null probe, skips the pid leg
     * (older CLI state files carry no pid — display-only, fail open).
     */
    public static String[] effectiveStatus(String status, long heartbeatAt, long now,
            long pid, long startedAt, PidProbe probe) {
        if (!"running".equals(status)) {
            return new String[] { status == null || status.isEmpty() ? "?" : status, null };
        }
        if (heartbeatAt > 0 && now - heartbeatAt > HEARTBEAT_STALE_MS) {
            return new String[] { "lost", "heartbeat-stale" };
        }
        if (pid > 0 && probe != null) {
            PidInfo info = probe.probe(pid);
            String reason = pidLostReason(info != null && info.alive,
                    info == null ? null : info.startMs, startedAt);
            if (reason != null) return new String[] { "lost", reason };
        }
        return new String[] { "running", null };
    }

    /**
     * List sessions in {@code dir}, newest first. Tolerant: unreadable or
     * malformed state files are skipped; a missing dir yields an empty list.
     * Uses the real OS pid probe; tests inject one via the overload.
     */
    public static List<Session> list(Path dir, long now) {
        return list(dir, now, BackgroundAgents::probePid);
    }

    /** {@link #list(Path, long)} with an injected pid probe (null = skip). */
    public static List<Session> list(Path dir, long now, PidProbe probe) {
        List<Session> out = new ArrayList<>();
        if (dir == null || !Files.isDirectory(dir)) return out;
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir, "*.json")) {
            for (Path file : stream) {
                String name = file.getFileName().toString();
                if (name.contains(".job.")) continue;
                Session s = readOne(file, dir, now, probe);
                if (s != null) out.add(s);
            }
        } catch (IOException ignored) {
            return out;
        }
        out.sort(Comparator.comparingLong((Session s) -> s.startedAt).reversed());
        return out;
    }

    private static Session readOne(Path file, Path dir, long now, PidProbe probe) {
        Map<String, Object> state;
        try {
            state = MiniJson.parseObject(Files.readString(file, StandardCharsets.UTF_8));
        } catch (Exception e) {
            return null;
        }
        if (state == null || !(state.get("id") instanceof String)) return null;
        String id = (String) state.get("id");
        long heartbeatAt = asLong(state.get("heartbeatAt"));
        long startedAt = asLong(state.get("startedAt"));
        String[] eff = effectiveStatus(asString(state.get("status")), heartbeatAt, now,
                asLong(state.get("pid")), startedAt, probe);
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
        String pendingQuestion = null;
        Object pq = state.get("pendingQuestion");
        if (pq instanceof Map) {
            pendingQuestion = asString(((Map<?, ?>) pq).get("question"));
        }
        return new Session(
                id, eff[0], eff[1],
                asString(state.get("phase")),
                (int) asLong(state.get("turnCount"), -1L),
                (int) asLong(state.get("pendingApprovals"), 0L),
                asString(state.get("title"), ""),
                asString(state.get("cwd"), ""),
                asString(state.get("sessionId")),
                startedAt,
                asLong(state.get("endedAt")),
                exitCode, logFile, pipe, token, interactive,
                pendingQuestion,
                (int) asLong(state.get("uncertainSideEffects"), 0L));
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

    /**
     * True when a human decision is blocking the session: an approval that is
     * genuinely pending wins over any phase label; the canonical blocking
     * phases are {@code waiting_permission} / {@code needs_input} (kebab and
     * legacy {@code *_approval} spellings tolerated — mirrors the CLI's
     * background-agent-phase aliases).
     */
    public static boolean needsAttention(String phase, int pendingApprovals) {
        if (pendingApprovals > 0) return true;
        String p = phase == null ? "" : phase.trim().toLowerCase().replace('-', '_');
        return "waiting_permission".equals(p) || "needs_input".equals(p)
                || "uncertain_side_effect".equals(p)
                || p.contains("approval");
    }

    /**
     * Last {@code lines} lines of a log file ("" when unreadable). Reads only
     * the trailing {@link #TAIL_READ_BYTES} — long-lived agents grow multi-MB
     * logs, and the old whole-file readString made every refresh pay for all
     * of it. When the head was skipped, the first (possibly partial) line
     * after the seek point is dropped so a mid-UTF-8 landing never shows a
     * torn line.
     */
    public static String tailLog(String logFile, int lines) {
        String text;
        try {
            text = readTail(Paths.get(logFile), TAIL_READ_BYTES);
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

    /**
     * The trailing {@code capBytes} of a file, decoded as UTF-8. When the file
     * is larger than the cap, everything up to and including the first newline
     * in the window is dropped (the seek can land mid-line / mid-UTF-8-char);
     * a window without any newline is returned as-is rather than discarded.
     */
    static String readTail(Path file, int capBytes) throws IOException {
        try (java.nio.channels.SeekableByteChannel ch =
                Files.newByteChannel(file, java.nio.file.StandardOpenOption.READ)) {
            long size = ch.size();
            boolean skippedHead = size > capBytes;
            int want = (int) Math.min(size, capBytes);
            ch.position(size - want);
            java.nio.ByteBuffer bb = java.nio.ByteBuffer.allocate(want);
            while (bb.hasRemaining() && ch.read(bb) >= 0) {
                // keep filling — a channel may return short reads
            }
            byte[] bytes = new byte[bb.position()];
            bb.flip();
            bb.get(bytes);
            int from = 0;
            if (skippedHead) {
                for (int i = 0; i < bytes.length; i++) {
                    if (bytes[i] == (byte) '\n') {
                        from = i + 1;
                        break;
                    }
                }
            }
            return new String(bytes, from, bytes.length - from, StandardCharsets.UTF_8);
        }
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
        if ("running".equals(s.status) && needsAttention(s.phase, s.pendingApprovals)) {
            sb.append("  ⚠ ").append(attentionText(s));
        }
        if (s.interactive) sb.append("  ⇄");
        return sb.toString();
    }

    /**
     * Short blocking-state text, e.g. "waiting for approval (2 pending)",
     * "waiting for input: Deploy to prod?", or "confirm 3 uncertain side-effects".
     */
    private static String attentionText(Session s) {
        String p = s.phase == null ? "" : s.phase.trim().toLowerCase().replace('-', '_');
        if (s.pendingApprovals > 0) {
            return "waiting for approval (" + s.pendingApprovals + " pending)";
        }
        if ("uncertain_side_effect".equals(p)) {
            return s.uncertainSideEffects > 0
                    ? "confirm " + s.uncertainSideEffects + " uncertain side-effect"
                            + (s.uncertainSideEffects > 1 ? "s" : "")
                    : "confirm uncertain side-effects";
        }
        if ("needs_input".equals(p)) {
            if (s.pendingQuestion != null && !s.pendingQuestion.isEmpty()) {
                String q = s.pendingQuestion.length() > 140
                        ? s.pendingQuestion.substring(0, 140) : s.pendingQuestion;
                return "waiting for input: " + q;
            }
            return "waiting for input";
        }
        return "waiting for approval";
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
        if ("running".equals(s.status) && needsAttention(s.phase, s.pendingApprovals)) {
            sb.append("attention: ").append(attentionText(s)).append('\n');
        }
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
