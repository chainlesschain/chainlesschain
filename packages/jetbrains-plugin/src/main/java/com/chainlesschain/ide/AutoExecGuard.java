package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Auto-exec config guard (P2 #13) — the JetBrains twin of the VS Code
 * extension's {@code auto-exec-guard.js}. Pure classification of workspace files
 * that can lead to CODE EXECUTION without an explicit "run" action (MCP configs,
 * git/husky hooks, shell profiles, VS Code tasks/launch, JetBrains run configs,
 * .idea project config), so the IDE can warn once before the agent — which can
 * trigger them via tasks / hooks / MCP — starts working in a freshly-opened
 * workspace. SDK-free → smoke-testable.
 *
 * <p>Matching is path-separator- and case-insensitive (Windows-safe) over
 * workspace-RELATIVE paths. An unknown path is simply not risky (null).
 */
public final class AutoExecGuard {
    private AutoExecGuard() {}

    /** A classified finding. */
    public static final class Finding {
        public final String path;
        public final String category;
        public final String label;
        public final int severity;

        Finding(String path, String category, String label, int severity) {
            this.path = path;
            this.category = category;
            this.label = label;
            this.severity = severity;
        }
    }

    private static final Map<String, String> LABELS = new LinkedHashMap<>();
    private static final Map<String, Integer> SEVERITY = new LinkedHashMap<>();

    static {
        put("mcp-config", "MCP server config (can spawn processes)", 5);
        put("git-hook", "Git / husky hook (runs on git actions)", 5);
        put("shell-profile", "Shell profile (runs on new shells)", 5);
        put("vscode-tasks", "VS Code task (can auto-run on folder open)", 4);
        put("jetbrains-run-config", "JetBrains run configuration", 4);
        put("vscode-launch", "VS Code launch/debug config", 3);
        put("vscode-settings", "VS Code workspace settings", 2);
        put("jetbrains-project", "JetBrains project config (.idea)", 2);
    }

    private static void put(String cat, String label, int sev) {
        LABELS.put(cat, label);
        SEVERITY.put(cat, sev);
    }

    private static final Set<String> SHELL_PROFILES = Set.of(
            ".bashrc", ".bash_profile", ".zshrc", ".zprofile", ".profile",
            ".kshrc", ".cshrc");

    /** Normalize to lower-case, forward-slash, no leading {@code ./} or {@code /}. */
    private static String norm(String relPath) {
        if (relPath == null) return "";
        String p = relPath.replace('\\', '/');
        p = p.replaceFirst("^\\.?/+", "");
        return p.toLowerCase(Locale.ROOT);
    }

    /** Classify a workspace-relative path, or null for anything ordinary. */
    public static Finding classify(String relPath) {
        String p = norm(relPath);
        if (p.isEmpty()) return null;
        String base = p.substring(p.lastIndexOf('/') + 1);

        String category = null;
        if (base.equals("mcp.json") || base.equals(".mcp.json")) {
            category = "mcp-config";
        } else if (p.endsWith("/mcp.json")
                && (p.startsWith(".vscode/") || p.startsWith(".cursor/"))) {
            category = "mcp-config";
        } else if (p.startsWith(".git/hooks/") || p.startsWith(".husky/")) {
            if (!base.endsWith(".sample") && !base.equals("_") && !base.isEmpty()) {
                category = "git-hook";
            }
        } else if (SHELL_PROFILES.contains(base)
                || base.endsWith("microsoft.powershell_profile.ps1")
                || base.equals("profile.ps1")) {
            category = "shell-profile";
        } else if (p.equals(".vscode/tasks.json")) {
            category = "vscode-tasks";
        } else if (p.equals(".vscode/launch.json")) {
            category = "vscode-launch";
        } else if (p.equals(".vscode/settings.json")) {
            category = "vscode-settings";
        } else if (p.startsWith(".idea/runconfigurations/")) {
            category = "jetbrains-run-config";
        } else if (p.startsWith(".idea/")) {
            category = "jetbrains-project";
        }

        if (category == null) return null;
        return new Finding(p, category, LABELS.get(category), SEVERITY.get(category));
    }

    /** Classify a list of relative paths into deduped findings, loudest-first. */
    public static List<Finding> scan(List<String> relPaths) {
        Set<String> seen = new LinkedHashSet<>();
        List<Finding> out = new ArrayList<>();
        if (relPaths != null) {
            for (String rp : relPaths) {
                Finding f = classify(rp);
                if (f == null || seen.contains(f.path)) continue;
                seen.add(f.path);
                out.add(f);
            }
        }
        out.sort((a, b) -> {
            if (a.severity != b.severity) return b.severity - a.severity;
            return a.path.compareTo(b.path);
        });
        return out;
    }

    /** One-line human summary for a confirmation prompt (empty when none). */
    public static String summarize(List<Finding> findings) {
        if (findings == null || findings.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        sb.append("This workspace contains ").append(findings.size())
                .append(" auto-executable config file(s). ")
                .append("The agent may trigger these while it works:\n");
        int shown = Math.min(6, findings.size());
        for (int i = 0; i < shown; i++) {
            Finding f = findings.get(i);
            sb.append("• ").append(f.path).append(" — ").append(f.label);
            if (i < shown - 1) sb.append("\n");
        }
        if (findings.size() > shown) {
            sb.append("\n…and ").append(findings.size() - shown).append(" more");
        }
        return sb.toString();
    }
}
