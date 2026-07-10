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

    private static String or(Object value, String fallback) {
        String s = string(value);
        return s.isEmpty() ? fallback : s;
    }

    private static String string(Object value) {
        return value == null ? "" : String.valueOf(value);
    }
}
