package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Parser for {@code cc session projection --json}.
 *
 * <p>The CLI is the only lifecycle/mutation authority. A malformed,
 * disconnected or stale document therefore produces an empty snapshot; IDE
 * callers must never retain actions from the previous successful refresh.
 */
public final class SessionProjection {

    private SessionProjection() {}

    public static final String SCHEMA = "chainlesschain.session-projection/v1";
    public static final int SCHEMA_VERSION = 1;

    public static final List<String> ACTIONS = List.of(
            "dispatch", "peek", "reply", "attach", "detach", "stop",
            "checkpoint", "archive");
    private static final Set<String> ACTION_SET =
            Collections.unmodifiableSet(new LinkedHashSet<String>(ACTIONS));
    private static final Set<String> KINDS = Set.of(
            "local", "background", "remote", "team", "workflow");
    private static final Set<String> STATES = Set.of(
            "working", "needs_input", "blocked", "done", "failed", "stopped");
    private static final Set<String> EXECUTORS = Set.of("cli", "terminal", "host");
    public static final String PROMPT_PLACEHOLDER = "$prompt";

    public static final class ActionPreview {
        public final String executor;
        public final List<String> argv;
        public final boolean mutates;
        public final String input;

        private ActionPreview(String executor, List<String> argv,
                boolean mutates, String input) {
            this.executor = executor;
            this.argv = Collections.unmodifiableList(new ArrayList<String>(argv));
            this.mutates = mutates;
            this.input = input == null ? "" : input;
        }

        public List<String> materialize(String prompt) {
            if (!"prompt".equals(input)) return argv;
            String value = prompt == null ? "" : prompt.trim();
            if (value.isEmpty()) return List.of();
            List<String> result = new ArrayList<String>();
            for (String arg : argv) {
                result.add(PROMPT_PLACEHOLDER.equals(arg) ? value : arg);
            }
            return Collections.unmodifiableList(result);
        }
    }

    public static final class Item {
        public final String id;
        public final String sourceId;
        public final String kind;
        public final String state;
        public final String title;
        public final String linkedSessionId;
        public final String cwd;
        public final long port;
        public final String lastEventAt;
        public final String revision;
        public final List<String> actions;
        public final Map<String, String> unavailableReasons;
        public final Map<String, ActionPreview> previews;

        private Item(String id, String sourceId, String kind, String state,
                String title, String linkedSessionId, String cwd, long port,
                String lastEventAt, String revision, List<String> actions,
                Map<String, String> unavailableReasons,
                Map<String, ActionPreview> previews) {
            this.id = id;
            this.sourceId = sourceId;
            this.kind = kind;
            this.state = state;
            this.title = title;
            this.linkedSessionId = linkedSessionId;
            this.cwd = cwd;
            this.port = port;
            this.lastEventAt = lastEventAt;
            this.revision = revision;
            this.actions = Collections.unmodifiableList(new ArrayList<String>(actions));
            this.unavailableReasons = Collections.unmodifiableMap(
                    new LinkedHashMap<String, String>(unavailableReasons));
            this.previews = Collections.unmodifiableMap(
                    new LinkedHashMap<String, ActionPreview>(previews));
        }
    }

    public static final class Snapshot {
        public final boolean connected;
        public final boolean stale;
        public final String revision;
        public final String error;
        public final List<Item> sessions;
        public final Map<String, Object> sources;

        private Snapshot(boolean connected, boolean stale, String revision,
                String error, List<Item> sessions, Map<String, Object> sources) {
            this.connected = connected;
            this.stale = stale;
            this.revision = revision == null ? "" : revision;
            this.error = error == null ? "" : error;
            this.sessions = Collections.unmodifiableList(
                    new ArrayList<Item>(sessions == null ? List.of() : sessions));
            this.sources = Collections.unmodifiableMap(
                    new LinkedHashMap<String, Object>(sources == null ? Map.of() : sources));
        }
    }

    public static Snapshot parse(String json) {
        return parse(json, null);
    }

    /** Parse and optionally require one exact envelope revision. */
    @SuppressWarnings("unchecked")
    public static Snapshot parse(String json, String expectedRevision) {
        final Map<String, Object> root;
        try {
            root = MiniJson.parseObject(json == null ? "" : json);
        } catch (RuntimeException error) {
            return disconnected("invalid session projection JSON", false, "", Map.of());
        }
        String revision = str(root.get("revision"));
        Map<String, Object> sources = root.get("sources") instanceof Map
                ? (Map<String, Object>) root.get("sources") : Map.of();
        if (!SCHEMA.equals(str(root.get("schema")))
                || number(root.get("schemaVersion")) != SCHEMA_VERSION
                || !"cli".equals(str(root.get("authority")))) {
            return disconnected("unsupported or non-CLI session projection",
                    false, revision, sources);
        }
        if (!Boolean.TRUE.equals(root.get("connected"))
                || revision.isEmpty()
                || !(root.get("sessions") instanceof List)) {
            String reason = str(root.get("reason"));
            return disconnected(reason.isEmpty()
                    ? "CLI session projection disconnected" : reason,
                    false, revision, sources);
        }
        if (expectedRevision != null && !expectedRevision.isEmpty()
                && !expectedRevision.equals(revision)) {
            return disconnected("stale session projection revision",
                    true, revision, sources);
        }

        List<Item> sessions = new ArrayList<Item>();
        try {
            for (Object value : (List<Object>) root.get("sessions")) {
                if (!(value instanceof Map)) throw new IllegalArgumentException();
                Map<String, Object> item = (Map<String, Object>) value;
                String id = str(item.get("id"));
                String sourceId = str(item.get("sourceId"));
                String kind = str(item.get("kind"));
                String state = str(item.get("state"));
                String itemRevision = str(item.get("revision"));
                if (id.isEmpty() || sourceId.isEmpty() || !KINDS.contains(kind)
                        || !STATES.contains(state) || itemRevision.isEmpty()
                        || !(item.get("actions") instanceof List)) {
                    throw new IllegalArgumentException();
                }

                List<String> available = new ArrayList<String>();
                Map<String, String> unavailable = new LinkedHashMap<String, String>();
                Map<String, ActionPreview> previews =
                        new LinkedHashMap<String, ActionPreview>();
                Set<String> seenActions = new LinkedHashSet<String>();
                for (Object rawAction : (List<Object>) item.get("actions")) {
                    if (!(rawAction instanceof Map)) continue;
                    Map<String, Object> action = (Map<String, Object>) rawAction;
                    String actionId = str(action.get("id"));
                    if (!ACTION_SET.contains(actionId)) continue;
                    seenActions.add(actionId);
                    if (Boolean.TRUE.equals(action.get("available"))) {
                        ActionPreview preview = parsePreview(action.get("preview"));
                        if (preview == null) throw new IllegalArgumentException();
                        available.add(actionId);
                        previews.put(actionId, preview);
                    } else {
                        if (action.get("preview") != null) {
                            throw new IllegalArgumentException();
                        }
                        unavailable.put(actionId, str(action.get("reason")));
                    }
                }
                if (seenActions.size() != ACTIONS.size()) {
                    throw new IllegalArgumentException();
                }
                Map<String, Object> environment = item.get("environment") instanceof Map
                        ? (Map<String, Object>) item.get("environment") : Map.of();
                Map<String, Object> lastEvent = item.get("lastEvent") instanceof Map
                        ? (Map<String, Object>) item.get("lastEvent") : Map.of();
                sessions.add(new Item(
                        id, sourceId, kind, state,
                        fallback(str(item.get("title")), sourceId),
                        str(item.get("linkedSessionId")),
                        str(environment.get("cwd")),
                        number(environment.get("port")),
                        str(lastEvent.get("at")),
                        itemRevision,
                        available,
                        unavailable,
                        previews));
            }
        } catch (RuntimeException error) {
            return disconnected("malformed session projection row",
                    false, revision, sources);
        }
        return new Snapshot(true, false, revision, "", sessions, sources);
    }

    /** Authority + envelope revision + item revision + capability gate. */
    public static boolean canRun(Snapshot snapshot, String canonicalId,
            String action, String requestRevision) {
        if (snapshot == null || !snapshot.connected || snapshot.revision.isEmpty()
                || !snapshot.revision.equals(requestRevision)) return false;
        for (Item item : snapshot.sessions) {
            if (item.id.equals(canonicalId) && item.actions.contains(action)) return true;
        }
        return false;
    }

    /** Exact action route captured with a rendered projection row. */
    public static ActionPreview preview(Snapshot snapshot, String canonicalId,
            String action, String requestRevision, String itemRevision) {
        if (!canRun(snapshot, canonicalId, action, requestRevision)) return null;
        for (Item item : snapshot.sessions) {
            if (item.id.equals(canonicalId)
                    && item.revision.equals(itemRevision)) {
                return item.previews.get(action);
            }
        }
        return null;
    }

    /**
     * Per-item revision CAS against a freshly fetched CLI projection. Unrelated
     * envelope changes do not invalidate an unchanged target row.
     */
    public static ActionPreview recheck(Snapshot rendered, Snapshot current,
            String canonicalId, String action, String requestRevision,
            String itemRevision) {
        if (preview(rendered, canonicalId, action, requestRevision,
                itemRevision) == null || current == null || !current.connected) {
            return null;
        }
        for (Item item : current.sessions) {
            if (item.id.equals(canonicalId)
                    && item.revision.equals(itemRevision)
                    && item.actions.contains(action)) {
                return item.previews.get(action);
            }
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private static ActionPreview parsePreview(Object value) {
        if (!(value instanceof Map)) return null;
        Map<String, Object> preview = (Map<String, Object>) value;
        String executor = str(preview.get("executor"));
        if (!EXECUTORS.contains(executor)
                || !(preview.get("argv") instanceof List)
                || !(preview.get("mutates") instanceof Boolean)) {
            return null;
        }
        List<String> argv = new ArrayList<String>();
        int placeholders = 0;
        for (Object raw : (List<Object>) preview.get("argv")) {
            if (!(raw instanceof String)) return null;
            String arg = (String) raw;
            if (PROMPT_PLACEHOLDER.equals(arg)) placeholders++;
            argv.add(arg);
        }
        if (argv.isEmpty()) return null;
        String input = str(preview.get("input"));
        if (!input.isEmpty() && !"prompt".equals(input)) return null;
        if (("prompt".equals(input) && placeholders != 1)
                || (input.isEmpty() && placeholders != 0)) {
            return null;
        }
        return new ActionPreview(executor, argv,
                Boolean.TRUE.equals(preview.get("mutates")), input);
    }

    private static Snapshot disconnected(String error, boolean stale,
            String revision, Map<String, Object> sources) {
        return new Snapshot(false, stale, revision, error, List.of(), sources);
    }

    private static String fallback(String first, String second) {
        return first.isEmpty() ? second : first;
    }

    private static String str(Object value) {
        if (value == null) return "";
        String text = String.valueOf(value).trim();
        return "null".equals(text) ? "" : text;
    }

    private static long number(Object value) {
        return value instanceof Number ? ((Number) value).longValue() : 0L;
    }
}
