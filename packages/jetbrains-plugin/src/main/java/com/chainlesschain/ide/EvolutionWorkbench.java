package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Fail-closed JetBrains projection boundary for {@code cc evolution workbench}.
 * The IDE owns no reviewer identity, writer, or active-state digest: it only
 * selects exact packet digests and sends a bounded human reason to the CLI.
 */
public final class EvolutionWorkbench {
    public static final String COMPARISON_SCHEMA =
            "chainlesschain.evolution-workbench-version-comparison/v1";
    public static final String BATCH_EXECUTION_SCHEMA =
            "chainlesschain.evolution-workbench-batch-execution/v1";
    public static final String ROLLBACK_RECEIPT_SCHEMA =
            "chainlesschain.evolution-workbench-rollback-receipt/v1";
    public static final int MAX_CANDIDATES = 500;
    public static final int MAX_REASON_LENGTH = 2_048;
    public static final int MAX_JSON_LENGTH = 4 * 1024 * 1024;

    private static final Pattern DIGEST = Pattern.compile("sha256:[a-f0-9]{64}");
    private static final Set<String> STATUSES =
            Set.of("pending", "approved", "rejected", "expired");

    private EvolutionWorkbench() {}

    public static final class Candidate {
        public final String packetDigest;
        public final String candidateId;
        public final String contentDigest;
        public final String status;
        public final boolean active;
        public final boolean humanApproved;
        public final long receiptCount;
        public final long completed;
        public final long failedOrBlocked;
        public final double totalCostUsd;
        public final String parentContentDigest;
        public final String diffDigest;
        public final String unifiedDiff;
        public final String matrixReceiptDigest;
        public final List<String> targetRuntimes;

        private Candidate(String packetDigest, String candidateId, String contentDigest,
                String status, boolean active, boolean humanApproved, long receiptCount,
                long completed, long failedOrBlocked, double totalCostUsd,
                String parentContentDigest, String diffDigest, String unifiedDiff,
                String matrixReceiptDigest, List<String> targetRuntimes) {
            this.packetDigest = packetDigest;
            this.candidateId = candidateId;
            this.contentDigest = contentDigest;
            this.status = status;
            this.active = active;
            this.humanApproved = humanApproved;
            this.receiptCount = receiptCount;
            this.completed = completed;
            this.failedOrBlocked = failedOrBlocked;
            this.totalCostUsd = totalCostUsd;
            this.parentContentDigest = parentContentDigest;
            this.diffDigest = diffDigest;
            this.unifiedDiff = unifiedDiff;
            this.matrixReceiptDigest = matrixReceiptDigest;
            this.targetRuntimes = List.copyOf(targetRuntimes);
        }
    }

    public static final class Projection {
        public final String projectionDigest;
        public final long total;
        public final boolean hasMore;
        public final List<Candidate> candidates;

        private Projection(String projectionDigest, long total, boolean hasMore,
                List<Candidate> candidates) {
            this.projectionDigest = projectionDigest;
            this.total = total;
            this.hasMore = hasMore;
            this.candidates = List.copyOf(candidates);
        }

        public Candidate activeCandidate() {
            Candidate found = null;
            for (Candidate candidate : candidates) {
                if (!candidate.active) continue;
                if (found != null) return null;
                found = candidate;
            }
            return found;
        }

        public Candidate findExact(String packetDigest) {
            Candidate found = null;
            for (Candidate candidate : candidates) {
                if (!candidate.packetDigest.equals(packetDigest)) continue;
                if (found != null) return null;
                found = candidate;
            }
            return found;
        }
    }

    public static Projection parseProjection(String json) {
        if (json == null || json.isBlank() || json.length() > MAX_JSON_LENGTH) return null;
        try {
            Map<String, Object> root = MiniJson.parseObject(json);
            String projectionDigest = digest(root.get("projectionDigest"));
            Long total = nonNegativeLong(root.get("total"));
            Long offset = nonNegativeLong(root.get("offset"));
            Long limit = nonNegativeLong(root.get("limit"));
            Object hasMore = root.get("hasMore");
            List<Object> rawCandidates = list(root.get("candidates"));
            if (projectionDigest == null || total == null || offset == null
                    || limit == null || limit != MAX_CANDIDATES
                    || offset != 0 || !(hasMore instanceof Boolean)
                    || rawCandidates == null || rawCandidates.size() > limit
                    || rawCandidates.size() > MAX_CANDIDATES
                    || total < rawCandidates.size()
                    || ((Boolean) hasMore && rawCandidates.size() != limit)
                    || ((Boolean) hasMore) != (total > rawCandidates.size())) return null;

            ArrayList<Candidate> candidates = new ArrayList<>();
            HashSet<String> packets = new HashSet<>();
            for (Object value : rawCandidates) {
                Candidate candidate = parseCandidate(object(value));
                if (candidate == null || !packets.add(candidate.packetDigest)) return null;
                candidates.add(candidate);
            }
            return new Projection(projectionDigest, total, (Boolean) hasMore, candidates);
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    public static List<String> buildListArgs() {
        return List.of("evolution", "workbench", "list", "--limit",
                String.valueOf(MAX_CANDIDATES));
    }

    public static List<String> buildCompareArgs(
            Projection projection, Candidate left, Candidate right) {
        requireMember(projection, left, "left");
        requireMember(projection, right, "right");
        if (left.packetDigest.equals(right.packetDigest)) {
            throw new IllegalArgumentException("comparison requires two exact versions");
        }
        return List.of("evolution", "workbench", "compare",
                left.packetDigest, right.packetDigest);
    }

    public static List<String> buildReviewArgs(
            Projection projection, Candidate candidate, String decision, String reason) {
        requireMember(projection, candidate, "review");
        if (!"pending".equals(candidate.status)
                || !("approve".equals(decision) || "reject".equals(decision))) {
            throw new IllegalArgumentException("only a pending packet can be reviewed");
        }
        return List.of("evolution", "workbench", "review", decision,
                candidate.packetDigest, "--reason", checkedReason(reason));
    }

    public static List<String> buildRollbackArgs(
            Projection projection, Candidate target, String reason) {
        requireMember(projection, target, "rollback target");
        Candidate active = projection.activeCandidate();
        if (active == null || target.active || !"approved".equals(target.status)
                || !target.humanApproved || active.packetDigest.equals(target.packetDigest)) {
            throw new IllegalArgumentException(
                    "rollback requires one active version and an approved inactive target");
        }
        return List.of("evolution", "workbench", "rollback", active.packetDigest,
                target.packetDigest, "--reason", checkedReason(reason));
    }

    public static String parseMutationPlanDigest(String json) {
        if (json == null || json.isBlank() || json.length() > MAX_JSON_LENGTH) return null;
        try {
            Map<String, Object> root = MiniJson.parseObject(json);
            String schema = text(root.get("schema"), 128);
            String terminalDigest;
            if (BATCH_EXECUTION_SCHEMA.equals(schema)) {
                terminalDigest = digest(root.get("executionDigest"));
            } else if (ROLLBACK_RECEIPT_SCHEMA.equals(schema)) {
                terminalDigest = digest(root.get("receiptDigest"));
            } else {
                return null;
            }
            String planDigest = digest(root.get("planDigest"));
            return terminalDigest == null ? null : planDigest;
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    public static String formatComparison(String json, Projection projection,
            Candidate left, Candidate right) {
        if (json == null || json.isBlank() || json.length() > MAX_JSON_LENGTH) return null;
        requireMember(projection, left, "left");
        requireMember(projection, right, "right");
        try {
            Map<String, Object> root = MiniJson.parseObject(json);
            if (!COMPARISON_SCHEMA.equals(text(root.get("schema"), 128))
                    || !projection.projectionDigest.equals(
                            digest(root.get("sourceProjectionDigest")))
                    || digest(root.get("comparisonDigest")) == null
                    || !summaryMatches(object(root.get("left")), left)
                    || !summaryMatches(object(root.get("right")), right)) return null;
            String skillName = requiredText(root.get("skillName"), 512);
            if (skillName == null) return null;
            return "Skill: " + skillName
                    + "\nProjection: " + projection.projectionDigest
                    + "\nComparison: " + root.get("comparisonDigest")
                    + "\n\nLEFT\n" + describe(left)
                    + "\n\nRIGHT\n" + describe(right);
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    public static String describe(Candidate candidate) {
        if (candidate == null) return "";
        return "Candidate: " + candidate.candidateId
                + "\nPacket: " + candidate.packetDigest
                + "\nContent: " + candidate.contentDigest
                + "\nParent: " + candidate.parentContentDigest
                + "\nStatus: " + candidate.status + (candidate.active ? " (active)" : "")
                + "\nMatrix: " + candidate.matrixReceiptDigest
                + "\nRuntimes: " + String.join(", ", candidate.targetRuntimes)
                + "\nUsage: " + candidate.receiptCount + " receipts, "
                + candidate.completed + " completed, " + candidate.failedOrBlocked
                + " failed/blocked, $" + String.format(java.util.Locale.ROOT, "%.4f",
                        candidate.totalCostUsd)
                + "\nDiff digest: " + candidate.diffDigest
                + "\n\n" + candidate.unifiedDiff;
    }

    public static String shortDigest(String value) {
        return isDigest(value) ? value.substring(0, 15) + "…" + value.substring(63) : "—";
    }

    private static Candidate parseCandidate(Map<String, Object> value) {
        if (value == null) return null;
        String packet = digest(value.get("packetDigest"));
        String candidateId = requiredText(value.get("candidateId"), 512);
        String content = digest(value.get("candidateContentDigest"));
        String status = text(value.get("status"), 32);
        Map<String, Object> usage = object(value.get("actualUsage"));
        Map<String, Object> why = object(value.get("why"));
        Map<String, Object> changes = object(value.get("changes"));
        Map<String, Object> validation = object(value.get("validation"));
        if (packet == null || candidateId == null || content == null
                || !STATUSES.contains(status) || usage == null || why == null
                || changes == null || validation == null
                || !(usage.get("active") instanceof Boolean)) return null;

        String parent = digest(why.get("parentContentDigest"));
        String diff = digest(changes.get("candidateDiffDigest"));
        String unifiedDiff = text(changes.get("unifiedDiff"), 1_000_000);
        String matrix = digest(validation.get("matrixReceiptDigest"));
        List<String> runtimes = stringList(validation.get("targetRuntimes"), 64, 128);
        Long receiptCount = nonNegativeLong(usage.get("receiptCount"));
        Long completed = nonNegativeLong(usage.get("completed"));
        Long failed = nonNegativeLong(usage.get("failedOrBlocked"));
        Double cost = nonNegativeDouble(usage.get("totalCostUsd"));
        if (parent == null || diff == null || unifiedDiff == null || matrix == null
                || runtimes == null || receiptCount == null || completed == null
                || failed == null || cost == null) return null;

        Map<String, Object> decision = object(value.get("decision"));
        boolean approved = "approved".equals(status) && decision != null
                && "approved".equals(text(decision.get("decision"), 32));
        return new Candidate(packet, candidateId, content, status,
                (Boolean) usage.get("active"), approved, receiptCount, completed,
                failed, cost, parent, diff, unifiedDiff, matrix, runtimes);
    }

    private static boolean summaryMatches(Map<String, Object> value, Candidate expected) {
        return value != null
                && expected.packetDigest.equals(digest(value.get("packetDigest")))
                && expected.contentDigest.equals(digest(value.get("contentDigest")));
    }

    private static void requireMember(
            Projection projection, Candidate candidate, String label) {
        if (projection == null || candidate == null || !isDigest(candidate.packetDigest)
                || projection.findExact(candidate.packetDigest) != candidate) {
            throw new IllegalArgumentException(label + " packet is stale or untrusted");
        }
    }

    private static String checkedReason(String value) {
        String reason = value == null ? "" : value.trim();
        if (reason.isEmpty() || reason.length() > MAX_REASON_LENGTH) {
            throw new IllegalArgumentException("a bounded human reason is required");
        }
        return reason;
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

    private static Double nonNegativeDouble(Object value) {
        if (!(value instanceof Number)) return null;
        double numeric = ((Number) value).doubleValue();
        return Double.isFinite(numeric) && numeric >= 0 ? numeric : null;
    }
}
