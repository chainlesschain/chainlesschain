import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _resetPluginBinSandboxPolicyPins } from "../../src/lib/plugin-runtime/bin.js";
import { pluginVersionDir } from "../../src/lib/plugin-runtime/scopes.js";

// Mock plan-mode, skill-loader, hook-manager before importing agent-core
vi.mock("../../src/lib/plan-mode.js", () => {
  const planModeManager = {
    isActive: () => false,
    isToolAllowed: () => true,
    addPlanItem: vi.fn(),
  };
  return { getPlanModeManager: vi.fn(() => planModeManager) };
});

vi.mock("../../src/lib/skill-loader.js", () => ({
  CLISkillLoader: vi.fn(function () {
    return { getResolvedSkills: vi.fn(() => []) };
  }),
}));

vi.mock("../../src/lib/hook-manager.js", () => ({
  executeHooks: vi.fn().mockResolvedValue(undefined),
  HookEvents: {
    PreToolUse: "PreToolUse",
    PostToolUse: "PostToolUse",
    ToolError: "ToolError",
  },
}));

const { detectPythonMock } = vi.hoisted(() => ({
  detectPythonMock: vi.fn(() => ({
    found: true,
    command: "python3",
    version: "3.11.0",
  })),
}));

// Mock cli-anything-bridge's detectPython
vi.mock("../../src/lib/cli-anything-bridge.js", () => ({
  detectPython: detectPythonMock,
}));

const {
  executeTool,
  classifyError,
  isValidPackageName,
  getEnvironmentInfo,
  getBaseSystemPrompt,
  _agentToolProcessDeps,
} = await import("../../src/lib/agent-core.js");
const { _resetCachedPythonForTests } =
  await import("../../src/runtime/agent-core.js");

function installStrictRunCodePolicy(cwd) {
  const root = pluginVersionDir("local", "strict-python-probe", "1.0.0", {
    cwd,
  });
  const target = join(root, "bin", "strict-python-probe.js");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, "process.stdout.write('strict');\n", "utf8");
  writeFileSync(
    join(root, "plugin.json"),
    JSON.stringify({
      name: "strict-python-probe",
      version: "1.0.0",
      permissions: { process: true },
      sandboxPolicy: {
        requiredBoundaries: ["filesystem", "network"],
      },
      bin: { "strict-python-probe": "bin/strict-python-probe.js" },
    }),
    "utf8",
  );
}

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
  }, 30_000);

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

  it("mentions gated auto-install and opt-in persistence in prompt", () => {
    const prompt = getBaseSystemPrompt("/test/dir");
    // gap 2026-07-11: auto-install is opt-in, scripts default to temp files
    expect(prompt).toContain("NOT auto-installed");
    expect(prompt).toContain("agent-scripts");
    expect(prompt).toContain("persist:true");
  });
});

describe("executeTool — run_code enhancements", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-run-code-test-"));
    _resetCachedPythonForTests();
    _resetPluginBinSandboxPolicyPins();
    detectPythonMock.mockClear();
  });

  afterEach(() => {
    _resetPluginBinSandboxPolicyPins();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("fails closed before cli-anything probes Python without the required sandbox policy", async () => {
    installStrictRunCodePolicy(tempDir);
    const original = _agentToolProcessDeps.runCode;
    const runCode = vi.fn();
    _agentToolProcessDeps.runCode = runCode;

    try {
      await expect(
        executeTool(
          "run_code",
          {
            language: "python",
            code: "print('must-not-run')",
            persist: true,
          },
          { cwd: tempDir },
        ),
      ).rejects.toMatchObject({
        code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
        sandboxReason: "python_interpreter_probe_requires_sandbox",
        sandboxFailClosed: true,
        requiredBoundaries: ["filesystem", "network"],
        actualGuarantees: [],
        missingBoundaries: ["filesystem", "network"],
      });
      expect(detectPythonMock).not.toHaveBeenCalled();
      expect(runCode).not.toHaveBeenCalled();
      expect(
        existsSync(join(tempDir, ".chainlesschain", "agent-scripts")),
      ).toBe(false);
    } finally {
      _agentToolProcessDeps.runCode = original;
    }
  });

  it("keeps legacy Python detection without a policy and reuses its cache under the pinned policy", async () => {
    const original = _agentToolProcessDeps.runCode;
    const runCode = vi.fn(() => "python-output");
    _agentToolProcessDeps.runCode = runCode;

    try {
      const legacyResult = await executeTool(
        "run_code",
        { language: "python", code: "print('legacy')" },
        { cwd: tempDir },
      );

      expect(legacyResult).toMatchObject({
        success: true,
        output: "python-output",
      });
      expect(detectPythonMock).toHaveBeenCalledTimes(1);
      expect(runCode).toHaveBeenNthCalledWith(
        1,
        "python3",
        [expect.stringMatching(/cc-agent-\d+\.py$/)],
        expect.objectContaining({
          cwd: tempDir,
          origin: "agent-core:run-code",
          policy: "allow",
          scope: "agent-core",
          shell: false,
        }),
      );
      expect(runCode.mock.calls[0][2]).not.toHaveProperty("sandboxPolicy");

      installStrictRunCodePolicy(tempDir);
      _resetPluginBinSandboxPolicyPins();
      const strictResult = await executeTool(
        "run_code",
        { language: "python", code: "print('strict')" },
        { cwd: tempDir },
      );

      expect(strictResult).toMatchObject({
        success: true,
        output: "python-output",
      });
      expect(detectPythonMock).toHaveBeenCalledTimes(1);
      expect(runCode).toHaveBeenNthCalledWith(
        2,
        "python3",
        [expect.stringMatching(/cc-agent-\d+\.py$/)],
        expect.objectContaining({
          cwd: tempDir,
          origin: "agent-core:run-code",
          policy: "allow",
          scope: "agent-core",
          shell: false,
          sandboxPolicy: {
            requiredBoundaries: ["filesystem", "network"],
          },
        }),
      );
      expect(Object.isFrozen(runCode.mock.calls[1][2].sandboxPolicy)).toBe(
        true,
      );
    } finally {
      _agentToolProcessDeps.runCode = original;
    }
  });

  it("persists scripts to .chainlesschain/agent-scripts/ only with persist:true", async () => {
    const result = await executeTool(
      "run_code",
      { language: "node", code: 'console.log("persist-test")', persist: true },
      { cwd: tempDir },
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain("persist-test");
    expect(result.scriptPath).toBeDefined();
    expect(result.scriptPath).toContain("agent-scripts");
    // Script file should still exist
    expect(existsSync(result.scriptPath)).toBe(true);
  });

  it("uses a temp file by DEFAULT (gap 2026-07-11: scripts stay out of the project)", async () => {
    const result = await executeTool(
      "run_code",
      {
        language: "node",
        code: 'console.log("temp-test")',
      },
      { cwd: tempDir },
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain("temp-test");
    expect(result.scriptPath).toBeUndefined();
    // Nothing lands in the project tree
    expect(existsSync(join(tempDir, ".chainlesschain", "agent-scripts"))).toBe(
      false,
    );
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
      { language: "node", code: 'console.log("mkdir-test")', persist: true },
      { cwd: tempDir },
    );

    expect(existsSync(scriptsDir)).toBe(true);
  });

  it("script filename includes language and timestamp", async () => {
    const result = await executeTool(
      "run_code",
      { language: "node", code: 'console.log("name-test")', persist: true },
      { cwd: tempDir },
    );
    expect(result.scriptPath).toMatch(/-node\.js$/);
    expect(result.scriptPath).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("routes run_code through literal Broker argv with provenance", async () => {
    const original = _agentToolProcessDeps.runCode;
    _agentToolProcessDeps.runCode = vi.fn(() => "brokered-output");

    try {
      const result = await executeTool(
        "run_code",
        { language: "node", code: 'console.log("brokered")' },
        { cwd: tempDir },
      );

      expect(result).toMatchObject({
        success: true,
        output: "brokered-output",
      });
      expect(_agentToolProcessDeps.runCode).toHaveBeenCalledWith(
        "node",
        [expect.stringMatching(/cc-agent-\d+\.js$/)],
        expect.objectContaining({
          cwd: tempDir,
          origin: "agent-core:run-code",
          policy: "allow",
          scope: "agent-core",
          shell: false,
        }),
      );
      expect(_agentToolProcessDeps.runCode.mock.calls[0][2]).not.toHaveProperty(
        "sandboxPolicy",
      );
    } finally {
      _agentToolProcessDeps.runCode = original;
    }
  });

  it("routes search_files shell commands through Broker provenance", async () => {
    const original = _agentToolProcessDeps.runSearch;
    _agentToolProcessDeps.runSearch = vi.fn(() => "found.js\n");

    try {
      const result = await executeTool(
        "search_files",
        { pattern: "*.js", directory: "." },
        { cwd: tempDir },
      );

      expect(result.files).toEqual(["found.js"]);
      expect(_agentToolProcessDeps.runSearch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          cwd: tempDir,
          origin: "agent-core:search-files",
          policy: "allow",
          scope: "agent-core",
        }),
      );
    } finally {
      _agentToolProcessDeps.runSearch = original;
    }
  });
});
