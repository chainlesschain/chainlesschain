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

        assertEquals("cc agent --worktree -p \"fix the tests\"",
                WorktreeTasks.buildNewTaskCommand("fix the tests", "cc", true));
        assertEquals("clc agent --worktree -p 'fix the tests'",
                WorktreeTasks.buildNewTaskCommand("fix the tests", "clc", false));
        // Quotes/backticks in the task are stripped, not escaped.
        assertEquals("cc agent --worktree -p \"say  hi   now\"",
                WorktreeTasks.buildNewTaskCommand("say \"hi\" `now`", "cc", true));
    }
}
