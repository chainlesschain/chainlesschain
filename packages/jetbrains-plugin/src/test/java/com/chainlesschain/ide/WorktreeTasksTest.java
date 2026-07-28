package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

final class WorktreeTasksTest {

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
    void classifiesMergePreview() {
        Map<String, Object> clean = WorktreeTasks.parseMergePreview(0, "abc123\n", "");
        assertEquals("clean", clean.get("risk"));

        Map<String, Object> conflict = WorktreeTasks.parseMergePreview(1,
                "deadbeef\nsrc/a.js\nsrc/b.js\n\nAuto-merging src/a.js\n", "");
        assertEquals("conflict", conflict.get("risk"));
        assertEquals(Arrays.asList("src/a.js", "src/b.js"), conflict.get("files"));

        Map<String, Object> unknown = WorktreeTasks.parseMergePreview(129, "",
                "error: unknown option `write-tree'");
        assertEquals("unknown", unknown.get("risk"));
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
        Map<String, Object> merge = new LinkedHashMap<String, Object>();
        merge.put("risk", "conflict");
        merge.put("files", Arrays.asList("src/a.js", "src/b.js"));
        t.put("merge", merge);
        String line = WorktreeTasks.formatTaskLine(t);
        assertTrue(line.contains("cc-agent-1"));
        assertTrue(line.contains("↑2"));
        assertTrue(line.contains("[dirty]"));
        assertTrue(line.contains("merge: conflict (src/a.js +1)"));
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
        assertEquals(Arrays.asList("merge-tree", "--write-tree", "--name-only", "main", "b1"),
                WorktreeTasks.buildMergePreviewArgs("main", "b1"));
        assertEquals(Arrays.asList("merge", "--no-ff", "b1"),
                WorktreeTasks.buildMergeArgs("b1"));
        assertEquals(Arrays.asList("merge", "--abort"),
                WorktreeTasks.buildMergeAbortArgs());
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
