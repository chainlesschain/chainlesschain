import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock plan-mode, skill-loader, hook-manager before importing agent-core
vi.mock("../../src/lib/plan-mode.js", () => ({
  getPlanModeManager: vi.fn(() => ({
    isActive: () => false,
    isToolAllowed: () => true,
    addPlanItem: vi.fn(),
  })),
}));

vi.mock("../../src/lib/skill-loader.js", () => ({
  CLISkillLoader: vi.fn().mockImplementation(() => ({
    getResolvedSkills: vi.fn(() => []),
  })),
}));

vi.mock("../../src/lib/hook-manager.js", () => ({
  executeHooks: vi.fn().mockResolvedValue(undefined),
  HookEvents: {
    PreToolUse: "PreToolUse",
    PostToolUse: "PostToolUse",
    ToolError: "ToolError",
  },
}));

// Mock cli-anything-bridge's detectPython
vi.mock("../../src/lib/cli-anything-bridge.js", () => ({
  detectPython: vi.fn(() => ({
    found: true,
    command: "python3",
    version: "3.11.0",
  })),
}));

const {
  executeTool,
  classifyError,
  isValidPackageName,
  getEnvironmentInfo,
  getBaseSystemPrompt,
} = await import("../../src/lib/agent-core.js");

describe("classifyError", () => {
  it("classifies ModuleNotFoundError as import_error", () => {
    const result = classifyError(
      "ModuleNotFoundError: No module named 'pandas'",
      "",
      1,
      "python",
    );
    expect(result.errorType).toBe("import_error");
    expect(result.hint).toContain("pandas");
  });

  it("classifies ImportError as import_error", () => {
    const result = classifyError(
      "ImportError: No module named 'requests'",
      "",
      1,
      "python",
    );
    expect(result.errorType).toBe("import_error");
    expect(result.hint).toContain("requests");
  });

  it("classifies SyntaxError with line number", () => {
    const result = classifyError(
      'File "test.py", line 15\n    print("hello\nSyntaxError: EOL while scanning',
      "",
      1,
      "python",
    );
    expect(result.errorType).toBe("syntax_error");
    expect(result.hint).toContain("line 15");
  });

  it("classifies IndentationError as syntax_error", () => {
    const result = classifyError(
      "IndentationError: unexpected indent",
      "",
      1,
      "python",
    );
    expect(result.errorType).toBe("syntax_error");
  });

  it("classifies timeout errors", () => {
    const result = classifyError(
      "ETIMEDOUT: connection timed out",
      "",
      null,
      "python",
    );
    expect(result.errorType).toBe("timeout");
    expect(result.hint).toContain("timeout");
  });

  it("classifies permission errors", () => {
    const result = classifyError(
      "PermissionError: [Errno 13] Permission denied: '/root/file'",
      "",
      1,
      "python",
    );
    expect(result.errorType).toBe("permission_error");
    expect(result.hint).toContain("Permission denied");
  });

  it("classifies EACCES as permission_error", () => {
    const result = classifyError(
      "EACCES: permission denied, open '/etc/shadow'",
      "",
      1,
      "bash",
    );
    expect(result.errorType).toBe("permission_error");
  });

  it("classifies generic errors as runtime_error", () => {
    const result = classifyError(
      "TypeError: cannot add int and str at line 42",
      "",
      1,
      "python",
    );
    expect(result.errorType).toBe("runtime_error");
    expect(result.hint).toContain("line 42");
  });

  it("handles empty stderr/message", () => {
    const result = classifyError("", "", 1, "python");
    expect(result.errorType).toBe("runtime_error");
  });
});

describe("isValidPackageName", () => {
  it("accepts valid package names", () => {
    expect(isValidPackageName("pandas")).toBe(true);
    expect(isValidPackageName("scikit-learn")).toBe(true);
    expect(isValidPackageName("python_dotenv")).toBe(true);
    expect(isValidPackageName("Flask")).toBe(true);
    expect(isValidPackageName("numpy")).toBe(true);
    expect(isValidPackageName("Pillow")).toBe(true);
  });

  it("rejects shell metacharacters", () => {
    expect(isValidPackageName("foo; rm -rf /")).toBe(false);
    expect(isValidPackageName("foo && echo pwned")).toBe(false);
    expect(isValidPackageName("$(whoami)")).toBe(false);
    expect(isValidPackageName("foo|bar")).toBe(false);
    expect(isValidPackageName("foo`cmd`")).toBe(false);
  });

  it("rejects empty or overly long names", () => {
    expect(isValidPackageName("")).toBe(false);
    expect(isValidPackageName("a".repeat(101))).toBe(false);
  });

  it("rejects names starting with hyphen", () => {
    expect(isValidPackageName("-foo")).toBe(false);
  });
});

describe("getEnvironmentInfo", () => {
  it("returns environment object with expected fields", () => {
    const info = getEnvironmentInfo();
    expect(info).toHaveProperty("os");
    expect(info).toHaveProperty("arch");
    expect(info).toHaveProperty("python");
    expect(info).toHaveProperty("pip");
    expect(info).toHaveProperty("node");
    expect(info).toHaveProperty("git");
    expect(typeof info.os).toBe("string");
    expect(typeof info.arch).toBe("string");
  });

  it("reports Node.js as available", () => {
    const info = getEnvironmentInfo();
    expect(info.node).toBeTruthy();
    expect(info.node).toMatch(/^v?\d+/);
  });

  it("caches result across calls", () => {
    const info1 = getEnvironmentInfo();
    const info2 = getEnvironmentInfo();
    expect(info1).toBe(info2); // same reference
  });
});

describe("getBaseSystemPrompt — environment section", () => {
  it("includes Environment section in prompt", () => {
    const prompt = getBaseSystemPrompt("/test/dir");
    expect(prompt).toContain("## Environment");
    expect(prompt).toContain("OS:");
    expect(prompt).toContain("Node.js:");
    expect(prompt).toContain("Git:");
  });

  it("mentions auto-install and persistence in prompt", () => {
    const prompt = getBaseSystemPrompt("/test/dir");
    expect(prompt).toContain("auto-installed via pip");
    expect(prompt).toContain("agent-scripts");
  });
});

describe("executeTool — run_code enhancements", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-run-code-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("persists scripts to .chainlesschain/agent-scripts/ by default", async () => {
    const result = await executeTool(
      "run_code",
      { language: "node", code: 'console.log("persist-test")' },
      { cwd: tempDir },
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain("persist-test");
    expect(result.scriptPath).toBeDefined();
    expect(result.scriptPath).toContain("agent-scripts");
    // Script file should still exist
    expect(existsSync(result.scriptPath)).toBe(true);
  });

  it("uses temp file and cleans up when persist=false", async () => {
    const result = await executeTool(
      "run_code",
      {
        language: "node",
        code: 'console.log("temp-test")',
        persist: false,
      },
      { cwd: tempDir },
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain("temp-test");
    expect(result.scriptPath).toBeUndefined();
  });

  it("returns error classification on syntax error", async () => {
    const result = await executeTool(
      "run_code",
      { language: "node", code: "function { broken syntax" },
      { cwd: tempDir },
    );
    expect(result.error).toBeDefined();
    expect(result.errorType).toBeDefined();
    expect(result.hint).toBeDefined();
    // Node syntax errors are typically runtime_error or syntax_error
    expect(["syntax_error", "runtime_error"]).toContain(result.errorType);
  });

  it("returns error classification on runtime error", async () => {
    const result = await executeTool(
      "run_code",
      {
        language: "node",
        code: 'throw new Error("intentional failure")',
      },
      { cwd: tempDir },
    );
    expect(result.error).toBeDefined();
    expect(result.errorType).toBe("runtime_error");
    expect(result.hint).toBeDefined();
  });

  it("returns unsupported language error", async () => {
    const result = await executeTool(
      "run_code",
      { language: "ruby", code: "puts 'hello'" },
      { cwd: tempDir },
    );
    expect(result.error).toContain("Unsupported language");
  });

  it("creates agent-scripts directory if it doesn't exist", async () => {
    const scriptsDir = join(tempDir, ".chainlesschain", "agent-scripts");
    expect(existsSync(scriptsDir)).toBe(false);

    await executeTool(
      "run_code",
      { language: "node", code: 'console.log("mkdir-test")' },
      { cwd: tempDir },
    );

    expect(existsSync(scriptsDir)).toBe(true);
  });

  it("script filename includes language and timestamp", async () => {
    const result = await executeTool(
      "run_code",
      { language: "node", code: 'console.log("name-test")' },
      { cwd: tempDir },
    );
    expect(result.scriptPath).toMatch(/-node\.js$/);
    expect(result.scriptPath).toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
