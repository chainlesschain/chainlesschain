package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link AutoExecGuard} classifier. */
class AutoExecGuardTest {

    @Test
    void flagsHighSeverityExecutors() {
        for (String p : new String[] {".mcp.json", ".vscode/mcp.json", ".cursor/mcp.json"}) {
            assertEquals("mcp-config", AutoExecGuard.classify(p).category, p);
        }
        assertEquals("git-hook", AutoExecGuard.classify(".git/hooks/pre-commit").category);
        assertEquals("git-hook", AutoExecGuard.classify(".husky/pre-push").category);
        assertEquals("shell-profile", AutoExecGuard.classify(".bashrc").category);
        assertEquals("shell-profile",
                AutoExecGuard.classify("Microsoft.PowerShell_profile.ps1").category);
        assertEquals(5, AutoExecGuard.classify(".mcp.json").severity);
    }

    @Test
    void flagsIdeConfigs() {
        assertEquals("vscode-tasks", AutoExecGuard.classify(".vscode/tasks.json").category);
        assertEquals("vscode-launch", AutoExecGuard.classify(".vscode/launch.json").category);
        assertEquals("vscode-settings", AutoExecGuard.classify(".vscode/settings.json").category);
        assertEquals("jetbrains-run-config",
                AutoExecGuard.classify(".idea/runConfigurations/App.xml").category);
        assertEquals("jetbrains-project", AutoExecGuard.classify(".idea/workspace.xml").category);
    }

    @Test
    void doesNotFlagOrdinaryOrInertFiles() {
        for (String p : new String[] {
                "src/index.ts", "package.json", "README.md",
                ".vscode/extensions.json", ".git/hooks/pre-commit.sample", ".git/config"}) {
            assertNull(AutoExecGuard.classify(p), p);
        }
    }

    @Test
    void isSeparatorAndCaseInsensitive() {
        assertEquals("vscode-tasks", AutoExecGuard.classify(".vscode\\tasks.json").category);
        assertEquals("vscode-tasks", AutoExecGuard.classify(".VSCode/Tasks.json").category);
        assertEquals("mcp-config", AutoExecGuard.classify("./.mcp.json").category);
    }

    @Test
    void scanDedupesDropsAndSortsLoudestFirst() {
        List<AutoExecGuard.Finding> f = AutoExecGuard.scan(List.of(
                "src/a.ts", ".vscode/settings.json", ".vscode/settings.json",
                ".mcp.json", ".vscode/tasks.json", "README.md"));
        assertEquals(3, f.size());
        assertEquals("mcp-config", f.get(0).category);
        assertEquals("vscode-tasks", f.get(1).category);
        assertEquals("vscode-settings", f.get(2).category);
    }

    @Test
    void summarizeNamesFilesAndCountsOverflow() {
        assertEquals("", AutoExecGuard.summarize(List.of()));
        List<AutoExecGuard.Finding> many = AutoExecGuard.scan(List.of(
                ".mcp.json", ".git/hooks/pre-commit", ".bashrc", ".vscode/tasks.json",
                ".vscode/launch.json", ".vscode/settings.json", ".idea/workspace.xml"));
        String s = AutoExecGuard.summarize(many);
        assertTrue(s.contains("7 auto-executable config file(s)"), s);
        assertTrue(s.contains(".mcp.json"), s);
        assertTrue(s.contains("…and 1 more"), s);
    }
}
