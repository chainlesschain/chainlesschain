package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Fail-closed parser for {@code cc automation center-projection --json}. */
public final class AutomationCenter {

    private AutomationCenter() {}

    public static final String SCHEMA = "chainlesschain.automation-center/v3";
    public static final int SCHEMA_VERSION = 3;
    public static final String LEGACY_SCHEMA = "chainlesschain.automation-center/v2";
    public static final int LEGACY_SCHEMA_VERSION = 2;
    public static final List<String> FLOW_ACTIONS = List.of(
            "run_now", "retry_failed", "pause", "resume", "disable", "delete");
    public static final List<String> ROUTINE_ACTIONS = List.of(
            "run_now", "retry_failed", "pause", "resume", "disable", "delete", "edit");
    public static final List<String> ACTIONS = ROUTINE_ACTIONS;
    private static final Set<String> KINDS = Set.of("flow", "routine");
    private static final Set<String> STATUS = Set.of("draft", "active", "paused", "archived");
    private static final Set<String> SECURITY = Set.of(
            "ready", "denied", "unconfigured", "invalid", "snapshot_bound");
    private static final Set<String> INCIDENT_CATEGORIES = Set.of(
            "permission", "connector", "budget", "write_scope");
    private static final Set<String> INCIDENT_STATUSES = Set.of(
            "open", "resolved", "cancelled");
    public static final List<String> INCIDENT_ACTIONS = List.of("retry", "cancel");
    private static final Pattern INCIDENT_ID = Pattern.compile("^[0-9a-f]{64}$");
    private static final Pattern INCIDENT_CODE = Pattern.compile("^[A-Z][A-Z0-9_]{0,127}$");
    private static final Pattern INCIDENT_TRIGGER = Pattern.compile("^[a-z][a-z0-9_-]{0,31}$");
    private static final int MAX_INCIDENTS = 100;
    public static final String RUNTIME_SCHEMA =
            "chainlesschain.automation-center-runtime/v1";
    public static final int RUNTIME_SCHEMA_VERSION = 1;
    public static final List<String> RUNTIME_ACTIONS = List.of("pause", "resume");
    private static final Set<String> RUNTIME_JOB_KINDS = Set.of(
            "agenda", "automation", "automation-event", "cowork-cron",
            "loop-iteration", "routine");
    private static final Set<String> RUNTIME_STATUSES = Set.of(
            "running", "pause_requested", "paused");
    private static final Set<String> RUNTIME_OCCURRENCE_STATUSES = Set.of(
            "running", "retry_wait");
    private static final Set<String> RUNTIME_SAFE_POINTS = Set.of(
            "before_execute", "adapter_checkpoint");
    private static final int MAX_RUNTIME_ITEMS = 200;
    private static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;

    public static final class ActionPreview {
        public final List<String> argv;
        public final boolean jsonStdin;

        private ActionPreview(List<String> argv, boolean jsonStdin) {
            this.argv = Collections.unmodifiableList(new ArrayList<String>(argv));
            this.jsonStdin = jsonStdin;
        }
    }

    public static final class Action {
        public final boolean available;
        public final String reason;
        public final ActionPreview preview;

        private Action(boolean available, String reason, ActionPreview preview) {
            this.available = available;
            this.reason = reason == null ? "" : reason;
            this.preview = preview;
        }
    }

    /** Sanitized run incident with only CLI-produced revision-gated actions. */
    public static final class Incident {
        public final String incidentId;
        public final String runId;
        public final String occurrenceId;
        public final String triggerType;
        public final String category;
        public final String code;
        public final String status;
        public final long revision;
        public final long createdAtMs;
        public final long updatedAtMs;
        public final Map<String, Action> actions;

        private Incident(String incidentId, String runId, String occurrenceId,
                String triggerType, String category, String code, String status,
                long revision, long createdAtMs, long updatedAtMs,
                Map<String, Action> actions) {
            this.incidentId = incidentId;
            this.runId = runId;
            this.occurrenceId = occurrenceId;
            this.triggerType = triggerType;
            this.category = category;
            this.code = code;
            this.status = status;
            this.revision = revision;
            this.createdAtMs = createdAtMs;
            this.updatedAtMs = updatedAtMs;
            this.actions = Collections.unmodifiableMap(
                    new LinkedHashMap<String, Action>(actions));
        }
    }

    /** Bounded live scheduler occurrence; payload and execution evidence never enter it. */
    public static final class RuntimeItem {
        public final String id;
        public final String jobId;
        public final String jobKind;
        public final String status;
        public final String occurrenceStatus;
        public final long scheduledFor;
        public final long attempt;
        public final long maxAttempts;
        public final long fence;
        public final long controlRevision;
        public final long createdAt;
        public final long updatedAt;
        public final List<String> safePoints;
        public final Map<String, Action> actions;

        private RuntimeItem(String id, String jobId, String jobKind, String status,
                String occurrenceStatus, long scheduledFor, long attempt,
                long maxAttempts, long fence, long controlRevision,
                long createdAt, long updatedAt, List<String> safePoints,
                Map<String, Action> actions) {
            this.id = id;
            this.jobId = jobId;
            this.jobKind = jobKind;
            this.status = status;
            this.occurrenceStatus = occurrenceStatus;
            this.scheduledFor = scheduledFor;
            this.attempt = attempt;
            this.maxAttempts = maxAttempts;
            this.fence = fence;
            this.controlRevision = controlRevision;
            this.createdAt = createdAt;
            this.updatedAt = updatedAt;
            this.safePoints = Collections.unmodifiableList(
                    new ArrayList<String>(safePoints));
            this.actions = Collections.unmodifiableMap(
                    new LinkedHashMap<String, Action>(actions));
        }
    }

    public static final class Item {
        public final String kind;
        public final String id;
        public final String revision;
        public final String name;
        public final String description;
        public final String status;
        public final String schedule;
        public final String securityState;
        public final boolean ready;
        public final String principalId;
        public final long remainingRuns;
        public final long remainingActionSteps;
        public final String issue;
        public final List<String> triggers;
        public final List<String> history;
        public final List<Incident> incidents;
        public final Map<String, Action> actions;
        public final Map<String, Object> definition;

        private Item(String kind, String id, String revision, String name,
                String description, String status, String schedule,
                String securityState, boolean ready, String principalId,
                long remainingRuns, long remainingActionSteps, String issue,
                List<String> triggers, List<String> history, List<Incident> incidents,
                Map<String, Action> actions, Map<String, Object> definition) {
            this.kind = kind;
            this.id = id;
            this.revision = revision;
            this.name = name;
            this.description = description;
            this.status = status;
            this.schedule = schedule;
            this.securityState = securityState;
            this.ready = ready;
            this.principalId = principalId;
            this.remainingRuns = remainingRuns;
            this.remainingActionSteps = remainingActionSteps;
            this.issue = issue;
            this.triggers = Collections.unmodifiableList(new ArrayList<String>(triggers));
            this.history = Collections.unmodifiableList(new ArrayList<String>(history));
            this.incidents = Collections.unmodifiableList(new ArrayList<Incident>(incidents));
            this.actions = Collections.unmodifiableMap(new LinkedHashMap<String, Action>(actions));
            this.definition = definition == null
                    ? Collections.emptyMap()
                    : Collections.unmodifiableMap(new LinkedHashMap<String, Object>(definition));
        }
    }

    /** Compatibility name retained for callers while the collection now holds both kinds. */
    public static final class Flow {
        private Flow() {}
    }

    public static final class Snapshot {
        public final boolean connected;
        public final boolean stale;
        public final String revision;
        public final String routineCatalogRevision;
        public final String error;
        public final long total;
        public final long flowCount;
        public final long routineCount;
        public final long active;
        public final long paused;
        public final long needsAttention;
        public final long runtimeRunning;
        public final long runtimePauseRequested;
        public final long runtimePaused;
        public final List<Item> items;
        public final List<Item> flows;
        public final List<RuntimeItem> runtimeItems;
        public final ActionPreview createRoutine;

        private Snapshot(boolean connected, boolean stale, String revision,
                String routineCatalogRevision, String error, long total,
                long flowCount, long routineCount, long active, long paused,
                long needsAttention, long runtimeRunning,
                long runtimePauseRequested, long runtimePaused,
                List<Item> items, List<RuntimeItem> runtimeItems,
                ActionPreview createRoutine) {
            this.connected = connected;
            this.stale = stale;
            this.revision = revision == null ? "" : revision;
            this.routineCatalogRevision = routineCatalogRevision == null
                    ? "" : routineCatalogRevision;
            this.error = error == null ? "" : error;
            this.total = total;
            this.flowCount = flowCount;
            this.routineCount = routineCount;
            this.active = active;
            this.paused = paused;
            this.needsAttention = needsAttention;
            this.runtimeRunning = runtimeRunning;
            this.runtimePauseRequested = runtimePauseRequested;
            this.runtimePaused = runtimePaused;
            this.items = Collections.unmodifiableList(new ArrayList<Item>(items));
            this.flows = this.items;
            this.runtimeItems = Collections.unmodifiableList(
                    new ArrayList<RuntimeItem>(runtimeItems));
            this.createRoutine = createRoutine;
        }
    }

    public static Snapshot parse(String json) {
        return parse(json, null);
    }

    @SuppressWarnings("unchecked")
    public static Snapshot parse(String json, String expectedRevision) {
        final Map<String, Object> root;
        try {
            root = MiniJson.parseObject(json == null ? "" : json);
        } catch (RuntimeException error) {
            return disconnected("invalid Automation Center JSON", false, "");
        }
        String revision = text(root.get("revision"), 96);
        boolean v3 = SCHEMA.equals(text(root.get("schema"), 96))
                && number(root.get("schemaVersion")) == SCHEMA_VERSION;
        boolean v2 = LEGACY_SCHEMA.equals(text(root.get("schema"), 96))
                && number(root.get("schemaVersion")) == LEGACY_SCHEMA_VERSION;
        if ((!v3 && !v2)
                || !"cli".equals(text(root.get("authority"), 16))) {
            return disconnected("unsupported or non-CLI Automation Center projection",
                    false, revision);
        }
        if (!Boolean.TRUE.equals(root.get("connected")) || revision.isEmpty()
                || !(root.get("items") instanceof List)) {
            return disconnected("Automation Center disconnected", false, revision);
        }
        if (expectedRevision != null && !expectedRevision.isEmpty()
                && !expectedRevision.equals(revision)) {
            return disconnected("stale Automation Center projection", true, revision);
        }
        try {
            String catalogRevision = text(root.get("routineCatalogRevision"), 96);
            if (catalogRevision.isEmpty() || !(root.get("mutations") instanceof Map)) {
                throw new IllegalArgumentException();
            }
            Map<String, Object> mutations = (Map<String, Object>) root.get("mutations");
            ActionPreview createRoutine = parseCreateRoutine(
                    mutations.get("createRoutine"), catalogRevision);
            if (createRoutine == null) throw new IllegalArgumentException();
            if (v2 && root.get("runtime") != null) {
                throw new IllegalArgumentException();
            }
            List<RuntimeItem> runtimeItems = v3
                    ? parseRuntimeItems(root.get("runtime")) : List.of();

            List<Item> items = new ArrayList<Item>();
            Set<String> keys = new LinkedHashSet<String>();
            Set<String> incidentIds = new LinkedHashSet<String>();
            for (Object rawItem : (List<Object>) root.get("items")) {
                if (!(rawItem instanceof Map)) throw new IllegalArgumentException();
                Map<String, Object> item = (Map<String, Object>) rawItem;
                String kind = text(item.get("kind"), 16);
                String id = text(item.get("id"), 256);
                String itemRevision = text(item.get("revision"), 96);
                String status = text(item.get("status"), 32);
                if (!KINDS.contains(kind) || id.isEmpty() || itemRevision.isEmpty()
                        || !keys.add(kind + "\0" + id) || !STATUS.contains(status)
                        || !(item.get("security") instanceof Map)
                        || !(item.get("triggers") instanceof List)
                        || !(item.get("history") instanceof List)
                        || !(item.get("actions") instanceof List)) {
                    throw new IllegalArgumentException();
                }
                Map<String, Object> security = (Map<String, Object>) item.get("security");
                String securityState = text(security.get("state"), 32);
                if (!SECURITY.contains(securityState)) throw new IllegalArgumentException();
                Map<String, Object> budget = security.get("budget") instanceof Map
                        ? (Map<String, Object>) security.get("budget") : Map.of();
                Map<String, Object> issue = security.get("issue") instanceof Map
                        ? (Map<String, Object>) security.get("issue") : Map.of();
                List<String> required = "routine".equals(kind)
                        ? ROUTINE_ACTIONS : FLOW_ACTIONS;
                Set<String> allowed = Set.copyOf(required);
                Map<String, Action> actions = new LinkedHashMap<String, Action>();
                Set<String> seen = new LinkedHashSet<String>();
                for (Object rawAction : (List<Object>) item.get("actions")) {
                    if (!(rawAction instanceof Map)) continue;
                    Map<String, Object> value = (Map<String, Object>) rawAction;
                    String actionId = text(value.get("id"), 32);
                    if (!allowed.contains(actionId) || !seen.add(actionId)) continue;
                    boolean available = Boolean.TRUE.equals(value.get("available"));
                    ActionPreview preview = available
                            ? parsePreview(value.get("preview"), kind, id,
                                    actionId, itemRevision)
                            : null;
                    if ((available && preview == null)
                            || (!available && value.get("preview") != null)) {
                        throw new IllegalArgumentException();
                    }
                    actions.put(actionId, new Action(available,
                            text(value.get("reason"), 240), preview));
                }
                if (actions.size() != required.size()) throw new IllegalArgumentException();
                if (v3 && "flow".equals(kind)
                        && !(item.get("incidents") instanceof List)) {
                    throw new IllegalArgumentException();
                }
                if (v2 && item.get("incidents") != null
                        && (!(item.get("incidents") instanceof List)
                                || !((List<Object>) item.get("incidents")).isEmpty())) {
                    throw new IllegalArgumentException();
                }
                Map<String, Object> definition = null;
                if ("routine".equals(kind)) {
                    if (!(item.get("definition") instanceof Map)) {
                        throw new IllegalArgumentException();
                    }
                    definition = (Map<String, Object>) item.get("definition");
                    if (text(definition.get("name"), 512).isEmpty()
                            || text(definition.get("prompt"), 65536).isEmpty()
                            || !(definition.get("trigger") instanceof Map)) {
                        throw new IllegalArgumentException();
                    }
                }
                items.add(new Item(
                        kind, id, itemRevision,
                        fallback(text(item.get("name"), 200), id),
                        text(item.get("description"), 500), status,
                        text(item.get("schedule"), 240), securityState,
                        Boolean.TRUE.equals(security.get("ready")),
                        text(security.get("principalId"), 256),
                        number(budget.get("remainingRuns")),
                        number(budget.get("remainingActionSteps")),
                        text(issue.get("code"), 96),
                        triggerLines((List<Object>) item.get("triggers")),
                        historyLines((List<Object>) item.get("history")),
                        v3 ? incidentItems(item.get("incidents"), incidentIds)
                                : List.of(),
                        actions, definition));
            }
            Map<String, Object> summary = root.get("summary") instanceof Map
                    ? (Map<String, Object>) root.get("summary") : Map.of();
            long total = number(summary.get("total"));
            long flowCount = number(summary.get("flows"));
            long routineCount = number(summary.get("routines"));
            long runtimeRunning = v3
                    ? strictInteger(summary.get("runtimeRunning"), 0) : 0;
            long runtimePauseRequested = v3
                    ? strictInteger(summary.get("runtimePauseRequested"), 0) : 0;
            long runtimePaused = v3
                    ? strictInteger(summary.get("runtimePaused"), 0) : 0;
            if (total != items.size()
                    || flowCount != items.stream().filter(i -> "flow".equals(i.kind)).count()
                    || routineCount != items.stream().filter(i -> "routine".equals(i.kind)).count()
                    || runtimeRunning != runtimeItems.stream()
                            .filter(i -> "running".equals(i.status)).count()
                    || runtimePauseRequested != runtimeItems.stream()
                            .filter(i -> "pause_requested".equals(i.status)).count()
                    || runtimePaused != runtimeItems.stream()
                            .filter(i -> "paused".equals(i.status)).count()) {
                throw new IllegalArgumentException();
            }
            return new Snapshot(true, false, revision, catalogRevision, "",
                    total, flowCount, routineCount, number(summary.get("active")),
                    number(summary.get("paused")), number(summary.get("needsAttention")),
                    runtimeRunning, runtimePauseRequested, runtimePaused,
                    items, runtimeItems, createRoutine);
        } catch (RuntimeException error) {
            return disconnected("malformed Automation Center projection", false, revision);
        }
    }

    public static ActionPreview preview(Snapshot snapshot, String kind,
            String itemId, String action, String requestRevision,
            String itemRevision) {
        if (snapshot == null || !snapshot.connected
                || !snapshot.revision.equals(requestRevision)) return null;
        for (Item item : snapshot.items) {
            if (item.kind.equals(kind) && item.id.equals(itemId)
                    && item.revision.equals(itemRevision)) {
                Action value = item.actions.get(action);
                return value != null && value.available ? value.preview : null;
            }
        }
        return null;
    }

    public static ActionPreview recheck(Snapshot rendered, Snapshot current,
            String kind, String itemId, String action, String requestRevision,
            String itemRevision) {
        if (preview(rendered, kind, itemId, action, requestRevision, itemRevision) == null
                || current == null || !current.connected) return null;
        return preview(current, kind, itemId, action,
                current.revision, itemRevision);
    }

    public static ActionPreview previewRuntime(Snapshot snapshot,
            String occurrenceId, String action, String requestRevision,
            long fence, long controlRevision) {
        if (snapshot == null || !snapshot.connected
                || !snapshot.revision.equals(requestRevision)
                || !RUNTIME_ACTIONS.contains(action)) return null;
        for (RuntimeItem item : snapshot.runtimeItems) {
            if (item.id.equals(occurrenceId) && item.fence == fence
                    && item.controlRevision == controlRevision) {
                Action value = item.actions.get(action);
                return value != null && value.available ? value.preview : null;
            }
        }
        return null;
    }

    public static ActionPreview recheckRuntime(Snapshot rendered, Snapshot current,
            String occurrenceId, String action, String requestRevision,
            long fence, long controlRevision) {
        ActionPreview prior = previewRuntime(rendered, occurrenceId, action,
                requestRevision, fence, controlRevision);
        if (prior == null || current == null || !current.connected) return null;
        ActionPreview next = previewRuntime(current, occurrenceId, action,
                current.revision, fence, controlRevision);
        return samePreview(prior, next) ? next : null;
    }

    public static ActionPreview previewIncident(Snapshot snapshot,
            String incidentId, String action, String requestRevision,
            long incidentRevision) {
        if (snapshot == null || !snapshot.connected
                || !snapshot.revision.equals(requestRevision)
                || !INCIDENT_ACTIONS.contains(action)) return null;
        for (Item item : snapshot.items) {
            for (Incident incident : item.incidents) {
                if (incident.incidentId.equals(incidentId)
                        && incident.revision == incidentRevision) {
                    Action value = incident.actions.get(action);
                    return value != null && value.available ? value.preview : null;
                }
            }
        }
        return null;
    }

    public static ActionPreview recheckIncident(Snapshot rendered,
            Snapshot current, String incidentId, String action,
            String requestRevision, long incidentRevision) {
        ActionPreview prior = previewIncident(rendered, incidentId, action,
                requestRevision, incidentRevision);
        if (prior == null || current == null || !current.connected) return null;
        ActionPreview next = previewIncident(current, incidentId, action,
                current.revision, incidentRevision);
        return samePreview(prior, next) ? next : null;
    }

    private static boolean samePreview(ActionPreview left, ActionPreview right) {
        return left != null && right != null && !left.jsonStdin && !right.jsonStdin
                && left.argv.equals(right.argv);
    }

    public static ActionPreview recheckCreateRoutine(
            Snapshot rendered, Snapshot current) {
        if (rendered == null || current == null || !rendered.connected
                || !current.connected
                || !rendered.routineCatalogRevision.equals(
                        current.routineCatalogRevision)) return null;
        return current.createRoutine;
    }

    public static List<Item> filter(List<Item> items, String query) {
        String needle = text(query, 200).trim().toLowerCase();
        if (needle.isEmpty()) return new ArrayList<Item>(items == null ? List.of() : items);
        List<Item> result = new ArrayList<Item>();
        if (items == null) return result;
        for (Item item : items) {
            StringBuilder haystack = new StringBuilder(item.kind).append(' ')
                    .append(item.name).append(' ').append(item.id).append(' ')
                    .append(item.status).append(' ').append(item.securityState)
                    .append(' ').append(item.schedule);
            for (Incident incident : item.incidents) {
                haystack.append(' ').append(incident.runId)
                        .append(' ').append(incident.occurrenceId)
                        .append(' ').append(incident.triggerType)
                        .append(' ').append(incident.category)
                        .append(' ').append(incident.code)
                        .append(' ').append(incident.status);
            }
            if (haystack.toString().toLowerCase().contains(needle)) result.add(item);
        }
        return result;
    }

    public static List<RuntimeItem> filterRuntime(
            List<RuntimeItem> items, String query) {
        String needle = text(query, 200).trim().toLowerCase();
        if (needle.isEmpty()) {
            return new ArrayList<RuntimeItem>(items == null ? List.of() : items);
        }
        List<RuntimeItem> result = new ArrayList<RuntimeItem>();
        if (items == null) return result;
        for (RuntimeItem item : items) {
            String haystack = String.join(" ", item.id, item.jobId, item.jobKind,
                    item.status, item.occurrenceStatus,
                    String.join(" ", item.safePoints)).toLowerCase();
            if (haystack.contains(needle)) result.add(item);
        }
        return result;
    }

    public static String detail(Item item) {
        if (item == null) return "";
        StringBuilder out = new StringBuilder();
        out.append(item.name).append("\n")
                .append(item.kind).append(" · ").append(item.id)
                .append(" · ").append(item.status);
        if (!item.schedule.isEmpty()) out.append(" · ").append(item.schedule);
        out.append("\nPreflight: ").append(item.securityState);
        if (!item.principalId.isEmpty()) out.append(" · principal ").append(item.principalId);
        if (item.ready && !"routine".equals(item.kind)) out.append(" · ")
                .append(item.remainingRuns).append(" runs / ")
                .append(item.remainingActionSteps).append(" steps left");
        if (!item.issue.isEmpty()) out.append(" · ").append(item.issue);
        out.append("\nTriggers: ").append(item.triggers.isEmpty()
                ? "none" : String.join("; ", item.triggers));
        out.append("\n\nIncidents:");
        if (item.incidents.isEmpty()) out.append(" none");
        else for (Incident incident : item.incidents) {
            out.append("\n  [").append(incident.status).append("] ")
                    .append(incident.category).append(" · ").append(incident.code)
                    .append(" · run ").append(incident.runId);
            if (!incident.occurrenceId.isEmpty()) {
                out.append(" · occurrence ").append(incident.occurrenceId);
            }
            List<String> availableActions = new ArrayList<String>();
            for (String action : INCIDENT_ACTIONS) {
                Action value = incident.actions.get(action);
                if (value != null && value.available) availableActions.add(action);
            }
            if (!availableActions.isEmpty()) {
                out.append(" · actions ").append(String.join(", ", availableActions));
            }
        }
        out.append("\n\nRun history:");
        if (item.history.isEmpty()) out.append(" none");
        else for (String line : item.history) out.append("\n  ").append(line);
        return out.toString();
    }

    public static String runtimeDetail(RuntimeItem item) {
        if (item == null) return "No live occurrence.";
        return "Live occurrence\n" + item.id + " · " + item.jobKind
                + " · " + item.status + "\nJob: " + item.jobId
                + "\nFence " + item.fence + " · control revision "
                + item.controlRevision + " · attempt " + item.attempt + "/"
                + item.maxAttempts + "\nSafe points: "
                + (item.safePoints.isEmpty()
                        ? "unsupported" : String.join(", ", item.safePoints));
    }

    @SuppressWarnings("unchecked")
    private static ActionPreview parseCreateRoutine(Object raw, String revision) {
        if (!(raw instanceof Map)) return null;
        Map<String, Object> action = (Map<String, Object>) raw;
        if (!Boolean.TRUE.equals(action.get("available"))
                || action.get("reason") != null) return null;
        List<String> expected = List.of("automation", "center-routine-create",
                "--expected-revision", revision, "--json-stdin", "--json");
        return parseExactPreview(action.get("preview"), expected, true);
    }

    private static List<String> expectedAction(String kind, String id,
            String action, String revision) {
        if ("flow".equals(kind)) return List.of("automation", "center-action", id,
                action, "--expected-revision", revision, "--json");
        if ("edit".equals(action)) return List.of("automation", "center-routine-edit", id,
                "--expected-revision", revision, "--json-stdin", "--json");
        return List.of("automation", "center-routine-action", id, action,
                "--expected-revision", revision, "--json");
    }

    private static ActionPreview parsePreview(Object raw, String kind,
            String id, String action, String revision) {
        return parseExactPreview(raw, expectedAction(kind, id, action, revision),
                "routine".equals(kind) && "edit".equals(action));
    }

    @SuppressWarnings("unchecked")
    private static ActionPreview parseExactPreview(Object raw,
            List<String> expected, boolean jsonStdin) {
        if (!(raw instanceof Map)) return null;
        Map<String, Object> value = (Map<String, Object>) raw;
        if (!"cli".equals(text(value.get("executor"), 16))
                || !Boolean.TRUE.equals(value.get("mutates"))
                || (jsonStdin ? !"json".equals(value.get("stdin"))
                        : value.get("stdin") != null)
                || !(value.get("argv") instanceof List)) return null;
        List<Object> argv = (List<Object>) value.get("argv");
        if (argv.size() != expected.size()) return null;
        for (int i = 0; i < expected.size(); i++) {
            if (!expected.get(i).equals(argv.get(i))) return null;
        }
        return new ActionPreview(expected, jsonStdin);
    }

    @SuppressWarnings("unchecked")
    private static List<Incident> incidentItems(Object rawValue,
            Set<String> globalIds) {
        if (rawValue == null) return List.of();
        if (!(rawValue instanceof List)) throw new IllegalArgumentException();
        List<Object> values = (List<Object>) rawValue;
        if (values.size() > MAX_INCIDENTS) throw new IllegalArgumentException();
        List<Incident> result = new ArrayList<Incident>();
        for (Object raw : values) {
            if (!(raw instanceof Map)) throw new IllegalArgumentException();
            Map<String, Object> value = (Map<String, Object>) raw;
            requireExactKeys(value, "incidentId", "runId", "occurrenceId",
                    "triggerType", "category", "code", "status", "revision",
                    "createdAtMs", "updatedAtMs", "actions");
            String incidentId = incidentText(value.get("incidentId"), 64, false);
            String runId = incidentText(value.get("runId"), 256, false);
            String occurrenceId = incidentText(value.get("occurrenceId"), 256, true);
            String triggerType = incidentText(value.get("triggerType"), 32, false);
            String category = incidentText(value.get("category"), 32, false);
            String code = incidentText(value.get("code"), 128, false);
            String status = incidentText(value.get("status"), 16, false);
            long revision = strictInteger(value.get("revision"), 1);
            long createdAtMs = strictInteger(value.get("createdAtMs"), 0);
            long updatedAtMs = strictInteger(value.get("updatedAtMs"), 0);
            if (!INCIDENT_ID.matcher(incidentId).matches()
                    || !globalIds.add(incidentId)
                    || !INCIDENT_TRIGGER.matcher(triggerType).matches()
                    || !INCIDENT_CATEGORIES.contains(category)
                    || !INCIDENT_CODE.matcher(code).matches()
                    || !INCIDENT_STATUSES.contains(status)
                    || updatedAtMs < createdAtMs) {
                throw new IllegalArgumentException();
            }
            Map<String, Action> actions = parseIncidentActions(
                    value.get("actions"), incidentId, occurrenceId,
                    triggerType, status, revision);
            result.add(new Incident(incidentId, runId, occurrenceId, triggerType,
                    category, code, status, revision, createdAtMs, updatedAtMs,
                    actions));
        }
        return result;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Action> parseIncidentActions(Object rawValue,
            String incidentId, String occurrenceId, String triggerType,
            String status, long revision) {
        if (!(rawValue instanceof List)
                || ((List<Object>) rawValue).size() != INCIDENT_ACTIONS.size()) {
            throw new IllegalArgumentException();
        }
        Map<String, Action> actions = new LinkedHashMap<String, Action>();
        boolean schedulerBacked = !occurrenceId.isEmpty()
                && Set.of("schedule", "event").contains(triggerType);
        for (Object raw : (List<Object>) rawValue) {
            if (!(raw instanceof Map)) throw new IllegalArgumentException();
            Map<String, Object> value = (Map<String, Object>) raw;
            requireExactKeys(value, "id", "available", "reason", "preview");
            String action = incidentText(value.get("id"), 16, false);
            if (!INCIDENT_ACTIONS.contains(action) || actions.containsKey(action)
                    || !(value.get("available") instanceof Boolean)) {
                throw new IllegalArgumentException();
            }
            boolean available = Boolean.TRUE.equals(value.get("available"));
            boolean expectedAvailable = "open".equals(status)
                    && ("cancel".equals(action) || schedulerBacked);
            if (available != expectedAvailable) throw new IllegalArgumentException();
            List<String> expected = List.of("automation", "center-incident-action",
                    incidentId, action, "--expected-revision",
                    String.valueOf(revision), "--json");
            ActionPreview preview = available
                    ? parseStrictPreview(value.get("preview"), expected) : null;
            String reason = available ? ""
                    : incidentText(value.get("reason"), 240, false);
            if ((available && (value.get("reason") != null || preview == null))
                    || (!available && value.get("preview") != null)) {
                throw new IllegalArgumentException();
            }
            actions.put(action, new Action(available, reason, preview));
        }
        if (actions.size() != INCIDENT_ACTIONS.size()) {
            throw new IllegalArgumentException();
        }
        return actions;
    }

    @SuppressWarnings("unchecked")
    private static List<RuntimeItem> parseRuntimeItems(Object rawValue) {
        if (!(rawValue instanceof Map)) throw new IllegalArgumentException();
        Map<String, Object> runtime = (Map<String, Object>) rawValue;
        requireExactKeys(runtime, "schema", "schemaVersion", "items");
        if (!RUNTIME_SCHEMA.equals(runtime.get("schema"))
                || strictInteger(runtime.get("schemaVersion"), 1)
                        != RUNTIME_SCHEMA_VERSION
                || !(runtime.get("items") instanceof List)) {
            throw new IllegalArgumentException();
        }
        List<Object> values = (List<Object>) runtime.get("items");
        if (values.size() > MAX_RUNTIME_ITEMS) throw new IllegalArgumentException();
        List<RuntimeItem> result = new ArrayList<RuntimeItem>();
        Set<String> ids = new LinkedHashSet<String>();
        for (Object raw : values) {
            if (!(raw instanceof Map)) throw new IllegalArgumentException();
            Map<String, Object> value = (Map<String, Object>) raw;
            requireExactKeys(value, "id", "jobId", "jobKind", "status",
                    "occurrenceStatus", "scheduledFor", "attempt", "maxAttempts",
                    "fence", "controlRevision", "createdAt", "updatedAt",
                    "runtimeControl", "actions");
            String id = incidentText(value.get("id"), 256, false);
            String jobId = incidentText(value.get("jobId"), 256, false);
            String jobKind = incidentText(value.get("jobKind"), 32, false);
            String status = incidentText(value.get("status"), 32, false);
            String occurrenceStatus = incidentText(
                    value.get("occurrenceStatus"), 32, false);
            long scheduledFor = strictInteger(value.get("scheduledFor"), 0);
            long attempt = strictInteger(value.get("attempt"), 1);
            long maxAttempts = strictInteger(value.get("maxAttempts"), 1);
            long fence = strictInteger(value.get("fence"), 1);
            long controlRevision = strictInteger(
                    value.get("controlRevision"), 0);
            long createdAt = strictInteger(value.get("createdAt"), 0);
            long updatedAt = strictInteger(value.get("updatedAt"), 0);
            if (!ids.add(id) || !RUNTIME_JOB_KINDS.contains(jobKind)
                    || !RUNTIME_STATUSES.contains(status)
                    || !RUNTIME_OCCURRENCE_STATUSES.contains(occurrenceStatus)
                    || ("paused".equals(status)
                            ? !"retry_wait".equals(occurrenceStatus)
                            : !"running".equals(occurrenceStatus))
                    || attempt > maxAttempts || updatedAt < createdAt) {
                throw new IllegalArgumentException();
            }
            List<String> safePoints = parseRuntimeControl(
                    value.get("runtimeControl"));
            Map<String, Action> actions = parseRuntimeActions(
                    value.get("actions"), id, status, fence,
                    controlRevision, !safePoints.isEmpty());
            result.add(new RuntimeItem(id, jobId, jobKind, status,
                    occurrenceStatus, scheduledFor, attempt, maxAttempts,
                    fence, controlRevision, createdAt, updatedAt,
                    safePoints, actions));
        }
        return result;
    }

    @SuppressWarnings("unchecked")
    private static List<String> parseRuntimeControl(Object rawValue) {
        if (rawValue == null) return List.of();
        if (!(rawValue instanceof Map)) throw new IllegalArgumentException();
        Map<String, Object> value = (Map<String, Object>) rawValue;
        requireExactKeys(value, "pauseResume", "safePoints");
        if (!"checkpoint_v1".equals(value.get("pauseResume"))
                || !(value.get("safePoints") instanceof List)) {
            throw new IllegalArgumentException();
        }
        List<Object> rawPoints = (List<Object>) value.get("safePoints");
        if (rawPoints.isEmpty() || rawPoints.size() > RUNTIME_SAFE_POINTS.size()) {
            throw new IllegalArgumentException();
        }
        List<String> safePoints = new ArrayList<String>();
        for (Object raw : rawPoints) {
            String point = incidentText(raw, 32, false);
            if (!RUNTIME_SAFE_POINTS.contains(point) || safePoints.contains(point)) {
                throw new IllegalArgumentException();
            }
            safePoints.add(point);
        }
        return safePoints;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Action> parseRuntimeActions(Object rawValue,
            String occurrenceId, String status, long fence,
            long controlRevision, boolean supported) {
        if (!(rawValue instanceof List)
                || ((List<Object>) rawValue).size() != RUNTIME_ACTIONS.size()) {
            throw new IllegalArgumentException();
        }
        Map<String, Action> actions = new LinkedHashMap<String, Action>();
        for (Object raw : (List<Object>) rawValue) {
            if (!(raw instanceof Map)) throw new IllegalArgumentException();
            Map<String, Object> value = (Map<String, Object>) raw;
            requireExactKeys(value, "id", "available", "reason", "preview");
            String action = incidentText(value.get("id"), 16, false);
            if (!RUNTIME_ACTIONS.contains(action) || actions.containsKey(action)
                    || !(value.get("available") instanceof Boolean)) {
                throw new IllegalArgumentException();
            }
            boolean available = Boolean.TRUE.equals(value.get("available"));
            boolean expectedAvailable = supported
                    && (("pause".equals(action) && "running".equals(status))
                            || ("resume".equals(action) && "paused".equals(status)));
            if (available != expectedAvailable) throw new IllegalArgumentException();
            List<String> expected = List.of("automation", "center-runtime-action",
                    occurrenceId, action, "--expected-fence",
                    String.valueOf(fence), "--expected-control-revision",
                    String.valueOf(controlRevision), "--json");
            ActionPreview preview = available
                    ? parseStrictPreview(value.get("preview"), expected) : null;
            String reason = available ? ""
                    : incidentText(value.get("reason"), 240, false);
            if ((available && (value.get("reason") != null || preview == null))
                    || (!available && value.get("preview") != null)) {
                throw new IllegalArgumentException();
            }
            actions.put(action, new Action(available, reason, preview));
        }
        if (actions.size() != RUNTIME_ACTIONS.size()) {
            throw new IllegalArgumentException();
        }
        return actions;
    }

    private static ActionPreview parseStrictPreview(Object raw,
            List<String> expected) {
        if (!(raw instanceof Map)) return null;
        @SuppressWarnings("unchecked")
        Map<String, Object> value = (Map<String, Object>) raw;
        try {
            requireExactKeys(value, "executor", "argv", "mutates");
        } catch (IllegalArgumentException error) {
            return null;
        }
        return parseExactPreview(value, expected, false);
    }

    private static void requireExactKeys(Map<String, Object> value,
            String... keys) {
        if (!value.keySet().equals(Set.of(keys))) {
            throw new IllegalArgumentException();
        }
    }

    private static String incidentText(Object value, int maximum, boolean optional) {
        if (value == null && optional) return "";
        if (!(value instanceof String)) throw new IllegalArgumentException();
        String string = (String) value;
        if (string.isEmpty() || string.length() > maximum) {
            throw new IllegalArgumentException();
        }
        for (int index = 0; index < string.length(); index++) {
            char character = string.charAt(index);
            if (character <= 31 || character == 127) {
                throw new IllegalArgumentException();
            }
        }
        return string;
    }

    private static long strictInteger(Object value, long minimum) {
        if (!(value instanceof Number)) throw new IllegalArgumentException();
        double number = ((Number) value).doubleValue();
        if (!Double.isFinite(number) || number < minimum
                || number > MAX_SAFE_INTEGER || number != Math.rint(number)) {
            throw new IllegalArgumentException();
        }
        return ((Number) value).longValue();
    }

    @SuppressWarnings("unchecked")
    private static List<String> triggerLines(List<Object> values) {
        List<String> result = new ArrayList<String>();
        for (Object raw : values) {
            if (!(raw instanceof Map) || result.size() >= 100) continue;
            Map<String, Object> trigger = (Map<String, Object>) raw;
            String type = text(trigger.get("type"), 40);
            if (type.isEmpty()) continue;
            StringBuilder line = new StringBuilder(type);
            if (!Boolean.TRUE.equals(trigger.get("enabled"))) line.append(" (disabled)");
            if (trigger.get("scope") instanceof Map) {
                Map<String, Object> scope = (Map<String, Object>) trigger.get("scope");
                String detail = firstNonEmpty(
                        text(scope.get("repo"), 200), text(scope.get("cron"), 120),
                        text(scope.get("at"), 80), text(scope.get("entryPoint"), 300));
                if (scope.get("origins") instanceof List) {
                    List<String> origins = new ArrayList<String>();
                    for (Object origin : (List<Object>) scope.get("origins")) {
                        String value = text(origin, 64);
                        if (!value.isEmpty()) origins.add(value);
                    }
                    detail = String.join(", ", origins);
                } else if (Boolean.TRUE.equals(scope.get("endpointConfigured"))) {
                    detail = "endpoint configured";
                }
                if (!detail.isEmpty()) line.append(" · ").append(detail);
            }
            result.add(line.toString());
        }
        return result;
    }

    @SuppressWarnings("unchecked")
    private static List<String> historyLines(List<Object> values) {
        List<String> result = new ArrayList<String>();
        for (Object raw : values) {
            if (!(raw instanceof Map) || result.size() >= 100) continue;
            Map<String, Object> item = (Map<String, Object>) raw;
            String status = text(item.get("status"), 40);
            if (status.isEmpty()) continue;
            result.add(status + " · " + fallback(text(item.get("triggerType"), 80), "manual")
                    + " · " + text(item.get("startedAt"), 80));
        }
        return result;
    }

    private static Snapshot disconnected(String error, boolean stale, String revision) {
        return new Snapshot(false, stale, revision, "", error,
                0, 0, 0, 0, 0, 0,
                0, 0, 0, List.of(), List.of(), null);
    }

    private static String text(Object value, int maximum) {
        if (!(value instanceof String)) return "";
        String string = (String) value;
        return string.length() <= maximum ? string : string.substring(0, maximum);
    }

    private static long number(Object value) {
        if (!(value instanceof Number)) return 0;
        return Math.max(0L, ((Number) value).longValue());
    }

    private static String fallback(String value, String fallback) {
        return value == null || value.isEmpty() ? fallback : value;
    }

    private static String firstNonEmpty(String... values) {
        for (String value : values) if (value != null && !value.isEmpty()) return value;
        return "";
    }
}
