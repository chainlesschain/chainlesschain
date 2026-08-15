package com.chainlesschain.ide;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Java twin of the deterministic {@code cc-context-center/v1} projection. */
public final class ContextCenter {
    public static final String SCHEMA = "cc-context-center/v1";
    public static final String ALGORITHM = "priority-stable-v1";
    public static final int DEFAULT_TOKEN_BUDGET = 4096;
    public static final int MAX_TOKEN_BUDGET = 32768;

    private static final int MAX_CANDIDATES = 64;
    private static final int MAX_CONTENT_BYTES = MAX_TOKEN_BUDGET * 4;
    private static final Pattern CHIP_ID =
            Pattern.compile("^ctx_[0-9a-f]{16}$");
    private static final List<String> KINDS = List.of(
            "selection", "active-file", "open-tabs", "diagnostics",
            "git-diff", "terminal-selection", "test-debug",
            "preview-evidence", "memory", "mcp-resource");

    private ContextCenter() {}

    /** Normalize the host-persisted, workspace-scoped Context Center intent. */
    public static Map<String, Object> normalizePreferences(
            Map<String, Object> value) {
        Map<String, Object> raw = value == null
                ? Collections.emptyMap() : value;
        int tokenBudget = DEFAULT_TOKEN_BUDGET;
        Object rawBudget = raw.get("tokenBudget");
        if (rawBudget instanceof Number) {
            double parsed = ((Number) rawBudget).doubleValue();
            if (Double.isFinite(parsed) && Math.rint(parsed) == parsed
                    && parsed >= 0 && parsed <= MAX_TOKEN_BUDGET) {
                tokenBudget = (int) parsed;
            }
        }
        Set<String> removed = idSet(stringValues(raw.get("removedIds")));
        Set<String> pinned = idSet(stringValues(raw.get("pinnedIds")));
        pinned.removeAll(removed);
        List<String> pinnedIds = new ArrayList<String>(pinned);
        List<String> removedIds = new ArrayList<String>(removed);
        Collections.sort(pinnedIds);
        Collections.sort(removedIds);
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("tokenBudget", Long.valueOf(tokenBudget));
        out.put("pinnedIds", pinnedIds);
        out.put("removedIds", removedIds);
        return out;
    }

    /** Apply one UI action without allowing malformed or overlapping IDs. */
    public static Map<String, Object> updatePreferences(
            Map<String, Object> value, String action, Object target) {
        Map<String, Object> current = normalizePreferences(value);
        if ("reset".equals(action)) {
            return normalizePreferences(Collections.emptyMap());
        }
        if ("budget".equals(action)) {
            Map<String, Object> next = new LinkedHashMap<String, Object>(current);
            next.put("tokenBudget", target);
            return normalizePreferences(next);
        }
        String id = text(target).trim();
        if (!CHIP_ID.matcher(id).matches()) return current;
        Set<String> pinned = idSet(stringValues(current.get("pinnedIds")));
        Set<String> removed = idSet(stringValues(current.get("removedIds")));
        if ("pin".equals(action)) {
            removed.remove(id);
            pinned.add(id);
        } else if ("unpin".equals(action)) {
            pinned.remove(id);
        } else if ("remove".equals(action)) {
            pinned.remove(id);
            removed.add(id);
        } else if ("restore".equals(action)) {
            removed.remove(id);
        }
        Map<String, Object> next = new LinkedHashMap<String, Object>();
        next.put("tokenBudget", current.get("tokenBudget"));
        next.put("pinnedIds", new ArrayList<String>(pinned));
        next.put("removedIds", new ArrayList<String>(removed));
        return normalizePreferences(next);
    }

    public static Map<String, Object> build(
            String workspaceId,
            List<Map<String, Object>> candidates,
            int tokenBudget,
            List<String> pinnedIds,
            List<String> removedIds,
            List<String> refreshedIds) {
        int limit = Math.max(0, Math.min(MAX_TOKEN_BUDGET, tokenBudget));
        Set<String> pinned = idSet(pinnedIds);
        Set<String> removed = idSet(removedIds);
        Set<String> refreshed = idSet(refreshedIds);

        List<Candidate> normalized = new ArrayList<Candidate>();
        if (candidates != null) {
            for (int i = 0; i < candidates.size() && i < MAX_CANDIDATES; i++) {
                Candidate candidate = normalize(candidates.get(i));
                if (candidate != null) normalized.add(candidate);
            }
        }
        Collections.sort(normalized, Comparator
                .comparing((Candidate value) -> value.id)
                .thenComparing(value -> value.content)
                .thenComparing(value -> value.label));
        Map<String, Candidate> unique = new LinkedHashMap<String, Candidate>();
        for (Candidate candidate : normalized) {
            unique.putIfAbsent(candidate.id, candidate);
        }
        List<Candidate> ranked = new ArrayList<Candidate>(unique.values());
        Collections.sort(ranked, (a, b) -> {
            int aRemoved = removed.contains(a.id) ? 1 : 0;
            int bRemoved = removed.contains(b.id) ? 1 : 0;
            if (aRemoved != bRemoved) return Integer.compare(aRemoved, bRemoved);
            int aPinned = aRemoved == 0 && (pinned.contains(a.id) || a.pinned)
                    ? 0 : 1;
            int bPinned = bRemoved == 0 && (pinned.contains(b.id) || b.pinned)
                    ? 0 : 1;
            if (aPinned != bPinned) return Integer.compare(aPinned, bPinned);
            int byKind = Integer.compare(KINDS.indexOf(a.kind), KINDS.indexOf(b.kind));
            return byKind != 0 ? byKind : a.id.compareTo(b.id);
        });

        int remaining = limit;
        int allocated = 0;
        List<Map<String, Object>> chips = new ArrayList<Map<String, Object>>();
        for (Candidate candidate : ranked) {
            boolean isRemoved = removed.contains(candidate.id);
            boolean isPinned = !isRemoved
                    && (pinned.contains(candidate.id) || candidate.pinned);
            int allocatedTokens = 0;
            String status = "removed";
            if (!isRemoved && remaining > 0) {
                allocatedTokens = Math.min(candidate.estimatedTokens, remaining);
                remaining -= allocatedTokens;
                allocated += allocatedTokens;
                status = allocatedTokens < candidate.estimatedTokens
                        ? "trimmed" : "included";
            } else if (!isRemoved) {
                status = "excluded-budget";
            }
            String content = truncateUtf8(
                    candidate.content, allocatedTokens * 4);
            Map<String, Object> chip = new LinkedHashMap<String, Object>();
            chip.put("id", candidate.id);
            chip.put("kind", candidate.kind);
            chip.put("label", candidate.label);
            chip.put("source", candidate.source);
            chip.put("scope", candidate.scope);
            chip.put("freshness", candidate.freshness);
            chip.put("range", candidate.range);
            chip.put("estimatedTokens", Long.valueOf(candidate.estimatedTokens));
            chip.put("allocatedTokens", Long.valueOf(allocatedTokens));
            chip.put("status", status);
            chip.put("pinned", Boolean.valueOf(isPinned));
            chip.put("refreshable", Boolean.valueOf(candidate.refreshable));
            chip.put("reason", isRemoved
                    ? "removed-by-user"
                    : isPinned
                            ? "user-pinned"
                            : refreshed.contains(candidate.id)
                                    ? "user-refreshed"
                                    : "excluded-budget".equals(status)
                                            ? "budget-exhausted"
                                            : "auto:" + candidate.autoReason);
            chip.put("content", content);
            chip.put("contentTruncated", Boolean.valueOf(
                    "trimmed".equals(status)
                            || utf8Length(content) < utf8Length(candidate.content)));
            chips.add(chip);
        }

        Map<String, Object> budget = new LinkedHashMap<String, Object>();
        budget.put("limitTokens", Long.valueOf(limit));
        budget.put("allocatedTokens", Long.valueOf(allocated));
        budget.put("remainingTokens", Long.valueOf(Math.max(0, limit - allocated)));
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("schema", SCHEMA);
        out.put("workspaceId",
                workspaceId == null || workspaceId.isEmpty() ? null : workspaceId);
        out.put("selectionAlgorithm", ALGORITHM);
        out.put("budget", budget);
        out.put("chips", chips);
        return out;
    }

    private static Candidate normalize(Map<String, Object> raw) {
        if (raw == null) return null;
        String kind = text(raw.get("kind"));
        if (!KINDS.contains(kind)) return null;
        String source = bounded(raw.get("source"), "ide-host", 128);
        String label = bounded(raw.get("label"), kind, 160);
        String scope = bounded(raw.get("scope"),
                bounded(raw.get("identity"), label, 512), 512);
        String content = truncateUtf8(text(raw.get("content")), MAX_CONTENT_BYTES);
        int estimatedTokens = estimateTokens(content);
        Object explicit = raw.get("estimatedTokens");
        if (explicit instanceof Number) {
            double value = ((Number) explicit).doubleValue();
            if (Double.isFinite(value) && value >= 1
                    && Math.rint(value) == value) {
                estimatedTokens = (int) Math.min(MAX_TOKEN_BUDGET, value);
            }
        }
        String id = text(raw.get("id"));
        if (!CHIP_ID.matcher(id).matches()) {
            id = stableId(kind, source, scope);
        }
        Map<String, Object> freshness = new LinkedHashMap<String, Object>();
        Object freshnessValue = raw.get("freshness");
        Map<?, ?> rawFreshness = freshnessValue instanceof Map
                ? (Map<?, ?>) freshnessValue : Collections.emptyMap();
        freshness.put("state", bounded(
                rawFreshness.get("state"), "live-host", 48));
        Object capturedAt = rawFreshness.get("capturedAt");
        freshness.put("capturedAt", capturedAt instanceof String
                ? ((String) capturedAt).substring(
                        0, Math.min(64, ((String) capturedAt).length()))
                : null);
        return new Candidate(
                id, kind, label, source, scope, content, estimatedTokens,
                raw.get("range") instanceof Map ? raw.get("range") : null,
                freshness,
                bounded(raw.get("autoReason"),
                        "available " + kind + " context", 240),
                !Boolean.FALSE.equals(raw.get("refreshable")),
                Boolean.TRUE.equals(raw.get("pinned")));
    }

    private static Set<String> idSet(List<String> values) {
        Set<String> out = new HashSet<String>();
        if (values == null) return out;
        for (int i = 0; i < values.size() && i < MAX_CANDIDATES; i++) {
            String value = values.get(i) == null ? "" : values.get(i).trim();
            if (CHIP_ID.matcher(value).matches()) out.add(value);
        }
        return out;
    }

    private static List<String> stringValues(Object value) {
        List<String> out = new ArrayList<String>();
        if (!(value instanceof List)) return out;
        for (Object item : (List<?>) value) {
            out.add(item == null ? "" : String.valueOf(item));
        }
        return out;
    }

    private static String stableId(String kind, String source, String identity) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(
                    (kind + "\n" + source + "\n" + identity)
                            .getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder("ctx_");
            for (int i = 0; i < 8; i++) {
                hex.append(String.format("%02x", digest[i] & 0xff));
            }
            return hex.toString();
        } catch (Exception impossible) {
            throw new IllegalStateException("SHA-256 unavailable", impossible);
        }
    }

    private static int estimateTokens(String content) {
        return Math.max(1, (utf8Length(content) + 3) / 4);
    }

    private static int utf8Length(String value) {
        return value.getBytes(StandardCharsets.UTF_8).length;
    }

    static String truncateUtf8(String value, int maxBytes) {
        String text = value == null ? "" : value;
        if (maxBytes <= 0) return "";
        if (utf8Length(text) <= maxBytes) return text;
        StringBuilder out = new StringBuilder();
        int used = 0;
        for (int offset = 0; offset < text.length();) {
            int codePoint = text.codePointAt(offset);
            String character = new String(Character.toChars(codePoint));
            int bytes = utf8Length(character);
            if (used + bytes > maxBytes) break;
            out.append(character);
            used += bytes;
            offset += Character.charCount(codePoint);
        }
        return out.toString();
    }

    private static String bounded(Object value, String fallback, int max) {
        String clean = text(value).trim();
        if (clean.isEmpty()) clean = fallback;
        return clean.length() <= max ? clean : clean.substring(0, max);
    }

    private static String text(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    private static final class Candidate {
        final String id;
        final String kind;
        final String label;
        final String source;
        final String scope;
        final String content;
        final int estimatedTokens;
        final Object range;
        final Map<String, Object> freshness;
        final String autoReason;
        final boolean refreshable;
        final boolean pinned;

        Candidate(String id, String kind, String label, String source,
                String scope, String content, int estimatedTokens, Object range,
                Map<String, Object> freshness, String autoReason,
                boolean refreshable, boolean pinned) {
            this.id = id;
            this.kind = kind;
            this.label = label;
            this.source = source;
            this.scope = scope;
            this.content = content;
            this.estimatedTokens = estimatedTokens;
            this.range = range;
            this.freshness = freshness;
            this.autoReason = autoReason;
            this.refreshable = refreshable;
            this.pinned = pinned;
        }
    }
}
