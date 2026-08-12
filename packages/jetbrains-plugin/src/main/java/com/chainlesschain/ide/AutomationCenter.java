package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Fail-closed parser for {@code cc automation center-projection --json}. */
public final class AutomationCenter {

    private AutomationCenter() {}

    public static final String SCHEMA = "chainlesschain.automation-center/v2";
    public static final int SCHEMA_VERSION = 2;
    public static final List<String> FLOW_ACTIONS = List.of(
            "run_now", "retry_failed", "pause", "resume", "disable", "delete");
    public static final List<String> ROUTINE_ACTIONS = List.of(
            "run_now", "retry_failed", "pause", "resume", "disable", "delete", "edit");
    public static final List<String> ACTIONS = ROUTINE_ACTIONS;
    private static final Set<String> KINDS = Set.of("flow", "routine");
    private static final Set<String> STATUS = Set.of("draft", "active", "paused", "archived");
    private static final Set<String> SECURITY = Set.of(
            "ready", "denied", "unconfigured", "invalid", "snapshot_bound");

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
        public final Map<String, Action> actions;
        public final Map<String, Object> definition;

        private Item(String kind, String id, String revision, String name,
                String description, String status, String schedule,
                String securityState, boolean ready, String principalId,
                long remainingRuns, long remainingActionSteps, String issue,
                List<String> triggers, List<String> history,
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
        public final List<Item> items;
        public final List<Item> flows;
        public final ActionPreview createRoutine;

        private Snapshot(boolean connected, boolean stale, String revision,
                String routineCatalogRevision, String error, long total,
                long flowCount, long routineCount, long active, long paused,
                long needsAttention, List<Item> items, ActionPreview createRoutine) {
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
            this.items = Collections.unmodifiableList(new ArrayList<Item>(items));
            this.flows = this.items;
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
        if (!SCHEMA.equals(text(root.get("schema"), 96))
                || number(root.get("schemaVersion")) != SCHEMA_VERSION
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

            List<Item> items = new ArrayList<Item>();
            Set<String> keys = new LinkedHashSet<String>();
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
                        actions, definition));
            }
            Map<String, Object> summary = root.get("summary") instanceof Map
                    ? (Map<String, Object>) root.get("summary") : Map.of();
            long total = number(summary.get("total"));
            long flowCount = number(summary.get("flows"));
            long routineCount = number(summary.get("routines"));
            if (total != items.size()
                    || flowCount != items.stream().filter(i -> "flow".equals(i.kind)).count()
                    || routineCount != items.stream().filter(i -> "routine".equals(i.kind)).count()) {
                throw new IllegalArgumentException();
            }
            return new Snapshot(true, false, revision, catalogRevision, "",
                    total, flowCount, routineCount, number(summary.get("active")),
                    number(summary.get("paused")), number(summary.get("needsAttention")),
                    items, createRoutine);
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
            String haystack = (item.kind + " " + item.name + " " + item.id + " "
                    + item.status + " " + item.securityState + " " + item.schedule).toLowerCase();
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
        out.append("\n\nRun history:");
        if (item.history.isEmpty()) out.append(" none");
        else for (String line : item.history) out.append("\n  ").append(line);
        return out.toString();
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
                0, 0, 0, 0, 0, 0, List.of(), null);
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
