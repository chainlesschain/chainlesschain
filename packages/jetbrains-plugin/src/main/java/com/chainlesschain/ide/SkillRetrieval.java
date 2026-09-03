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
    public static final String TRANSCRIPT_OUTCOME_AUTHORITY_SCHEMA =
            "chainlesschain.skill-outcome-transcript-authority/v1";
    public static final String INDEX_OUTCOME_AUTHORITY_SCHEMA =
            "chainlesschain.skill-outcome-index-authority/v1";
    public static final String VECTOR_AUTHORITY_SCHEMA =
            "chainlesschain.skill-vector-authority/v1";
    public static final String OUTCOME_AUTHORITY_SCHEMA =
            TRANSCRIPT_OUTCOME_AUTHORITY_SCHEMA;
    public static final int MAX_CANDIDATES = 64;
    public static final int MAX_REJECTIONS = 10_000;
    public static final int MAX_QUERY_LENGTH = 4_096;
    public static final int MAX_JSON_LENGTH = 8 * 1024 * 1024;
    private static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;

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
        public final String outcomeAuthorityStatus;
        public final String outcomeSourceDigest;
        public final String vectorAuthorityStatus;
        public final String vectorModel;
        public final String vectorIndexDigest;
        public final List<Candidate> candidates;

        private Result(String query, String selectedDigest,
                boolean vectorAvailable, int conflictCount, int rejectedCount,
                String outcomeAuthorityStatus, String outcomeSourceDigest,
                String vectorAuthorityStatus, String vectorModel,
                String vectorIndexDigest,
                List<Candidate> candidates) {
            this.query = query;
            this.selectedDigest = selectedDigest;
            this.vectorAvailable = vectorAvailable;
            this.conflictCount = conflictCount;
            this.rejectedCount = rejectedCount;
            this.outcomeAuthorityStatus = outcomeAuthorityStatus;
            this.outcomeSourceDigest = outcomeSourceDigest;
            this.vectorAuthorityStatus = vectorAuthorityStatus;
            this.vectorModel = vectorModel;
            this.vectorIndexDigest = vectorIndexDigest;
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
            OutcomeAuthority outcomeAuthority = parseOutcomeAuthority(
                    object(root.get("outcomeAuthority")));
            VectorAuthority vectorAuthority = parseVectorAuthority(
                    object(root.get("vectorAuthority")), vectorAvailable);
            if (!SCHEMA.equals(schema) || query == null || !query.equals(query.trim())
                    || !root.containsKey("selected")
                    || rawCandidates == null || rawCandidates.size() > MAX_CANDIDATES
                    || rawConflicts == null || rawConflicts.size() > MAX_CANDIDATES
                    || rawRejected == null || rawRejected.size() > MAX_REJECTIONS
                    || !(vectorAvailable instanceof Boolean)
                    || outcomeAuthority == null || vectorAuthority == null) return null;

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
                    rawConflicts.size(), rawRejected.size(),
                    outcomeAuthority.status, outcomeAuthority.sourceDigest,
                    vectorAuthority.status, vectorAuthority.model,
                    vectorAuthority.indexDigest,
                    candidates);
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
                + "\nOutcome authority: " + result.outcomeAuthorityStatus
                + (result.outcomeSourceDigest == null ? ""
                        : " (" + shortDigest(result.outcomeSourceDigest) + ")")
                + "\nVector authority: " + result.vectorAuthorityStatus
                + (result.vectorModel == null ? "" : " (" + result.vectorModel + ")")
                + (result.vectorIndexDigest == null ? ""
                        : " index=" + shortDigest(result.vectorIndexDigest))
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

    private static final class OutcomeAuthority {
        private final String status;
        private final String sourceDigest;

        private OutcomeAuthority(String status, String sourceDigest) {
            this.status = status;
            this.sourceDigest = sourceDigest;
        }
    }

    private static final class VectorAuthority {
        private final String status;
        private final String model;
        private final String indexDigest;

        private VectorAuthority(String status, String model, String indexDigest) {
            this.status = status;
            this.model = model;
            this.indexDigest = indexDigest;
        }
    }

    private static VectorAuthority parseVectorAuthority(
            Map<String, Object> value, Object vectorAvailable) {
        if (value == null || !VECTOR_AUTHORITY_SCHEMA.equals(text(value.get("schema"), 128))) {
            return null;
        }
        String status = text(value.get("status"), 32);
        if ("unavailable".equals(status)) {
            String code = text(value.get("code"), 128);
            return value.size() == 3 && code != null
                    && code.matches("CC_SKILL_VECTOR_[A-Z0-9_]{1,96}")
                    && Boolean.FALSE.equals(vectorAvailable)
                    ? new VectorAuthority(status, null, null) : null;
        }
        if (!"verified".equals(status) || value.size() != 11
                || !validIdentifier(value.get("tenantId"))
                || !validIdentifier(value.get("modelId"))
                || !validIdentifier(value.get("modelRevision"))
                || digest(value.get("requestDigest")) == null
                || digest(value.get("corpusDigest")) == null
                || digest(value.get("indexDigest")) == null
                || digest(value.get("resultDigest")) == null
                || digest(value.get("receiptDigest")) == null) return null;
        Long skillCount = nonNegativeLong(value.get("skillCount"));
        if (skillCount == null || skillCount < 1 || skillCount > 10_000) return null;
        return new VectorAuthority(status,
                value.get("modelId") + "@" + value.get("modelRevision"),
                (String) value.get("indexDigest"));
    }

    private static boolean validIdentifier(Object value) {
        String text = text(value, 256);
        return text != null && text.matches("[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}");
    }

    private static OutcomeAuthority parseOutcomeAuthority(Map<String, Object> value) {
        if (value == null) return null;
        String schema = text(value.get("schema"), 128);
        String status = text(value.get("status"), 32);
        if (INDEX_OUTCOME_AUTHORITY_SCHEMA.equals(schema)) {
            if ("unavailable".equals(status)) {
                String code = text(value.get("code"), 132);
                return code != null
                        && code.matches("CC_SKILL_OUTCOME_INDEX_[A-Z0-9_]{1,96}")
                        && Boolean.FALSE.equals(value.get("antiRollbackWitness"))
                        ? new OutcomeAuthority(status, null) : null;
            }
            if (!"verified-indexed".equals(status)
                    || !Boolean.TRUE.equals(value.get("antiRollbackWitness"))) return null;
            String sourceDigest = digest(value.get("sourceDigest"));
            Long sources = nonNegativeLong(value.get("sourceCount"));
            Long snapshots = nonNegativeLong(value.get("snapshotCount"));
            Long versions = nonNegativeLong(value.get("versionCount"));
            Long samples = nonNegativeLong(value.get("outcomeSampleCount"));
            Long maxSources = nonNegativeLong(value.get("maxSources"));
            Long maxVersions = nonNegativeLong(value.get("maxVersions"));
            if (sourceDigest == null || sources == null || snapshots == null
                    || versions == null || samples == null || maxSources == null
                    || maxVersions == null || sources < 1 || maxSources < 1
                    || maxSources > 128 || maxVersions < 1 || maxVersions > 10_000
                    || sources > maxSources || snapshots > sources
                    || versions > maxVersions) return null;
            return new OutcomeAuthority(status, sourceDigest);
        }
        if (!TRANSCRIPT_OUTCOME_AUTHORITY_SCHEMA.equals(schema)) return null;
        if ("unavailable".equals(status)) {
            String code = text(value.get("code"), 105);
            return code != null && code.matches("CC_SKILL_[A-Z0-9_]{1,96}")
                    ? new OutcomeAuthority(status, null) : null;
        }
        if (!"verified".equals(status)) return null;
        String sourceDigest = digest(value.get("sourceDigest"));
        Long selectedSessions = nonNegativeLong(value.get("selectedSessionCount"));
        Long receipts = nonNegativeLong(value.get("receiptCount"));
        Long unique = nonNegativeLong(value.get("uniqueReceiptCount"));
        Long attributionEligible = nonNegativeLong(
                value.get("attributionEligibleReceiptCount"));
        Long outcomeEligible = nonNegativeLong(
                value.get("outcomeEligibleReceiptCount"));
        Long duplicates = nonNegativeLong(value.get("duplicateReceiptCount"));
        Long maxSessions = nonNegativeLong(value.get("maxSessions"));
        Long maxReceipts = nonNegativeLong(value.get("maxReceipts"));
        if (sourceDigest == null || selectedSessions == null || receipts == null
                || unique == null || attributionEligible == null
                || outcomeEligible == null || duplicates == null
                || maxSessions == null || maxReceipts == null
                || maxSessions < 1 || maxSessions > 128
                || maxReceipts < 1 || maxReceipts > 10_000
                || selectedSessions > maxSessions || receipts > maxReceipts
                || unique > receipts || attributionEligible > unique
                || outcomeEligible > attributionEligible
                || duplicates != receipts - unique) return null;
        return new OutcomeAuthority(status, sourceDigest);
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
                || numeric > MAX_SAFE_INTEGER) return null;
        return (long) numeric;
    }

    private static Double unitDouble(Object value) {
        if (!(value instanceof Number)) return null;
        double numeric = ((Number) value).doubleValue();
        return Double.isFinite(numeric) && numeric >= 0 && numeric <= 1 ? numeric : null;
    }
}
