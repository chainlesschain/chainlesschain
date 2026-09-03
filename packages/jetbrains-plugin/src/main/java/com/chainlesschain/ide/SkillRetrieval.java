package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Fail-closed JetBrains boundary for {@code cc skill search --json}. The IDE
 * displays canonical routing evidence only; it never executes a Skill or owns
 * the retrieval algorithm.
 */
public final class SkillRetrieval {
    public static final String SCHEMA = "chainlesschain.skill-retrieval-result/v1";
    public static final int MAX_CANDIDATES = 64;
    public static final int MAX_REJECTIONS = 10_000;
    public static final int MAX_QUERY_LENGTH = 4_096;
    public static final int MAX_JSON_LENGTH = 8 * 1024 * 1024;

    private static final Pattern DIGEST = Pattern.compile("sha256:[a-f0-9]{64}");
    private static final Set<String> CONFLICT_TYPES = Set.of(
            "same-name-different-version", "ambiguous-top-score");

    private SkillRetrieval() {}

    public static final class Candidate {
        public final String id;
        public final String displayName;
        public final String namespace;
        public final String version;
        public final String digest;
        public final String category;
        public final long contextCostTokens;
        public final double score;
        public final String reason;

        private Candidate(String id, String displayName, String namespace,
                String version, String digest, String category,
                long contextCostTokens, double score, String reason) {
            this.id = id;
            this.displayName = displayName;
            this.namespace = namespace;
            this.version = version;
            this.digest = digest;
            this.category = category;
            this.contextCostTokens = contextCostTokens;
            this.score = score;
            this.reason = reason;
        }
    }

    public static final class Result {
        public final String query;
        public final String selectedDigest;
        public final boolean vectorAvailable;
        public final int conflictCount;
        public final int rejectedCount;
        public final List<Candidate> candidates;

        private Result(String query, String selectedDigest,
                boolean vectorAvailable, int conflictCount, int rejectedCount,
                List<Candidate> candidates) {
            this.query = query;
            this.selectedDigest = selectedDigest;
            this.vectorAvailable = vectorAvailable;
            this.conflictCount = conflictCount;
            this.rejectedCount = rejectedCount;
            this.candidates = List.copyOf(candidates);
        }

        public boolean abstained() {
            return selectedDigest == null && conflictCount > 0;
        }
    }

    public static List<String> buildSearchArgs(String query, int limit) {
        String normalized = query == null ? "" : query.trim();
        if (normalized.isEmpty() || normalized.length() > MAX_QUERY_LENGTH
                || limit < 1 || limit > MAX_CANDIDATES) {
            throw new IllegalArgumentException("a bounded Skill search query is required");
        }
        return List.of("skill", "search", normalized, "--limit",
                String.valueOf(limit), "--json");
    }

    public static Result parseResult(String json) {
        if (json == null || json.isBlank() || json.length() > MAX_JSON_LENGTH) return null;
        try {
            Map<String, Object> root = MiniJson.parseObject(json);
            String schema = text(root.get("schema"), 128);
            String query = requiredText(root.get("query"), MAX_QUERY_LENGTH);
            List<Object> rawCandidates = list(root.get("candidates"));
            List<Object> rawConflicts = list(root.get("conflicts"));
            List<Object> rawRejected = list(root.get("rejected"));
            Object vectorAvailable = root.get("vectorAvailable");
            if (!SCHEMA.equals(schema) || query == null || !query.equals(query.trim())
                    || !root.containsKey("selected")
                    || rawCandidates == null || rawCandidates.size() > MAX_CANDIDATES
                    || rawConflicts == null || rawConflicts.size() > MAX_CANDIDATES
                    || rawRejected == null || rawRejected.size() > MAX_REJECTIONS
                    || !(vectorAvailable instanceof Boolean)) return null;

            ArrayList<Candidate> candidates = new ArrayList<>();
            HashSet<String> digests = new HashSet<>();
            for (Object item : rawCandidates) {
                Candidate candidate = parseCandidate(object(item));
                if (candidate == null || !digests.add(candidate.digest)) return null;
                candidates.add(candidate);
            }
            for (Object item : rawConflicts) {
                if (!validConflict(object(item))) return null;
            }
            for (Object item : rawRejected) {
                if (!validRejection(object(item))) return null;
            }

            String selectedDigest = null;
            Object rawSelected = root.get("selected");
            if (rawSelected != null) {
                Candidate selected = parseCandidate(object(rawSelected));
                if (selected == null) return null;
                Candidate canonical = null;
                for (Candidate candidate : candidates) {
                    if (candidate.digest.equals(selected.digest)
                            && candidate.id.equals(selected.id)) {
                        canonical = candidate;
                        break;
                    }
                }
                if (canonical == null) return null;
                selectedDigest = canonical.digest;
            }
            if ((candidates.isEmpty() && selectedDigest != null)
                    || (!candidates.isEmpty() && selectedDigest == null
                            && rawConflicts.isEmpty())
                    || (selectedDigest != null
                            && !selectedDigest.equals(candidates.get(0).digest))) return null;
            return new Result(query, selectedDigest, (Boolean) vectorAvailable,
                    rawConflicts.size(), rawRejected.size(), candidates);
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    public static String describe(Result result, Candidate candidate) {
        if (result == null || candidate == null
                || !result.candidates.contains(candidate)) return "";
        return "Execution authorized: false"
                + "\nQuery: " + result.query
                + "\nSelected by router: "
                + (candidate.digest.equals(result.selectedDigest) ? "yes" : "no")
                + "\nSkill: " + candidate.displayName + " (" + candidate.id + ")"
                + "\nVersion: " + candidate.version
                + "\nNamespace: " + candidate.namespace
                + "\nCategory: " + candidate.category
                + "\nDigest: " + candidate.digest
                + "\nContext cost: " + candidate.contextCostTokens + " tokens"
                + "\nScore: " + String.format(java.util.Locale.ROOT, "%.3f", candidate.score)
                + "\nReason: " + candidate.reason
                + "\nConflicts: " + result.conflictCount
                + "\nRejected before recall: " + result.rejectedCount;
    }

    public static String shortDigest(String value) {
        return isDigest(value) ? value.substring(0, 15) + "…" + value.substring(63) : "—";
    }

    private static Candidate parseCandidate(Map<String, Object> value) {
        if (value == null) return null;
        String id = requiredText(value.get("id"), 256);
        String displayName = requiredText(value.get("displayName"), 512);
        String namespace = requiredText(value.get("namespace"), 128);
        String version = requiredText(value.get("version"), 128);
        String digest = digest(value.get("digest"));
        String category = requiredText(value.get("category"), 128);
        Long contextCost = nonNegativeLong(value.get("contextCostTokens"));
        Double score = unitDouble(value.get("score"));
        String reason = requiredText(value.get("reason"), 2_048);
        Map<String, Object> scores = object(value.get("scores"));
        Map<String, Object> outcome = object(value.get("outcome"));
        if (id == null || displayName == null || namespace == null || version == null
                || digest == null || category == null || contextCost == null
                || score == null || reason == null || scores == null || outcome == null
                || unitDouble(scores.get("lexical")) == null
                || unitDouble(scores.get("vector")) == null
                || unitDouble(scores.get("outcome")) == null
                || nonNegativeLong(outcome.get("samples")) == null
                || unitDouble(outcome.get("successRate")) == null
                || unitDouble(outcome.get("correctionRate")) == null) return null;
        return new Candidate(id, displayName, namespace, version, digest,
                category, contextCost, score, reason);
    }

    private static boolean validConflict(Map<String, Object> value) {
        if (value == null || !CONFLICT_TYPES.contains(text(value.get("type"), 64))) {
            return false;
        }
        List<String> digests = stringList(value.get("digests"), 2, 71);
        if (digests == null || digests.size() != 2
                || digests.stream().anyMatch(item -> !isDigest(item))
                || digests.get(0).equals(digests.get(1))) return false;
        if ("same-name-different-version".equals(value.get("type"))
                && requiredText(value.get("name"), 256) == null) return false;
        return !"ambiguous-top-score".equals(value.get("type"))
                || unitDouble(value.get("margin")) != null;
    }

    private static boolean validRejection(Map<String, Object> value) {
        if (value == null || requiredText(value.get("id"), 256) == null) return false;
        Object rawDigest = value.get("digest");
        if (rawDigest != null && digest(rawDigest) == null) return false;
        List<String> reasons = stringList(value.get("reasons"), 16, 512);
        return reasons != null && !reasons.isEmpty();
    }

    private static boolean isDigest(String value) {
        return value != null && DIGEST.matcher(value).matches();
    }

    private static String digest(Object value) {
        String result = text(value, 71);
        return isDigest(result) ? result : null;
    }

    private static String requiredText(Object value, int limit) {
        String result = text(value, limit);
        return result == null || result.isBlank() ? null : result;
    }

    private static String text(Object value, int limit) {
        if (!(value instanceof String)) return null;
        String result = (String) value;
        return result.length() <= limit ? result : null;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> object(Object value) {
        return value instanceof Map ? (Map<String, Object>) value : null;
    }

    @SuppressWarnings("unchecked")
    private static List<Object> list(Object value) {
        return value instanceof List ? (List<Object>) value : null;
    }

    private static List<String> stringList(Object value, int maxItems, int maxLength) {
        List<Object> raw = list(value);
        if (raw == null || raw.size() > maxItems) return null;
        ArrayList<String> result = new ArrayList<>();
        for (Object item : raw) {
            String string = requiredText(item, maxLength);
            if (string == null) return null;
            result.add(string);
        }
        return result;
    }

    private static Long nonNegativeLong(Object value) {
        if (!(value instanceof Number)) return null;
        double numeric = ((Number) value).doubleValue();
        if (!Double.isFinite(numeric) || numeric < 0 || numeric != Math.rint(numeric)
                || numeric > Long.MAX_VALUE) return null;
        return (long) numeric;
    }

    private static Double unitDouble(Object value) {
        if (!(value instanceof Number)) return null;
        double numeric = ((Number) value).doubleValue();
        return Double.isFinite(numeric) && numeric >= 0 && numeric <= 1 ? numeric : null;
    }
}
