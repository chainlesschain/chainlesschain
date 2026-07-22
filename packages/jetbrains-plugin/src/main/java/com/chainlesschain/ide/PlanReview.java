package com.chainlesschain.ide;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Pure helper for IDE-native plan review editor tabs. */
public final class PlanReview {
    private PlanReview() {}

    public static final int MAX_SNAPSHOT_CHARS = 24000;
    public static final String STATE_SCHEMA = "cc-plan-review/v1";
    public static final int MAX_PERSISTED_STATES = 20;
    public static final int MAX_PERSISTED_ITEMS = 128;

    public static String markdown(
            Map<String, Object> plan,
            String conversationTitle,
            String sessionId,
            Instant updatedAt) {
        Map<String, Object> p = plan != null ? plan : new LinkedHashMap<String, Object>();
        List<Map<String, Object>> items = normalizedItems(p.get("items"));
        StringBuilder sb = new StringBuilder();
        sb.append("# ChainlessChain Plan Review\n\n");
        sb.append("- Conversation: ").append(or(conversationTitle, "Chat")).append("\n");
        sb.append("- Session: ").append(or(sessionId, "(pending)")).append("\n");
        sb.append("- State: ").append(or(p.get("state"), "analyzing")).append("\n");
        sb.append("- Updated: ").append(updatedAt != null ? updatedAt : Instant.now()).append("\n");
        Object risk = p.get("risk");
        if (risk instanceof Map) {
            Map<?, ?> r = (Map<?, ?>) risk;
            sb.append("- Risk: ").append(or(r.get("level"), "unknown"));
            if (r.get("totalScore") != null) sb.append(" (").append(r.get("totalScore")).append(")");
            sb.append("\n");
        }
        if (p.get("note") != null) sb.append("- Note: ").append(p.get("note")).append("\n");
        sb.append("\n## Review Actions\n\n");
        sb.append("Use the Plan card buttons, /approve, /reject, or the chat toolbar actions.\n\n");
        sb.append("## Inline Comments\n\n");
        sb.append("Add comments under the relevant plan item or in Reviewer Notes before choosing an action.\n\n");
        sb.append("## Plan Items\n\n");
        if (items.isEmpty()) {
            sb.append("- (No plan items yet. Blocked write/execute tools will appear here.)\n");
        } else {
            int n = 1;
            for (Map<String, Object> item : items) {
                String tool = string(item.get("tool"));
                sb.append(n++).append(". ");
                if (!tool.isEmpty()) sb.append(tool).append(": ");
                sb.append(or(item.get("title"), "(untitled item)")).append("\n");
                sb.append("   - id: ").append(or(item.get("id"), "")).append("\n");
                sb.append("   - impact: ").append(or(item.get("impact"), "low")).append("\n");
                sb.append("   - status: ").append(or(item.get("status"), "pending")).append("\n");
                sb.append("   - comment:\n");
            }
        }
        sb.append("\n## Reviewer Notes\n\n- ");
        return sb.toString();
    }

    public static Map<String, Object> reviewRecord(
            String action,
            String documentText,
            String conversationId,
            String conversationTitle,
            String sessionId,
            Map<String, Object> plan,
            Instant reviewedAt) {
        Map<String, Object> r = new LinkedHashMap<String, Object>();
        r.put("action", or(action, "review"));
        r.put("reviewedAt", String.valueOf(reviewedAt != null ? reviewedAt : Instant.now()));
        r.put("conversationId", or(conversationId, ""));
        r.put("conversationTitle", or(conversationTitle, ""));
        r.put("sessionId", or(sessionId, ""));
        r.put("planState", plan == null ? "" : or(plan.get("state"), ""));
        r.put("itemCount", normalizedItems(plan == null ? null : plan.get("items")).size());
        r.put("snapshot", trimSnapshot(documentText));
        return r;
    }

    public static Map<String, Object> planEvent(String action, Map<String, Object> review) {
        Map<String, Object> ev = MiniJson.obj();
        ev.put("type", "plan");
        ev.put("action", action);
        if (review != null && review.get("snapshot") instanceof String
                && !String.valueOf(review.get("snapshot")).trim().isEmpty()) {
            ev.put("review", review);
        }
        return ev;
    }

    public static String feedbackPrompt(String action, String documentText) {
        String verb = "regenerate".equals(action)
                ? "Regenerate the plan from scratch"
                : "Revise the plan";
        return verb + " based on this plan review document.\n\n"
                + "Keep plan mode active. Do not execute write or shell tools until "
                + "the revised plan is approved.\n\n"
                + "```markdown\n"
                + trimSnapshot(documentText)
                + "\n```";
    }

    public static String trimSnapshot(String text) {
        String raw = text == null ? "" : text;
        if (raw.length() <= MAX_SNAPSHOT_CHARS) return raw;
        int omitted = raw.length() - MAX_SNAPSHOT_CHARS;
        return raw.substring(0, MAX_SNAPSHOT_CHARS)
                + "\n\n[review snapshot truncated: " + omitted + " chars omitted]";
    }

    /** Build one bounded, versioned plan-review draft/decision snapshot. */
    public static Map<String, Object> persistedState(
            String documentText,
            String conversationId,
            String conversationTitle,
            String sessionId,
            Map<String, Object> plan,
            String status,
            String action,
            Map<String, Object> previous,
            Instant updatedAt) {
        Map<String, Object> prior = normalizePersistedState(previous);
        Map<String, Object> state = new LinkedHashMap<String, Object>();
        state.put("schema", STATE_SCHEMA);
        state.put("revision", prior == null ? 1 : number(prior.get("revision"), 1) + 1);
        state.put("updatedAt", String.valueOf(updatedAt != null ? updatedAt : Instant.now()));
        state.put("conversationId", bounded(conversationId, 256));
        state.put("conversationTitle", bounded(conversationTitle, 256));
        state.put("sessionId", bounded(sessionId, 256));
        state.put("status", or(bounded(status, 64), "draft"));
        state.put("action", bounded(action, 64));
        state.put("plan", sanitizePlanSnapshot(plan));
        state.put("snapshot", trimSnapshot(documentText));
        return normalizePersistedState(state);
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> normalizePersistedState(Object value) {
        if (!(value instanceof Map)) return null;
        Map<?, ?> source = (Map<?, ?>) value;
        if (!STATE_SCHEMA.equals(source.get("schema"))) return null;
        Map<String, Object> state = new LinkedHashMap<String, Object>();
        state.put("schema", STATE_SCHEMA);
        state.put("revision", Math.max(1, number(source.get("revision"), 1)));
        state.put("updatedAt", bounded(source.get("updatedAt"), 64));
        state.put("conversationId", bounded(source.get("conversationId"), 256));
        state.put("conversationTitle", bounded(source.get("conversationTitle"), 256));
        state.put("sessionId", bounded(source.get("sessionId"), 256));
        state.put("status", or(bounded(source.get("status"), 64), "draft"));
        state.put("action", bounded(source.get("action"), 64));
        state.put("plan", sanitizePlanSnapshot(
                source.get("plan") instanceof Map
                        ? (Map<String, Object>) source.get("plan") : null));
        state.put("snapshot", trimSnapshot(string(source.get("snapshot"))));
        return persistedIdentity(state).isEmpty() ? null : state;
    }

    public static Map<String, Object> findPersistedState(
            Object values, String sessionId, String conversationId) {
        String wanted = persistedIdentity(sessionId, conversationId);
        if (wanted.isEmpty() || !(values instanceof List)) return null;
        List<?> list = (List<?>) values;
        for (int i = list.size() - 1; i >= 0; i--) {
            Map<String, Object> state = normalizePersistedState(list.get(i));
            if (state != null && wanted.equals(persistedIdentity(state))) return state;
        }
        return null;
    }

    public static List<Map<String, Object>> upsertPersistedState(
            Object values, Map<String, Object> value) {
        Map<String, Object> state = normalizePersistedState(value);
        List<Map<String, Object>> kept = new ArrayList<Map<String, Object>>();
        String identity = state == null ? "" : persistedIdentity(state);
        if (values instanceof List) {
            for (Object raw : (List<?>) values) {
                Map<String, Object> entry = normalizePersistedState(raw);
                if (entry != null && !identity.equals(persistedIdentity(entry))) {
                    kept.add(entry);
                }
            }
        }
        if (state != null) kept.add(state);
        if (kept.size() <= MAX_PERSISTED_STATES) return kept;
        return new ArrayList<Map<String, Object>>(
                kept.subList(kept.size() - MAX_PERSISTED_STATES, kept.size()));
    }

    public static Map<String, Object> sanitizePlanSnapshot(Map<String, Object> plan) {
        Map<String, Object> source = plan != null ? plan : new LinkedHashMap<String, Object>();
        Map<String, Object> snapshot = new LinkedHashMap<String, Object>();
        snapshot.put("active", Boolean.TRUE.equals(source.get("active")));
        snapshot.put("state", bounded(source.get("state"), 128));
        List<Map<String, Object>> items = normalizedItems(source.get("items"));
        List<Map<String, Object>> boundedItems = new ArrayList<Map<String, Object>>();
        for (int i = 0; i < items.size() && i < MAX_PERSISTED_ITEMS; i++) {
            Map<String, Object> item = items.get(i);
            Map<String, Object> row = new LinkedHashMap<String, Object>();
            row.put("id", bounded(item.get("id"), 160));
            row.put("title", bounded(item.get("title"), 512));
            row.put("tool", bounded(item.get("tool"), 160));
            row.put("impact", bounded(item.get("impact"), 64));
            row.put("status", bounded(item.get("status"), 64));
            boundedItems.add(row);
        }
        snapshot.put("items", boundedItems);
        if (source.get("note") != null) snapshot.put("note", bounded(source.get("note"), 2000));
        if (source.get("risk") instanceof Map) {
            Map<?, ?> inputRisk = (Map<?, ?>) source.get("risk");
            Map<String, Object> risk = new LinkedHashMap<String, Object>();
            risk.put("level", bounded(inputRisk.get("level"), 64));
            if (inputRisk.get("totalScore") instanceof Number) {
                risk.put("totalScore", inputRisk.get("totalScore"));
            }
            snapshot.put("risk", risk);
        }
        return snapshot;
    }

    @SuppressWarnings("unchecked")
    public static List<Map<String, Object>> normalizedItems(Object value) {
        List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
        if (!(value instanceof List)) return out;
        int n = 1;
        for (Object item : (List<?>) value) {
            Map<String, Object> row = new LinkedHashMap<String, Object>();
            if (item instanceof Map) {
                Map<?, ?> m = (Map<?, ?>) item;
                row.put("id", or(m.get("id"), "item-" + n));
                row.put("title", or(firstPresent(m, "title", "text"), "(untitled item)"));
                row.put("tool", or(m.get("tool"), ""));
                row.put("impact", or(firstPresent(m, "impact", "estimatedImpact"), "low"));
                row.put("status", or(m.get("status"), "pending"));
            } else {
                row.put("id", "item-" + n);
                row.put("title", String.valueOf(item));
                row.put("tool", "");
                row.put("impact", "low");
                row.put("status", "pending");
            }
            out.add(row);
            n++;
        }
        return out;
    }

    private static Object firstPresent(Map<?, ?> m, String... keys) {
        for (String key : keys) {
            Object v = m.get(key);
            if (v != null && !String.valueOf(v).isEmpty()) return v;
        }
        return null;
    }

    private static String persistedIdentity(Map<String, Object> state) {
        return persistedIdentity(string(state.get("sessionId")), string(state.get("conversationId")));
    }

    private static String persistedIdentity(String sessionId, String conversationId) {
        String session = bounded(sessionId, 256);
        if (!session.isEmpty()) return "session:" + session;
        String conversation = bounded(conversationId, 256);
        return conversation.isEmpty() ? "" : "conversation:" + conversation;
    }

    private static int number(Object value, int fallback) {
        return value instanceof Number ? ((Number) value).intValue() : fallback;
    }

    private static String bounded(Object value, int limit) {
        String s = string(value);
        return s.length() <= limit ? s : s.substring(0, limit);
    }

    private static String or(Object value, String fallback) {
        String s = string(value);
        return s.isEmpty() ? fallback : s;
    }

    private static String string(Object value) {
        return value == null ? "" : String.valueOf(value);
    }
}
