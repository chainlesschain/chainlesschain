package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Pure stale-intent CAS and CLI protocol for JetBrains Agent Team control.
 *
 * <p>The IDE never edits a team state. Legacy v6 clicks pin {@code stateId}
 * and the existing control digest. Distributed queue clicks pin queueId,
 * authorityDigest and either the exact holder/lease/fence or adjudication
 * evidence. Immediately before spawning the CLI, {@link #execute} re-reads
 * the state and rejects any changed authority. The CLI repeats the same
 * checks while holding its durable state lock.
 */
public final class TeamControl {
    public static final int MAX_REASON_LENGTH = 500;
    public static final int MAX_FAILURE_LENGTH = 500;
    public static final long CLI_TIMEOUT_MS = 30_000L;

    private static final int MAX_CONTROL_ID_LENGTH = 512;
    private static final Pattern DIGEST_PATTERN =
            Pattern.compile("^sha256:[a-f0-9]{64}$");
    private static final Pattern AUTHORITY_DIGEST_PATTERN =
            Pattern.compile("^[a-f0-9]{64}$");
    private static final Pattern SECRET_ASSIGNMENT = Pattern.compile(
            "(?i)(authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|"
                    + "token|password|passwd|secret)\\s*([:=])\\s*([^\\s,;]+)");
    private static final Pattern BEARER = Pattern.compile(
            "(?i)\\bbearer\\s+[^\\s,;]+");
    private static final Pattern URL_CREDENTIALS = Pattern.compile(
            "(?i)(https?://)[^\\s/@:]+(?::[^\\s/@]*)?@");
    private static final Set<String> DECISIONS =
            Set.of("retry", "accept", "cancel");

    private TeamControl() {}

    public enum Action {
        INTERRUPT,
        RECOVER,
        ADJUDICATE
    }

    /** Immutable authority captured at click time. */
    public static final class Intent {
        public final Action action;
        public final String taskKey;
        public final String stateId;
        public final String attemptDigest;
        public final String adjudicationDigest;
        public final String decision;
        public final String queueId;
        public final String authorityDigest;
        public final String repoRoot;
        public final String runId;
        public final String holder;
        public final String leaseId;
        public final Long fencingToken;
        public final String evidenceDigest;
        public final String operationId;

        private Intent(Action action, String taskKey, String stateId,
                String attemptDigest, String adjudicationDigest, String decision,
                String queueId, String authorityDigest, String repoRoot,
                String runId, String holder, String leaseId, Long fencingToken,
                String evidenceDigest, String operationId) {
            this.action = action;
            this.taskKey = taskKey;
            this.stateId = stateId;
            this.attemptDigest = attemptDigest;
            this.adjudicationDigest = adjudicationDigest;
            this.decision = decision;
            this.queueId = queueId;
            this.authorityDigest = authorityDigest;
            this.repoRoot = repoRoot;
            this.runId = runId;
            this.holder = holder;
            this.leaseId = leaseId;
            this.fencingToken = fencingToken;
            this.evidenceDigest = evidenceDigest;
            this.operationId = operationId;
        }

        public boolean isDistributed() {
            return queueId != null;
        }
    }

    /** Pin or validation result, with the selected task when successful. */
    public static final class Target {
        public final boolean ok;
        public final String error;
        public final Intent intent;
        public final TeamMonitor.Task task;

        private Target(boolean ok, String error, Intent intent, TeamMonitor.Task task) {
            this.ok = ok;
            this.error = error;
            this.intent = intent;
            this.task = task;
        }

        static Target failure(String error) {
            return new Target(false, error, null, null);
        }

        static Target success(Intent intent, TeamMonitor.Task task) {
            return new Target(true, null, intent, task);
        }
    }

    /** Captured process outcome. Signal is injectable because Process has no portable signal API. */
    public static final class CliResult {
        public final Integer code;
        public final String stdout;
        public final String stderr;
        public final boolean timedOut;
        public final String signal;

        public CliResult(Integer code, String stdout, String stderr,
                boolean timedOut, String signal) {
            this.code = code;
            this.stdout = stdout == null ? "" : stdout;
            this.stderr = stderr == null ? "" : stderr;
            this.timedOut = timedOut;
            this.signal = signal;
        }
    }

    /** Final fail-closed protocol outcome returned to the action. */
    public static final class Result {
        public final boolean ok;
        public final String error;
        public final Map<String, Object> value;

        private Result(boolean ok, String error, Map<String, Object> value) {
            this.ok = ok;
            this.error = error;
            this.value = value;
        }

        static Result success(Map<String, Object> value) {
            return new Result(true, null, value);
        }

        static Result failure(String error) {
            return new Result(false, bounded(error), null);
        }
    }

    @FunctionalInterface
    public interface StateReader {
        TeamMonitor.State read(String statePath) throws Exception;
    }

    @FunctionalInterface
    public interface CliRunner {
        CliResult run(List<String> args, long timeoutMs) throws Exception;
    }

    /** Capture one exact active attempt from the currently rendered snapshot. */
    public static Target pinInterrupt(TeamMonitor.State state, String taskKey) {
        Target common = commonTarget(state, taskKey);
        if (!common.ok) return common;
        TeamMonitor.Task task = common.task;
        if (!"in_progress".equals(task.status)) {
            return Target.failure("Only an in-progress task can be taken over.");
        }
        if (state.distributedQueue) {
            if (!validControlId(task.holder)
                    || !validControlId(task.leaseId)
                    || !(task.fencingToken instanceof Long)
                    || ((Long) task.fencingToken).longValue() < 1L) {
                return Target.failure(
                        "The selected task has no valid distributed holder/lease/fence authority.");
            }
            Intent intent = distributedIntent(
                    Action.INTERRUPT, state, task, null, null);
            return Target.success(intent, task);
        }
        if (!validDigest(task.attemptDigest)) {
            return Target.failure(
                    "The selected task has no valid holder/lease/fence authority.");
        }
        Intent intent = legacyIntent(
                Action.INTERRUPT, taskKey, state.stateId,
                task.attemptDigest, null, null);
        return Target.success(intent, task);
    }

    /** Capture one exact adjudication case from the currently rendered snapshot. */
    public static Target pinAdjudication(TeamMonitor.State state, String taskKey,
            String decision) {
        Target common = commonTarget(state, taskKey);
        if (!common.ok) return common;
        if (!DECISIONS.contains(decision)) {
            return Target.failure("Unsupported adjudication decision.");
        }
        TeamMonitor.Task task = common.task;
        if (task.adjudication == null || !task.adjudication.required) {
            return Target.failure("This task no longer requires adjudication.");
        }
        if (state.distributedQueue) {
            if (!validDigest(task.evidenceDigest)) {
                return Target.failure(
                        "The selected task has no valid distributed adjudication evidence.");
            }
            Intent intent = distributedIntent(
                    Action.ADJUDICATE, state, task, decision, task.evidenceDigest);
            return Target.success(intent, task);
        }
        if (!validDigest(task.adjudicationDigest)) {
            return Target.failure(
                    "The selected task has no valid adjudication case authority.");
        }
        Intent intent = legacyIntent(
                Action.ADJUDICATE, taskKey, state.stateId,
                null, task.adjudicationDigest, decision);
        return Target.success(intent, task);
    }

    /** Capture one exact rollback-recovery-required distributed checkpoint. */
    public static Target pinRecovery(TeamMonitor.State state, String taskKey) {
        Target common = commonTarget(state, taskKey);
        if (!common.ok) return common;
        TeamMonitor.Task task = common.task;
        if (!state.distributedQueue) {
            return Target.failure(
                    "Managed checkpoint recovery requires distributed queue state.");
        }
        if (task.adjudication == null || !task.adjudication.required) {
            return Target.failure("This task no longer requires adjudication.");
        }
        if (!task.checkpointRecoveryRequired) {
            return Target.failure(
                    "This task no longer requires managed checkpoint recovery.");
        }
        if (!validDigest(task.evidenceDigest)) {
            return Target.failure(
                    "The selected task has no valid distributed recovery evidence.");
        }
        return Target.success(
                distributedIntent(
                        Action.RECOVER, state, task, null, task.evidenceDigest),
                task);
    }

    /**
     * Revalidate a pinned click against a newly read state. Both state identity
     * and the relevant authority digest must match exactly.
     */
    public static Target validate(TeamMonitor.State state, Intent intent) {
        if (intent == null || intent.action == null) {
            return Target.failure("The team control request is invalid.");
        }
        Target common = commonTarget(state, intent.taskKey);
        if (!common.ok) return common;
        TeamMonitor.Task task = common.task;
        if (intent.isDistributed()) {
            if (!state.distributedQueue
                    || !intent.queueId.equals(state.queueId)
                    || !intent.authorityDigest.equals(state.authorityDigest)
                    || !intent.repoRoot.equals(state.repoRoot)
                    || !intent.runId.equals(state.runId)) {
                return Target.failure(
                        "The distributed queue authority changed. Refresh before "
                                + "issuing a control action.");
            }
            if (intent.action == Action.INTERRUPT) {
                if (!"in_progress".equals(task.status)) {
                    return Target.failure(
                            "Only an in-progress task can be taken over.");
                }
                if (!same(intent.holder, task.holder)
                        || !same(intent.leaseId, task.leaseId)
                        || !(task.fencingToken instanceof Long)
                        || !intent.fencingToken.equals(task.fencingToken)) {
                    return Target.failure(
                            "The selected distributed lease fence changed. Refresh "
                                    + "before requesting takeover.");
                }
                return Target.success(intent, task);
            }
            if (task.adjudication == null || !task.adjudication.required) {
                return Target.failure(
                        "This task no longer requires adjudication.");
            }
            if (!validDigest(task.evidenceDigest)
                    || !task.evidenceDigest.equals(intent.evidenceDigest)) {
                return Target.failure(
                        "The distributed task evidence changed. Refresh before "
                                + "applying human control.");
            }
            if (intent.action == Action.RECOVER) {
                if (!task.checkpointRecoveryRequired) {
                    return Target.failure(
                            "This task no longer requires managed checkpoint recovery.");
                }
                return Target.success(intent, task);
            }
            if (intent.action != Action.ADJUDICATE
                    || !DECISIONS.contains(intent.decision)) {
                return Target.failure("Unsupported adjudication decision.");
            }
            return Target.success(intent, task);
        }
        if (intent.stateId == null || !intent.stateId.equals(state.stateId)) {
            return Target.failure(
                    "The team state changed. Refresh before issuing a control action.");
        }
        if (intent.action == Action.INTERRUPT) {
            if (!"in_progress".equals(task.status)) {
                return Target.failure("Only an in-progress task can be taken over.");
            }
            if (!validDigest(task.attemptDigest)
                    || !task.attemptDigest.equals(intent.attemptDigest)) {
                return Target.failure(
                        "The selected task attempt changed. Refresh before requesting takeover.");
            }
        } else if (intent.action == Action.ADJUDICATE) {
            if (!DECISIONS.contains(intent.decision)) {
                return Target.failure("Unsupported adjudication decision.");
            }
            if (task.adjudication == null || !task.adjudication.required) {
                return Target.failure("This task no longer requires adjudication.");
            }
            if (!validDigest(task.adjudicationDigest)
                    || !task.adjudicationDigest.equals(intent.adjudicationDigest)) {
                return Target.failure(
                        "The adjudication case changed. Refresh before applying a decision.");
            }
        } else {
            return Target.failure("Unsupported team control action.");
        }
        return Target.success(intent, task);
    }

    /** Exact shell-free argv forwarded to the resolved {@code cc} executable. */
    public static List<String> buildArgs(String statePath, Intent intent, String reason) {
        String normalizedReason = normalizeReason(reason);
        if (statePath == null || statePath.trim().isEmpty()) {
            throw new IllegalArgumentException("A team state path is required.");
        }
        if (intent == null || !validControlId(intent.taskKey)) {
            throw new IllegalArgumentException("A valid pinned team control intent is required.");
        }
        if (normalizedReason == null) {
            throw new IllegalArgumentException(
                    "A non-empty control reason of at most 500 characters is required.");
        }
        List<String> args = new ArrayList<String>();
        if (intent.isDistributed()) {
            if (!validControlId(intent.queueId)
                    || !validAuthorityDigest(intent.authorityDigest)
                    || !validAuthorityPath(intent.repoRoot)
                    || !validControlId(intent.runId)
                    || !validControlId(intent.operationId)) {
                throw new IllegalArgumentException(
                        "A complete pinned distributed queue authority is required.");
            }
            Collections.addAll(args,
                    "team", "queue", actionName(intent.action),
                    "--state", statePath,
                    "--repo", intent.repoRoot,
                    "--run-id", intent.runId,
                    "--queue-id", intent.queueId,
                    "--authority-digest", intent.authorityDigest,
                    "--task", intent.taskKey);
            if (intent.action == Action.INTERRUPT) {
                if (!validControlId(intent.holder)
                        || !validControlId(intent.leaseId)
                        || intent.fencingToken == null
                        || intent.fencingToken.longValue() < 1L) {
                    throw new IllegalArgumentException(
                            "A complete distributed lease fence is required.");
                }
                Collections.addAll(args,
                        "--holder", intent.holder,
                        "--lease-id", intent.leaseId,
                        "--fencing-token", String.valueOf(intent.fencingToken),
                        "--request-id", intent.operationId);
            } else if (intent.action == Action.RECOVER) {
                if (!validDigest(intent.evidenceDigest)) {
                    throw new IllegalArgumentException(
                            "A valid distributed recovery evidence digest is required.");
                }
                Collections.addAll(args,
                        "--recovery-id", intent.operationId,
                        "--evidence-digest", intent.evidenceDigest);
            } else if (intent.action == Action.ADJUDICATE
                    && DECISIONS.contains(intent.decision)) {
                if (!validDigest(intent.evidenceDigest)) {
                    throw new IllegalArgumentException(
                            "A valid distributed adjudication evidence digest is required.");
                }
                Collections.addAll(args,
                        "--decision", intent.decision,
                        "--decision-id", intent.operationId,
                        "--evidence-digest", intent.evidenceDigest);
            } else {
                throw new IllegalArgumentException(
                        "Unsupported distributed team control action.");
            }
            Collections.addAll(args,
                    "--actor", "jetbrains",
                    "--reason", normalizedReason,
                    "--json");
            return Collections.unmodifiableList(args);
        }
        if (!validControlId(intent.stateId)) {
            throw new IllegalArgumentException(
                    "A valid pinned team control intent is required.");
        }
        args.add("team");
        if (intent.action == Action.INTERRUPT) {
            if (!validDigest(intent.attemptDigest)) {
                throw new IllegalArgumentException(
                        "A valid expected task attempt digest is required.");
            }
            Collections.addAll(args,
                    "interrupt",
                    "--state", statePath,
                    "--expected-state-id", intent.stateId,
                    "--expected-attempt-digest", intent.attemptDigest,
                    "--task", intent.taskKey,
                    "--actor", "jetbrains",
                    "--reason", normalizedReason,
                    "--json");
        } else if (intent.action == Action.ADJUDICATE
                && DECISIONS.contains(intent.decision)) {
            if (!validDigest(intent.adjudicationDigest)) {
                throw new IllegalArgumentException(
                        "A valid expected adjudication digest is required.");
            }
            Collections.addAll(args,
                    "adjudicate",
                    "--state", statePath,
                    "--expected-state-id", intent.stateId,
                    "--expected-adjudication-digest", intent.adjudicationDigest,
                    "--task", intent.taskKey,
                    "--decision", intent.decision,
                    "--authority", "jetbrains",
                    "--reason", normalizedReason,
                    "--json");
        } else {
            throw new IllegalArgumentException("Unsupported team control action.");
        }
        return Collections.unmodifiableList(args);
    }

    /**
     * Re-read, CAS-validate and invoke the CLI. Stdout alone is parsed as the
     * success protocol; timeout, signal, non-zero exit, malformed output and
     * runner exceptions all fail closed.
     */
    public static Result execute(String statePath, Intent intent, String reason,
            StateReader reader, CliRunner runner) {
        if (reader == null || runner == null) {
            return Result.failure("The team control runtime is unavailable.");
        }
        List<String> args;
        try {
            TeamMonitor.State latest = reader.read(statePath);
            Target target = validate(latest, intent);
            if (!target.ok) return Result.failure(target.error);
            args = buildArgs(statePath, intent, reason);
        } catch (Exception error) {
            return Result.failure("Team control validation failed: "
                    + safeFailureText(error.getMessage()));
        }

        final CliResult process;
        try {
            process = runner.run(args, CLI_TIMEOUT_MS);
        } catch (Exception error) {
            return Result.failure("Team control could not start: "
                    + safeFailureText(error.getMessage()));
        }
        if (process == null) return Result.failure("Team control failed.");
        if (process.timedOut) {
            return processFailure("Team control timed out", process.stderr);
        }
        if (process.signal != null && !process.signal.isEmpty()) {
            return processFailure("Team control was terminated by "
                    + safeFailureText(process.signal), process.stderr);
        }
        if (process.code == null || process.code.intValue() != 0) {
            String outcome = process.code == null
                    ? "Team control failed"
                    : "Team control exited with code " + process.code;
            return processFailure(outcome, process.stderr);
        }
        return parseControlOutput(process.stdout);
    }

    /** Trim, reject controls and cap the operator reason exactly like VS Code. */
    public static String normalizeReason(String value) {
        if (value == null) return null;
        String reason = value.trim();
        if (reason.isEmpty() || reason.length() > MAX_REASON_LENGTH
                || hasControlCharacters(reason)) return null;
        return reason;
    }

    /** Bounded, single-line and credential-redacted text safe for IDE dialogs. */
    public static String safeFailureText(String value) {
        String text = value == null ? "" : value;
        text = text.replaceAll("[\\u0000-\\u001f\\u007f]+", " ")
                .replaceAll("\\s+", " ").trim();
        text = BEARER.matcher(text).replaceAll("Bearer <redacted>");
        text = SECRET_ASSIGNMENT.matcher(text).replaceAll("$1$2<redacted>");
        text = URL_CREDENTIALS.matcher(text).replaceAll("$1<redacted>@");
        return bounded(text);
    }

    private static Intent legacyIntent(Action action, String taskKey, String stateId,
            String attemptDigest, String adjudicationDigest, String decision) {
        return new Intent(action, taskKey, stateId, attemptDigest,
                adjudicationDigest, decision, null, null, null, null,
                null, null, null, null, null);
    }

    private static Intent distributedIntent(Action action, TeamMonitor.State state,
            TeamMonitor.Task task, String decision, String evidenceDigest) {
        String kind = action == Action.INTERRUPT
                ? "request" : action == Action.RECOVER ? "recovery" : "decision";
        String operationId = "jetbrains-" + kind + "-" + UUID.randomUUID();
        return new Intent(
                action,
                task.key,
                null,
                null,
                null,
                decision,
                state.queueId,
                state.authorityDigest,
                state.repoRoot,
                state.runId,
                action == Action.INTERRUPT ? task.holder : null,
                action == Action.INTERRUPT ? task.leaseId : null,
                action == Action.INTERRUPT && task.fencingToken instanceof Long
                        ? (Long) task.fencingToken : null,
                evidenceDigest,
                operationId);
    }

    private static Target commonTarget(TeamMonitor.State state, String taskKey) {
        if (state == null || !state.ok) {
            return Target.failure(state == null || state.error == null
                    ? "Team state is unreadable." : state.error);
        }
        if (state.distributedQueue) {
            if (state.schemaVersion != TeamMonitor.DISTRIBUTED_QUEUE_SCHEMA_VERSION
                    || !validControlId(state.queueId)
                    || !validAuthorityDigest(state.authorityDigest)
                    || !validAuthorityPath(state.repoRoot)
                    || !validControlId(state.runId)) {
                return Target.failure(
                        "Human control requires complete distributed queue authority.");
            }
        } else if (state.version != 6 || !validControlId(state.stateId)) {
            return Target.failure(
                    "Human control requires a version 6 team state with a stateId "
                            + "or schema-v1 distributed queue state.");
        }
        if (!validControlId(taskKey)) {
            return Target.failure("The selected task has no valid durable key.");
        }
        TeamMonitor.Task task = TeamMonitor.findTask(state, taskKey);
        if (task == null) return Target.failure("The selected task no longer exists.");
        return Target.success(null, task);
    }

    private static String actionName(Action action) {
        if (action == Action.INTERRUPT) return "interrupt";
        if (action == Action.RECOVER) return "recover";
        if (action == Action.ADJUDICATE) return "adjudicate";
        throw new IllegalArgumentException("Unsupported team control action.");
    }

    private static boolean same(String left, String right) {
        return left != null && left.equals(right);
    }

    private static Result processFailure(String outcome, String detail) {
        String safe = safeFailureText(detail);
        return Result.failure(outcome + (safe.isEmpty() ? "." : ": " + safe));
    }

    @SuppressWarnings("unchecked")
    private static Result parseControlOutput(String output) {
        String text = output == null ? "" : output.trim();
        if (text.isEmpty()) {
            return Result.failure("The CLI returned no control result.");
        }
        Object value = parseObjectCandidate(text);
        if (!(value instanceof Map)) {
            String detail = safeFailureText(text);
            if (detail.length() > 300) detail = detail.substring(0, 300);
            return Result.failure("The CLI returned an invalid control result"
                    + (detail.isEmpty() ? "." : ": " + detail));
        }
        Map<String, Object> object = (Map<String, Object>) value;
        Object error = object.get("error");
        if (Boolean.FALSE.equals(object.get("ok"))
                || error != null && !String.valueOf(error).isEmpty()) {
            String detail = safeFailureText(error != null
                    ? String.valueOf(error)
                    : String.valueOf(object.get("message")));
            return Result.failure(detail.isEmpty() ? "Team control failed." : detail);
        }
        return Result.success(object);
    }

    private static Object parseObjectCandidate(String text) {
        try {
            return MiniJson.parse(text);
        } catch (RuntimeException ignored) {
            String[] lines = text.split("\\r?\\n");
            for (int index = lines.length - 1; index >= 0; index--) {
                try {
                    Object value = MiniJson.parse(lines[index]);
                    if (value instanceof Map) return value;
                } catch (RuntimeException ignoredLine) {
                    // Try an earlier JSONL record.
                }
            }
            int first = text.indexOf('{');
            int last = text.lastIndexOf('}');
            if (first >= 0 && last > first) {
                try {
                    return MiniJson.parse(text.substring(first, last + 1));
                } catch (RuntimeException ignoredObject) {
                    // Fall through to the fail-closed invalid result.
                }
            }
            return null;
        }
    }

    private static boolean validControlId(String value) {
        return value != null && !value.isEmpty()
                && value.length() <= MAX_CONTROL_ID_LENGTH
                && !hasControlCharacters(value);
    }

    private static boolean validDigest(String value) {
        return value != null && DIGEST_PATTERN.matcher(value).matches();
    }

    private static boolean validAuthorityDigest(String value) {
        return value != null && AUTHORITY_DIGEST_PATTERN.matcher(value).matches();
    }

    private static boolean validAuthorityPath(String value) {
        return value != null && !value.isEmpty() && value.length() <= 4096
                && value.trim().equals(value) && !hasControlCharacters(value);
    }

    private static boolean hasControlCharacters(String value) {
        for (int index = 0; index < value.length(); index++) {
            char c = value.charAt(index);
            if (c < 32 || c == 127) return true;
        }
        return false;
    }

    private static String bounded(String value) {
        String text = value == null ? "" : value;
        return text.length() <= MAX_FAILURE_LENGTH
                ? text : text.substring(0, MAX_FAILURE_LENGTH);
    }
}
