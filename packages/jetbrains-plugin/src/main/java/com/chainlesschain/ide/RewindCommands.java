package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.HashSet;
import java.util.Set;

/**
 * Panel {@code /rewind} (checkpoint restore) — the Java twin of the VS Code
 * extension's rewind-commands.js. Rather than re-implement the shadow-commit
 * engine, this defers to the CLI's source of truth — {@code cc checkpoint
 * list|restore} — scoped to the panel's session (mirroring how /cost and
 * /sessions defer to the CLI). Pure arg builders + tolerant stdout parsers;
 * the glue drives {@code AgentChatSession.runCapture} + a chooser around them.
 */
public final class RewindCommands {

    public static final String TIMELINE_SCHEMA = "cc-checkpoint-timeline/v1";
    public static final int TIMELINE_VERSION = 1;
    public static final String TIMELINE_ACTION_SCHEMA = "cc-checkpoint-timeline-action/v1";
    public static final int TIMELINE_ACTION_VERSION = 1;
    public static final String TIMELINE_RESULT_SCHEMA = "cc-checkpoint-timeline-result/v1";
    public static final int TIMELINE_RESULT_VERSION = 1;
    public static final String TIMELINE_CONFIRMATION_SCHEMA =
            "cc-checkpoint-timeline-confirmation/v1";
    public static final int TIMELINE_CONFIRMATION_VERSION = 1;
    public static final String WORKSPACE_BINDING_SCHEMA =
            "cc-checkpoint-workspace-binding/v1";
    public static final int WORKSPACE_BINDING_VERSION = 1;
    private static final int MAX_TIMELINE_ENTRIES = 1000;
    private static final int MAX_TIMELINE_LIST = 256;
    private static final Set<String> TIMELINE_COVERAGES = new HashSet<String>(Arrays.asList(
            "full", "partial", "none"));
    private static final Set<String> TIMELINE_MARKERS = new HashSet<String>(Arrays.asList(
            "checkpoint", "commit", "tool-side-effect", "artifact", "verification"));
    private static final Set<String> TIMELINE_ACTIONS = new HashSet<String>(Arrays.asList(
            "restore-code", "restore-conversation", "restore-both",
            "summary-from", "summary-to", "branch"));

    private RewindCommands() {}

    /** One checkpoint row from {@code cc checkpoint list --json}. */
    public static final class Checkpoint {
        public final String id;
        public final String createdAt; // nullable
        public final String label;     // nullable
        public final Long fileCount;   // nullable

        Checkpoint(String id, String createdAt, String label, Long fileCount) {
            this.id = id;
            this.createdAt = createdAt;
            this.label = label;
            this.fileCount = fileCount;
        }
    }

    /** One bounded, display-ready row from the CLI-authored timeline. */
    public static final class TimelineEntry {
        public final String turnId;
        public final String coverage;
        public final List<String> markerKinds;
        public final List<String> enabledActions;
        public final List<String> excludedPaths;
        public final List<String> irreversibleSideEffects;
        private final Map<String, Map<String, Object>> submissions;

        TimelineEntry(String turnId, String coverage, List<String> markerKinds,
                List<String> enabledActions, List<String> excludedPaths,
                List<String> irreversibleSideEffects,
                Map<String, Map<String, Object>> submissions) {
            this.turnId = turnId;
            this.coverage = coverage;
            this.markerKinds = markerKinds;
            this.enabledActions = enabledActions;
            this.excludedPaths = excludedPaths;
            this.irreversibleSideEffects = irreversibleSideEffects;
            this.submissions = submissions;
        }

        /** Exact CLI-authored envelope, copied so callers cannot mutate the projection. */
        public Map<String, Object> actionSubmission(String action) {
            return copyMap(submissions.get(action));
        }
    }

    /** Versioned host projection; availability is never recomputed by the IDE. */
    public static final class TimelineProjection {
        public final String sessionId;
        public final String revision;
        public final List<TimelineEntry> entries;

        TimelineProjection(String sessionId, String revision, List<TimelineEntry> entries) {
            this.sessionId = sessionId;
            this.revision = revision;
            this.entries = entries;
        }

        /** Small shared shape consumed by renderers and cross-host fixtures. */
        public Map<String, Object> hostProjection() {
            Map<String, Object> root = new LinkedHashMap<String, Object>();
            root.put("sessionId", sessionId);
            root.put("revision", revision);
            List<Object> rows = new ArrayList<Object>();
            for (TimelineEntry entry : entries) {
                Map<String, Object> row = new LinkedHashMap<String, Object>();
                row.put("turnId", entry.turnId);
                row.put("coverage", entry.coverage);
                row.put("markerKinds", new ArrayList<String>(entry.markerKinds));
                row.put("enabledActions", new ArrayList<String>(entry.enabledActions));
                row.put("excludedPaths", new ArrayList<String>(entry.excludedPaths));
                row.put("irreversibleSideEffects",
                        new ArrayList<String>(entry.irreversibleSideEffects));
                rows.add(row);
            }
            root.put("entries", rows);
            return root;
        }

        public Map<String, Object> actionSubmission(String turnId, String action) {
            for (TimelineEntry entry : entries) {
                if (entry.turnId.equals(turnId)) return entry.actionSubmission(action);
            }
            return null;
        }
    }

    /** {@code cc checkpoint list -s <session> --json} — newest-first snapshots. */
    public static List<String> buildListArgs(String sessionId) {
        return new ArrayList<String>(Arrays.asList(
                "checkpoint", "list", "-s", orDefault(sessionId), "--json"));
    }

    /**
     * {@code cc checkpoint restore <id> -s <session> --force --json} —
     * auto-snapshots the current state first, then restores. {@code --force}
     * skips the CLI's own interactive confirm because the panel confirms via
     * its chooser selection.
     */
    public static List<String> buildRestoreArgs(String sessionId, String id) {
        return new ArrayList<String>(Arrays.asList(
                "checkpoint", "restore", id == null ? "" : id,
                "-s", orDefault(sessionId), "--force", "--json"));
    }

    /**
     * {@code cc checkpoint show <id> --diff -s <session> --json} — the
     * checkpoint's diff vs the current work tree, for a PREVIEW before
     * restoring (the old flow restored on pick with no way to see what changes).
     */
    public static List<String> buildShowDiffArgs(String sessionId, String id) {
        return new ArrayList<String>(Arrays.asList(
                "checkpoint", "show", id == null ? "" : id,
                "--diff", "-s", orDefault(sessionId), "--json"));
    }

    /** Read-only canonical projection; the CLI remains the sole write authority. */
    public static List<String> buildTimelineArgs(String sessionId) {
        return new ArrayList<String>(Arrays.asList(
                "checkpoint", "timeline", "-s", orDefault(sessionId), "--json"));
    }

    /** Parse the CLI timeline JSON, returning null for any unsupported root contract. */
    public static TimelineProjection parseTimelineProjection(String stdout) {
        Object parsed;
        try {
            parsed = MiniJson.parse(stdout == null ? "" : stdout.trim());
        } catch (RuntimeException e) {
            return null;
        }
        return parseTimelineProjection(parsed);
    }

    /** Object overload lets conformance tests consume one shared fixture without re-encoding it. */
    @SuppressWarnings("unchecked")
    public static TimelineProjection parseTimelineProjection(Object parsed) {
        if (!(parsed instanceof Map)) return null;
        Map<String, Object> root = (Map<String, Object>) parsed;
        if (!TIMELINE_SCHEMA.equals(root.get("schema"))
                || !numberEquals(root.get("version"), TIMELINE_VERSION)
                || !"cli".equals(root.get("authority"))
                || !TIMELINE_ACTION_SCHEMA.equals(root.get("actionSchema"))
                || !(root.get("sessionId") instanceof String)
                || ((String) root.get("sessionId")).isEmpty()
                || !(root.get("revision") instanceof String)
                || ((String) root.get("revision")).isEmpty()
                || !(root.get("entries") instanceof List)
                || ((List<?>) root.get("entries")).size() > MAX_TIMELINE_ENTRIES) {
            return null;
        }

        String sessionId = (String) root.get("sessionId");
        String revision = (String) root.get("revision");
        List<TimelineEntry> entries = new ArrayList<TimelineEntry>();
        for (Object rawEntry : (List<?>) root.get("entries")) {
            if (!(rawEntry instanceof Map)) return null;
            Map<String, Object> source = (Map<String, Object>) rawEntry;
            if (!(source.get("turnId") instanceof String)
                    || ((String) source.get("turnId")).isEmpty()
                    || !TIMELINE_COVERAGES.contains(source.get("coverage"))
                    || !(source.get("markers") instanceof List)
                    || !(source.get("actions") instanceof List)) {
                return null;
            }
            String turnId = (String) source.get("turnId");
            List<String> markerKinds = new ArrayList<String>();
            int markerCount = 0;
            for (Object rawMarker : (List<?>) source.get("markers")) {
                if (markerCount++ >= MAX_TIMELINE_LIST) break;
                if (!(rawMarker instanceof Map)) continue;
                Object kind = ((Map<?, ?>) rawMarker).get("kind");
                if (kind instanceof String && TIMELINE_MARKERS.contains(kind)) {
                    markerKinds.add((String) kind);
                }
            }

            List<String> enabledActions = new ArrayList<String>();
            Map<String, Map<String, Object>> submissions =
                    new LinkedHashMap<String, Map<String, Object>>();
            int actionCount = 0;
            for (Object rawAction : (List<?>) source.get("actions")) {
                if (actionCount++ >= MAX_TIMELINE_LIST) break;
                if (!(rawAction instanceof Map)) continue;
                Map<String, Object> candidate = (Map<String, Object>) rawAction;
                Object actionObject = candidate.get("action");
                if (!(actionObject instanceof String)
                        || !TIMELINE_ACTIONS.contains(actionObject)) continue;
                String action = (String) actionObject;
                Map<String, Object> submission = candidate.get("enabled") == Boolean.TRUE
                        ? validSubmission(candidate.get("submission"), sessionId,
                                revision, turnId, action)
                        : null;
                if (submission != null) {
                    enabledActions.add(action);
                    submissions.put(action, submission);
                }
            }
            entries.add(new TimelineEntry(
                    turnId,
                    (String) source.get("coverage"),
                    markerKinds,
                    enabledActions,
                    boundedStrings(source.get("excludedPaths")),
                    boundedStrings(source.get("irreversibleSideEffects")),
                    submissions));
        }
        return new TimelineProjection(sessionId, revision, entries);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> validSubmission(Object raw, String sessionId,
            String revision, String turnId, String action) {
        if (!(raw instanceof Map)) return null;
        Map<String, Object> submission = (Map<String, Object>) raw;
        if (!TIMELINE_ACTION_SCHEMA.equals(submission.get("schema"))
                || !numberEquals(submission.get("version"), TIMELINE_ACTION_VERSION)
                || !"cli".equals(submission.get("authority"))
                || !revision.equals(submission.get("revision"))
                || !action.equals(submission.get("action"))
                || !sessionId.equals(submission.get("sessionId"))
                || !turnId.equals(submission.get("turnId"))) {
            return null;
        }
        Object checkpointId = submission.get("checkpointId");
        if (checkpointId != null && !(checkpointId instanceof String)) return null;
        Object checkpointIdentity = submission.get("checkpointIdentity");
        boolean needsCheckpointIdentity = "restore-code".equals(action)
                || "restore-both".equals(action);
        if ((needsCheckpointIdentity && !(checkpointIdentity instanceof String))
                || (checkpointIdentity != null
                    && (!(checkpointIdentity instanceof String)
                        || !String.valueOf(checkpointIdentity).matches(
                                "^(?:git:(?:[a-f0-9]{40}|[a-f0-9]{64})"
                                + "|sha256:[a-f0-9]{64})$")))) {
            return null;
        }
        Object offset = submission.get("conversationOffset");
        if (offset != null && (!isNonNegativeInteger(offset))) return null;
        return copyMap(submission);
    }

    /** Serialize the exact embedded envelope for CLI preview/commit. */
    public static List<String> buildTimelineActionArgs(Map<String, Object> submission,
            boolean preview, boolean confirm) {
        if (submission == null || preview == confirm) {
            return new ArrayList<String>();
        }
        Map<String, Object> envelope = submission;
        Object sessionId = submission.get("sessionId");
        if (confirm) {
            envelope = validConfirmation(submission);
            if (envelope == null) return new ArrayList<String>();
            @SuppressWarnings("unchecked")
            Map<String, Object> nested =
                    (Map<String, Object>) envelope.get("submission");
            sessionId = nested.get("sessionId");
        }
        if (!(sessionId instanceof String) || ((String) sessionId).isEmpty()) {
            return new ArrayList<String>();
        }
        return new ArrayList<String>(Arrays.asList(
                "checkpoint", "action", "-s", String.valueOf(sessionId),
                "--submission", MiniJson.stringify(envelope),
                preview ? "--preview" : "--confirm", "--json"));
    }

    /** Native chooser label that makes coverage and marker kinds visible. */
    public static String timelineEntryLabel(TimelineEntry entry) {
        return entry.coverage + "  " + entry.turnId + "  "
                + (entry.markerKinds.isEmpty() ? "no markers"
                        : String.join(" · ", entry.markerKinds));
    }

    public static String timelineActionLabel(String action) {
        if ("restore-code".equals(action)) return "Restore code";
        if ("restore-conversation".equals(action)) return "Restore conversation";
        if ("restore-both".equals(action)) return "Restore code + conversation";
        if ("summary-from".equals(action)) return "Summarize from here";
        if ("summary-to".equals(action)) return "Summarize up to here";
        if ("branch".equals(action)) return "Branch from here";
        return action;
    }

    /** Strict parser for preview/execution output; null on protocol drift. */
    public static Map<String, Object> parseTimelineActionResult(String stdout) {
        Object parsed;
        try {
            parsed = MiniJson.parse(stdout == null ? "" : stdout.trim());
        } catch (RuntimeException e) {
            return null;
        }
        if (!(parsed instanceof Map)) return null;
        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) parsed;
        if (!TIMELINE_RESULT_SCHEMA.equals(result.get("schema"))
                || !numberEquals(result.get("version"), TIMELINE_RESULT_VERSION)
                || !(result.get("ok") instanceof Boolean)) return null;
        if (result.get("ok") == Boolean.TRUE && "preview".equals(result.get("mode"))
                && validConfirmation(result.get("confirmationSubmission")) == null) {
            return null;
        }
        return copyMap(result);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> validConfirmation(Object raw) {
        if (!(raw instanceof Map)) return null;
        Map<String, Object> confirmation = (Map<String, Object>) raw;
        if (!TIMELINE_CONFIRMATION_SCHEMA.equals(confirmation.get("schema"))
                || !numberEquals(confirmation.get("version"), TIMELINE_CONFIRMATION_VERSION)
                || !"cli".equals(confirmation.get("authority"))
                || !(confirmation.get("digest") instanceof String)
                || !String.valueOf(confirmation.get("digest"))
                        .matches("^sha256:[a-f0-9]{64}$")
                || !(confirmation.get("submission") instanceof Map)) {
            return null;
        }
        Set<String> keys = new HashSet<String>(confirmation.keySet());
        if (!keys.equals(new HashSet<String>(Arrays.asList(
                "schema", "version", "authority", "submission", "workspace", "digest")))) {
            return null;
        }
        Map<String, Object> nested = (Map<String, Object>) confirmation.get("submission");
        if (!(nested.get("sessionId") instanceof String)
                || !(nested.get("revision") instanceof String)
                || !(nested.get("turnId") instanceof String)
                || !(nested.get("action") instanceof String)
                || !TIMELINE_ACTIONS.contains(nested.get("action"))
                || validSubmission(
                        nested,
                        (String) nested.get("sessionId"),
                        (String) nested.get("revision"),
                        (String) nested.get("turnId"),
                        (String) nested.get("action")) == null) {
            return null;
        }
        boolean needsWorkspace = "restore-code".equals(nested.get("action"))
                || "restore-both".equals(nested.get("action"));
        Map<String, Object> workspace = validWorkspaceBinding(confirmation.get("workspace"));
        if ((needsWorkspace && workspace == null)
                || (!needsWorkspace && confirmation.get("workspace") != null)) {
            return null;
        }
        return copyMap(confirmation);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> validWorkspaceBinding(Object raw) {
        if (!(raw instanceof Map)) return null;
        Map<String, Object> value = (Map<String, Object>) raw;
        if (!WORKSPACE_BINDING_SCHEMA.equals(value.get("schema"))
                || !numberEquals(value.get("version"), WORKSPACE_BINDING_VERSION)
                || !("git".equals(value.get("engine")) || "copy".equals(value.get("engine")))
                || !digestString(value.get("scopeIdentity"))
                || !digestString(value.get("writePlanIdentity"))) {
            return null;
        }
        String statePattern = "git".equals(value.get("engine"))
                ? "^git-tree:(?:[a-f0-9]{40}|[a-f0-9]{64})$"
                : "^sha256:[a-f0-9]{64}$";
        if (!(value.get("prestateIdentity") instanceof String)
                || !(value.get("targetPoststateIdentity") instanceof String)
                || !String.valueOf(value.get("prestateIdentity")).matches(statePattern)
                || !String.valueOf(value.get("targetPoststateIdentity")).matches(statePattern)) {
            return null;
        }
        Set<String> keys = new HashSet<String>(value.keySet());
        if (!keys.equals(new HashSet<String>(Arrays.asList(
                "schema", "version", "engine", "scopeIdentity",
                "prestateIdentity", "writePlanIdentity", "targetPoststateIdentity")))) {
            return null;
        }
        return copyMap(value);
    }

    private static boolean digestString(Object value) {
        return value instanceof String
                && String.valueOf(value).matches("^sha256:[a-f0-9]{64}$");
    }

    /** Readable body for the preview dialog; warnings are never hidden. */
    @SuppressWarnings("unchecked")
    public static String formatTimelinePreview(Map<String, Object> result) {
        if (result == null || result.get("ok") != Boolean.TRUE
                || !"preview".equals(result.get("mode"))) return "";
        StringBuilder out = new StringBuilder();
        out.append("Checkpoint timeline action: ").append(result.get("action"));
        out.append("\nTurn: ").append(result.get("turnId"));
        out.append("\nCoverage: ").append(result.get("coverage"));
        out.append("\nRevision: ").append(result.get("revision"));
        Object code = result.get("code");
        if (code instanceof Map) {
            Map<String, Object> value = (Map<String, Object>) code;
            out.append("\n\nCode checkpoint: ").append(value.get("checkpointId"));
            appendPreviewList(out, "Modified", value.get("modified"));
            appendPreviewList(out, "Added", value.get("added"));
            appendPreviewList(out, "Deleted", value.get("deleted"));
        }
        Object conversation = result.get("conversation");
        if (conversation instanceof Map) {
            Map<String, Object> value = (Map<String, Object>) conversation;
            out.append("\n\nConversation messages: ")
                    .append(value.get("beforeMessages")).append(" → ")
                    .append(value.get("afterMessages"));
        }
        Object branch = result.get("branch");
        if (branch instanceof Map) {
            out.append("\n\nBranch session: ")
                    .append(((Map<String, Object>) branch).get("branchSessionId"));
        }
        appendPreviewList(out, "Excluded paths", result.get("excludedPaths"));
        appendPreviewList(out, "Irreversible side effects",
                result.get("irreversibleSideEffects"));
        appendPreviewList(out, "Warnings", result.get("warnings"));
        if (branch instanceof Map) {
            appendPreviewList(out, "Branch warnings",
                    ((Map<String, Object>) branch).get("warnings"));
        }
        return out.toString();
    }

    private static void appendPreviewList(StringBuilder out, String label, Object raw) {
        if (!(raw instanceof List) || ((List<?>) raw).isEmpty()) return;
        out.append("\n").append(label).append(": ");
        List<String> values = new ArrayList<String>();
        for (Object value : (List<?>) raw) values.add(String.valueOf(value));
        out.append(String.join(", ", values));
    }

    private static boolean numberEquals(Object value, int expected) {
        return value instanceof Number
                && ((Number) value).doubleValue() == (double) expected;
    }

    private static boolean isNonNegativeInteger(Object value) {
        if (!(value instanceof Number)) return false;
        double number = ((Number) value).doubleValue();
        return Double.isFinite(number) && number >= 0
                && number <= 9007199254740991d && number == Math.floor(number);
    }

    private static List<String> boundedStrings(Object raw) {
        List<String> out = new ArrayList<String>();
        if (!(raw instanceof List)) return out;
        Set<String> seen = new HashSet<String>();
        int count = 0;
        for (Object value : (List<?>) raw) {
            if (count++ >= MAX_TIMELINE_LIST) break;
            if (!(value instanceof String) || ((String) value).isEmpty()
                    || !seen.add((String) value)) continue;
            out.add((String) value);
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> copyMap(Map<String, Object> source) {
        if (source == null) return null;
        return (Map<String, Object>) MiniJson.parse(MiniJson.stringify(source));
    }

    /**
     * Normalize {@code checkpoint show --diff --json} stdout into preview text.
     * The git engine returns {@code { id, diff:"<patch>" }}; the copy-fallback
     * engine has no raw patch and returns a status object
     * {@code { modified, added, deleted }} — both become a readable string.
     * Returns "" when there's nothing to show or the stdout is unusable.
     */
    @SuppressWarnings("unchecked")
    public static String formatDiffPreview(String stdout) {
        Object parsed;
        try {
            parsed = MiniJson.parse(stdout == null ? "" : stdout.trim());
        } catch (RuntimeException e) {
            return "";
        }
        if (!(parsed instanceof Map)) return "";
        Map<String, Object> data = (Map<String, Object>) parsed;
        Object diff = data.get("diff");
        if (diff instanceof String) return ((String) diff).trim();
        StringBuilder sb = new StringBuilder();
        appendList(sb, "modified", data.get("modified"));
        appendList(sb, "added", data.get("added"));
        appendList(sb, "deleted", data.get("deleted"));
        return sb.toString().trim();
    }

    private static void appendList(StringBuilder sb, String label, Object arr) {
        if (!(arr instanceof List) || ((List<?>) arr).isEmpty()) return;
        List<?> list = (List<?>) arr;
        if (sb.length() > 0) sb.append("\n\n");
        sb.append(label).append(" (").append(list.size()).append("):\n");
        for (Object f : list) {
            String rel = f instanceof Map && ((Map<?, ?>) f).get("rel") != null
                    ? String.valueOf(((Map<?, ?>) f).get("rel")) : String.valueOf(f);
            sb.append("  ").append(rel).append("\n");
        }
    }

    /** Tolerant parse of {@code checkpoint list --json} stdout (empty on any mismatch). */
    public static List<Checkpoint> parseCheckpointList(String stdout) {
        List<Checkpoint> out = new ArrayList<Checkpoint>();
        Object parsed;
        try {
            parsed = MiniJson.parse(stdout == null ? "" : stdout.trim());
        } catch (RuntimeException e) {
            return out;
        }
        if (!(parsed instanceof List)) return out;
        for (Object row : (List<?>) parsed) {
            if (!(row instanceof Map)) continue;
            Map<?, ?> c = (Map<?, ?>) row;
            Object id = c.get("id");
            if (!(id instanceof String) || ((String) id).isEmpty()) continue;
            Object created = c.get("createdAt");
            Object label = c.get("label");
            Object files = c.get("fileCount");
            out.add(new Checkpoint(
                    (String) id,
                    created instanceof String ? (String) created : null,
                    label instanceof String ? (String) label : null,
                    files instanceof Number ? Long.valueOf(((Number) files).longValue()) : null));
        }
        return out;
    }

    /** Chooser row: {@code "<id>  ·  <createdAt>  ·  N file(s)  ·  <label>"} (parts optional). */
    public static String itemLabel(Checkpoint c) {
        StringBuilder sb = new StringBuilder(c.id);
        if (c.createdAt != null && !c.createdAt.isEmpty()) sb.append("  ·  ").append(c.createdAt);
        if (c.fileCount != null) sb.append("  ·  ").append(c.fileCount).append(" file(s)");
        if (c.label != null && !c.label.isEmpty()) sb.append("  ·  ").append(c.label);
        return sb.toString();
    }

    /** Did {@code checkpoint restore --json} succeed? (stdout parses as a JSON object) */
    public static boolean restoreOk(String stdout) {
        try {
            MiniJson.parseObject(stdout == null ? "" : stdout.trim());
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** Restored-file count from {@code checkpoint restore --json} stdout (null when absent). */
    public static Integer restoredCount(String stdout) {
        Map<String, Object> data;
        try {
            data = MiniJson.parseObject(stdout == null ? "" : stdout.trim());
        } catch (RuntimeException e) {
            return null;
        }
        Object n = data.get("restoredCount");
        if (n == null) n = data.get("restored");
        return n instanceof Number ? Integer.valueOf(((Number) n).intValue()) : null;
    }

    private static String orDefault(String sessionId) {
        return sessionId == null || sessionId.isEmpty() ? "default" : sessionId;
    }
}
