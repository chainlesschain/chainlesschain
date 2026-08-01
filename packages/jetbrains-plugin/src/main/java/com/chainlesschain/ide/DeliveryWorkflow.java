package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Pure consumer and renderer for the host-neutral CLI delivery protocol. */
public final class DeliveryWorkflow {
    private static final String PROJECTION_SCHEMA =
            "chainlesschain.delivery-flow-projection";
    private static final String ACTION_SCHEMA = "chainlesschain.delivery-action";
    private static final String ACTION_RESULT_SCHEMA =
            "chainlesschain.delivery-action-result";
    private static final String COMMAND_RESULT_SCHEMA =
            "chainlesschain.delivery-flow-command-result";
    private static final Pattern DIGEST = Pattern.compile("^sha256:[0-9a-fA-F]{64}$");
    private static final Set<String> ACTIONS = Set.of(
            "run_gates", "run_preview", "run_review", "apply_fix",
            "create_pr", "refresh_ci", "publish_evidence", "merge", "archive");
    private static final Set<String> STATUSES = Set.of(
            "active", "blocked", "stopped", "completed");
    private static final Set<String> PHASES = Set.of(
            "gates", "preview", "review", "fix", "pr", "ci", "evidence",
            "merge", "archive", "completed");
    private static final Map<String, String> ACTION_LABELS = actionLabels();
    private static final List<String> STAGE_LABELS = List.of(
            "Gates", "Preview", "Review", "PR / CI", "Merge", "Archive");

    private DeliveryWorkflow() {}

    private static Map<String, String> actionLabels() {
        Map<String, String> labels = new LinkedHashMap<>();
        labels.put("run_gates", "run gates");
        labels.put("run_preview", "run preview");
        labels.put("run_review", "run review");
        labels.put("apply_fix", "apply reviewed fix");
        labels.put("create_pr", "request PR creation");
        labels.put("refresh_ci", "refresh CI evidence");
        labels.put("publish_evidence", "publish immutable evidence");
        labels.put("merge", "request merge");
        labels.put("archive", "archive verified flow");
        return Map.copyOf(labels);
    }

    public static String actionLabel(String action) {
        return ACTION_LABELS.getOrDefault(action, String.valueOf(action));
    }

    public static boolean supportsAction(String action) {
        return ACTIONS.contains(action);
    }

    public static Map<String, Object> parseProjection(String text) {
        try {
            return validateProjection(MiniJson.parseObject(text == null ? "" : text));
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> validateProjection(Map<String, Object> state) {
        if (state == null
                || !PROJECTION_SCHEMA.equals(state.get("schema"))
                || number(state.get("version")) != 1
                || !Boolean.TRUE.equals(state.get("valid"))
                || blank(state.get("flowId"))
                || number(state.get("revision")) < 0
                || !digest(state.get("stateDigest"))
                || !STATUSES.contains(String.valueOf(state.get("status")))
                || !PHASES.contains(String.valueOf(state.get("phase")))
                || number(state.get("round")) < 0
                || number(state.get("maxRounds")) < 0
                || number(state.get("noProgressRounds")) < 0
                || number(state.get("maxNoProgressRounds")) < 0
                || !(state.get("availableActions") instanceof List)
                || !(state.get("failures") instanceof List)) {
            return null;
        }
        List<Object> available = (List<Object>) state.get("availableActions");
        Set<String> unique = new LinkedHashSet<>();
        for (Object action : available) {
            String value = String.valueOf(action);
            if (!ACTIONS.contains(value) || !unique.add(value)) return null;
        }
        for (Object rawFailure : (List<Object>) state.get("failures")) {
            if (!(rawFailure instanceof Map)) return null;
            Map<String, Object> failure = (Map<String, Object>) rawFailure;
            if (!(failure.get("message") instanceof String)) return null;
            if (failure.get("line") != null && number(failure.get("line")) < 0) return null;
        }
        Object pendingRaw = state.get("pendingEffect");
        if (pendingRaw != null) {
            if (!(pendingRaw instanceof Map)) return null;
            Map<String, Object> pending = (Map<String, Object>) pendingRaw;
            if (!digest(pending.get("id"))
                    || !ACTIONS.contains(String.valueOf(pending.get("action")))
                    || !available.isEmpty()) {
                return null;
            }
        }
        Object prRaw = state.get("pr");
        if (prRaw != null) {
            if (!(prRaw instanceof Map)) return null;
            Map<String, Object> pr = (Map<String, Object>) prRaw;
            if (number(pr.get("number")) <= 0 || !(pr.get("mergeAllowed") instanceof Boolean)) {
                return null;
            }
        }
        Object evidenceRaw = state.get("evidence");
        if (evidenceRaw != null) {
            if (!(evidenceRaw instanceof Map)) return null;
            Map<String, Object> evidence = (Map<String, Object>) evidenceRaw;
            if (!digest(evidence.get("recordDigest"))
                    || !(evidence.get("ready") instanceof Boolean)
                    || (evidence.get("artifactId") != null
                    && !(evidence.get("artifactId") instanceof String))) {
                return null;
            }
        }
        return state;
    }

    public static Map<String, Object> parseAction(String text) {
        try {
            return validateAction(MiniJson.parseObject(text == null ? "" : text));
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    public static Map<String, Object> validateAction(Map<String, Object> action) {
        if (action == null
                || !ACTION_SCHEMA.equals(action.get("schema"))
                || number(action.get("version")) != 1
                || blank(action.get("flowId"))
                || number(action.get("expectedRevision")) < 0
                || !digest(action.get("expectedStateDigest"))
                || !ACTIONS.contains(String.valueOf(action.get("action")))
                || !(action.get("payload") instanceof Map)) {
            return null;
        }
        return action;
    }

    public static Map<String, Object> parseActionResult(String text) {
        try {
            return validateActionResult(MiniJson.parseObject(text == null ? "" : text));
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    public static Map<String, Object> validateActionResult(Map<String, Object> envelope) {
        if (envelope == null
                || !ACTION_RESULT_SCHEMA.equals(envelope.get("schema"))
                || number(envelope.get("version")) != 1
                || !digest(envelope.get("effectId"))
                || !(envelope.get("result") instanceof Map)) {
            return null;
        }
        return envelope;
    }

    public static Map<String, Object> parseCommandResult(String text) {
        try {
            return validateCommandResult(MiniJson.parseObject(text == null ? "" : text));
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> validateCommandResult(Map<String, Object> result) {
        if (result == null
                || !COMMAND_RESULT_SCHEMA.equals(result.get("schema"))
                || number(result.get("version")) != 1
                || !(result.get("state") instanceof Map)
                || !(result.get("projection") instanceof Map)) {
            return null;
        }
        Map<String, Object> projection =
                validateProjection((Map<String, Object>) result.get("projection"));
        return projection == null ? null : result;
    }

    public static List<String> buildProjectArgs(String statePath) {
        if (statePath == null || statePath.trim().isEmpty()) {
            throw new IllegalArgumentException("statePath is required");
        }
        return new ArrayList<>(List.of(
                "artifacts", "delivery-project", statePath, "--json"));
    }

    /** Backwards-compatible argv builder used by the protocol conformance test. */
    public static List<String> buildStepArgs(
            String statePath, String action, String payloadPath, String resultPath) {
        return buildStepArgs(statePath, action, payloadPath, resultPath,
                null, null, null, false);
    }

    /** Build exact CAS-bound CLI argv. No provider executable is ever returned. */
    public static List<String> buildStepArgs(
            String statePath, String action, String payloadPath, String resultPath,
            Long expectedRevision, String expectedStateDigest,
            String expectedEffectId, boolean writeState) {
        if (statePath == null || statePath.trim().isEmpty()) {
            throw new IllegalArgumentException("statePath is required");
        }
        if (action != null && !ACTIONS.contains(action)) {
            throw new IllegalArgumentException("unsupported delivery action: " + action);
        }
        if (expectedRevision != null && expectedRevision < 0) {
            throw new IllegalArgumentException("expectedRevision must be non-negative");
        }
        if (expectedStateDigest != null && !digest(expectedStateDigest)) {
            throw new IllegalArgumentException("expectedStateDigest must be a full sha256 digest");
        }
        if (expectedEffectId != null && !digest(expectedEffectId)) {
            throw new IllegalArgumentException("expectedEffectId must be a full sha256 digest");
        }
        List<String> args = new ArrayList<>();
        args.add("artifacts");
        args.add("delivery-step");
        args.add(statePath);
        if (action != null) {
            args.add("--action");
            args.add(action);
        }
        if (payloadPath != null) {
            args.add("--payload-file");
            args.add(payloadPath);
        }
        if (resultPath != null) {
            args.add("--result-file");
            args.add(resultPath);
        }
        if (expectedRevision != null) {
            args.add("--expected-revision");
            args.add(String.valueOf(expectedRevision));
        }
        if (expectedStateDigest != null) {
            args.add("--expected-state-digest");
            args.add(expectedStateDigest);
        }
        if (expectedEffectId != null) {
            args.add("--expected-effect-id");
            args.add(expectedEffectId);
        }
        if (writeState) args.add("--write-state");
        args.add("--json");
        return args;
    }

    @SuppressWarnings("unchecked")
    public static List<String> availableActions(Map<String, Object> projection) {
        Map<String, Object> valid = validateProjection(projection);
        if (valid == null) return List.of();
        List<String> result = new ArrayList<>();
        for (Object action : (List<Object>) valid.get("availableActions")) {
            result.add(String.valueOf(action));
        }
        return result;
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> pendingEffect(Map<String, Object> projection) {
        Map<String, Object> valid = validateProjection(projection);
        if (valid == null || !(valid.get("pendingEffect") instanceof Map)) return null;
        return (Map<String, Object>) valid.get("pendingEffect");
    }

    /** Plain text used inside the existing Sessions Workbench Swing panel. */
    @SuppressWarnings("unchecked")
    public static String render(Map<String, Object> projection, String statePath) {
        Map<String, Object> state = validateProjection(projection);
        if (state == null) {
            return "Delivery flow\nSelect a CLI delivery-flow state snapshot. "
                    + "No delivery action is available while disconnected.";
        }
        StringBuilder out = new StringBuilder("Delivery flow\n");
        if (statePath != null && !statePath.isEmpty()) out.append(statePath).append('\n');
        int current = stageIndex(String.valueOf(state.get("phase")));
        for (int i = 0; i < STAGE_LABELS.size(); i++) {
            if (i > 0) out.append(" -> ");
            String marker = i < current || current == STAGE_LABELS.size()
                    ? "[done]" : i == current ? "[current]" : "[next]";
            out.append(marker).append(' ').append(STAGE_LABELS.get(i));
        }
        out.append('\n');
        out.append(state.get("status")).append('/').append(state.get("phase"))
                .append(" · round ").append(number(state.get("round"))).append('/')
                .append(number(state.get("maxRounds")))
                .append(" · no progress ").append(number(state.get("noProgressRounds")))
                .append('/').append(number(state.get("maxNoProgressRounds")))
                .append(" · revision ").append(number(state.get("revision"))).append('\n');
        if (state.get("stopReason") != null) {
            out.append("Stop reason: ").append(state.get("stopReason")).append('\n');
        }
        Map<String, Object> pending = pendingEffect(state);
        if (pending != null) {
            out.append("Pending request only: ")
                    .append(actionLabel(String.valueOf(pending.get("action"))))
                    .append('\n').append(pending.get("id")).append('\n');
        }
        List<Object> failures = (List<Object>) state.get("failures");
        if (!failures.isEmpty()) out.append("Failure mapping\n");
        for (Object raw : failures) {
            Map<String, Object> failure = (Map<String, Object>) raw;
            out.append("- ").append(failure.get("message"));
            String location = failureLocation(failure);
            if (!location.isEmpty()) out.append(" · ").append(location);
            out.append('\n');
        }
        if (state.get("pr") instanceof Map) {
            Map<String, Object> pr = (Map<String, Object>) state.get("pr");
            out.append("PR #").append(pr.get("number"))
                    .append(" · head ").append(orUnverified(pr.get("headCommitSha")))
                    .append(" · CI ").append(orUnverified(pr.get("ciCommitSha")))
                    .append(" · merge ")
                    .append(Boolean.TRUE.equals(pr.get("mergeAllowed")) ? "eligible" : "blocked")
                    .append('\n');
        }
        if (state.get("evidence") instanceof Map) {
            Map<String, Object> evidence = (Map<String, Object>) state.get("evidence");
            out.append("Immutable evidence: ")
                    .append(Boolean.TRUE.equals(evidence.get("ready")) ? "ready" : "not ready")
                    .append(" · ").append(evidence.get("recordDigest"));
            if (evidence.get("artifactId") != null) {
                out.append(" · artifact ").append(evidence.get("artifactId"));
            }
            out.append('\n');
        }
        List<String> actions = availableActions(state);
        if (!actions.isEmpty()) {
            out.append("Available request: ").append(actionLabel(actions.get(0))).append('\n');
        }
        out.append("Requests/settlements use cc artifacts delivery-step only; "
                + "the IDE never calls a PR, CI, merge, or archive provider directly.");
        return out.toString();
    }

    private static int stageIndex(String phase) {
        if ("completed".equals(phase)) return STAGE_LABELS.size();
        if ("gates".equals(phase)) return 0;
        if ("preview".equals(phase)) return 1;
        if ("review".equals(phase) || "fix".equals(phase)) return 2;
        if ("pr".equals(phase) || "ci".equals(phase) || "evidence".equals(phase)) return 3;
        if ("merge".equals(phase)) return 4;
        if ("archive".equals(phase)) return 5;
        return -1;
    }

    private static String failureLocation(Map<String, Object> failure) {
        List<String> parts = new ArrayList<>();
        if (!blank(failure.get("file"))) {
            String file = String.valueOf(failure.get("file"));
            if (failure.get("line") != null) file += ":" + number(failure.get("line"));
            parts.add(file);
        }
        if (!blank(failure.get("hunk"))) parts.add(String.valueOf(failure.get("hunk")));
        if (!blank(failure.get("turnId"))) parts.add(String.valueOf(failure.get("turnId")));
        if (!blank(failure.get("toolCallId"))) parts.add(String.valueOf(failure.get("toolCallId")));
        return String.join(" · ", parts);
    }

    private static String orUnverified(Object value) {
        return blank(value) ? "unverified" : String.valueOf(value);
    }

    static long number(Object value) {
        if (!(value instanceof Number)) return -1;
        if (value instanceof Byte || value instanceof Short
                || value instanceof Integer || value instanceof Long) {
            long integer = ((Number) value).longValue();
            return integer >= 0 ? integer : -1;
        }
        double decimal = ((Number) value).doubleValue();
        if (!Double.isFinite(decimal) || decimal < 0
                || decimal != Math.rint(decimal) || decimal > Long.MAX_VALUE) {
            return -1;
        }
        return (long) decimal;
    }

    static boolean digest(Object value) {
        return value != null && DIGEST.matcher(String.valueOf(value)).matches();
    }

    static boolean blank(Object value) {
        return value == null || String.valueOf(value).trim().isEmpty();
    }
}
