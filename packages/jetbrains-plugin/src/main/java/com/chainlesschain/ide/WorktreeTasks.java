package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Worktree parallel tasks (P1 #9) — the Java twin of the VS Code extension's
 * worktree-tasks.js. Enumerates agent task worktrees ({@code cc agent
 * --worktree} → cc-agent-*, {@code cc batch} → batch/*, team isolation →
 * agent/*), sizes changes, previews merge-conflict risk via {@code git
 * merge-tree --write-tree} (git ≥ 2.38), and builds git argv for merge /
 * discard plus the {@code cc agent --worktree} command for a NEW isolated
 * task. All plain git — pure builders/parsers, JUnit-testable.
 */
public final class WorktreeTasks {

    private WorktreeTasks() {}

    private static final Pattern TASK_BRANCH =
            Pattern.compile("^(cc-agent-|batch/|agent/)");

    public static boolean isTaskBranch(String branch) {
        return branch != null && TASK_BRANCH.matcher(branch).find();
    }

    public static List<String> buildWorktreeListArgs() {
        return new ArrayList<String>(Arrays.asList("worktree", "list", "--porcelain"));
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

    public static List<String> buildMergePreviewArgs(String mainBranch, String branch) {
        return new ArrayList<String>(Arrays.asList(
                "merge-tree", "--write-tree", "--name-only", mainBranch, branch));
    }

    public static List<String> buildMergeArgs(String branch) {
        return new ArrayList<String>(Arrays.asList("merge", "--no-ff", branch));
    }

    public static List<String> buildMergeAbortArgs() {
        return new ArrayList<String>(Arrays.asList("merge", "--abort"));
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
     * Interpret merge-tree output + exit code → {@code {risk, files}} where
     * risk is clean | conflict | unknown (older git without --write-tree).
     */
    public static Map<String, Object> parseMergePreview(int code, String stdout, String stderr) {
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        List<String> files = new ArrayList<String>();
        String err = String.valueOf(stderr == null ? "" : stderr);
        if (err.contains("unknown option") || err.contains("usage: git merge-tree")) {
            out.put("risk", "unknown");
            out.put("files", files);
            return out;
        }
        if (code == 0) {
            out.put("risk", "clean");
            out.put("files", files);
            return out;
        }
        String[] lines = String.valueOf(stdout == null ? "" : stdout).split("\r?\n");
        for (int i = 1; i < lines.length; i++) { // line 0 = tree OID
            String s = lines[i].trim();
            if (s.isEmpty()) break;
            files.add(s);
        }
        out.put("risk", "conflict");
        out.put("files", files);
        return out;
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

    /** One JList row: {@code "branch  +40 −2 (3 files) ↑2  [dirty]  merge: clean"}. */
    public static String formatTaskLine(Map<String, Object> t) {
        StringBuilder sb = new StringBuilder(String.valueOf(t.get("branch")));
        sb.append("  ").append(t.get("stat"));
        Object ahead = t.get("ahead");
        if (ahead instanceof Number && ((Number) ahead).longValue() > 0) {
            sb.append(" ↑").append(ahead);
        }
        if (Boolean.TRUE.equals(t.get("dirty"))) sb.append("  [dirty]");
        Object merge = t.get("merge");
        if (merge instanceof Map) {
            Object risk = ((Map<?, ?>) merge).get("risk");
            sb.append("  merge: ").append(risk);
            Object files = ((Map<?, ?>) merge).get("files");
            if ("conflict".equals(risk) && files instanceof List && !((List<?>) files).isEmpty()) {
                List<?> f = (List<?>) files;
                sb.append(" (").append(f.get(0));
                if (f.size() > 1) sb.append(" +").append(f.size() - 1);
                sb.append(')');
            }
        }
        return sb.toString();
    }

    /**
     * The terminal command for a NEW isolated task ({@code --bg --worktree}
     * is rejected by the CLI, so it runs interactively). Quotes in the task
     * are stripped rather than escaped — shell-escaping across cmd/PowerShell/
     * POSIX is not worth a prompt character.
     */
    public static String buildNewTaskCommand(String task, String command, boolean windows) {
        String clean = String.valueOf(task == null ? "" : task)
                .replaceAll("[\"'`\\\\]", " ").trim();
        String cc = command == null || command.isEmpty() ? "cc" : command;
        return windows
                ? cc + " agent --worktree -p \"" + clean + "\""
                : cc + " agent --worktree -p '" + clean + "'";
    }

    private static String firstGroup(String haystack, String regex) {
        Matcher m = Pattern.compile(regex).matcher(haystack);
        return m.find() ? m.group(1) : null;
    }
}
