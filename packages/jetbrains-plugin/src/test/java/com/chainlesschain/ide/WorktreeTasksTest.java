package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

final class WorktreeTasksTest {

    private static final String REVIEW_ID = "tmr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static final String FILE_ID = "tmrf_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    private static final String BINARY_FILE_ID = "tmrf_cccccccccccccccccccccccccccccccc";
    private static final String HUNK_ID = "tmrh_dddddddddddddddddddddddddddddddd";
    private static final String PLAN_DIGEST = "sha256:" + repeat('e', 64);
    private static final String EVIDENCE_DIGEST = "sha256:" + repeat('f', 64);

    private static final String PORCELAIN = String.join("\n",
            "worktree C:/repo",
            "HEAD 1111111111111111111111111111111111111111",
            "branch refs/heads/main",
            "",
            "worktree C:/repo/.cc-worktrees/cc-agent-20260710-ab12",
            "HEAD 2222222222222222222222222222222222222222",
            "branch refs/heads/cc-agent-20260710-ab12",
            "",
            "worktree C:/elsewhere/feature",
            "HEAD 3333333333333333333333333333333333333333",
            "branch refs/heads/feature/other",
            "");

    private static String repeat(char value, int count) {
        char[] chars = new char[count];
        Arrays.fill(chars, value);
        return new String(chars);
    }

    private static String envelope(String operation, String state, long revision) {
        boolean decided = "published".equals(state) || "rollback_required".equals(state)
                || "rolled_back".equals(state);
        String decision = decided
                ? "{\"actor\":\"jetbrains-worktree-tasks\","
                    + "\"reason\":\"approved exact IDs\",\"host\":\"jetbrains\","
                    + "\"decidedAt\":\"2026-08-14T10:00:00Z\"}"
                : "null";
        String actionId = "preview".equals(operation) ? "show"
                : "published".equals(state) ? "rollback" : "apply";
        String actionArgv;
        if ("show".equals(actionId)) {
            actionArgv = "[\"team\",\"merge-review\",\"show\",\""
                    + REVIEW_ID + "\",\"--json\"]";
        } else if ("rollback".equals(actionId)) {
            actionArgv = "[\"team\",\"merge-review\",\"rollback\",\""
                    + REVIEW_ID + "\",\"--revision\",\"" + revision
                    + "\",\"--evidence-digest\",\"" + EVIDENCE_DIGEST
                    + "\",\"--confirm\",\"" + REVIEW_ID + "\",\"--json\"]";
        } else {
            actionArgv = "[\"team\",\"merge-review\",\"apply\",\""
                    + REVIEW_ID + "\",\"--revision\",\"" + revision
                    + "\",\"--plan-digest\",\"" + PLAN_DIGEST
                    + "\",\"--file-id\",\"" + BINARY_FILE_ID
                    + "\",\"--hunk-id\",\"" + HUNK_ID + "\",\"--json\"]";
        }
        return "{"
                + "\"schema\":\"chainlesschain.team-merge-review/v1\","
                + "\"schemaVersion\":1,\"operation\":\"" + operation + "\","
                + "\"review\":{"
                + "\"reviewId\":\"" + REVIEW_ID + "\",\"revision\":" + revision + ","
                + "\"state\":\"" + state + "\","
                + "\"base\":{\"branch\":\"main\",\"commitOid\":\""
                + repeat('1', 40) + "\"},"
                + "\"candidates\":[{\"key\":\"candidate-1\","
                + "\"branch\":\"cc-agent-task-1\",\"commitOid\":\""
                + repeat('2', 40) + "\"}],"
                + "\"files\":["
                + "{\"id\":\"" + FILE_ID + "\",\"candidateKey\":\"candidate-1\","
                + "\"path\":\"src/a.js\",\"status\":\"modified\","
                + "\"binary\":false,\"selected\":false,\"hunks\":[{"
                + "\"id\":\"" + HUNK_ID + "\",\"header\":\"@@ -1,2 +1,3 @@\","
                + "\"oldStart\":1,\"oldLines\":2,\"newStart\":1,"
                + "\"newLines\":3,\"selected\":true}]},"
                + "{\"id\":\"" + BINARY_FILE_ID + "\","
                + "\"candidateKey\":\"candidate-1\",\"path\":\"assets/a.png\","
                + "\"status\":\"added\",\"binary\":true,\"selected\":true,"
                + "\"hunks\":[]}],"
                + "\"selection\":{\"fileIds\":[\"" + BINARY_FILE_ID
                + "\"],\"hunkIds\":[\"" + HUNK_ID + "\"]},"
                + "\"conflicts\":[{\"candidateKey\":\"candidate-1\","
                + "\"path\":\"src/a.js\",\"type\":\"both_modified\","
                + "\"explanation\":\"Both sides changed this hunk.\","
                + "\"suggestion\":\"Review the selected lines.\","
                + "\"hunkIds\":[\"" + HUNK_ID + "\"]}],"
                + "\"decision\":" + decision + ","
                + "\"planDigest\":\"" + PLAN_DIGEST + "\","
                + "\"evidenceDigest\":\"" + EVIDENCE_DIGEST + "\","
                + "\"createdAt\":\"2026-08-14T09:00:00Z\","
                + "\"updatedAt\":\"2026-08-14T10:00:00Z\",\"details\":{}},"
                + "\"actions\":[{\"id\":\"" + actionId + "\","
                + "\"enabled\":true,\"argv\":" + actionArgv + ",\"reason\":null}]}";
    }

    @Test
    void parsesWorktreeListAndMarksTasks() {
        List<Map<String, Object>> rows = WorktreeTasks.parseWorktreeList(PORCELAIN);
        assertEquals(3, rows.size());
        assertEquals("main", rows.get(0).get("branch"));
        assertEquals(Boolean.TRUE, rows.get(0).get("main"));
        assertEquals(Boolean.FALSE, rows.get(0).get("isTask"));
        assertEquals("cc-agent-20260710-ab12", rows.get(1).get("branch"));
        assertEquals(Boolean.TRUE, rows.get(1).get("isTask"));
        assertEquals(Boolean.FALSE, rows.get(2).get("isTask"));
        assertTrue(WorktreeTasks.parseWorktreeList("").isEmpty());

        assertTrue(WorktreeTasks.isTaskBranch("batch/unit-1"));
        assertTrue(WorktreeTasks.isTaskBranch("agent/task-9"));
        assertTrue(WorktreeTasks.isTaskBranch("team/release-reviewer"));
        assertFalse(WorktreeTasks.isTaskBranch("main"));
        assertFalse(WorktreeTasks.isTaskBranch(null));
    }

    @Test
    void summarizesShortstatAndFormatsLines() {
        assertEquals("+40 −2 (3 files)", WorktreeTasks.summarizeShortstat(
                " 3 files changed, 40 insertions(+), 2 deletions(-)"));
        assertEquals("+5 −0 (1 file)", WorktreeTasks.summarizeShortstat(
                " 1 file changed, 5 insertions(+)"));
        assertEquals("no diff", WorktreeTasks.summarizeShortstat(""));

        Map<String, Object> t = new LinkedHashMap<String, Object>();
        t.put("branch", "cc-agent-1");
        t.put("stat", "+40 −2 (3 files)");
        t.put("ahead", 2L);
        t.put("dirty", Boolean.TRUE);
        String line = WorktreeTasks.formatTaskLine(t);
        assertTrue(line.contains("cc-agent-1"));
        assertTrue(line.contains("↑2"));
        assertTrue(line.contains("[dirty]"));
        assertTrue(line.contains("review: CLI-governed"));
    }

    @Test
    void buildsArgvAndNewTaskCommand() {
        assertEquals(Arrays.asList("worktree", "list", "--porcelain"),
                WorktreeTasks.buildWorktreeListArgs());
        assertEquals(Arrays.asList("daemon", "view", "--json"),
                WorktreeTasks.buildBackgroundListArgs());
        assertEquals(Arrays.asList("rev-list", "--count", "abc..b1"),
                WorktreeTasks.buildAheadArgs("abc", "b1"));
        assertEquals(Arrays.asList("diff", "--shortstat", "abc...b1"),
                WorktreeTasks.buildShortstatArgs("abc", "b1"));
        assertEquals(Arrays.asList("worktree", "remove", "--force", "/wt"),
                WorktreeTasks.buildWorktreeRemoveArgs("/wt"));
        assertEquals(Arrays.asList("branch", "-D", "b1"),
                WorktreeTasks.buildBranchDeleteArgs("b1"));

        assertEquals("cc agent --bg --worktree -p \"fix the tests\"",
                WorktreeTasks.buildNewTaskCommand("fix the tests", "cc", true));
        assertEquals("clc agent --bg --worktree -p 'fix the tests'",
                WorktreeTasks.buildNewTaskCommand("fix the tests", "clc", false));
        // Quotes/backticks in the task are stripped, not escaped.
        assertEquals("cc agent --bg --worktree -p \"say  hi   now\"",
                WorktreeTasks.buildNewTaskCommand("say \"hi\" `now`", "cc", true));
    }

    @Test
    void parsesStrictMergeReviewV1AndExplainsConflicts() {
        WorktreeTasks.MergeReviewEnvelope parsed =
                WorktreeTasks.parseMergeReviewEnvelope(
                        envelope("preview", "planned", 1), "preview");

        assertEquals("preview", parsed.operation);
        assertEquals(REVIEW_ID, parsed.review.reviewId);
        assertEquals(1L, parsed.review.revision);
        assertEquals("planned", parsed.review.state);
        assertEquals("main", parsed.review.baseBranch);
        assertEquals(repeat('1', 40), parsed.review.baseOid);
        assertEquals("candidate-1", parsed.review.candidates.get(0).key);
        assertEquals(repeat('2', 40), parsed.review.candidates.get(0).oid);
        assertEquals(Arrays.asList(BINARY_FILE_ID), parsed.review.selectedFileIds);
        assertEquals(Arrays.asList(HUNK_ID), parsed.review.selectedHunkIds);
        assertTrue(parsed.review.files.get(1).binary);
        assertTrue(WorktreeTasks.explainMergeReviewConflicts(parsed.review)
                .contains("Both sides changed this hunk."));

        List<String> expectedShow = WorktreeTasks.buildMergeReviewShowArgs(
                REVIEW_ID, null);
        assertEquals(expectedShow, WorktreeTasks.selectMergeReviewActionArgs(
                parsed, "show", expectedShow));
        assertNull(WorktreeTasks.selectMergeReviewActionArgs(
                parsed, "show", Arrays.asList(
                        "team", "merge-review", "show", REVIEW_ID,
                        "--state-dir", "other", "--json")));

        WorktreeTasks.MergeReviewEnvelope oidAlias =
                WorktreeTasks.parseMergeReviewEnvelope(
                        envelope("preview", "planned", 1)
                                .replace("\"commitOid\"", "\"oid\""),
                        "preview");
        assertEquals(parsed.review.baseOid, oidAlias.review.baseOid);
        assertEquals(parsed.review.candidates.get(0).oid,
                oidAlias.review.candidates.get(0).oid);

        String nullableSuggestion = envelope("preview", "planned", 1)
                .replace("\"suggestion\":\"Review the selected lines.\"",
                        "\"suggestion\":null");
        assertEquals("No automatic resolution is available.",
                WorktreeTasks.parseMergeReviewEnvelope(
                        nullableSuggestion, "preview")
                        .review.conflicts.get(0).suggestion);
    }

    @Test
    void rejectsMalformedUnknownAndInconsistentMergeReviewAuthority() {
        assertThrows(IllegalArgumentException.class,
                () -> WorktreeTasks.parseMergeReviewEnvelope("not json", "preview"));
        assertThrows(IllegalArgumentException.class,
                () -> WorktreeTasks.parseMergeReviewEnvelope(
                        envelope("preview", "planned", 1), "show"));
        assertThrows(IllegalArgumentException.class,
                () -> WorktreeTasks.parseMergeReviewEnvelope(
                        envelope("preview", "planned", 1)
                                .replace("\"schemaVersion\":1", "\"schemaVersion\":2"),
                        "preview"));
        assertThrows(IllegalArgumentException.class,
                () -> WorktreeTasks.parseMergeReviewEnvelope(
                        envelope("preview", "planned", 1)
                                .replace("\"state\":\"planned\"",
                                        "\"state\":\"surprise\""),
                        "preview"));
        assertThrows(IllegalArgumentException.class,
                () -> WorktreeTasks.parseMergeReviewEnvelope(
                        envelope("preview", "planned", 1)
                                .replace(REVIEW_ID, "tmr_not-an-id"),
                        "preview"));
        assertThrows(IllegalArgumentException.class,
                () -> WorktreeTasks.parseMergeReviewEnvelope(
                        envelope("preview", "planned", 1)
                                .replace(PLAN_DIGEST, "sha256:bad"),
                        "preview"));
        assertThrows(IllegalArgumentException.class,
                () -> WorktreeTasks.parseMergeReviewEnvelope(
                        envelope("preview", "planned", 1)
                                .replace("\"selected\":false,\"hunks\"",
                                        "\"selected\":true,\"hunks\""),
                        "preview"));
        assertThrows(IllegalArgumentException.class,
                () -> WorktreeTasks.parseMergeReviewEnvelope(
                        envelope("preview", "planned", 1)
                                .replace("\"show\",\"" + REVIEW_ID,
                                        "\"git\",\"merge\""),
                        "preview"));
        assertThrows(IllegalArgumentException.class,
                () -> WorktreeTasks.parseMergeReviewEnvelope(
                        envelope("preview", "planned", 1)
                                .replace("\"actions\":[", "\"unexpected\":true,\"actions\":["),
                        "preview"));
        assertThrows(IllegalArgumentException.class,
                () -> WorktreeTasks.parseMergeReviewEnvelope(
                        envelope("preview", "planned", 1)
                                .replace("\"updatedAt\":\"2026-08-14T10:00:00Z\"",
                                        "\"updatedAt\":\"2026-08-13T10:00:00Z\""),
                        "preview"));
        assertThrows(IllegalArgumentException.class,
                () -> WorktreeTasks.parseMergeReviewEnvelope(
                        envelope("preview", "planned", 1)
                                .replace("[\"team\",\"merge-review\",\"show\",\""
                                                + REVIEW_ID,
                                        "[\"team\",\"merge-review\",\"show\",\"tmr_"
                                                + repeat('9', 32)),
                        "preview"));
        assertThrows(IllegalArgumentException.class,
                () -> WorktreeTasks.parseMergeReviewEnvelope(
                        envelope("preview", "planned", 1)
                                .replace("\"commitOid\":\"" + repeat('1', 40) + "\"",
                                        "\"oid\":\"" + repeat('1', 40)
                                                + "\",\"commitOid\":\""
                                                + repeat('1', 40) + "\""),
                        "preview"));
    }

    @Test
    void buildsExactMergeReviewArgvAndValidatesTransitions() {
        WorktreeTasks.MergeReview preview = WorktreeTasks.parseMergeReviewEnvelope(
                envelope("preview", "planned", 1), "preview").review;

        assertEquals(Arrays.asList(
                        "team", "merge-review", "preview",
                        "--branch", "cc-agent-task-1",
                        "--branch", "cc-agent-task-2",
                        "--base", "main",
                        "--state-dir", "C:/repo/.chainlesschain/reviews",
                        "--actor", "jetbrains-worktree-tasks",
                        "--reason", "user-approved-selection", "--json"),
                WorktreeTasks.buildMergeReviewPreviewArgs(
                        Arrays.asList("cc-agent-task-1", "cc-agent-task-2"),
                        "main", "C:/repo/.chainlesschain/reviews",
                        "jetbrains-worktree-tasks", "user-approved-selection"));
        assertEquals(Arrays.asList(
                        "team", "merge-review", "show", REVIEW_ID,
                        "--state-dir", "C:/repo/.chainlesschain/reviews", "--json"),
                WorktreeTasks.buildMergeReviewShowArgs(
                        REVIEW_ID, "C:/repo/.chainlesschain/reviews"));
        assertEquals(Arrays.asList(
                        "team", "merge-review", "apply", REVIEW_ID,
                        "--revision", "1", "--plan-digest", PLAN_DIGEST,
                        "--state-dir", "C:/repo/.chainlesschain/reviews",
                        "--file-id", BINARY_FILE_ID,
                        "--hunk-id", HUNK_ID,
                        "--actor", "jetbrains-worktree-tasks",
                        "--reason", "user-approved-selection", "--json"),
                WorktreeTasks.buildMergeReviewApplyArgs(preview,
                        Arrays.asList(BINARY_FILE_ID), Arrays.asList(HUNK_ID),
                        "C:/repo/.chainlesschain/reviews",
                        "jetbrains-worktree-tasks", "user-approved-selection"));

        WorktreeTasks.MergeReview published = WorktreeTasks.parseMergeReviewEnvelope(
                envelope("apply", "published", 2), "apply").review;
        WorktreeTasks.requirePublishedTransition(preview, published);

        WorktreeTasks.MergeReview conflicted = WorktreeTasks.parseMergeReviewEnvelope(
                envelope("apply", "conflicted", 2), "apply").review;
        WorktreeTasks.requireConflictedTransition(preview, conflicted);
        assertTrue(WorktreeTasks.explainMergeReviewConflicts(conflicted)
                .contains("Review the selected lines."));
        WorktreeTasks.MergeReview unexplainedConflict =
                WorktreeTasks.parseMergeReviewEnvelope(
                        envelope("apply", "conflicted", 2)
                                .replace(
                                        "\"conflicts\":[{\"candidateKey\":\"candidate-1\","
                                                + "\"path\":\"src/a.js\","
                                                + "\"type\":\"both_modified\","
                                                + "\"explanation\":\"Both sides changed this hunk.\","
                                                + "\"suggestion\":\"Review the selected lines.\","
                                                + "\"hunkIds\":[\"" + HUNK_ID + "\"]}]",
                                        "\"conflicts\":[]"),
                        "apply").review;
        assertThrows(IllegalArgumentException.class,
                () -> WorktreeTasks.requireConflictedTransition(
                        preview, unexplainedConflict));
        assertEquals(Arrays.asList(
                        "team", "merge-review", "rollback", REVIEW_ID,
                        "--revision", "2", "--evidence-digest", EVIDENCE_DIGEST,
                        "--confirm", REVIEW_ID,
                        "--state-dir", "C:/repo/.chainlesschain/reviews", "--json"),
                WorktreeTasks.buildMergeReviewRollbackArgs(published,
                        REVIEW_ID, "C:/repo/.chainlesschain/reviews"));

        WorktreeTasks.MergeReviewEnvelope publishedEnvelope =
                WorktreeTasks.parseMergeReviewEnvelope(
                        envelope("apply", "published", 2), "apply");
        List<String> rollbackWithoutState =
                WorktreeTasks.buildMergeReviewRollbackArgs(
                        publishedEnvelope.review, REVIEW_ID, null);
        assertEquals(rollbackWithoutState,
                WorktreeTasks.selectMergeReviewActionArgs(
                        publishedEnvelope, "rollback", rollbackWithoutState));

        WorktreeTasks.MergeReview rolledBack = WorktreeTasks.parseMergeReviewEnvelope(
                envelope("rollback", "rolled_back", 3), "rollback").review;
        WorktreeTasks.requireRolledBackTransition(published, rolledBack);

        assertThrows(IllegalArgumentException.class,
                () -> WorktreeTasks.buildMergeReviewPreviewArgs(
                        Arrays.asList("same", "same"), null, null, null, null));
        assertThrows(IllegalArgumentException.class,
                () -> WorktreeTasks.buildMergeReviewRollbackArgs(
                        published, "wrong", null));
        assertThrows(IllegalArgumentException.class,
                () -> WorktreeTasks.buildMergeReviewApplyArgs(preview,
                        Arrays.asList(FILE_ID), Arrays.asList(HUNK_ID),
                        null, null, null));
        assertThrows(IllegalArgumentException.class,
                () -> WorktreeTasks.buildMergeReviewApplyArgs(preview,
                        Arrays.asList("tmrf_" + repeat('9', 32)),
                        Arrays.<String>asList(), null, null, null));
        assertThrows(IllegalArgumentException.class,
                () -> WorktreeTasks.buildMergeReviewApplyArgs(preview,
                        Collections.nCopies(101, FILE_ID),
                        Collections.<String>emptyList(), null, null, null));
        assertThrows(IllegalArgumentException.class,
                () -> WorktreeTasks.requirePublishedTransition(
                        preview, WorktreeTasks.parseMergeReviewEnvelope(
                                envelope("apply", "published", 1), "apply").review));
    }

    @Test
    void projectsAndAttachesBackgroundGovernance() {
        String daemon = "{"
                + "\"sessions\":[{"
                + "\"id\":\"bg-1700000000000-a1b2c3\","
                + "\"sessionId\":\"fallback\","
                + "\"branch\":\"cc-agent-20260710-ab12\","
                + "\"worktreePath\":\"C:\\\\repo\\\\.cc-worktrees\\\\cc-agent-20260710-ab12\","
                + "\"status\":\"running\","
                + "\"lifecycleState\":\"waiting_for_approval\","
                + "\"governance\":{"
                + "\"owner\":\"background:bg-1700000000000-a1b2c3\","
                + "\"sessionId\":\"session-1\","
                + "\"permissionMode\":\"auto\","
                + "\"resourceBudget\":{\"maxTurns\":7,\"maxCostUsd\":2.5}},"
                + "\"sideEffects\":{\"total\":4,\"unsettled\":1,\"unknown\":1,"
                + "\"metadata\":{\"secret\":\"must-not-cross\"}},"
                + "\"argv\":[\"agent\",\"-p\",\"secret-prompt\"]"
                + "}]}";
        List<Map<String, Object>> projected =
                WorktreeTasks.parseBackgroundTaskGovernance(daemon);
        assertEquals(1, projected.size());
        assertEquals("auto", projected.get(0).get("permissionMode"));
        assertEquals("waiting_for_approval",
                projected.get(0).get("backgroundStatus"));
        assertFalse(MiniJson.stringify(projected).contains("secret"));

        Map<String, Object> task = new LinkedHashMap<String, Object>();
        task.put("branch", "cc-agent-20260710-ab12");
        task.put("path", "C:/wrong");
        List<Map<String, Object>> attached =
                WorktreeTasks.attachTaskGovernance(Arrays.asList(task), daemon);
        assertEquals("bg-1700000000000-a1b2c3",
                attached.get(0).get("backgroundId"));
        assertTrue(WorktreeTasks.formatTaskLine(attached.get(0))
                .contains("bg: waiting_for_approval / auto"));

        Map<String, Object> legacy = new LinkedHashMap<String, Object>();
        legacy.put("branch", "legacy/task");
        legacy.put("path",
                "c:/repo/.cc-worktrees/cc-agent-20260710-ab12/");
        assertEquals("bg-1700000000000-a1b2c3",
                WorktreeTasks.attachTaskGovernance(Arrays.asList(legacy), daemon)
                        .get(0).get("backgroundId"));
        assertTrue(WorktreeTasks.parseBackgroundTaskGovernance("not json").isEmpty());
    }

    @Test
    void projectsReadOnlyCollaborationGovernanceWithoutBackgroundControlId() {
        String daemon = "{"
                + "\"sessions\":[],\"managedTasks\":[{"
                + "\"managedTaskId\":\"batch-1700000000000-a1b2c3:unit-1\","
                + "\"runId\":\"batch-1700000000000-a1b2c3\","
                + "\"runKind\":\"batch\","
                + "\"branch\":\"batch/unit-1\","
                + "\"worktreePath\":\"C:\\\\repo\\\\.cc-worktrees\\\\unit-1\","
                + "\"status\":\"test-failed\","
                + "\"governance\":{"
                + "\"owner\":\"batch:batch-1700000000000-a1b2c3:unit-1\","
                + "\"sessionId\":\"session-batch-unit-1\","
                + "\"permissionMode\":\"acceptEdits\","
                + "\"resourceBudget\":{\"maxTurns\":8,\"maxCostUsd\":3,"
                + "\"maxTasks\":4,\"maxTokens\":20000,\"maxWallMs\":60000}},"
                + "\"sideEffects\":{\"total\":3,\"unsettled\":1,\"unknown\":0,"
                + "\"metadata\":{\"secret\":\"must-not-cross\"}},"
                + "\"prompt\":\"secret prompt\"}]}";

        List<Map<String, Object>> projected =
                WorktreeTasks.parseBackgroundTaskGovernance(daemon);
        assertEquals(1, projected.size());
        Map<String, Object> row = projected.get(0);
        assertEquals("batch-1700000000000-a1b2c3:unit-1",
                row.get("managedTaskId"));
        assertEquals("batch", row.get("runKind"));
        assertEquals("test-failed", row.get("managementStatus"));
        assertFalse(row.containsKey("backgroundId"));
        assertFalse(MiniJson.stringify(projected).contains("secret"));

        Map<String, Object> task = new LinkedHashMap<String, Object>();
        task.put("branch", "batch/unit-1");
        task.put("path", "C:/wrong");
        Map<String, Object> attached =
                WorktreeTasks.attachTaskGovernance(Arrays.asList(task), daemon).get(0);
        assertEquals("batch-1700000000000-a1b2c3:unit-1",
                attached.get("managedTaskId"));
        assertTrue(WorktreeTasks.formatTaskLine(attached)
                .contains("batch: test-failed / acceptEdits"));
    }
}
