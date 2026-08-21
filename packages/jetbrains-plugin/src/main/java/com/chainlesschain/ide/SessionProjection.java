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

    public static final String SCHEMA = "chainlesschain.session-projection/v2";
    public static final int SCHEMA_VERSION = 2;
    public static final String LEGACY_SCHEMA = "chainlesschain.session-projection/v1";

    public static final List<String> ACTIONS = List.of(
            "dispatch", "peek", "reply", "attach", "detach", "stop",
            "checkpoint", "archive", "pause", "resume", "recover");
    private static final Set<String> ACTION_SET =
            Collections.unmodifiableSet(new LinkedHashSet<String>(ACTIONS));
    private static final Set<String> LEGACY_ACTION_SET = Set.of(
            "dispatch", "peek", "reply", "attach", "detach", "stop",
            "checkpoint", "archive");
    private static final Set<String> KINDS = Set.of(
            "local", "background", "remote", "team", "workflow",
            "dynamic_workflow");
    private static final Set<String> LEGACY_KINDS = Set.of(
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

    public static final class MessagingEndpoint {
        public final String name;
        public final String address;
        public final String policy;
        public final boolean online;
        public final boolean idle;
        public final long unread;
        public final long held;

        private MessagingEndpoint(String name, String address, String policy,
                boolean online, boolean idle, long unread, long held) {
            this.name = name;
            this.address = address;
            this.policy = policy;
            this.online = online;
            this.idle = idle;
            this.unread = unread;
            this.held = held;
        }
    }

    public static final class MessagingSummary {
        public final boolean registered;
        public final long revision;
        public final long unread;
        public final long held;
        public final List<MessagingEndpoint> endpoints;

        private MessagingSummary(boolean registered, long revision, long unread,
                long held, List<MessagingEndpoint> endpoints) {
            this.registered = registered;
            this.revision = revision;
            this.unread = unread;
            this.held = held;
            this.endpoints = Collections.unmodifiableList(
                    new ArrayList<MessagingEndpoint>(endpoints));
        }
    }

    public static final class Group {
        public final String id;
        public final String name;
        public final long order;

        private Group(String id, String name, long order) {
            this.id = id;
            this.name = name;
            this.order = order;
        }
    }

    public static final class AttentionSummary {
        public final long unread;
        public final boolean needsApproval;
        public final long pendingInteractions;

        private AttentionSummary(long unread, boolean needsApproval,
                long pendingInteractions) {
            this.unread = unread;
            this.needsApproval = needsApproval;
            this.pendingInteractions = pendingInteractions;
        }
    }

    public static final class FocusSummary {
        public final boolean active;
        public final String liveTool;
        public final String liveToolStatus;
        public final String latestTodo;
        public final String pendingQuestion;
        public final String settledAnswer;

        private FocusSummary(boolean active, String liveTool,
                String liveToolStatus, String latestTodo,
                String pendingQuestion, String settledAnswer) {
            this.active = active;
            this.liveTool = liveTool;
            this.liveToolStatus = liveToolStatus;
            this.latestTodo = latestTodo;
            this.pendingQuestion = pendingQuestion;
            this.settledAnswer = settledAnswer;
        }
    }

    public static final class LocationSummary {
        public final String kind;
        public final String status;

        private LocationSummary(String kind, String status) {
            this.kind = kind;
            this.status = status;
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
        public final MessagingSummary messaging;
        public final String groupId;
        public final AttentionSummary attention;
        public final FocusSummary focus;
        public final LocationSummary location;
        /** Bounded, content-free owner/worktree/artifact/approval/PR summary. */
        public final String detail;

        private Item(String id, String sourceId, String kind, String state,
                String title, String linkedSessionId, String cwd, long port,
                String lastEventAt, String revision, List<String> actions,
                Map<String, String> unavailableReasons,
                Map<String, ActionPreview> previews,
                MessagingSummary messaging, String groupId,
                AttentionSummary attention, FocusSummary focus,
                LocationSummary location, String detail) {
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
            this.messaging = messaging;
            this.groupId = groupId == null ? "" : groupId;
            this.attention = attention;
            this.focus = focus;
            this.location = location;
            this.detail = detail == null ? "" : detail;
        }
    }

    public static final class Snapshot {
        public final boolean connected;
        public final boolean stale;
        public final String revision;
        public final String error;
        public final List<Item> sessions;
        public final Map<String, Object> sources;
        public final boolean groupsConnected;
        public final String groupRevision;
        public final List<Group> groups;

        private Snapshot(boolean connected, boolean stale, String revision,
                String error, List<Item> sessions, Map<String, Object> sources,
                boolean groupsConnected, String groupRevision,
                List<Group> groups) {
            this.connected = connected;
            this.stale = stale;
            this.revision = revision == null ? "" : revision;
            this.error = error == null ? "" : error;
            this.sessions = Collections.unmodifiableList(
                    new ArrayList<Item>(sessions == null ? List.of() : sessions));
            this.sources = Collections.unmodifiableMap(
                    new LinkedHashMap<String, Object>(sources == null ? Map.of() : sources));
            this.groupsConnected = groupsConnected;
            this.groupRevision = groupRevision == null ? "" : groupRevision;
            this.groups = Collections.unmodifiableList(
                    new ArrayList<Group>(groups == null ? List.of() : groups));
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
        boolean legacy = LEGACY_SCHEMA.equals(str(root.get("schema")))
                && number(root.get("schemaVersion")) == 1;
        if ((!legacy && (!SCHEMA.equals(str(root.get("schema")))
                || number(root.get("schemaVersion")) != SCHEMA_VERSION))
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

        final GroupProjection groups;
        try {
            groups = parseGroups(root.get("groups"));
        } catch (RuntimeException error) {
            return disconnected("malformed session group projection",
                    false, revision, sources);
        }
        Map<String, String> groupNames = new LinkedHashMap<String, String>();
        for (Group group : groups.items) groupNames.put(group.id, group.name);

        List<Item> sessions = new ArrayList<Item>();
        Set<String> actionSet = legacy ? LEGACY_ACTION_SET : ACTION_SET;
        Set<String> kindSet = legacy ? LEGACY_KINDS : KINDS;
        try {
            for (Object value : (List<Object>) root.get("sessions")) {
                if (!(value instanceof Map)) throw new IllegalArgumentException();
                Map<String, Object> item = (Map<String, Object>) value;
                String id = str(item.get("id"));
                String sourceId = str(item.get("sourceId"));
                String kind = str(item.get("kind"));
                String state = str(item.get("state"));
                String itemRevision = str(item.get("revision"));
                if (id.isEmpty() || sourceId.isEmpty() || !kindSet.contains(kind)
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
                    if (!actionSet.contains(actionId)) continue;
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
                if (seenActions.size() != actionSet.size()) {
                    throw new IllegalArgumentException();
                }
                Map<String, Object> environment = item.get("environment") instanceof Map
                        ? (Map<String, Object>) item.get("environment") : Map.of();
                Map<String, Object> lastEvent = item.get("lastEvent") instanceof Map
                        ? (Map<String, Object>) item.get("lastEvent") : Map.of();
                String groupId = str(item.get("groupId"));
                if (!groupId.isEmpty() && !groupNames.containsKey(groupId)) {
                    throw new IllegalArgumentException();
                }
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
                        previews,
                        parseMessaging(item.get("messaging")),
                        groupId,
                        parseAttention(item.get("attention")),
                        parseFocus(item.get("focus"), state),
                        parseLocation(item.get("location")),
                        projectionDetail(item)));
            }
        } catch (RuntimeException error) {
            return disconnected("malformed session projection row",
                    false, revision, sources);
        }
        return new Snapshot(true, false, revision, "", sessions, sources,
                groups.connected, groups.revision, groups.items);
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

    private static final class GroupProjection {
        final boolean connected;
        final String revision;
        final List<Group> items;

        GroupProjection(boolean connected, String revision, List<Group> items) {
            this.connected = connected;
            this.revision = revision == null ? "" : revision;
            this.items = items;
        }
    }

    @SuppressWarnings("unchecked")
    private static GroupProjection parseGroups(Object value) {
        if (value == null) return new GroupProjection(false, "", List.of());
        if (!(value instanceof Map)) throw new IllegalArgumentException();
        Map<String, Object> groups = (Map<String, Object>) value;
        if (!"cli".equals(str(groups.get("authority")))
                || !(groups.get("connected") instanceof Boolean)
                || !(groups.get("items") instanceof List)) {
            throw new IllegalArgumentException();
        }
        if (!Boolean.TRUE.equals(groups.get("connected"))) {
            return new GroupProjection(false, "", List.of());
        }
        String revision = str(groups.get("revision"));
        if (revision.isEmpty() || !(groups.get("generation") instanceof Number)
                || number(groups.get("generation")) < 0) {
            throw new IllegalArgumentException();
        }
        List<Object> rawItems = (List<Object>) groups.get("items");
        if (rawItems.size() > 128) throw new IllegalArgumentException();
        Set<String> ids = new LinkedHashSet<String>();
        List<Group> items = new ArrayList<Group>();
        for (Object raw : rawItems) {
            if (!(raw instanceof Map)) throw new IllegalArgumentException();
            Map<String, Object> item = (Map<String, Object>) raw;
            String id = str(item.get("id"));
            String name = str(item.get("name"));
            long order = number(item.get("order"));
            if (!id.matches("group-[a-zA-Z0-9_-]+") || name.isEmpty()
                    || name.length() > 80 || !(item.get("order") instanceof Number)
                    || order < 0 || !ids.add(id)) {
                throw new IllegalArgumentException();
            }
            items.add(new Group(id, name, order));
        }
        items.sort((left, right) -> {
            int order = Long.compare(left.order, right.order);
            return order != 0 ? order : left.name.compareTo(right.name);
        });
        return new GroupProjection(true, revision, items);
    }

    @SuppressWarnings("unchecked")
    private static AttentionSummary parseAttention(Object value) {
        if (value == null) return new AttentionSummary(0L, false, 0L);
        if (!(value instanceof Map)) throw new IllegalArgumentException();
        Map<String, Object> attention = (Map<String, Object>) value;
        if (!(attention.get("unread") instanceof Number)
                || !(attention.get("needsApproval") instanceof Boolean)
                || !(attention.get("pendingInteractions") instanceof Number)) {
            throw new IllegalArgumentException();
        }
        long unread = number(attention.get("unread"));
        long pending = number(attention.get("pendingInteractions"));
        if (unread < 0 || pending < 0 || pending > 1_000) {
            throw new IllegalArgumentException();
        }
        return new AttentionSummary(unread,
                Boolean.TRUE.equals(attention.get("needsApproval")), pending);
    }

    @SuppressWarnings("unchecked")
    private static FocusSummary parseFocus(Object value, String state) {
        if (value == null) {
            return new FocusSummary(Set.of("working", "needs_input", "blocked")
                    .contains(state), "", "", "", "", "");
        }
        if (!(value instanceof Map)) throw new IllegalArgumentException();
        Map<String, Object> focus = (Map<String, Object>) value;
        if (!(focus.get("active") instanceof Boolean)) {
            throw new IllegalArgumentException();
        }
        String liveTool = "";
        String liveToolStatus = "";
        if (focus.get("liveTool") != null) {
            if (!(focus.get("liveTool") instanceof Map)) {
                throw new IllegalArgumentException();
            }
            Map<String, Object> tool = (Map<String, Object>) focus.get("liveTool");
            liveTool = bounded(tool.get("name"), 96);
            liveToolStatus = bounded(tool.get("status"), 48);
            if (liveTool.isEmpty()) throw new IllegalArgumentException();
        }
        return new FocusSummary(Boolean.TRUE.equals(focus.get("active")),
                liveTool, liveToolStatus,
                bounded(focus.get("latestTodo"), 240),
                bounded(focus.get("pendingQuestion"), 240),
                bounded(focus.get("settledAnswer"), 240));
    }

    @SuppressWarnings("unchecked")
    private static LocationSummary parseLocation(Object value) {
        if (value == null) return new LocationSummary("local", "local");
        if (!(value instanceof Map)) throw new IllegalArgumentException();
        Map<String, Object> location = (Map<String, Object>) value;
        String kind = str(location.get("kind"));
        String status = str(location.get("status"));
        if (!Set.of("local", "remote", "cloud").contains(kind)
                || !Set.of("local", "online", "offline").contains(status)) {
            throw new IllegalArgumentException();
        }
        return new LocationSummary(kind, status);
    }

    private static String bounded(Object value, int max) {
        if (value == null) return "";
        if (!(value instanceof String)) throw new IllegalArgumentException();
        String text = (String) value;
        if (text.length() > max) throw new IllegalArgumentException();
        return text;
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

    @SuppressWarnings("unchecked")
    private static MessagingSummary parseMessaging(Object value) {
        if (value == null) {
            return new MessagingSummary(false, 0L, 0L, 0L, List.of());
        }
        if (!(value instanceof Map)) throw new IllegalArgumentException();
        Map<String, Object> messaging = (Map<String, Object>) value;
        if (!"cli".equals(str(messaging.get("authority")))
                || !(messaging.get("registered") instanceof Boolean)
                || !(messaging.get("revision") instanceof Number)
                || !(messaging.get("unread") instanceof Number)
                || !(messaging.get("held") instanceof Number)
                || !(messaging.get("endpoints") instanceof List)) {
            throw new IllegalArgumentException();
        }
        long revision = number(messaging.get("revision"));
        long unread = number(messaging.get("unread"));
        long held = number(messaging.get("held"));
        if (revision < 0 || unread < 0 || held < 0) {
            throw new IllegalArgumentException();
        }
        List<Object> rawEndpoints = (List<Object>) messaging.get("endpoints");
        if (rawEndpoints.size() > 16) throw new IllegalArgumentException();
        List<MessagingEndpoint> endpoints = new ArrayList<MessagingEndpoint>();
        long endpointUnread = 0L;
        long endpointHeld = 0L;
        for (Object raw : rawEndpoints) {
            if (!(raw instanceof Map)) throw new IllegalArgumentException();
            Map<String, Object> endpoint = (Map<String, Object>) raw;
            String name = str(endpoint.get("name"));
            String address = str(endpoint.get("address"));
            String policy = str(endpoint.get("policy"));
            long itemUnread = number(endpoint.get("unread"));
            long itemHeld = number(endpoint.get("held"));
            if (name.isEmpty() || name.length() > 64
                    || !address.startsWith("cc-session://")
                    || address.length() > 512
                    || !Set.of("accept", "hold", "refuse").contains(policy)
                    || !(endpoint.get("online") instanceof Boolean)
                    || !(endpoint.get("idle") instanceof Boolean)
                    || !(endpoint.get("unread") instanceof Number)
                    || !(endpoint.get("held") instanceof Number)
                    || itemUnread < 0 || itemHeld < 0) {
                throw new IllegalArgumentException();
            }
            endpointUnread += itemUnread;
            endpointHeld += itemHeld;
            endpoints.add(new MessagingEndpoint(name, address, policy,
                    Boolean.TRUE.equals(endpoint.get("online")),
                    Boolean.TRUE.equals(endpoint.get("idle")),
                    itemUnread, itemHeld));
        }
        boolean registered = Boolean.TRUE.equals(messaging.get("registered"));
        if (registered != !endpoints.isEmpty()
                || unread != endpointUnread || held != endpointHeld) {
            throw new IllegalArgumentException();
        }
        return new MessagingSummary(registered, revision, unread, held, endpoints);
    }

    @SuppressWarnings("unchecked")
    private static String projectionDetail(Map<String, Object> item) {
        List<String> parts = new ArrayList<String>();
        Map<String, Object> owner = item.get("owner") instanceof Map
                ? (Map<String, Object>) item.get("owner") : Map.of();
        String ownerType = str(owner.get("type"));
        String ownerId = str(owner.get("id"));
        if (!ownerType.isEmpty()) {
            parts.add("owner " + ownerType
                    + (ownerId.isEmpty() ? "" : ":" + ownerId));
        }
        Map<String, Object> worktree = item.get("worktree") instanceof Map
                ? (Map<String, Object>) item.get("worktree") : Map.of();
        String worktreeLabel = fallback(
                str(worktree.get("branch")), str(worktree.get("path")));
        if (!worktreeLabel.isEmpty()) parts.add("worktree " + worktreeLabel);

        Map<String, Object> artifact = item.get("artifact") instanceof Map
                ? (Map<String, Object>) item.get("artifact") : Map.of();
        long artifactCount = number(artifact.get("count"));
        Map<String, Object> latestArtifact = artifact.get("latest") instanceof Map
                ? (Map<String, Object>) artifact.get("latest") : Map.of();
        if (artifactCount > 0) {
            parts.add("artifacts " + artifactCount
                    + (str(latestArtifact.get("title")).isEmpty() ? ""
                    : " · " + str(latestArtifact.get("title"))));
        }

        Map<String, Object> approval = item.get("approval") instanceof Map
                ? (Map<String, Object>) item.get("approval") : Map.of();
        if (Boolean.TRUE.equals(approval.get("pending"))) {
            String type = fallback(str(approval.get("type")), "pending");
            long count = number(approval.get("count"));
            parts.add("input " + type + (count > 0 ? " (" + count + ")" : ""));
        }

        Map<String, Object> pr = item.get("pr") instanceof Map
                ? (Map<String, Object>) item.get("pr") : Map.of();
        long prCount = number(pr.get("count"));
        Map<String, Object> latestPr = pr.get("latest") instanceof Map
                ? (Map<String, Object>) pr.get("latest") : Map.of();
        if (prCount > 0) {
            String number = str(latestPr.get("number"));
            String state = str(latestPr.get("state"));
            parts.add("PR " + (number.isEmpty() ? prCount : "#" + number)
                    + (state.isEmpty() ? "" : " " + state));
        }
        Map<String, Object> workflow = item.get("workflow") instanceof Map
                ? (Map<String, Object>) item.get("workflow") : Map.of();
        if (!workflow.isEmpty()) {
            Map<String, Object> phase = workflow.get("phase") instanceof Map
                    ? (Map<String, Object>) workflow.get("phase") : Map.of();
            Map<String, Object> agents = workflow.get("agents") instanceof Map
                    ? (Map<String, Object>) workflow.get("agents") : Map.of();
            Map<String, Object> budget = workflow.get("budget") instanceof Map
                    ? (Map<String, Object>) workflow.get("budget") : Map.of();
            parts.add("phase " + fallback(str(phase.get("status")), "unknown"));
            parts.add("agents " + number(agents.get("settled")) + "/"
                    + number(agents.get("requested")));
            parts.add("budget " + fallback(str(budget.get("overall")), "unknown"));

            Map<String, Object> recent = workflow.get("recent") instanceof Map
                    ? (Map<String, Object>) workflow.get("recent") : Map.of();
            Map<String, Object> call = recent.get("call") instanceof Map
                    ? (Map<String, Object>) recent.get("call") : Map.of();
            if (!str(call.get("name")).isEmpty()) {
                parts.add("recent tool " + str(call.get("name")) + ":"
                        + fallback(str(call.get("status")), "unknown"));
            } else if (!str(recent.get("taskStatus")).isEmpty()) {
                parts.add("recent result " + str(recent.get("taskStatus")));
            }
            Map<String, Object> recovery = workflow.get("recovery") instanceof Map
                    ? (Map<String, Object>) workflow.get("recovery") : Map.of();
            long recoverable = number(recovery.get("terminal"));
            if (recoverable > 0) {
                parts.add("recoverable checkpoints " + recoverable);
            }
            Map<String, Object> recoveryPolicy =
                    workflow.get("recoveryPolicy") instanceof Map
                            ? (Map<String, Object>) workflow.get("recoveryPolicy")
                            : Map.of();
            String risk = str(recoveryPolicy.get("risk"));
            if (!risk.isEmpty() && !"none".equals(risk)) {
                parts.add("recovery "
                        + fallback(str(recoveryPolicy.get("severity")), "info")
                        + ":" + risk + " -> "
                        + fallback(str(recoveryPolicy.get("recommendedAction")),
                                "review"));
            }
        }
        return String.join(" · ", parts);
    }

    private static Snapshot disconnected(String error, boolean stale,
            String revision, Map<String, Object> sources) {
        return new Snapshot(false, stale, revision, error, List.of(), sources,
                false, "", List.of());
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
