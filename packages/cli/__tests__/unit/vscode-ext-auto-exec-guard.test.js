/**
 * Auto-exec config guard (P2 #13) — pure classifier for workspace files that
 * can execute code without an explicit run action. Host-free.
 */
import { describe, it, expect } from "vitest";
import {
  classifyAutoExecTarget,
  scanAutoExecConfig,
  summarizeAutoExecScan,
} from "../../../vscode-extension/src/auto-exec-guard.js";

describe("classifyAutoExecTarget", () => {
  it("flags MCP, hooks and shell profiles as the highest severity", () => {
    for (const p of [".mcp.json", ".vscode/mcp.json", ".cursor/mcp.json"]) {
      expect(classifyAutoExecTarget(p).category).toBe("mcp-config");
    }
    expect(classifyAutoExecTarget(".git/hooks/pre-commit").category).toBe(
      "git-hook",
    );
    expect(classifyAutoExecTarget(".husky/pre-push").category).toBe("git-hook");
    expect(classifyAutoExecTarget(".bashrc").category).toBe("shell-profile");
    expect(
      classifyAutoExecTarget("Microsoft.PowerShell_profile.ps1").category,
    ).toBe("shell-profile");
    for (const c of ["mcp-config", "git-hook", "shell-profile"]) {
      expect(classifyAutoExecTarget(sampleFor(c)).severity).toBe(5);
    }
  });

  it("flags VS Code tasks/launch/settings and .idea configs", () => {
    expect(classifyAutoExecTarget(".vscode/tasks.json").category).toBe(
      "vscode-tasks",
    );
    expect(classifyAutoExecTarget(".vscode/launch.json").category).toBe(
      "vscode-launch",
    );
    expect(classifyAutoExecTarget(".vscode/settings.json").category).toBe(
      "vscode-settings",
    );
    expect(
      classifyAutoExecTarget(".idea/runConfigurations/App.xml").category,
    ).toBe("jetbrains-run-config");
    expect(classifyAutoExecTarget(".idea/workspace.xml").category).toBe(
      "jetbrains-project",
    );
  });

  it("does NOT flag ordinary files or inert git sample hooks", () => {
    for (const p of [
      "src/index.ts",
      "package.json",
      "README.md",
      ".vscode/extensions.json",
      ".git/hooks/pre-commit.sample",
      ".git/config",
    ]) {
      expect(classifyAutoExecTarget(p)).toBeNull();
    }
  });

  it("is path-separator and case insensitive (Windows-safe)", () => {
    expect(classifyAutoExecTarget(".vscode\\tasks.json").category).toBe(
      "vscode-tasks",
    );
    expect(classifyAutoExecTarget(".VSCode/Tasks.json").category).toBe(
      "vscode-tasks",
    );
    expect(classifyAutoExecTarget("./.mcp.json").category).toBe("mcp-config");
  });
});

describe("scanAutoExecConfig", () => {
  it("dedupes, drops non-risky, and sorts loudest-first", () => {
    const findings = scanAutoExecConfig([
      "src/a.ts",
      ".vscode/settings.json",
      ".vscode/settings.json", // dup
      ".mcp.json",
      ".vscode/tasks.json",
      "README.md",
    ]);
    expect(findings.map((f) => f.category)).toEqual([
      "mcp-config", // sev 5
      "vscode-tasks", // sev 4
      "vscode-settings", // sev 2
    ]);
  });

  it("returns [] for an all-ordinary workspace", () => {
    expect(scanAutoExecConfig(["a.ts", "b.js", "package.json"])).toEqual([]);
    expect(scanAutoExecConfig([])).toEqual([]);
  });
});

describe("summarizeAutoExecScan", () => {
  it("names the files and counts overflow, empty when none", () => {
    expect(summarizeAutoExecScan([])).toBe("");
    const many = scanAutoExecConfig([
      ".mcp.json",
      ".git/hooks/pre-commit",
      ".bashrc",
      ".vscode/tasks.json",
      ".vscode/launch.json",
      ".vscode/settings.json",
      ".idea/workspace.xml",
    ]);
    const s = summarizeAutoExecScan(many);
    expect(s).toContain("7 auto-executable config file(s)");
    expect(s).toContain(".mcp.json");
    expect(s).toContain("…and 1 more");
  });
});

function sampleFor(category) {
  return {
    "mcp-config": ".mcp.json",
    "git-hook": ".git/hooks/pre-commit",
    "shell-profile": ".zshrc",
  }[category];
}
