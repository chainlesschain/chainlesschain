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

    public static final String SCHEMA = "chainlesschain.automation-center/v1";
    public static final int SCHEMA_VERSION = 1;
    public static final List<String> ACTIONS = List.of("run_now", "pause", "resume");
    private static final Set<String> ACTION_SET = Set.copyOf(ACTIONS);
    private static final Set<String> STATUS = Set.of("draft", "active", "paused", "archived");
    private static final Set<String> SECURITY = Set.of("ready", "denied", "unconfigured", "invalid");

    public static final class ActionPreview {
        public final List<String> argv;

        private ActionPreview(List<String> argv) {
            this.argv = Collections.unmodifiableList(new ArrayList<String>(argv));
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

    public static final class Flow {
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

        private Flow(String id, String revision, String name, String description,
                String status, String schedule, String securityState, boolean ready,
                String principalId, long remainingRuns, long remainingActionSteps,
                String issue, List<String> triggers, List<String> history,
                Map<String, Action> actions) {
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
        }
    }

    public static final class Snapshot {
        public final boolean connected;
        public final boolean stale;
        public final String revision;
        public final String error;
        public final long total;
        public final long active;
        public final long paused;
        public final long needsAttention;
        public final List<Flow> flows;

        private Snapshot(boolean connected, boolean stale, String revision,
                String error, long total, long active, long paused,
                long needsAttention, List<Flow> flows) {
            this.connected = connected;
            this.stale = stale;
            this.revision = revision == null ? "" : revision;
            this.error = error == null ? "" : error;
            this.total = total;
            this.active = active;
            this.paused = paused;
            this.needsAttention = needsAttention;
            this.flows = Collections.unmodifiableList(new ArrayList<Flow>(flows));
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
                || !(root.get("flows") instanceof List)) {
            return disconnected("Automation Center disconnected", false, revision);
        }
        if (expectedRevision != null && !expectedRevision.isEmpty()
                && !expectedRevision.equals(revision)) {
            return disconnected("stale Automation Center projection", true, revision);
        }
        try {
            List<Flow> flows = new ArrayList<Flow>();
            for (Object rawFlow : (List<Object>) root.get("flows")) {
                if (!(rawFlow instanceof Map)) throw new IllegalArgumentException();
                Map<String, Object> flow = (Map<String, Object>) rawFlow;
                String id = text(flow.get("id"), 256);
                String itemRevision = text(flow.get("revision"), 96);
                String status = text(flow.get("status"), 32);
                if (id.isEmpty() || itemRevision.isEmpty() || !STATUS.contains(status)
                        || !(flow.get("security") instanceof Map)
                        || !(flow.get("triggers") instanceof List)
                        || !(flow.get("history") instanceof List)
                        || !(flow.get("actions") instanceof List)) {
                    throw new IllegalArgumentException();
                }
                Map<String, Object> security = (Map<String, Object>) flow.get("security");
                String securityState = text(security.get("state"), 32);
                if (!SECURITY.contains(securityState)) throw new IllegalArgumentException();
                Map<String, Object> budget = security.get("budget") instanceof Map
                        ? (Map<String, Object>) security.get("budget") : Map.of();
                Map<String, Object> issue = security.get("issue") instanceof Map
                        ? (Map<String, Object>) security.get("issue") : Map.of();
                Map<String, Action> actions = new LinkedHashMap<String, Action>();
                Set<String> seen = new LinkedHashSet<String>();
                for (Object rawAction : (List<Object>) flow.get("actions")) {
                    if (!(rawAction instanceof Map)) continue;
                    Map<String, Object> value = (Map<String, Object>) rawAction;
                    String actionId = text(value.get("id"), 32);
                    if (!ACTION_SET.contains(actionId) || !seen.add(actionId)) continue;
                    boolean available = Boolean.TRUE.equals(value.get("available"));
                    ActionPreview preview = available
                            ? parsePreview(value.get("preview"), id, actionId, itemRevision)
                            : null;
                    if ((available && preview == null)
                            || (!available && value.get("preview") != null)) {
                        throw new IllegalArgumentException();
                    }
                    actions.put(actionId, new Action(available,
                            text(value.get("reason"), 240), preview));
                }
                if (actions.size() != ACTIONS.size()) throw new IllegalArgumentException();
                flows.add(new Flow(
                        id, itemRevision, fallback(text(flow.get("name"), 200), id),
                        text(flow.get("description"), 500), status,
                        text(flow.get("schedule"), 120), securityState,
                        Boolean.TRUE.equals(security.get("ready")),
                        text(security.get("principalId"), 256),
                        number(budget.get("remainingRuns")),
                        number(budget.get("remainingActionSteps")),
                        text(issue.get("code"), 96),
                        triggerLines((List<Object>) flow.get("triggers")),
                        historyLines((List<Object>) flow.get("history")),
                        actions));
            }
            Map<String, Object> summary = root.get("summary") instanceof Map
                    ? (Map<String, Object>) root.get("summary") : Map.of();
            return new Snapshot(true, false, revision, "",
                    number(summary.get("total")), number(summary.get("active")),
                    number(summary.get("paused")), number(summary.get("needsAttention")),
                    flows);
        } catch (RuntimeException error) {
            return disconnected("malformed Automation Center projection", false, revision);
        }
    }

    public static ActionPreview preview(Snapshot snapshot, String flowId,
            String action, String requestRevision, String itemRevision) {
        if (snapshot == null || !snapshot.connected
                || !snapshot.revision.equals(requestRevision)) return null;
        for (Flow flow : snapshot.flows) {
            if (flow.id.equals(flowId) && flow.revision.equals(itemRevision)) {
                Action value = flow.actions.get(action);
                return value != null && value.available ? value.preview : null;
            }
        }
        return null;
    }

    public static ActionPreview recheck(Snapshot rendered, Snapshot current,
            String flowId, String action, String requestRevision,
            String itemRevision) {
        if (preview(rendered, flowId, action, requestRevision, itemRevision) == null
                || current == null || !current.connected) return null;
        for (Flow flow : current.flows) {
            if (flow.id.equals(flowId) && flow.revision.equals(itemRevision)) {
                Action value = flow.actions.get(action);
                return value != null && value.available ? value.preview : null;
            }
        }
        return null;
    }

    public static List<Flow> filter(List<Flow> flows, String query) {
        String needle = text(query, 200).trim().toLowerCase();
        if (needle.isEmpty()) return new ArrayList<Flow>(flows == null ? List.of() : flows);
        List<Flow> result = new ArrayList<Flow>();
        if (flows == null) return result;
        for (Flow flow : flows) {
            String haystack = (flow.name + " " + flow.id + " " + flow.status
                    + " " + flow.securityState + " " + flow.schedule).toLowerCase();
            if (haystack.contains(needle)) result.add(flow);
        }
        return result;
    }

    public static String detail(Flow flow) {
        if (flow == null) return "";
        StringBuilder out = new StringBuilder();
        out.append(flow.name).append("\n")
                .append(flow.id).append(" · ").append(flow.status);
        if (!flow.schedule.isEmpty()) out.append(" · ").append(flow.schedule);
        out.append("\nPreflight: ").append(flow.securityState);
        if (!flow.principalId.isEmpty()) out.append(" · principal ").append(flow.principalId);
        if (flow.ready) out.append(" · ").append(flow.remainingRuns)
                .append(" runs / ").append(flow.remainingActionSteps).append(" steps left");
        if (!flow.issue.isEmpty()) out.append(" · ").append(flow.issue);
        out.append("\nTriggers: ").append(flow.triggers.isEmpty()
                ? "none" : String.join("; ", flow.triggers));
        out.append("\n\nRun history:");
        if (flow.history.isEmpty()) out.append(" none");
        else for (String line : flow.history) out.append("\n  ").append(line);
        return out.toString();
    }

    @SuppressWarnings("unchecked")
    private static ActionPreview parsePreview(Object raw, String flowId,
            String actionId, String itemRevision) {
        if (!(raw instanceof Map)) return null;
        Map<String, Object> value = (Map<String, Object>) raw;
        if (!"cli".equals(text(value.get("executor"), 16))
                || !Boolean.TRUE.equals(value.get("mutates"))
                || !(value.get("argv") instanceof List)) return null;
        List<String> expected = List.of("automation", "center-action", flowId,
                actionId, "--expected-revision", itemRevision, "--json");
        List<Object> argv = (List<Object>) value.get("argv");
        if (argv.size() != expected.size()) return null;
        for (int i = 0; i < expected.size(); i++) {
            if (!expected.get(i).equals(argv.get(i))) return null;
        }
        return new ActionPreview(expected);
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
                if (scope.get("origins") instanceof List) {
                    List<String> origins = new ArrayList<String>();
                    for (Object origin : (List<Object>) scope.get("origins")) {
                        String value = text(origin, 64);
                        if (!value.isEmpty()) origins.add(value);
                    }
                    if (!origins.isEmpty()) line.append(" · ").append(String.join(", ", origins));
                } else if (Boolean.TRUE.equals(scope.get("endpointConfigured"))) {
                    line.append(" · endpoint configured");
                }
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
            result.add(status + " · " + fallback(text(item.get("triggerType"), 40), "manual")
                    + " · " + text(item.get("startedAt"), 80));
        }
        return result;
    }

    private static Snapshot disconnected(String error, boolean stale, String revision) {
        return new Snapshot(false, stale, revision, error, 0, 0, 0, 0, List.of());
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
}
