package com.chainlesschain.ide;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * "cc team" monitor — parse legacy {@code cc team run --state <file>}
 * snapshots and schema-v1 {@code cc team queue} state for an in-IDE Agent
 * View. Legacy version 6 state identity and distributed queue
 * authority/lease/evidence bindings are exposed to {@link TeamControl}. The
 * Java twin of the VS Code extension's team-monitor.js. Pure (no IntelliJ
 * SDK): tolerant parser + text report; TeamMonitorAction drives the file pick
 * + dialog around it.
 *
 * State file: {@code { version, registry:{ tasks:{ tasks:[task…] } }, members,
 * budget } } where each task is { id, title, status, metadata:{ key,
 * dependsOn, lease:{holder,expiresAt}, attempts } }.
 */
public final class TeamMonitor {

    private static final Pattern DIGEST_PATTERN =
            Pattern.compile("^sha256:[a-f0-9]{64}$");
    private static final Pattern AUTHORITY_DIGEST_PATTERN =
            Pattern.compile("^[a-f0-9]{64}$");
    private static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;
    public static final long DISTRIBUTED_QUEUE_SCHEMA_VERSION = 1L;

    private TeamMonitor() {}

    /** Fail-closed side-effect adjudication binding for one task. */
    public static final class Adjudication {
        public final boolean required;
        public final String code;
        public final String reason;
        public final String evidenceDigest;
        public final String caseId;
        public final String sideEffectDigest;

        Adjudication(boolean required, String code, String reason,
                String evidenceDigest, String caseId, String sideEffectDigest) {
            this.required = required;
            this.code = code;
            this.reason = reason;
            this.evidenceDigest = evidenceDigest;
            this.caseId = caseId;
            this.sideEffectDigest = sideEffectDigest;
        }
    }

    /** Read-only distributed interruption evidence shown in the Agent View. */
    public static final class Interruption {
        public final String requestId;
        public final String actor;
        public final String reason;
        public final String evidenceDigest;

        Interruption(String requestId, String actor, String reason,
                String evidenceDigest) {
            this.requestId = requestId;
            this.actor = actor;
            this.reason = reason;
            this.evidenceDigest = evidenceDigest;
        }
    }

    /** Read-only distributed workspace/checkpoint recovery status. */
    public static final class WorkspaceExecution {
        public final String phase;
        public final String workerId;
        public final String checkpointState;
        public final String transactionId;
        public final boolean recoveryRequired;

        WorkspaceExecution(String phase, String workerId, String checkpointState,
                String transactionId, boolean recoveryRequired) {
            this.phase = phase;
            this.workerId = workerId;
            this.checkpointState = checkpointState;
            this.transactionId = transactionId;
            this.recoveryRequired = recoveryRequired;
        }
    }

    /** One flattened task row. */
    public static final class Task {
        public final String id;
        public final String title;
        public final String status;
        public final String key;          // nullable
        public final String holder;       // nullable
        public final String leaseId;      // nullable
        public final Object fencingToken; // nullable String or Long
        public final Long leaseExpiresAt; // nullable
        public final String attemptDigest; // nullable
        public final List<String> dependsOn;
        public final int attempts;
        public final Adjudication adjudication; // nullable
        public final String adjudicationDigest; // nullable
        /** Direct distributed queue evidence digest (nullable on legacy). */
        public final String evidenceDigest;
        public final Interruption interruption; // nullable
        public final WorkspaceExecution workspaceExecution; // nullable
        public final boolean checkpointRecoveryRequired;

        Task(String id, String title, String status, String key, String holder,
                String leaseId, Object fencingToken, Long leaseExpiresAt,
                String attemptDigest, List<String> dependsOn, int attempts,
                Adjudication adjudication, String adjudicationDigest,
                String evidenceDigest, Interruption interruption,
                WorkspaceExecution workspaceExecution) {
            this.id = id;
            this.title = title;
            this.status = status;
            this.key = key;
            this.holder = holder;
            this.leaseId = leaseId;
            this.fencingToken = fencingToken;
            this.leaseExpiresAt = leaseExpiresAt;
            this.attemptDigest = attemptDigest;
            this.dependsOn = dependsOn;
            this.attempts = attempts;
            this.adjudication = adjudication;
            this.adjudicationDigest = adjudicationDigest;
            this.evidenceDigest = evidenceDigest;
            this.interruption = interruption;
            this.workspaceExecution = workspaceExecution;
            this.checkpointRecoveryRequired = workspaceExecution != null
                    && workspaceExecution.recoveryRequired;
        }
    }

    /** Parse result: {@code ok} tasks, or {@code !ok} with a human error. */
    public static final class State {
        public final boolean ok;
        public final String error;      // when !ok
        public final long version;
        /** Stable v6 authority identity. Null on legacy monitor-only snapshots. */
        public final String stateId;
        /** True only for a fully identified schema-v1 distributed queue. */
        public final boolean distributedQueue;
        public final long schemaVersion;
        public final String queueId;
        public final String authorityDigest;
        public final String repoRoot;
        public final String runId;
        public final Long revision;
        public final List<Task> tasks;
        /** Teammate records {holder,state,completed,failed,…}; empty when absent. */
        public final List<Map<String, Object>> members;
        /** Budget snapshot {limits:{…},totals:{…}}; null when the state has none. */
        public final Map<String, Object> budget;

        State(boolean ok, String error, long version, String stateId,
                boolean distributedQueue, long schemaVersion, String queueId,
                String authorityDigest, String repoRoot, String runId, Long revision,
                List<Task> tasks, List<Map<String, Object>> members,
                Map<String, Object> budget) {
            this.ok = ok;
            this.error = error;
            this.version = version;
            this.stateId = stateId;
            this.distributedQueue = distributedQueue;
            this.schemaVersion = schemaVersion;
            this.queueId = queueId;
            this.authorityDigest = authorityDigest;
            this.repoRoot = repoRoot;
            this.runId = runId;
            this.revision = revision;
            this.tasks = tasks;
            this.members = members == null
                    ? new ArrayList<Map<String, Object>>() : members;
            this.budget = budget;
        }
    }

    /** Status-count rollup + live/stale lease split + done%. */
    public static final class Summary {
        public final Map<String, Integer> counts; // by status
        public final int active;  // in_progress with a live lease
        public final int stale;   // in_progress with an expired lease (crashed holder)
        public final int adjudicationRequired;
        public final int total;
        public final int donePct;

        Summary(Map<String, Integer> counts, int active, int stale,
                int adjudicationRequired, int total, int donePct) {
            this.counts = counts;
            this.active = active;
            this.stale = stale;
            this.adjudicationRequired = adjudicationRequired;
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
            return invalidState("not JSON — is this a cc team --state file?");
        }
        if (!(root instanceof Map)) {
            return invalidState("empty or non-object state");
        }
        Map<String, Object> snap = (Map<String, Object>) root;
        boolean distributedCandidate = snap.containsKey("schemaVersion")
                || snap.containsKey("queueId")
                || snap.containsKey("authorityDigest");
        boolean distributed = false;
        long schemaVersion = 0L;
        String queueId = null;
        String authorityDigest = null;
        String repoRoot = null;
        String runId = null;
        Long revision = null;
        if (distributedCandidate) {
            schemaVersion = normalizedRequiredVersion(snap.get("schemaVersion"));
            queueId = stableString(snap.get("queueId"), 512);
            authorityDigest = optionalString(snap.get("authorityDigest"));
            Map<?, ?> authority = snap.get("authority") instanceof Map
                    ? (Map<?, ?>) snap.get("authority") : null;
            repoRoot = authority == null
                    ? null : stableString(authority.get("repoRoot"), 4096);
            runId = authority == null
                    ? null : stableString(authority.get("runId"), 512);
            if (schemaVersion != DISTRIBUTED_QUEUE_SCHEMA_VERSION
                    || queueId == null
                    || authorityDigest == null
                    || !AUTHORITY_DIGEST_PATTERN.matcher(authorityDigest).matches()
                    || repoRoot == null
                    || runId == null) {
                return invalidState(
                        "invalid distributed queue authority — schemaVersion, queueId, "
                                + "authority.repoRoot/runId, and authorityDigest are required.");
            }
            distributed = true;
            revision = nonnegativeSafeLong(snap.get("revision"));
        }
        List<?> rawTasks = tasksArray(snap);
        if (rawTasks == null) {
            return invalidState(
                    "no task graph in this file — pass the path you gave `cc team run --state`.");
        }
        List<Task> tasks = new ArrayList<Task>();
        for (Object o : rawTasks) {
            if (!(o instanceof Map)) continue;
            Map<?, ?> t = (Map<?, ?>) o;
            Map<?, ?> md = t.get("metadata") instanceof Map ? (Map<?, ?>) t.get("metadata") : null;
            Map<?, ?> lease = md != null && md.get("lease") instanceof Map
                    ? (Map<?, ?>) md.get("lease") : null;
            String id = str(t.get("id"), "");
            String status = str(t.get("status"), "pending");
            String key = md != null ? optionalString(md.get("key")) : null;
            List<String> deps = new ArrayList<String>();
            if (md != null && md.get("dependsOn") instanceof List) {
                for (Object d : (List<?>) md.get("dependsOn")) deps.add(String.valueOf(d));
            }
            String holder = lease != null ? optionalString(lease.get("holder")) : null;
            String leaseId = lease != null ? optionalString(lease.get("leaseId")) : null;
            Object fencingToken = lease == null ? null : lease.get("fencingToken");
            if (distributed) {
                fencingToken = normalizeDistributedFencingToken(fencingToken);
            } else if (fencingToken == null) {
                fencingToken = leaseId;
            }
            Long exp = lease != null && lease.get("expiresAt") instanceof Number
                    ? ((Number) lease.get("expiresAt")).longValue() : null;
            int attempts = md != null && md.get("attempts") instanceof Number
                    ? ((Number) md.get("attempts")).intValue() : 0;
            String attemptDigest = "in_progress".equals(status)
                    ? computeTeamControlAttemptDigest(holder, leaseId, fencingToken)
                    : null;
            Adjudication adjudication = parseAdjudication(md == null
                    ? null : md.get("adjudication"));
            String adjudicationDigest = adjudication != null && adjudication.required
                    && adjudication.caseId != null
                    && adjudication.sideEffectDigest != null
                    ? computeTeamControlAdjudicationDigest(
                            adjudication.caseId, adjudication.sideEffectDigest)
                    : null;
            String evidenceDigest = adjudication != null
                    && validDigest(adjudication.evidenceDigest)
                            ? adjudication.evidenceDigest : null;
            Interruption interruption = parseInterruption(md == null
                    ? null : md.get("interruption"));
            WorkspaceExecution workspaceExecution = parseWorkspaceExecution(md == null
                    ? null : md.get("workspaceExecution"));
            tasks.add(new Task(id, str(t.get("title"), id.isEmpty() ? "(untitled)" : id),
                    status, key, holder, leaseId, fencingToken, exp, attemptDigest, deps,
                    attempts, adjudication, adjudicationDigest, evidenceDigest,
                    interruption, workspaceExecution));
        }
        long version = distributed ? 0L : normalizedVersion(snap.get("version"));
        String stateId = distributed ? null : optionalString(snap.get("stateId"));
        // v2 bundles teammate records + the budget snapshot alongside the task
        // graph (VS team-monitor.js parity) — tolerate their absence.
        List<Map<String, Object>> members = new ArrayList<Map<String, Object>>();
        if (snap.get("members") instanceof List) {
            for (Object m : (List<?>) snap.get("members")) {
                if (m instanceof Map) members.add((Map<String, Object>) m);
            }
        }
        Map<String, Object> budget = snap.get("budget") instanceof Map
                ? (Map<String, Object>) snap.get("budget") : null;
        return new State(true, null, version, stateId, distributed, schemaVersion,
                queueId, authorityDigest, repoRoot, runId, revision,
                tasks, members, budget);
    }

    /**
     * Compute the exact canonical binding used by the CLI's
     * {@code computeTeamControlAttemptDigest}. Invalid untrusted snapshot data
     * returns null so the IDE never offers a weakened takeover.
     */
    public static String computeTeamControlAttemptDigest(String holder, String leaseId,
            Object fencingToken) {
        String normalizedHolder = normalizeAttemptString(holder, 256);
        String normalizedLeaseId = normalizeAttemptString(leaseId, 512);
        Object normalizedFence = normalizeFencingToken(fencingToken);
        if (normalizedHolder == null || normalizedLeaseId == null
                || normalizedFence == null) return null;
        Map<String, Object> value = new TreeMap<String, Object>();
        value.put("holder", normalizedHolder);
        value.put("leaseId", normalizedLeaseId);
        value.put("fencingToken", normalizedFence);
        return digest("cc-team-control-attempt-v1", value);
    }

    /**
     * Compute the exact canonical binding used by the CLI's
     * {@code computeTeamControlAdjudicationDigest}. Invalid bindings return
     * null and remain monitor-only.
     */
    public static String computeTeamControlAdjudicationDigest(String caseId,
            String evidenceDigest) {
        if (!validDigest(evidenceDigest)) return null;
        if (caseId == null) return evidenceDigest;
        String normalizedCaseId = normalizeAttemptString(caseId, 512);
        if (normalizedCaseId == null) return null;
        Map<String, Object> value = new TreeMap<String, Object>();
        value.put("caseId", normalizedCaseId);
        value.put("evidenceDigest", evidenceDigest);
        return digest("cc-team-control-adjudication-v1", value);
    }

    /** Locate one task by its durable metadata key. */
    public static Task findTask(State state, String taskKey) {
        if (state == null || state.tasks == null || taskKey == null) return null;
        Task found = null;
        for (Task task : state.tasks) {
            if (!taskKey.equals(task.key)) continue;
            if (found != null) return null;
            found = task;
        }
        return found;
    }

    /** Roll a parsed state up into counts + progress ({@code nowMs} judges lease liveness). */
    public static Summary summarize(State state, long nowMs) {
        Map<String, Integer> counts = new LinkedHashMap<String, Integer>();
        for (String s : STATUSES) counts.put(s, 0);
        int active = 0, stale = 0, adjudicationRequired = 0;
        List<Task> tasks = state != null && state.tasks != null ? state.tasks
                : new ArrayList<Task>();
        for (Task t : tasks) {
            if (counts.containsKey(t.status)) counts.put(t.status, counts.get(t.status) + 1);
            if ("in_progress".equals(t.status) && t.holder != null) {
                if (t.leaseExpiresAt != null && t.leaseExpiresAt <= nowMs) stale++;
                else active++;
            }
            if (t.adjudication != null && t.adjudication.required) {
                adjudicationRequired++;
            }
        }
        int total = tasks.size();
        int donePct = total == 0 ? 0 : Math.round(counts.get("completed") * 100f / total);
        return new Summary(
                counts, active, stale, adjudicationRequired, total, donePct);
    }

    /** The plain-text report the dialog shows (status-ordered task list + counts). */
    public static String formatReport(State state, long nowMs) {
        if (state == null || !state.ok) {
            return "cc team monitor\n\n" + (state == null ? "no state" : state.error) + "\n";
        }
        Summary s = summarize(state, nowMs);
        StringBuilder sb = new StringBuilder("cc team monitor\n\n");
        if (state.distributedQueue) {
            sb.append("distributed queue: ").append(state.queueId)
              .append(" · run ").append(state.runId)
              .append(" · revision ")
              .append(state.revision == null ? "unknown" : state.revision)
              .append("\nauthority: ").append(state.authorityDigest)
              .append("\nrepository: ").append(state.repoRoot).append("\n");
        }
        sb.append(s.donePct).append("% done · ")
          .append(s.counts.get("completed")).append("/").append(s.total).append(" tasks · ")
          .append(s.active).append(" active");
        if (s.stale > 0) sb.append(" · ").append(s.stale).append(" stale lease");
        if (s.counts.get("blocked") > 0) sb.append(" · ").append(s.counts.get("blocked")).append(" blocked");
        if (s.adjudicationRequired > 0) {
            sb.append(" · ").append(s.adjudicationRequired).append(" needs decision");
        }
        sb.append("\n");
        String budget = budgetLine(state.budget);
        if (!budget.isEmpty()) sb.append("budget: ").append(budget).append("\n");
        if (!state.members.isEmpty()) {
            sb.append("members:");
            for (Map<String, Object> m : state.members) {
                Object holder = m.get("holder");
                if (holder == null) continue;
                sb.append("  @").append(holder);
                long done = numOr(m.get("completed"), 0);
                long failed = numOr(m.get("failed"), 0);
                sb.append(" (✓").append(done);
                if (failed > 0) sb.append(" ✗").append(failed);
                sb.append(')');
            }
            sb.append("\n");
        }
        sb.append("\n");
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
                    if (state.distributedQueue && t.leaseId != null
                            && t.fencingToken != null) {
                        sb.append("  lease=").append(t.leaseId)
                          .append(" fence=").append(t.fencingToken);
                    }
                }
                if (t.adjudication != null && t.adjudication.required) {
                    sb.append("  [needs decision]");
                    if (t.adjudication.reason != null) {
                        sb.append(" reason=").append(t.adjudication.reason);
                    }
                    if (t.evidenceDigest != null) {
                        sb.append(" evidence=").append(t.evidenceDigest);
                    }
                }
                if (t.workspaceExecution != null) {
                    sb.append("  [workspace ")
                      .append(t.workspaceExecution.phase == null
                              ? "unknown" : t.workspaceExecution.phase);
                    if (t.workspaceExecution.checkpointState != null) {
                        sb.append("; checkpoint ")
                          .append(t.workspaceExecution.checkpointState);
                    }
                    if (t.workspaceExecution.transactionId != null) {
                        sb.append("; transaction ")
                          .append(t.workspaceExecution.transactionId);
                    }
                    sb.append(']');
                }
                if (t.interruption != null) {
                    sb.append("  [interrupt requested");
                    if (t.interruption.actor != null) {
                        sb.append(" by ").append(t.interruption.actor);
                    }
                    if (t.interruption.requestId != null) {
                        sb.append("; request ").append(t.interruption.requestId);
                    }
                    sb.append(']');
                }
                sb.append("\n");
            }
        }
        if (state.tasks.isEmpty()) sb.append("  (no tasks in this state file yet)\n");
        return sb.toString();
    }

    // --- internals -----------------------------------------------------------

    private static State invalidState(String error) {
        return new State(false, error, 0L, null, false, 0L,
                null, null, null, null, null, null, null, null);
    }

    /** Compact one-line budget summary from {limits,totals}; "" when unusable. */
    private static String budgetLine(Map<String, Object> budget) {
        if (budget == null) return "";
        Map<?, ?> totals = budget.get("totals") instanceof Map
                ? (Map<?, ?>) budget.get("totals") : null;
        Map<?, ?> limits = budget.get("limits") instanceof Map
                ? (Map<?, ?>) budget.get("limits") : null;
        if (totals == null) return "";
        StringBuilder sb = new StringBuilder();
        sb.append(numOr(totals.get("tasks"), 0)).append(" tasks");
        Object maxTasks = limits == null ? null : limits.get("maxTasks");
        if (maxTasks instanceof Number) sb.append("/").append(numOr(maxTasks, 0));
        sb.append(" · ").append(ChatEvents.formatTokens(numOr(totals.get("tokens"), 0)))
          .append(" tokens");
        Object spent = totals.get("spentUsd");
        if (spent instanceof Number) {
            sb.append(" · $").append(String.format(java.util.Locale.ROOT, "%.2f",
                    ((Number) spent).doubleValue())).append(" spent");
            Object maxUsd = limits == null ? null : limits.get("maxUsd");
            if (maxUsd instanceof Number) {
                sb.append(" of $").append(String.format(java.util.Locale.ROOT, "%.2f",
                        ((Number) maxUsd).doubleValue()));
            }
        }
        return sb.toString();
    }

    private static long numOr(Object v, long dflt) {
        return v instanceof Number ? ((Number) v).longValue() : dflt;
    }

    private static long normalizedVersion(Object value) {
        if (!(value instanceof Number)) return 1;
        double number = ((Number) value).doubleValue();
        if (!Double.isFinite(number) || number != Math.rint(number)
                || number < Long.MIN_VALUE || number > Long.MAX_VALUE) return 0;
        return (long) number;
    }

    private static long normalizedRequiredVersion(Object value) {
        return value instanceof Number ? normalizedVersion(value) : 0L;
    }

    private static Long nonnegativeSafeLong(Object value) {
        if (!(value instanceof Number)) return null;
        double number = ((Number) value).doubleValue();
        if (!Double.isFinite(number) || number < 0 || number > MAX_SAFE_INTEGER
                || number != Math.rint(number)) return null;
        return Long.valueOf((long) number);
    }

    private static Adjudication parseAdjudication(Object raw) {
        if (!(raw instanceof Map)) return null;
        Map<?, ?> value = (Map<?, ?>) raw;
        Map<?, ?> adjudicationCase = value.get("case") instanceof Map
                ? (Map<?, ?>) value.get("case") : null;
        return new Adjudication(
                Boolean.TRUE.equals(value.get("required")),
                optionalString(value.get("code")),
                optionalString(value.get("reason")),
                optionalString(value.get("evidenceDigest")),
                adjudicationCase == null ? null
                        : optionalString(adjudicationCase.get("caseId")),
                adjudicationCase == null ? null
                        : optionalString(adjudicationCase.get("sideEffectDigest")));
    }

    private static Interruption parseInterruption(Object raw) {
        if (!(raw instanceof Map)) return null;
        Map<?, ?> value = (Map<?, ?>) raw;
        String evidenceDigest = optionalString(value.get("evidenceDigest"));
        return new Interruption(
                optionalString(value.get("requestId")),
                optionalString(value.get("actor")),
                optionalString(value.get("reason")),
                validDigest(evidenceDigest) ? evidenceDigest : null);
    }

    private static WorkspaceExecution parseWorkspaceExecution(Object raw) {
        if (!(raw instanceof Map)) return null;
        Map<?, ?> value = (Map<?, ?>) raw;
        Map<?, ?> checkpoint = value.get("checkpoint") instanceof Map
                ? (Map<?, ?>) value.get("checkpoint") : null;
        String phase = optionalString(value.get("phase"));
        boolean recoveryRequired = "rollback-recovery-required".equals(phase)
                || checkpoint != null
                && Boolean.TRUE.equals(checkpoint.get("recoveryRequired"));
        return new WorkspaceExecution(
                phase,
                optionalString(value.get("workerId")),
                checkpoint == null ? null
                        : optionalString(checkpoint.get("state")),
                checkpoint == null ? null
                        : optionalString(checkpoint.get("transactionId")),
                recoveryRequired);
    }

    private static boolean validDigest(String value) {
        return value != null && DIGEST_PATTERN.matcher(value).matches();
    }

    private static String normalizeAttemptString(String value, int maxLength) {
        if (value == null || value.isEmpty() || value.length() > maxLength
                || hasEcmaWhitespaceEdge(value)
                || hasControlCharacters(value)) return null;
        return value;
    }

    private static Object normalizeFencingToken(Object value) {
        if (value instanceof String) return normalizeAttemptString((String) value, 512);
        if (!(value instanceof Number)) return null;
        double number = ((Number) value).doubleValue();
        if (!Double.isFinite(number) || number <= 0 || number > MAX_SAFE_INTEGER
                || number != Math.rint(number)) return null;
        return Long.valueOf((long) number);
    }

    private static Long normalizeDistributedFencingToken(Object value) {
        if (!(value instanceof Number)) return null;
        Object normalized = normalizeFencingToken(value);
        return normalized instanceof Long ? (Long) normalized : null;
    }

    private static String stableString(Object value, int maxLength) {
        if (!(value instanceof String)) return null;
        return normalizeAttemptString((String) value, maxLength);
    }

    private static boolean hasControlCharacters(String value) {
        for (int index = 0; index < value.length(); index++) {
            char c = value.charAt(index);
            if (c < 32 || c == 127) return true;
        }
        return false;
    }

    private static boolean hasEcmaWhitespaceEdge(String value) {
        int first = value.codePointAt(0);
        int last = value.codePointBefore(value.length());
        return isEcmaWhitespace(first) || isEcmaWhitespace(last);
    }

    private static boolean isEcmaWhitespace(int codePoint) {
        return codePoint == 0xfeff
                || Character.isWhitespace(codePoint)
                || Character.isSpaceChar(codePoint);
    }

    private static String digest(String domain, Map<String, Object> value) {
        try {
            String canonical = canonicalJson(value);
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(
                    (domain + "\0" + canonical).getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder("sha256:");
            for (byte b : hash) hex.append(String.format("%02x", b & 0xff));
            return hex.toString();
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 unavailable", impossible);
        }
    }

    /**
     * The binding documents contain only sorted string keys and
     * string/integer values. This writer deliberately mirrors modern
     * JavaScript JSON.stringify, including well-formed escaping of lone UTF-16
     * surrogates, so the Java and Node SHA-256 inputs are byte-identical.
     */
    private static String canonicalJson(Map<String, Object> value) {
        StringBuilder output = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, Object> entry : value.entrySet()) {
            if (!first) output.append(',');
            first = false;
            appendJsonString(output, entry.getKey());
            output.append(':');
            Object field = entry.getValue();
            if (field instanceof String) {
                appendJsonString(output, (String) field);
            } else if (field instanceof Long || field instanceof Integer) {
                output.append(field);
            } else {
                throw new IllegalArgumentException("Unsupported canonical value");
            }
        }
        return output.append('}').toString();
    }

    private static void appendJsonString(StringBuilder output, String value) {
        output.append('"');
        for (int index = 0; index < value.length(); index++) {
            char c = value.charAt(index);
            switch (c) {
                case '"': output.append("\\\""); break;
                case '\\': output.append("\\\\"); break;
                case '\b': output.append("\\b"); break;
                case '\f': output.append("\\f"); break;
                case '\n': output.append("\\n"); break;
                case '\r': output.append("\\r"); break;
                case '\t': output.append("\\t"); break;
                default:
                    if (c < 0x20 || Character.isSurrogate(c)
                            && !isPairedSurrogate(value, index)) {
                        output.append(String.format("\\u%04x", (int) c));
                    } else {
                        output.append(c);
                        if (Character.isHighSurrogate(c)) {
                            output.append(value.charAt(++index));
                        }
                    }
            }
        }
        output.append('"');
    }

    private static boolean isPairedSurrogate(String value, int index) {
        char c = value.charAt(index);
        if (Character.isHighSurrogate(c)) {
            return index + 1 < value.length()
                    && Character.isLowSurrogate(value.charAt(index + 1));
        }
        return Character.isLowSurrogate(c) && index > 0
                && Character.isHighSurrogate(value.charAt(index - 1));
    }

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

    private static String optionalString(Object value) {
        return value instanceof String && !((String) value).isEmpty()
                ? (String) value : null;
    }

    private static String pad(String s) {
        StringBuilder b = new StringBuilder(s);
        while (b.length() < 11) b.append(' ');
        return b.toString();
    }
}
