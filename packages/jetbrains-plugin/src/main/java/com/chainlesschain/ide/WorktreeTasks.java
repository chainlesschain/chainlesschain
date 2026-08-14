package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Worktree parallel tasks (P1 #9) — the Java twin of the VS Code extension's
 * worktree-tasks.js. Enumerates agent task worktrees ({@code cc agent
 * --worktree} → cc-agent-*, {@code cc batch} → batch/*, team isolation →
 * agent/*), sizes changes, and delegates every merge-authority operation to
 * {@code cc team merge-review}. Listing and explicit discard remain plain git;
 * no IDE path accepts patch bytes or invokes {@code git merge} directly.
 * Builders and the strict v1 projection are pure and JUnit-testable.
 */
public final class WorktreeTasks {

    private WorktreeTasks() {}

    private static final Pattern TASK_BRANCH =
            Pattern.compile("^(cc-agent-|batch/|agent/|team/)");
    public static final String MERGE_REVIEW_SCHEMA =
            "chainlesschain.team-merge-review/v1";
    private static final Pattern REVIEW_ID = Pattern.compile("^tmr_[a-f0-9]{32}$");
    private static final Pattern FILE_ID = Pattern.compile("^tmrf_[a-f0-9]{32}$");
    private static final Pattern HUNK_ID = Pattern.compile("^tmrh_[a-f0-9]{32}$");
    private static final Pattern DIGEST = Pattern.compile("^sha256:[a-f0-9]{64}$");
    private static final Pattern OID = Pattern.compile("^(?:[a-f0-9]{40}|[a-f0-9]{64})$");
    private static final Pattern SAFE_ID =
            Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$");
    private static final int MAX_SELECTION_IDS = 100;
    private static final Pattern SAFE_TOKEN = Pattern.compile("^[a-z][a-z0-9_-]{0,63}$");
    private static final Pattern SAFE_BRANCH = Pattern.compile(
            "^[A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9][A-Za-z0-9._-]*)*$");
    private static final Set<String> REVIEW_STATES = Collections.unmodifiableSet(
            new HashSet<String>(Arrays.asList(
                    "planned", "prepared", "publishing", "published", "conflicted",
                    "rollback_required", "rolled_back")));
    private static final Set<String> REVIEW_OPERATIONS = Collections.unmodifiableSet(
            new HashSet<String>(Arrays.asList("preview", "show", "apply", "rollback")));

    public static boolean isTaskBranch(String branch) {
        return branch != null && TASK_BRANCH.matcher(branch).find();
    }

    public static List<String> buildWorktreeListArgs() {
        return new ArrayList<String>(Arrays.asList("worktree", "list", "--porcelain"));
    }

    public static List<String> buildBackgroundListArgs() {
        return new ArrayList<String>(Arrays.asList("daemon", "view", "--json"));
    }

    public static List<String> buildStatusArgs() {
        return new ArrayList<String>(Arrays.asList("status", "--porcelain"));
    }

    public static List<String> buildAheadArgs(String mainHead, String branch) {
        return new ArrayList<String>(Arrays.asList(
                "rev-list", "--count", mainHead + ".." + branch));
    }

    public static List<String> buildShortstatArgs(String mainHead, String branch) {
        return new ArrayList<String>(Arrays.asList(
                "diff", "--shortstat", mainHead + "..." + branch));
    }

    public static List<String> buildMergeReviewPreviewArgs(
            List<String> branches, String base, String stateDir,
            String actor, String reason) {
        if (branches == null || branches.isEmpty() || branches.size() > 256) {
            throw new IllegalArgumentException("merge review needs 1..256 branches");
        }
        List<String> args = mergeReviewPrefix("preview");
        Set<String> seen = new LinkedHashSet<String>();
        for (String branch : branches) {
            String clean = requireBranch(branch, "branch");
            if (!seen.add(clean)) {
                throw new IllegalArgumentException("duplicate merge-review branch");
            }
            args.add("--branch");
            args.add(clean);
        }
        addOption(args, "--base", optionalBranch(base, "base"));
        addOption(args, "--state-dir", optionalText(stateDir, "stateDir", 4096));
        addOption(args, "--actor", optionalId(actor, "actor"));
        addOption(args, "--reason", optionalText(reason, "reason", 1000));
        args.add("--json");
        return args;
    }

    public static List<String> buildMergeReviewShowArgs(String reviewId, String stateDir) {
        List<String> args = mergeReviewPrefix("show");
        args.add(requirePattern(reviewId, REVIEW_ID, "reviewId"));
        addOption(args, "--state-dir", optionalText(stateDir, "stateDir", 4096));
        args.add("--json");
        return args;
    }

    public static List<String> buildMergeReviewApplyArgs(
            MergeReview review, List<String> fileIds, List<String> hunkIds,
            String stateDir, String actor, String reason) {
        if (review == null) throw new IllegalArgumentException("review is required");
        validateApplySelection(review, fileIds, hunkIds);
        List<String> args = mergeReviewPrefix("apply");
        args.add(review.reviewId);
        args.add("--revision");
        args.add(String.valueOf(review.revision));
        args.add("--plan-digest");
        args.add(review.planDigest);
        addOption(args, "--state-dir", optionalText(stateDir, "stateDir", 4096));
        for (String fileId : fileIds) {
            args.add("--file-id");
            args.add(requirePattern(fileId, FILE_ID, "fileId"));
        }
        for (String hunkId : hunkIds) {
            args.add("--hunk-id");
            args.add(requirePattern(hunkId, HUNK_ID, "hunkId"));
        }
        addOption(args, "--actor", optionalId(actor, "actor"));
        addOption(args, "--reason", optionalText(reason, "reason", 1000));
        args.add("--json");
        return args;
    }

    public static List<String> buildMergeReviewRollbackArgs(
            MergeReview review, String confirmation, String stateDir) {
        if (review == null) throw new IllegalArgumentException("review is required");
        if (!("published".equals(review.state)
                || "rollback_required".equals(review.state))) {
            throw new IllegalArgumentException("only a published review can be rolled back");
        }
        if (!review.reviewId.equals(confirmation)) {
            throw new IllegalArgumentException("rollback confirmation must equal reviewId");
        }
        List<String> args = mergeReviewPrefix("rollback");
        args.add(review.reviewId);
        args.add("--revision");
        args.add(String.valueOf(review.revision));
        args.add("--evidence-digest");
        args.add(review.evidenceDigest);
        args.add("--confirm");
        args.add(review.reviewId);
        addOption(args, "--state-dir", optionalText(stateDir, "stateDir", 4096));
        args.add("--json");
        return args;
    }

    public static List<String> buildWorktreeRemoveArgs(String path) {
        return new ArrayList<String>(Arrays.asList("worktree", "remove", "--force", path));
    }

    public static List<String> buildBranchDeleteArgs(String branch) {
        return new ArrayList<String>(Arrays.asList("branch", "-D", branch));
    }

    /**
     * Parse {@code git worktree list --porcelain}. The FIRST row is the main
     * checkout ({@code main=true}); {@code isTask} marks agent-task branches.
     */
    public static List<Map<String, Object>> parseWorktreeList(String text) {
        List<Map<String, Object>> rows = new ArrayList<Map<String, Object>>();
        Map<String, Object> current = null;
        for (String line : String.valueOf(text == null ? "" : text).split("\r?\n")) {
            if (line.startsWith("worktree ")) {
                if (current != null) rows.add(current);
                current = new LinkedHashMap<String, Object>();
                current.put("path", line.substring(9).trim());
                current.put("branch", "");
                current.put("head", "");
            } else if (current == null) {
                continue;
            } else if (line.startsWith("HEAD ")) {
                current.put("head", line.substring(5).trim());
            } else if (line.startsWith("branch ")) {
                current.put("branch",
                        line.substring(7).trim().replace("refs/heads/", ""));
            }
        }
        if (current != null) rows.add(current);
        for (int i = 0; i < rows.size(); i++) {
            rows.get(i).put("main", i == 0);
            rows.get(i).put("isTask", isTaskBranch(String.valueOf(rows.get(i).get("branch"))));
        }
        return rows;
    }

    /**
     * Parse {@code cc daemon view --json}, retaining only bounded, secret-free
     * governance fields needed by a worktree row.
     */
    public static List<Map<String, Object>> parseBackgroundTaskGovernance(String text) {
        List<Map<String, Object>> rows = new ArrayList<Map<String, Object>>();
        Object parsed;
        try {
            parsed = MiniJson.parse(String.valueOf(text == null ? "" : text));
        } catch (RuntimeException ignored) {
            return rows;
        }
        if (!(parsed instanceof Map)) return rows;
        Map<?, ?> root = (Map<?, ?>) parsed;
        List<Object> candidates = new ArrayList<Object>();
        Object sessions = root.get("sessions");
        if (sessions instanceof List) {
            int sessionCount = 0;
            for (Object raw : (List<?>) sessions) {
                if (sessionCount++ >= 1000) break;
                candidates.add(raw);
            }
        }
        Object managedTasks = root.get("managedTasks");
        if (managedTasks instanceof List) {
            int managedCount = 0;
            for (Object raw : (List<?>) managedTasks) {
                if (managedCount++ >= 1000) break;
                candidates.add(raw);
            }
        }
        int count = 0;
        for (Object raw : candidates) {
            if (count++ >= 2000) break;
            if (!(raw instanceof Map)) continue;
            Map<?, ?> session = (Map<?, ?>) raw;
            String backgroundId = boundedString(session.get("id"), 160);
            String managedTaskId = boundedString(session.get("managedTaskId"), 512);
            String branch = boundedString(session.get("branch"), 512);
            String worktreePath = boundedString(
                    session.get("worktreePath") != null
                            ? session.get("worktreePath") : session.get("cwd"),
                    4096);
            if ((backgroundId == null && managedTaskId == null)
                    || (branch == null && worktreePath == null)) continue;
            Map<?, ?> governance = session.get("governance") instanceof Map
                    ? (Map<?, ?>) session.get("governance")
                    : new LinkedHashMap<Object, Object>();
            Map<?, ?> budget = governance.get("resourceBudget") instanceof Map
                    ? (Map<?, ?>) governance.get("resourceBudget")
                    : new LinkedHashMap<Object, Object>();
            Map<?, ?> effects = session.get("sideEffects") instanceof Map
                    ? (Map<?, ?>) session.get("sideEffects")
                    : new LinkedHashMap<Object, Object>();

            Map<String, Object> row = new LinkedHashMap<String, Object>();
            if (backgroundId != null) {
                row.put("backgroundId", backgroundId);
            } else {
                row.put("managedTaskId", managedTaskId);
                row.put("runId", boundedString(session.get("runId"), 160));
                row.put("runKind", boundedString(session.get("runKind"), 32));
            }
            row.put("branch", branch);
            row.put("worktreePath", worktreePath);
            String owner = boundedString(governance.get("owner"), 512);
            row.put("owner", owner == null
                    ? (backgroundId == null ? managedTaskId : "background:" + backgroundId)
                    : owner);
            String sessionId = boundedString(
                    governance.get("sessionId") != null
                            ? governance.get("sessionId") : session.get("sessionId"),
                    256);
            row.put("sessionId", sessionId);
            String status = boundedString(
                    session.get("lifecycleState") != null
                            ? session.get("lifecycleState") : session.get("status"),
                    64);
            String managementStatus = status == null ? "unknown" : status;
            if (backgroundId != null) {
                row.put("backgroundStatus", managementStatus);
            } else {
                row.put("managementStatus", managementStatus);
            }
            String permissionMode = boundedString(governance.get("permissionMode"), 64);
            row.put("permissionMode",
                    permissionMode == null ? "default" : permissionMode);
            Map<String, Object> resourceBudget = new LinkedHashMap<String, Object>();
            resourceBudget.put("maxTurns", positiveNumber(budget.get("maxTurns")));
            resourceBudget.put("maxCostUsd", positiveNumber(budget.get("maxCostUsd")));
            if (managedTaskId != null) {
                resourceBudget.put("maxTasks", positiveNumber(budget.get("maxTasks")));
                resourceBudget.put("maxTokens", positiveNumber(budget.get("maxTokens")));
                resourceBudget.put("maxWallMs", positiveNumber(budget.get("maxWallMs")));
            }
            row.put("resourceBudget", resourceBudget);
            Map<String, Object> sideEffects = new LinkedHashMap<String, Object>();
            sideEffects.put("total", nonNegativeLong(effects.get("total")));
            sideEffects.put("unsettled", nonNegativeLong(effects.get("unsettled")));
            sideEffects.put("unknown", nonNegativeLong(effects.get("unknown")));
            row.put("sideEffects", sideEffects);
            rows.add(row);
        }
        return rows;
    }

    /**
     * Join supervisor governance onto worktree rows. Branch identity wins;
     * normalized path is the fallback for legacy supervisor records.
     */
    public static List<Map<String, Object>> attachTaskGovernance(
            List<Map<String, Object>> tasks, String text) {
        List<Map<String, Object>> governance = parseBackgroundTaskGovernance(text);
        List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
        if (tasks == null) return out;
        for (Map<String, Object> task : tasks) {
            Map<String, Object> copy = new LinkedHashMap<String, Object>(task);
            String branch = boundedString(task.get("branch"), 512);
            String path = normalizedPath(task.get("path"));
            Map<String, Object> match = null;
            for (Map<String, Object> row : governance) {
                if (branch != null && branch.equals(row.get("branch"))) {
                    match = row;
                    break;
                }
            }
            if (match == null && !path.isEmpty()) {
                for (Map<String, Object> row : governance) {
                    if (path.equals(normalizedPath(row.get("worktreePath")))) {
                        match = row;
                        break;
                    }
                }
            }
            if (match != null) {
                for (Map.Entry<String, Object> entry : match.entrySet()) {
                    if (!"branch".equals(entry.getKey())
                            && !"worktreePath".equals(entry.getKey())) {
                        copy.put(entry.getKey(), entry.getValue());
                    }
                }
            }
            out.add(copy);
        }
        return out;
    }

    public static final class MergeReviewEnvelope {
        public final String operation;
        public final MergeReview review;
        public final List<ReviewAction> actions;

        private MergeReviewEnvelope(String operation, MergeReview review,
                List<ReviewAction> actions) {
            this.operation = operation;
            this.review = review;
            this.actions = Collections.unmodifiableList(actions);
        }
    }

    public static final class MergeReview {
        public final String reviewId;
        public final long revision;
        public final String state;
        public final String baseBranch;
        public final String baseOid;
        public final List<ReviewCandidate> candidates;
        public final List<ReviewFile> files;
        public final List<String> selectedFileIds;
        public final List<String> selectedHunkIds;
        public final List<ReviewConflict> conflicts;
        public final ReviewDecision decision;
        public final String planDigest;
        public final String evidenceDigest;
        public final String createdAt;
        public final String updatedAt;

        private MergeReview(String reviewId, long revision, String state,
                String baseBranch, String baseOid,
                List<ReviewCandidate> candidates, List<ReviewFile> files,
                List<String> selectedFileIds, List<String> selectedHunkIds,
                List<ReviewConflict> conflicts, ReviewDecision decision,
                String planDigest, String evidenceDigest,
                String createdAt, String updatedAt) {
            this.reviewId = reviewId;
            this.revision = revision;
            this.state = state;
            this.baseBranch = baseBranch;
            this.baseOid = baseOid;
            this.candidates = Collections.unmodifiableList(candidates);
            this.files = Collections.unmodifiableList(files);
            this.selectedFileIds = Collections.unmodifiableList(selectedFileIds);
            this.selectedHunkIds = Collections.unmodifiableList(selectedHunkIds);
            this.conflicts = Collections.unmodifiableList(conflicts);
            this.decision = decision;
            this.planDigest = planDigest;
            this.evidenceDigest = evidenceDigest;
            this.createdAt = createdAt;
            this.updatedAt = updatedAt;
        }
    }

    public static final class ReviewCandidate {
        public final String key;
        public final String branch;
        public final String oid;

        private ReviewCandidate(String key, String branch, String oid) {
            this.key = key;
            this.branch = branch;
            this.oid = oid;
        }
    }

    public static final class ReviewFile {
        public final String id;
        public final String candidateKey;
        public final String path;
        public final String status;
        public final boolean binary;
        public final boolean selected;
        public final List<ReviewHunk> hunks;

        private ReviewFile(String id, String candidateKey, String path,
                String status, boolean binary, boolean selected,
                List<ReviewHunk> hunks) {
            this.id = id;
            this.candidateKey = candidateKey;
            this.path = path;
            this.status = status;
            this.binary = binary;
            this.selected = selected;
            this.hunks = Collections.unmodifiableList(hunks);
        }
    }

    public static final class ReviewHunk {
        public final String id;
        public final String header;
        public final long oldStart;
        public final long oldLines;
        public final long newStart;
        public final long newLines;
        public final boolean selected;

        private ReviewHunk(String id, String header, long oldStart,
                long oldLines, long newStart, long newLines, boolean selected) {
            this.id = id;
            this.header = header;
            this.oldStart = oldStart;
            this.oldLines = oldLines;
            this.newStart = newStart;
            this.newLines = newLines;
            this.selected = selected;
        }
    }

    public static final class ReviewConflict {
        public final String candidateKey;
        public final String path;
        public final String type;
        public final String explanation;
        public final String suggestion;
        public final List<String> hunkIds;

        private ReviewConflict(String candidateKey, String path, String type,
                String explanation, String suggestion, List<String> hunkIds) {
            this.candidateKey = candidateKey;
            this.path = path;
            this.type = type;
            this.explanation = explanation;
            this.suggestion = suggestion;
            this.hunkIds = Collections.unmodifiableList(hunkIds);
        }
    }

    public static final class ReviewDecision {
        public final String actor;
        public final String reason;
        public final String host;
        public final String decidedAt;

        private ReviewDecision(String actor, String reason, String host,
                String decidedAt) {
            this.actor = actor;
            this.reason = reason;
            this.host = host;
            this.decidedAt = decidedAt;
        }
    }

    public static final class ReviewAction {
        public final String id;
        public final boolean enabled;
        public final List<String> argv;
        public final String reason;

        private ReviewAction(String id, boolean enabled, List<String> argv,
                String reason) {
            this.id = id;
            this.enabled = enabled;
            this.argv = Collections.unmodifiableList(argv);
            this.reason = reason;
        }
    }

    /** Parse exactly one success envelope; unknown fields and versions fail closed. */
    public static MergeReviewEnvelope parseMergeReviewEnvelope(
            String text, String expectedOperation) {
        if (!REVIEW_OPERATIONS.contains(expectedOperation)) {
            throw new IllegalArgumentException("unknown expected merge-review operation");
        }
        Object parsed;
        try {
            parsed = MiniJson.parse(String.valueOf(text == null ? "" : text).trim());
        } catch (RuntimeException error) {
            throw invalidReview("merge-review output is not strict JSON", error);
        }
        Map<?, ?> root = requireMap(parsed, "envelope");
        requireExactKeys(root, "schema", "schemaVersion", "operation", "review", "actions");
        if (!MERGE_REVIEW_SCHEMA.equals(root.get("schema"))) {
            throw invalidReview("unsupported merge-review schema");
        }
        if (requireLong(root.get("schemaVersion"), "schemaVersion", 1, 1) != 1) {
            throw invalidReview("unsupported merge-review schema version");
        }
        String operation = requireToken(root.get("operation"), "operation");
        if (!expectedOperation.equals(operation) || !REVIEW_OPERATIONS.contains(operation)) {
            throw invalidReview("unexpected merge-review operation");
        }
        MergeReview review = parseReview(requireMap(root.get("review"), "review"));
        List<ReviewAction> actions = parseActions(
                requireList(root.get("actions"), "actions", 16), review.reviewId);
        return new MergeReviewEnvelope(operation, review, actions);
    }

    public static void requireSameReviewAuthority(
            MergeReview expected, MergeReview actual) {
        if (expected == null || actual == null
                || !expected.reviewId.equals(actual.reviewId)
                || expected.revision != actual.revision
                || !expected.planDigest.equals(actual.planDigest)
                || !expected.evidenceDigest.equals(actual.evidenceDigest)) {
            throw invalidReview("merge-review show changed canonical authority");
        }
    }

    public static void requirePublishedTransition(
            MergeReview before, MergeReview after) {
        requireForwardTransition(before, after, "published");
    }

    public static void requireConflictedTransition(
            MergeReview before, MergeReview after) {
        requireForwardTransition(before, after, "conflicted");
        if (after.conflicts.isEmpty()) {
            throw invalidReview(
                    "conflicted merge-review omitted its conflict explanation");
        }
    }

    public static void requireRolledBackTransition(
            MergeReview before, MergeReview after) {
        requireForwardTransition(before, after, "rolled_back");
    }

    public static void validateApplySelection(
            MergeReview review, List<String> fileIds, List<String> hunkIds) {
        if (review == null || fileIds == null || hunkIds == null) {
            throw new IllegalArgumentException("review selection is required");
        }
        if (fileIds.size() + hunkIds.size() == 0
                || fileIds.size() + hunkIds.size() > MAX_SELECTION_IDS) {
            throw new IllegalArgumentException("merge-review selection is empty or too large");
        }
        Set<String> knownFiles = new HashSet<String>();
        Map<String, String> hunkOwners = new LinkedHashMap<String, String>();
        for (ReviewFile file : review.files) {
            knownFiles.add(file.id);
            for (ReviewHunk hunk : file.hunks) hunkOwners.put(hunk.id, file.id);
        }
        Set<String> selectedFiles = uniqueIds(fileIds, FILE_ID, "fileId");
        Set<String> selectedHunks = uniqueIds(hunkIds, HUNK_ID, "hunkId");
        if (!knownFiles.containsAll(selectedFiles)
                || !hunkOwners.keySet().containsAll(selectedHunks)) {
            throw new IllegalArgumentException("selection is not part of this review");
        }
        for (String hunkId : selectedHunks) {
            if (selectedFiles.contains(hunkOwners.get(hunkId))) {
                throw new IllegalArgumentException(
                        "cannot select both an entire file and one of its hunks");
            }
        }
    }

    public static String explainMergeReviewConflicts(MergeReview review) {
        if (review == null || review.conflicts.isEmpty()) return "No conflicts reported.";
        StringBuilder out = new StringBuilder();
        for (ReviewConflict conflict : review.conflicts) {
            if (out.length() > 0) out.append("\n\n");
            out.append(conflict.path).append(" [").append(conflict.type).append("]\n")
                    .append(conflict.explanation).append("\nSuggestion: ")
                    .append(conflict.suggestion);
        }
        return out.toString();
    }

    /** Return CLI-issued argv only when every argument equals the local v1 pin. */
    public static List<String> selectMergeReviewActionArgs(
            MergeReviewEnvelope envelope, String actionId, List<String> expectedArgs) {
        if (envelope == null || !REVIEW_OPERATIONS.contains(actionId)
                || expectedArgs == null) return null;
        for (ReviewAction action : envelope.actions) {
            if (!actionId.equals(action.id)) continue;
            if (!action.enabled || !action.argv.equals(expectedArgs)) return null;
            return new ArrayList<String>(action.argv);
        }
        return null;
    }

    /** {@code "3 files changed, 40 insertions(+), 2 deletions(-)"} → {@code "+40 −2 (3 files)"}. */
    public static String summarizeShortstat(String text) {
        String s = String.valueOf(text == null ? "" : text).trim();
        if (s.isEmpty()) return "no diff";
        String files = firstGroup(s, "(\\d+) files? changed");
        String ins = firstGroup(s, "(\\d+) insertions?\\(\\+\\)");
        String del = firstGroup(s, "(\\d+) deletions?\\(-\\)");
        StringBuilder sb = new StringBuilder("+")
                .append(ins == null ? "0" : ins)
                .append(" −").append(del == null ? "0" : del);
        if (files != null) {
            sb.append(" (").append(files).append(" file")
                    .append("1".equals(files) ? "" : "s").append(')');
        }
        return sb.toString();
    }

    /** One JList row; merge authority is deliberately absent from git-derived data. */
    public static String formatTaskLine(Map<String, Object> t) {
        StringBuilder sb = new StringBuilder(String.valueOf(t.get("branch")));
        sb.append("  ").append(t.get("stat"));
        Object ahead = t.get("ahead");
        if (ahead instanceof Number && ((Number) ahead).longValue() > 0) {
            sb.append(" ↑").append(ahead);
        }
        if (Boolean.TRUE.equals(t.get("dirty"))) sb.append("  [dirty]");
        sb.append("  review: CLI-governed");
        if (t.get("backgroundId") != null || t.get("managedTaskId") != null) {
            String managementKind = t.get("backgroundId") != null
                    ? "bg"
                    : String.valueOf(t.get("runKind") == null ? "managed" : t.get("runKind"));
            Object managementStatus = t.get("managementStatus") != null
                    ? t.get("managementStatus") : t.get("backgroundStatus");
            sb.append("  ").append(managementKind).append(": ").append(managementStatus);
            sb.append(" / ").append(t.get("permissionMode"));
            Object budget = t.get("resourceBudget");
            if (budget instanceof Map) {
                Object turns = ((Map<?, ?>) budget).get("maxTurns");
                Object cost = ((Map<?, ?>) budget).get("maxCostUsd");
                Object tasks = ((Map<?, ?>) budget).get("maxTasks");
                Object tokens = ((Map<?, ?>) budget).get("maxTokens");
                if (turns != null) sb.append(" / turns ").append(turns);
                if (cost != null) sb.append(" / $").append(cost);
                if (tasks != null) sb.append(" / tasks ").append(tasks);
                if (tokens != null) sb.append(" / tokens ").append(tokens);
            }
            Object effects = t.get("sideEffects");
            if (effects instanceof Map) {
                Object unsettled = ((Map<?, ?>) effects).get("unsettled");
                Object unknown = ((Map<?, ?>) effects).get("unknown");
                sb.append(" / effects unsettled ").append(unsettled)
                        .append(", unknown ").append(unknown);
            }
        } else {
            sb.append("  bg: unmanaged");
        }
        return sb.toString();
    }

    /**
     * Terminal command for a supervised, isolated task. The background
     * supervisor owns governance while the worktree provides filesystem
     * isolation. Quotes are stripped rather than shell-escaped across three
     * host shell families.
     */
    public static String buildNewTaskCommand(String task, String command, boolean windows) {
        String clean = String.valueOf(task == null ? "" : task)
                .replaceAll("[\"'`\\\\]", " ").trim();
        String cc = command == null || command.isEmpty() ? "cc" : command;
        return windows
                ? cc + " agent --bg --worktree -p \"" + clean + "\""
                : cc + " agent --bg --worktree -p '" + clean + "'";
    }

    private static MergeReview parseReview(Map<?, ?> raw) {
        requireExactKeys(raw, "reviewId", "revision", "state", "base", "candidates",
                "files", "selection", "conflicts", "decision", "planDigest",
                "evidenceDigest", "createdAt", "updatedAt", "details");
        String reviewId = requirePattern(raw.get("reviewId"), REVIEW_ID, "reviewId");
        long revision = requireLong(raw.get("revision"), "revision", 1, Long.MAX_VALUE);
        String state = requireToken(raw.get("state"), "state");
        if (!REVIEW_STATES.contains(state)) throw invalidReview("unknown review state");

        Map<?, ?> base = requireMap(raw.get("base"), "base");
        requireBranchOidKeys(base, "base");
        String baseBranch = requireBranch(base.get("branch"), "base.branch");
        String baseOid = requirePattern(oidValue(base), OID, "base.oid");

        List<ReviewCandidate> candidates = new ArrayList<ReviewCandidate>();
        Set<String> candidateKeys = new LinkedHashSet<String>();
        for (Object value : requireList(raw.get("candidates"), "candidates", 256)) {
            Map<?, ?> item = requireMap(value, "candidate");
            requireCandidateOidKeys(item);
            String key = requirePattern(item.get("key"), SAFE_ID, "candidate.key");
            if (!candidateKeys.add(key)) throw invalidReview("duplicate candidate key");
            candidates.add(new ReviewCandidate(key,
                    requireBranch(item.get("branch"), "candidate.branch"),
                    requirePattern(oidValue(item), OID, "candidate.oid")));
        }
        if (candidates.isEmpty()) throw invalidReview("review has no candidates");

        List<ReviewFile> files = new ArrayList<ReviewFile>();
        Set<String> fileIds = new LinkedHashSet<String>();
        Set<String> hunkIds = new LinkedHashSet<String>();
        Set<String> selectedFilesFromRows = new LinkedHashSet<String>();
        Set<String> selectedHunksFromRows = new LinkedHashSet<String>();
        for (Object value : requireList(raw.get("files"), "files", 4096)) {
            Map<?, ?> item = requireMap(value, "file");
            requireExactKeys(item, "id", "candidateKey", "path", "status",
                    "binary", "selected", "hunks");
            String id = requirePattern(item.get("id"), FILE_ID, "file.id");
            if (!fileIds.add(id)) throw invalidReview("duplicate file id");
            String candidateKey = requirePattern(
                    item.get("candidateKey"), SAFE_ID, "file.candidateKey");
            if (!candidateKeys.contains(candidateKey)) {
                throw invalidReview("file references an unknown candidate");
            }
            String path = requireRepoPath(item.get("path"), "file.path");
            String status = requireToken(item.get("status"), "file.status");
            boolean binary = requireBoolean(item.get("binary"), "file.binary");
            boolean selected = requireBoolean(item.get("selected"), "file.selected");
            if (selected) selectedFilesFromRows.add(id);
            List<ReviewHunk> hunks = new ArrayList<ReviewHunk>();
            for (Object hunkValue : requireList(item.get("hunks"), "file.hunks", 20000)) {
                Map<?, ?> hunk = requireMap(hunkValue, "hunk");
                requireExactKeys(hunk, "id", "header", "oldStart", "oldLines",
                        "newStart", "newLines", "selected");
                String hunkId = requirePattern(hunk.get("id"), HUNK_ID, "hunk.id");
                if (!hunkIds.add(hunkId)) throw invalidReview("duplicate hunk id");
                boolean hunkSelected = requireBoolean(hunk.get("selected"), "hunk.selected");
                if (hunkSelected) selectedHunksFromRows.add(hunkId);
                hunks.add(new ReviewHunk(hunkId,
                        requireText(hunk.get("header"), "hunk.header", 4096, false),
                        requireLong(hunk.get("oldStart"), "hunk.oldStart", 0, Integer.MAX_VALUE),
                        requireLong(hunk.get("oldLines"), "hunk.oldLines", 0, Integer.MAX_VALUE),
                        requireLong(hunk.get("newStart"), "hunk.newStart", 0, Integer.MAX_VALUE),
                        requireLong(hunk.get("newLines"), "hunk.newLines", 0, Integer.MAX_VALUE),
                        hunkSelected));
            }
            if (binary && !hunks.isEmpty()) {
                throw invalidReview("binary file must not expose selectable hunks");
            }
            files.add(new ReviewFile(id, candidateKey, path, status, binary,
                    selected, hunks));
        }

        Map<?, ?> selection = requireMap(raw.get("selection"), "selection");
        requireExactKeys(selection, "fileIds", "hunkIds");
        List<String> selectedFileIds = parseIdList(
                selection.get("fileIds"), "selection.fileIds", FILE_ID, 4096);
        List<String> selectedHunkIds = parseIdList(
                selection.get("hunkIds"), "selection.hunkIds", HUNK_ID, 20000);
        if (selectedFileIds.size() + selectedHunkIds.size() > MAX_SELECTION_IDS) {
            throw invalidReview("merge-review selection exceeds the v1 ID limit");
        }
        if (!fileIds.containsAll(selectedFileIds) || !hunkIds.containsAll(selectedHunkIds)) {
            throw invalidReview("selection references an unknown file or hunk");
        }
        if (!selectedFilesFromRows.equals(new LinkedHashSet<String>(selectedFileIds))
                || !selectedHunksFromRows.equals(new LinkedHashSet<String>(selectedHunkIds))) {
            throw invalidReview("selection disagrees with file or hunk projection");
        }
        Set<String> selectedFileSet = new HashSet<String>(selectedFileIds);
        for (ReviewFile file : files) {
            if (!selectedFileSet.contains(file.id)) continue;
            for (ReviewHunk hunk : file.hunks) {
                if (selectedHunksFromRows.contains(hunk.id)) {
                    throw invalidReview("selection redundantly selects a file and its hunk");
                }
            }
        }

        List<ReviewConflict> conflicts = new ArrayList<ReviewConflict>();
        for (Object value : requireList(raw.get("conflicts"), "conflicts", 4096)) {
            Map<?, ?> item = requireMap(value, "conflict");
            requireExactKeys(item, "candidateKey", "path", "type", "explanation",
                    "suggestion", "hunkIds");
            String candidateKey = requirePattern(
                    item.get("candidateKey"), SAFE_ID, "conflict.candidateKey");
            if (!candidateKeys.contains(candidateKey)) {
                throw invalidReview("conflict references an unknown candidate");
            }
            List<String> conflictHunkIds = parseIdList(
                    item.get("hunkIds"), "conflict.hunkIds", HUNK_ID, 20000);
            if (!hunkIds.containsAll(conflictHunkIds)) {
                throw invalidReview("conflict references an unknown hunk");
            }
            conflicts.add(new ReviewConflict(candidateKey,
                    requireRepoPath(item.get("path"), "conflict.path"),
                    requireToken(item.get("type"), "conflict.type"),
                    requireText(item.get("explanation"), "conflict.explanation", 8000, false),
                    item.get("suggestion") == null ? "No automatic resolution is available."
                            : requireText(item.get("suggestion"),
                                    "conflict.suggestion", 8000, false),
                    conflictHunkIds));
        }

        ReviewDecision decision = null;
        if (raw.get("decision") != null) {
            Map<?, ?> item = requireMap(raw.get("decision"), "decision");
            requireExactKeys(item, "actor", "reason", "host", "decidedAt");
            decision = new ReviewDecision(
                    requirePattern(item.get("actor"), SAFE_ID, "decision.actor"),
                    requireText(item.get("reason"), "decision.reason", 1000, false),
                    requireText(item.get("host"), "decision.host", 256, false),
                    requireTimestamp(item.get("decidedAt"), "decision.decidedAt"));
        }
        Map<?, ?> details = requireMap(raw.get("details"), "details");
        if (!details.isEmpty()) throw invalidReview("unknown merge-review details");
        String createdAt = requireTimestamp(raw.get("createdAt"), "createdAt");
        String updatedAt = requireTimestamp(raw.get("updatedAt"), "updatedAt");
        if (java.time.Instant.parse(updatedAt).isBefore(java.time.Instant.parse(createdAt))) {
            throw invalidReview("merge-review updatedAt precedes createdAt");
        }
        return new MergeReview(reviewId, revision, state, baseBranch, baseOid,
                candidates, files, selectedFileIds, selectedHunkIds, conflicts,
                decision,
                requirePattern(raw.get("planDigest"), DIGEST, "planDigest"),
                requirePattern(raw.get("evidenceDigest"), DIGEST, "evidenceDigest"),
                createdAt, updatedAt);
    }

    private static List<ReviewAction> parseActions(List<?> raw, String reviewId) {
        List<ReviewAction> actions = new ArrayList<ReviewAction>();
        Set<String> ids = new LinkedHashSet<String>();
        for (Object value : raw) {
            Map<?, ?> item = requireMap(value, "action");
            requireExactKeys(item, "id", "enabled", "argv", "reason");
            String id = requirePattern(item.get("id"), SAFE_ID, "action.id");
            if (!REVIEW_OPERATIONS.contains(id)) {
                throw invalidReview("unknown merge-review action");
            }
            if (!ids.add(id)) throw invalidReview("duplicate action id");
            List<String> argv = new ArrayList<String>();
            for (Object arg : requireList(item.get("argv"), "action.argv", 256)) {
                argv.add(requireText(arg, "action.argv[]", 4096, false));
            }
            if (argv.size() < 3 || !"team".equals(argv.get(0))
                    || !"merge-review".equals(argv.get(1))
                    || !id.equals(argv.get(2))
                    || (("show".equals(id) || "apply".equals(id)
                            || "rollback".equals(id))
                        && (argv.size() < 4
                            || !reviewId.equals(argv.get(3))))) {
                throw invalidReview("action argv crosses its declared boundary");
            }
            String reason = item.get("reason") == null ? null
                    : requireText(item.get("reason"), "action.reason", 1000, false);
            actions.add(new ReviewAction(id,
                    requireBoolean(item.get("enabled"), "action.enabled"), argv, reason));
        }
        return actions;
    }

    private static void requireForwardTransition(
            MergeReview before, MergeReview after, String expectedState) {
        if (before == null || after == null
                || !before.reviewId.equals(after.reviewId)
                || !before.planDigest.equals(after.planDigest)
                || after.revision <= before.revision
                || !expectedState.equals(after.state)) {
            throw invalidReview("invalid merge-review " + expectedState + " transition");
        }
    }

    private static List<String> mergeReviewPrefix(String operation) {
        return new ArrayList<String>(Arrays.asList("team", "merge-review", operation));
    }

    private static void addOption(List<String> args, String option, String value) {
        if (value == null) return;
        args.add(option);
        args.add(value);
    }

    private static String optionalBranch(String value, String label) {
        return value == null || value.trim().isEmpty() ? null : requireBranch(value, label);
    }

    private static String optionalId(String value, String label) {
        return value == null || value.trim().isEmpty()
                ? null : requirePattern(value, SAFE_ID, label);
    }

    private static String optionalText(String value, String label, int max) {
        return value == null || value.trim().isEmpty()
                ? null : requireText(value, label, max, false);
    }

    private static String requireBranch(Object value, String label) {
        String branch = requirePattern(value, SAFE_BRANCH, label);
        if (branch.contains("..") || branch.endsWith(".lock")
                || branch.contains("@{") || branch.endsWith(".")) {
            throw invalidReview(label + " is not a canonical branch");
        }
        return branch;
    }

    private static String requireRepoPath(Object value, String label) {
        String path = requireText(value, label, 4096, false);
        if (path.startsWith("/") || path.startsWith("\\")
                || path.matches("^[A-Za-z]:.*") || path.contains("\\")) {
            throw invalidReview(label + " must be repo-relative");
        }
        String[] segments = path.split("/", -1);
        if (segments.length == 0) throw invalidReview(label + " is empty");
        for (String segment : segments) {
            if (segment.isEmpty() || ".".equals(segment) || "..".equals(segment)) {
                throw invalidReview(label + " is not canonical");
            }
        }
        return path;
    }

    private static String requireToken(Object value, String label) {
        return requirePattern(value, SAFE_TOKEN, label);
    }

    private static String requirePattern(Object value, Pattern pattern, String label) {
        String text = requireText(value, label, 4096, false);
        if (!pattern.matcher(text).matches()) throw invalidReview("invalid " + label);
        return text;
    }

    private static String requireText(Object value, String label,
            int max, boolean allowEmpty) {
        if (!(value instanceof String)) throw invalidReview(label + " must be a string");
        String text = (String) value;
        if (text.length() > max || (!allowEmpty && text.isEmpty())
                || !text.equals(text.trim())
                || Pattern.compile("[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]")
                        .matcher(text).find()) {
            throw invalidReview("invalid " + label);
        }
        return text;
    }

    private static String requireTimestamp(Object value, String label) {
        String timestamp = requireText(value, label, 64, false);
        try {
            java.time.Instant.parse(timestamp);
        } catch (RuntimeException error) {
            throw invalidReview("invalid " + label, error);
        }
        return timestamp;
    }

    private static boolean requireBoolean(Object value, String label) {
        if (!(value instanceof Boolean)) throw invalidReview(label + " must be boolean");
        return (Boolean) value;
    }

    private static long requireLong(Object value, String label, long min, long max) {
        if (!(value instanceof Number)) throw invalidReview(label + " must be an integer");
        Number number = (Number) value;
        double asDouble = number.doubleValue();
        long asLong = number.longValue();
        if (!Double.isFinite(asDouble) || asDouble != (double) asLong
                || asLong < min || asLong > max) {
            throw invalidReview("invalid " + label);
        }
        return asLong;
    }

    private static Map<?, ?> requireMap(Object value, String label) {
        if (!(value instanceof Map)) throw invalidReview(label + " must be an object");
        return (Map<?, ?>) value;
    }

    private static List<?> requireList(Object value, String label, int max) {
        if (!(value instanceof List)) throw invalidReview(label + " must be an array");
        List<?> list = (List<?>) value;
        if (list.size() > max) throw invalidReview(label + " exceeds its bound");
        return list;
    }

    private static void requireExactKeys(Map<?, ?> value, String... keys) {
        Set<Object> expected = new LinkedHashSet<Object>(Arrays.asList(keys));
        if (value.size() != expected.size() || !value.keySet().equals(expected)) {
            throw invalidReview("merge-review fields are missing or unknown");
        }
    }

    private static void requireBranchOidKeys(Map<?, ?> value, String label) {
        boolean oid = value.containsKey("oid");
        boolean commitOid = value.containsKey("commitOid");
        if (oid == commitOid || value.size() != 2 || !value.containsKey("branch")) {
            throw invalidReview(label + " must carry exactly one OID field");
        }
    }

    private static void requireCandidateOidKeys(Map<?, ?> value) {
        boolean oid = value.containsKey("oid");
        boolean commitOid = value.containsKey("commitOid");
        if (oid == commitOid || value.size() != 3
                || !value.containsKey("key") || !value.containsKey("branch")) {
            throw invalidReview("candidate must carry exactly one OID field");
        }
    }

    private static Object oidValue(Map<?, ?> value) {
        return value.containsKey("oid") ? value.get("oid") : value.get("commitOid");
    }

    private static List<String> parseIdList(
            Object value, String label, Pattern pattern, int max) {
        List<String> result = new ArrayList<String>();
        Set<String> seen = new LinkedHashSet<String>();
        for (Object item : requireList(value, label, max)) {
            String id = requirePattern(item, pattern, label + "[]");
            if (!seen.add(id)) throw invalidReview("duplicate " + label + " entry");
            result.add(id);
        }
        return result;
    }

    private static Set<String> uniqueIds(
            List<String> values, Pattern pattern, String label) {
        Set<String> out = new LinkedHashSet<String>();
        for (String value : values) {
            String id = requirePattern(value, pattern, label);
            if (!out.add(id)) throw new IllegalArgumentException("duplicate " + label);
        }
        return out;
    }

    private static IllegalArgumentException invalidReview(String message) {
        return new IllegalArgumentException("Invalid merge-review v1: " + message);
    }

    private static IllegalArgumentException invalidReview(
            String message, Throwable cause) {
        return new IllegalArgumentException("Invalid merge-review v1: " + message, cause);
    }

    private static String boundedString(Object value, int max) {
        if (!(value instanceof String)) return null;
        String clean = ((String) value)
                .replaceAll("[\\x00-\\x1f\\x7f]", "")
                .trim();
        return clean.isEmpty() ? null : clean.substring(0, Math.min(max, clean.length()));
    }

    private static String normalizedPath(Object value) {
        String path = boundedString(value, 4096);
        if (path == null) return "";
        String slash = path.replace('\\', '/').replaceAll("/+$", "");
        return slash.matches("^[A-Za-z]:/.*") ? slash.toLowerCase(Locale.ROOT) : slash;
    }

    private static Number positiveNumber(Object value) {
        if (!(value instanceof Number)) return null;
        Number n = (Number) value;
        double d = n.doubleValue();
        return Double.isFinite(d) && d > 0 ? n : null;
    }

    private static long nonNegativeLong(Object value) {
        if (!(value instanceof Number)) return 0L;
        double d = ((Number) value).doubleValue();
        return Double.isFinite(d) && d >= 0 ? ((Number) value).longValue() : 0L;
    }

    private static String firstGroup(String haystack, String regex) {
        Matcher m = Pattern.compile(regex).matcher(haystack);
        return m.find() ? m.group(1) : null;
    }
}
