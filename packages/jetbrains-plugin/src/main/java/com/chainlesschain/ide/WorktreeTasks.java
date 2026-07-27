package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
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
            Pattern.compile("^(cc-agent-|batch/|agent/|team/)");

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
        Object sessions = ((Map<?, ?>) parsed).get("sessions");
        if (!(sessions instanceof List)) return rows;
        int count = 0;
        for (Object raw : (List<?>) sessions) {
            if (count++ >= 1000) break;
            if (!(raw instanceof Map)) continue;
            Map<?, ?> session = (Map<?, ?>) raw;
            String backgroundId = boundedString(session.get("id"), 160);
            String branch = boundedString(session.get("branch"), 512);
            String worktreePath = boundedString(
                    session.get("worktreePath") != null
                            ? session.get("worktreePath") : session.get("cwd"),
                    4096);
            if (backgroundId == null || (branch == null && worktreePath == null)) continue;
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
            row.put("backgroundId", backgroundId);
            row.put("branch", branch);
            row.put("worktreePath", worktreePath);
            String owner = boundedString(governance.get("owner"), 160);
            row.put("owner", owner == null ? "background:" + backgroundId : owner);
            String sessionId = boundedString(
                    governance.get("sessionId") != null
                            ? governance.get("sessionId") : session.get("sessionId"),
                    256);
            row.put("sessionId", sessionId);
            String status = boundedString(
                    session.get("lifecycleState") != null
                            ? session.get("lifecycleState") : session.get("status"),
                    64);
            row.put("backgroundStatus", status == null ? "unknown" : status);
            String permissionMode = boundedString(governance.get("permissionMode"), 64);
            row.put("permissionMode",
                    permissionMode == null ? "default" : permissionMode);
            Map<String, Object> resourceBudget = new LinkedHashMap<String, Object>();
            resourceBudget.put("maxTurns", positiveNumber(budget.get("maxTurns")));
            resourceBudget.put("maxCostUsd", positiveNumber(budget.get("maxCostUsd")));
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
        if (t.get("backgroundId") != null) {
            sb.append("  bg: ").append(t.get("backgroundStatus"));
            sb.append(" / ").append(t.get("permissionMode"));
            Object budget = t.get("resourceBudget");
            if (budget instanceof Map) {
                Object turns = ((Map<?, ?>) budget).get("maxTurns");
                Object cost = ((Map<?, ?>) budget).get("maxCostUsd");
                if (turns != null) sb.append(" / turns ").append(turns);
                if (cost != null) sb.append(" / $").append(cost);
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
