package com.chainlesschain.ide;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Pure helper for IDE-native plan review editor tabs. */
public final class PlanReview {
    private PlanReview() {}

    public static final int MAX_SNAPSHOT_CHARS = 24000;
    public static final String STATE_SCHEMA = "cc-plan-review/v1";
    public static final int MAX_PERSISTED_STATES = 20;
    public static final int MAX_PERSISTED_ITEMS = 128;
    public static final int MAX_COMMENTS = 64;
    public static final int MAX_COMMENT_CHARS = 2000;
    private static final Pattern FILE_REFERENCE = Pattern.compile(
            "((?:[A-Za-z]:[\\\\/])?(?:[\\w@.+()\\-]+[\\\\/])*"
                    + "[\\w@.+()\\-]+\\.[A-Za-z0-9]+):(\\d+)(?::(\\d+))?");

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
                String progress = formatProgress(item);
                if (!progress.isEmpty()) sb.append("   - progress: ").append(progress).append("\n");
                if (!string(item.get("error")).isEmpty()) {
                    sb.append("   - error: ").append(item.get("error")).append("\n");
                }
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
        return reviewRecord(action, documentText, conversationId, conversationTitle,
                sessionId, plan, latestPlanTurn(plan), "default", reviewedAt);
    }

    public static Map<String, Object> reviewRecord(
            String action,
            String documentText,
            String conversationId,
            String conversationTitle,
            String sessionId,
            Map<String, Object> plan,
            int turn,
            Instant reviewedAt) {
        return reviewRecord(action, documentText, conversationId, conversationTitle,
                sessionId, plan, turn, "default", reviewedAt);
    }

    public static Map<String, Object> reviewRecord(
            String action,
            String documentText,
            String conversationId,
            String conversationTitle,
            String sessionId,
            Map<String, Object> plan,
            int turn,
            String permissionMode,
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
        r.put("comments", extractComments(documentText, turn));
        if (turn > 0) r.put("turn", turn);
        if ("approve".equals(r.get("action"))) {
            r.put("executionLock", executionLockSummary(plan, permissionMode));
        }
        return r;
    }

    public static Map<String, Object> executionLockSummary(
            Map<String, Object> plan, String permissionMode) {
        Map<String, Object> source = plan != null
                ? plan : new LinkedHashMap<String, Object>();
        List<Map<String, Object>> items = normalizedItems(source.get("items"));
        List<String> itemIds = new ArrayList<String>();
        List<String> tools = new ArrayList<String>();
        tools.add("read_file");
        tools.add("search_files");
        tools.add("list_dir");
        tools.add("list_skills");
        for (Map<String, Object> item : items) {
            itemIds.add(or(item.get("id"), ""));
            String tool = string(item.get("tool"));
            if (!tool.isEmpty() && !tools.contains(tool)) tools.add(tool);
        }
        Collections.sort(tools);
        Map<String, Object> lock = new LinkedHashMap<String, Object>();
        lock.put("planId", or(source.get("planId"), or(source.get("plan_id"), "")));
        lock.put("permissionMode", or(permissionMode, "default"));
        lock.put("approvedItemIds", itemIds);
        lock.put("allowedTools", tools);
        return lock;
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
        return persistedState(documentText, conversationId, conversationTitle,
                sessionId, plan, status, action, previous, latestPlanTurn(plan), updatedAt);
    }

    public static Map<String, Object> persistedState(
            String documentText,
            String conversationId,
            String conversationTitle,
            String sessionId,
            Map<String, Object> plan,
            String status,
            String action,
            Map<String, Object> previous,
            int turn,
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
        state.put("comments", extractComments(documentText, turn));
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
        state.put("comments", source.get("comments") instanceof List
                ? normalizeComments(source.get("comments"))
                : extractComments(string(state.get("snapshot")),
                        latestPlanTurn((Map<String, Object>) state.get("plan"))));
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
            int turn = number(item.get("turn"), 0);
            if (turn > 0) row.put("turn", turn);
            copyBounded(row, "tool_use_id", item.get("tool_use_id"), 160);
            copyBounded(row, "started_at", item.get("started_at"), 64);
            copyBounded(row, "completed_at", item.get("completed_at"), 64);
            copyBounded(row, "error", item.get("error"), 1000);
            boundedItems.add(row);
        }
        snapshot.put("items", boundedItems);
        if (source.get("planId") != null || source.get("plan_id") != null) {
            snapshot.put("plan_id", bounded(
                    source.get("planId") != null
                            ? source.get("planId") : source.get("plan_id"), 160));
        }
        Object lockValue = source.get("executionLock") != null
                ? source.get("executionLock") : source.get("execution_lock");
        if (lockValue instanceof Map) {
            Map<?, ?> input = (Map<?, ?>) lockValue;
            Map<String, Object> lock = new LinkedHashMap<String, Object>();
            lock.put("planId", bounded(input.get("planId"), 160));
            lock.put("permissionMode", or(bounded(input.get("permissionMode"), 64), "default"));
            lock.put("approvedItemIds", boundedStrings(input.get("approvedItemIds"),
                    MAX_PERSISTED_ITEMS, 160));
            lock.put("allowedTools", boundedStrings(input.get("allowedTools"),
                    MAX_PERSISTED_ITEMS, 160));
            if (input.get("createdAt") != null) {
                lock.put("createdAt", bounded(input.get("createdAt"), 64));
            }
            snapshot.put("execution_lock", lock);
        }
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

    private static List<String> boundedStrings(Object value, int limit, int chars) {
        List<String> result = new ArrayList<String>();
        if (!(value instanceof List)) return result;
        for (Object entry : (List<?>) value) {
            if (result.size() >= limit) break;
            result.add(bounded(entry, chars));
        }
        return result;
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
                int turn = number(m.get("turn"), 0);
                if (turn > 0) row.put("turn", turn);
                row.put("tool_use_id", or(firstPresent(m, "tool_use_id", "toolUseId"), ""));
                row.put("started_at", or(firstPresent(m, "started_at", "startedAt"), ""));
                row.put("completed_at", or(firstPresent(m, "completed_at", "completedAt"), ""));
                row.put("error", or(m.get("error"), ""));
            } else {
                row.put("id", "item-" + n);
                row.put("title", String.valueOf(item));
                row.put("tool", "");
                row.put("impact", "low");
                row.put("status", "pending");
                row.put("tool_use_id", "");
                row.put("started_at", "");
                row.put("completed_at", "");
                row.put("error", "");
            }
            out.add(row);
            n++;
        }
        return out;
    }

    public static List<Map<String, Object>> extractComments(String documentText, int turn) {
        String[] lines = string(documentText).split("\\r?\\n", -1);
        List<Map<String, Object>> comments = new ArrayList<Map<String, Object>>();
        String itemId = null;
        boolean reviewerNotes = false;
        for (int index = 0; index < lines.length && comments.size() < MAX_COMMENTS; index++) {
            String line = lines[index];
            Matcher heading = Pattern.compile("^##\\s+(.+?)\\s*$").matcher(line);
            if (heading.matches()) {
                reviewerNotes = "Reviewer Notes".equalsIgnoreCase(heading.group(1));
                itemId = null;
                continue;
            }
            if (line.matches("^\\d+\\.\\s+.*")) {
                reviewerNotes = false;
                itemId = null;
                continue;
            }
            Matcher id = Pattern.compile("^\\s*-\\s*id:\\s*(.+?)\\s*$",
                    Pattern.CASE_INSENSITIVE).matcher(line);
            if (id.matches()) {
                itemId = bounded(id.group(1), 160);
                continue;
            }
            Matcher inline = Pattern.compile("^\\s*-\\s*comment:\\s*(.*)$",
                    Pattern.CASE_INSENSITIVE).matcher(line);
            if (inline.matches()) {
                StringBuilder text = new StringBuilder(inline.group(1).trim());
                int cursor = index + 1;
                while (cursor < lines.length) {
                    String continuation = lines[cursor];
                    if (continuation.matches(
                            "(?i)^\\s*-\\s*(id|impact|status|progress|error|comment):.*")
                            || continuation.matches("^\\d+\\.\\s+.*")
                            || continuation.matches("^##\\s+.*")) {
                        break;
                    }
                    if (!continuation.trim().isEmpty()) {
                        if (text.length() > 0) text.append("\n");
                        text.append(continuation.trim());
                    }
                    cursor++;
                }
                addComment(comments, text.toString(), index + 1, itemId, turn);
                index = cursor - 1;
                continue;
            }
            if (reviewerNotes) {
                Matcher note = Pattern.compile("^\\s*[-*]\\s+(.+?)\\s*$").matcher(line);
                if (note.matches()) addComment(comments, note.group(1), index + 1, null, turn);
            }
        }
        return comments;
    }

    public static List<Map<String, Object>> normalizeComments(Object values) {
        List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
        if (!(values instanceof List)) return out;
        for (Object raw : (List<?>) values) {
            if (out.size() >= MAX_COMMENTS) break;
            if (!(raw instanceof Map)) continue;
            Map<?, ?> source = (Map<?, ?>) raw;
            String text = bounded(source.get("text"), MAX_COMMENT_CHARS).trim();
            if (text.isEmpty()) continue;
            Map<String, Object> comment = new LinkedHashMap<String, Object>();
            comment.put("id", or(bounded(source.get("id"), 160),
                    "comment-" + (out.size() + 1)));
            comment.put("sourceLine", positive(source.get("sourceLine")));
            comment.put("itemId", emptyToNull(bounded(source.get("itemId"), 160)));
            comment.put("text", text);
            Map<String, Object> reference = fileReference(text);
            comment.put("file", orNull(
                    emptyToNull(bounded(source.get("file"), 1024)), reference.get("file")));
            comment.put("line", orNull(positive(source.get("line")), reference.get("line")));
            comment.put("column", orNull(
                    positive(source.get("column")), reference.get("column")));
            comment.put("turn", positive(source.get("turn")));
            out.add(comment);
        }
        return out;
    }

    /** Update only machine-owned status/progress lines; reviewer text is preserved. */
    public static String mergeProgress(String documentText, Map<String, Object> plan) {
        Map<String, Map<String, Object>> byId = new LinkedHashMap<String, Map<String, Object>>();
        for (Map<String, Object> item : normalizedItems(plan == null ? null : plan.get("items"))) {
            byId.put(string(item.get("id")), item);
        }
        String[] lines = string(documentText).split("\\r?\\n", -1);
        List<String> out = new ArrayList<String>();
        String itemId = null;
        Pattern idPattern = Pattern.compile("^\\s*-\\s*id:\\s*(.+?)\\s*$",
                Pattern.CASE_INSENSITIVE);
        Pattern statusPattern = Pattern.compile("^(\\s*-\\s*status:)\\s*.*$",
                Pattern.CASE_INSENSITIVE);
        for (int index = 0; index < lines.length; index++) {
            String line = lines[index];
            Matcher id = idPattern.matcher(line);
            if (id.matches()) itemId = id.group(1);
            if (line.matches("^\\d+\\.\\s+.*") || line.matches("^##\\s+.*")) itemId = null;
            Map<String, Object> item = itemId == null ? null : byId.get(itemId);
            Matcher status = statusPattern.matcher(line);
            if (!status.matches() || item == null) {
                if (item != null && line.matches("(?i)^\\s*-\\s*(progress|error):.*")) continue;
                out.add(line);
                continue;
            }
            out.add(status.group(1) + " " + or(item.get("status"), "pending"));
            String indent = leadingWhitespace(status.group(1));
            String progress = formatProgress(item);
            if (!progress.isEmpty()) out.add(indent + "- progress: " + progress);
            if (!string(item.get("error")).isEmpty()) {
                out.add(indent + "- error: " + item.get("error"));
            }
            while (index + 1 < lines.length
                    && lines[index + 1].matches("(?i)^\\s*-\\s*(progress|error):.*")) {
                index++;
            }
        }
        return String.join("\n", out);
    }

    private static void addComment(
            List<Map<String, Object>> comments,
            String text,
            int sourceLine,
            String itemId,
            int turn) {
        Map<String, Object> raw = new LinkedHashMap<String, Object>();
        raw.put("id", "comment-" + (comments.size() + 1));
        raw.put("sourceLine", sourceLine);
        raw.put("itemId", itemId);
        raw.put("text", text);
        if (turn > 0) raw.put("turn", turn);
        List<Map<String, Object>> normalized = normalizeComments(List.of(raw));
        if (!normalized.isEmpty()) comments.add(normalized.get(0));
    }

    private static Map<String, Object> fileReference(String text) {
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        Matcher matcher = FILE_REFERENCE.matcher(string(text));
        if (!matcher.find()) return out;
        out.put("file", bounded(matcher.group(1), 1024));
        out.put("line", Integer.parseInt(matcher.group(2)));
        if (matcher.group(3) != null) out.put("column", Integer.parseInt(matcher.group(3)));
        return out;
    }

    private static String formatProgress(Map<String, Object> item) {
        List<String> parts = new ArrayList<String>();
        int turn = number(item.get("turn"), 0);
        if (turn > 0) parts.add("turn " + turn);
        if (!string(item.get("tool_use_id")).isEmpty()) {
            parts.add("tool use " + item.get("tool_use_id"));
        }
        if (!string(item.get("started_at")).isEmpty()) {
            parts.add("started " + item.get("started_at"));
        }
        if (!string(item.get("completed_at")).isEmpty()) {
            parts.add("completed " + item.get("completed_at"));
        }
        return String.join("; ", parts);
    }

    private static int latestPlanTurn(Map<String, Object> plan) {
        int latest = 0;
        for (Map<String, Object> item : normalizedItems(plan == null ? null : plan.get("items"))) {
            latest = Math.max(latest, number(item.get("turn"), 0));
        }
        return latest;
    }

    private static void copyBounded(
            Map<String, Object> target, String key, Object value, int limit) {
        String text = bounded(value, limit);
        if (!text.isEmpty()) target.put(key, text);
    }

    private static Integer positive(Object value) {
        int n = number(value, 0);
        return n > 0 ? n : null;
    }

    private static Object orNull(Object preferred, Object fallback) {
        return preferred != null ? preferred : fallback;
    }

    private static String emptyToNull(String value) {
        return value == null || value.isEmpty() ? null : value;
    }

    private static String leadingWhitespace(String value) {
        int index = 0;
        while (index < value.length() && Character.isWhitespace(value.charAt(index))) index++;
        return value.substring(0, index);
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
