import { describe, it, expect, vi, beforeEach } from "vitest";

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

// Track execSync calls for pip-install flow assertions
let execSyncCalls = [];
let execSyncImpl = null;

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    execSync: vi.fn((...args) => {
      if (execSyncImpl) return execSyncImpl(...args);
      return original.execSync(...args);
    }),
  };
});

// Mock detectPython as available
vi.mock("../../src/lib/cli-anything-bridge.js", () => ({
  detectPython: vi.fn(() => ({
    found: true,
    command: "python3",
    version: "3.11.0",
  })),
}));

const { executeTool, isValidPackageName } =
  await import("../../src/lib/agent-core.js");
const { execSync } = await import("node:child_process");

describe("run_code pip auto-install flow", () => {
  let tempDir;

  beforeEach(async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pip-test-"));
    execSyncCalls = [];
    execSyncImpl = null;
    vi.mocked(execSync).mockReset();
  });

  it("auto-installs missing Python package and retries", async () => {
    let callIdx = 0;
    vi.mocked(execSync).mockImplementation((cmd, opts) => {
      callIdx++;
      if (callIdx === 1) {
        // writeFileSync already handled by real fs — this is the first exec (run script)
        const err = new Error("ModuleNotFoundError: No module named 'pandas'");
        err.stderr = "ModuleNotFoundError: No module named 'pandas'";
        err.status = 1;
        throw err;
      }
      if (callIdx === 2) {
        // pip install pandas
        expect(cmd).toContain("pip install pandas");
        return "Successfully installed pandas-2.0.0";
      }
      if (callIdx === 3) {
        // retry execution
        return "result after install";
      }
      return "";
    });

    const result = await executeTool(
      "run_code",
      { language: "python", code: "import pandas; print('ok')" },
      { cwd: tempDir },
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("result after install");
    expect(result.autoInstalled).toEqual(["pandas"]);
  });

  it("returns error when pip install fails", async () => {
    let callIdx = 0;
    vi.mocked(execSync).mockImplementation((cmd) => {
      callIdx++;
      if (callIdx === 1) {
        const err = new Error(
          "ModuleNotFoundError: No module named 'nonexistent_pkg'",
        );
        err.stderr = "ModuleNotFoundError: No module named 'nonexistent_pkg'";
        err.status = 1;
        throw err;
      }
      if (callIdx === 2) {
        // pip install fails
        const pipErr = new Error("pip install failed");
        pipErr.stderr = "ERROR: No matching distribution found";
        throw pipErr;
      }
      return "";
    });

    const result = await executeTool(
      "run_code",
      { language: "python", code: "import nonexistent_pkg" },
      { cwd: tempDir },
    );

    expect(result.error).toBeDefined();
    expect(result.hint).toContain("Failed to auto-install");
  });

  it("extracts top-level package from dotted module name", async () => {
    let pipCmd = "";
    let callIdx = 0;
    vi.mocked(execSync).mockImplementation((cmd) => {
      callIdx++;
      if (callIdx === 1) {
        const err = new Error("ModuleNotFoundError: No module named 'foo.bar'");
        err.stderr = "ModuleNotFoundError: No module named 'foo.bar'";
        err.status = 1;
        throw err;
      }
      if (callIdx === 2) {
        pipCmd = cmd;
        return "Successfully installed foo";
      }
      if (callIdx === 3) {
        return "output from foo.bar";
      }
      return "";
    });

    const result = await executeTool(
      "run_code",
      { language: "python", code: "import foo.bar" },
      { cwd: tempDir },
    );

    expect(result.success).toBe(true);
    expect(result.autoInstalled).toEqual(["foo"]);
    // pip install should use top-level "foo", not "foo.bar"
    expect(pipCmd).toContain("pip install foo");
    expect(pipCmd).not.toContain("foo.bar");
  });

  it("rejects invalid package names without running pip", async () => {
    let callIdx = 0;
    let pipCalled = false;
    vi.mocked(execSync).mockImplementation((cmd) => {
      callIdx++;
      if (callIdx === 1) {
        const err = new Error(
          "ModuleNotFoundError: No module named 'foo; rm -rf /'",
        );
        err.stderr = "ModuleNotFoundError: No module named 'foo; rm -rf /'";
        err.status = 1;
        throw err;
      }
      if (cmd.includes("pip install")) {
        pipCalled = true;
      }
      return "";
    });

    const result = await executeTool(
      "run_code",
      { language: "python", code: "import foo; rm -rf /" },
      { cwd: tempDir },
    );

    expect(result.error).toContain("Invalid package name");
    expect(pipCalled).toBe(false);
    // Verify the validation function also rejects it
    expect(isValidPackageName("foo; rm -rf /")).toBe(false);
  });
});
