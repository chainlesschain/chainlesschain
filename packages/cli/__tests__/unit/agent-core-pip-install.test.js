import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
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

// Mock detectPython as available
vi.mock("../../src/lib/cli-anything-bridge.js", () => ({
  detectPython: vi.fn(() => ({
    found: true,
    command: "python3",
    version: "3.11.0",
  })),
}));

const { executeTool, isValidPackageName, _agentToolProcessDeps } =
  await import("../../src/lib/agent-core.js");

const originalRunCodeProcess = _agentToolProcessDeps.runCode;
let runCodeImpl = null;

function installStrictPolicyPlugin(cwd) {
  const root = pluginVersionDir("local", "strict-run-code", "1.0.0", {
    cwd,
  });
  const target = path.join(root, "bin", "strict-run-code.js");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "process.stdout.write('strict');\n", "utf8");
  fs.writeFileSync(
    path.join(root, "plugin.json"),
    JSON.stringify({
      name: "strict-run-code",
      version: "1.0.0",
      permissions: { process: true },
      sandboxPolicy: {
        requiredBoundaries: ["filesystem", "network"],
      },
      bin: { "strict-run-code": "bin/strict-run-code.js" },
    }),
    "utf8",
  );
}

function installRunCodeMock() {
  _agentToolProcessDeps.runCode = vi.fn((file, args, options) => {
    const command = [file, ...(args || [])].join(" ");
    return runCodeImpl ? runCodeImpl(command, options) : "";
  });
}

function restoreRunCodeProcess() {
  _agentToolProcessDeps.runCode = originalRunCodeProcess;
}

describe("run_code pip auto-install flow", () => {
  let tempDir;

  beforeEach(async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pip-test-"));
    runCodeImpl = null;
    installRunCodeMock();
    _resetPluginBinSandboxPolicyPins();
    // gap 2026-07-11: auto-install is opt-in — these flow tests opt in; the
    // default-disabled behavior has its own cases below. Audit lines go to
    // the temp dir, never the real home.
    process.env.CC_RUN_CODE_AUTO_INSTALL = "1";
    process.env.CC_AUDIT_DIR = path.join(tempDir, "audit");
  });

  afterEach(() => {
    restoreRunCodeProcess();
    _resetPluginBinSandboxPolicyPins();
    delete process.env.CC_RUN_CODE_AUTO_INSTALL;
    delete process.env.CC_AUDIT_DIR;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("auto-installs missing Python package and retries", async () => {
    let callIdx = 0;
    runCodeImpl = (cmd) => {
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
    };

    const result = await executeTool(
      "run_code",
      { language: "python", code: "import pandas; print('ok')" },
      { cwd: tempDir },
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("result after install");
    expect(result.autoInstalled).toEqual(["pandas"]);
    expect(_agentToolProcessDeps.runCode).toHaveBeenNthCalledWith(
      2,
      "python3",
      ["-m", "pip", "install", "pandas"],
      expect.objectContaining({
        cwd: tempDir,
        origin: "agent-core:run-code-install",
        policy: "allow",
        scope: "agent-core",
        shell: false,
      }),
    );
  });

  it("reuses one pinned strict Plugin workspace policy for execution, pip install, and retry", async () => {
    installStrictPolicyPlugin(tempDir);
    let callIdx = 0;
    runCodeImpl = () => {
      callIdx++;
      if (callIdx === 1) {
        const err = new Error("ModuleNotFoundError: No module named 'pandas'");
        err.stderr = "ModuleNotFoundError: No module named 'pandas'";
        err.status = 1;
        throw err;
      }
      return callIdx === 2 ? "Successfully installed pandas" : "sandboxed ok";
    };

    const result = await executeTool(
      "run_code",
      { language: "python", code: "import pandas" },
      { cwd: tempDir },
    );

    expect(result).toMatchObject({
      success: true,
      output: "sandboxed ok",
      autoInstalled: ["pandas"],
    });
    expect(_agentToolProcessDeps.runCode).toHaveBeenCalledTimes(3);
    const options = _agentToolProcessDeps.runCode.mock.calls.map(
      (call) => call[2],
    );
    expect(options.map((entry) => entry.origin)).toEqual([
      "agent-core:run-code",
      "agent-core:run-code-install",
      "agent-core:run-code-retry",
    ]);
    expect(options[0].sandboxPolicy).toEqual({
      requiredBoundaries: ["filesystem", "network"],
    });
    expect(options[1].sandboxPolicy).toBe(options[0].sandboxPolicy);
    expect(options[2].sandboxPolicy).toBe(options[0].sandboxPolicy);
  });

  it("preserves a structured Broker boundary refusal during pip install", async () => {
    installStrictPolicyPlugin(tempDir);
    const boundaryError = Object.assign(
      new Error("strict backend cannot satisfy network"),
      {
        code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
        sandboxFailClosed: true,
        requiredBoundaries: ["filesystem", "network"],
        actualGuarantees: ["filesystem"],
        missingBoundaries: ["network"],
      },
    );
    let callIdx = 0;
    runCodeImpl = () => {
      callIdx++;
      if (callIdx === 1) {
        const err = new Error("ModuleNotFoundError: No module named 'pandas'");
        err.stderr = "ModuleNotFoundError: No module named 'pandas'";
        err.status = 1;
        throw err;
      }
      throw boundaryError;
    };

    await expect(
      executeTool(
        "run_code",
        { language: "python", code: "import pandas" },
        { cwd: tempDir },
      ),
    ).rejects.toBe(boundaryError);
    expect(_agentToolProcessDeps.runCode).toHaveBeenCalledTimes(2);
    expect(_agentToolProcessDeps.runCode.mock.calls[1][2].sandboxPolicy).toBe(
      _agentToolProcessDeps.runCode.mock.calls[0][2].sandboxPolicy,
    );
    const auditLines = fs
      .readFileSync(
        path.join(process.env.CC_AUDIT_DIR, "dependency-install.jsonl"),
        "utf8",
      )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(auditLines).toMatchObject([
      {
        outcome: "failed",
        detail: "strict backend cannot satisfy network",
      },
    ]);
  });

  it("preserves a structured Broker boundary refusal during retry", async () => {
    installStrictPolicyPlugin(tempDir);
    const boundaryError = Object.assign(
      new Error("strict backend lost its filesystem guarantee"),
      {
        code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
        sandboxFailClosed: true,
        requiredBoundaries: ["filesystem", "network"],
        actualGuarantees: ["network"],
        missingBoundaries: ["filesystem"],
      },
    );
    let callIdx = 0;
    runCodeImpl = () => {
      callIdx++;
      if (callIdx === 1) {
        const err = new Error("ModuleNotFoundError: No module named 'pandas'");
        err.stderr = "ModuleNotFoundError: No module named 'pandas'";
        err.status = 1;
        throw err;
      }
      if (callIdx === 2) return "Successfully installed pandas";
      throw boundaryError;
    };

    await expect(
      executeTool(
        "run_code",
        { language: "python", code: "import pandas" },
        { cwd: tempDir },
      ),
    ).rejects.toBe(boundaryError);
    expect(_agentToolProcessDeps.runCode).toHaveBeenCalledTimes(3);
    const firstPolicy =
      _agentToolProcessDeps.runCode.mock.calls[0][2].sandboxPolicy;
    expect(_agentToolProcessDeps.runCode.mock.calls[1][2].sandboxPolicy).toBe(
      firstPolicy,
    );
    expect(_agentToolProcessDeps.runCode.mock.calls[2][2].sandboxPolicy).toBe(
      firstPolicy,
    );
  });

  it("keeps a successful install audit when the script retry fails", async () => {
    let callIdx = 0;
    runCodeImpl = () => {
      callIdx++;
      if (callIdx === 1) {
        const err = new Error("ModuleNotFoundError: No module named 'pandas'");
        err.stderr = "ModuleNotFoundError: No module named 'pandas'";
        err.status = 1;
        throw err;
      }
      if (callIdx === 2) return "Successfully installed pandas";
      const retryErr = new Error("retry execution failed");
      retryErr.stderr = "ValueError: retry boom";
      retryErr.status = 2;
      throw retryErr;
    };

    const result = await executeTool(
      "run_code",
      { language: "python", code: "import pandas" },
      { cwd: tempDir },
    );

    expect(result).toMatchObject({
      error: "ValueError: retry boom",
      stderr: "ValueError: retry boom",
      exitCode: 2,
      autoInstalled: ["pandas"],
    });
    expect(result.hint).toContain(
      'Package "pandas" was installed, but the script retry failed.',
    );
    const auditLines = fs
      .readFileSync(
        path.join(process.env.CC_AUDIT_DIR, "dependency-install.jsonl"),
        "utf8",
      )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(auditLines.map((line) => line.outcome)).toEqual(["installed"]);
  });

  it("returns error when pip install fails", async () => {
    let callIdx = 0;
    runCodeImpl = (cmd) => {
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
    };

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
    runCodeImpl = (cmd) => {
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
    };

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
    runCodeImpl = (cmd) => {
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
    };

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

  it("DEFAULT: refuses to auto-install and returns the opt-in hint", async () => {
    delete process.env.CC_RUN_CODE_AUTO_INSTALL; // back to the default policy
    let pipCalled = false;
    runCodeImpl = (cmd) => {
      if (String(cmd).includes("pip install")) {
        pipCalled = true;
        return "";
      }
      const err = new Error("ModuleNotFoundError: No module named 'pandas'");
      err.stderr = "ModuleNotFoundError: No module named 'pandas'";
      err.status = 1;
      throw err;
    };

    const result = await executeTool(
      "run_code",
      { language: "python", code: "import pandas" },
      { cwd: tempDir },
    );

    expect(pipCalled).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.hint).toContain("disabled by default");
    expect(result.hint).toContain("runCode");
  });

  it("blocks packages outside runCode.installAllowlist (opt-in + allowlist)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    // Project settings: allowlist that does NOT include pandas
    const claudeDir = path.join(tempDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({ runCode: { installAllowlist: ["requests"] } }),
      "utf-8",
    );

    let pipCalled = false;
    runCodeImpl = (cmd) => {
      if (String(cmd).includes("pip install")) {
        pipCalled = true;
        return "";
      }
      const err = new Error("ModuleNotFoundError: No module named 'pandas'");
      err.stderr = "ModuleNotFoundError: No module named 'pandas'";
      err.status = 1;
      throw err;
    };

    const result = await executeTool(
      "run_code",
      { language: "python", code: "import pandas" },
      { cwd: tempDir },
    );

    expect(pipCalled).toBe(false);
    expect(result.hint).toContain("installAllowlist");
  });
});

describe("run_code auto-install — unified install-command audit (P0 sandbox)", () => {
  let tempDir;

  beforeEach(async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pip-uaudit-"));
    runCodeImpl = null;
    installRunCodeMock();
    process.env.CC_RUN_CODE_AUTO_INSTALL = "1";
    process.env.CC_AUDIT_DIR = path.join(tempDir, "audit");
  });

  afterEach(() => {
    restoreRunCodeProcess();
    delete process.env.CC_RUN_CODE_AUTO_INSTALL;
    delete process.env.CC_AUDIT_DIR;
    delete process.env.CC_INSTALL_AUDIT;
  });

  const runAutoInstallFlow = async () => {
    let callIdx = 0;
    runCodeImpl = () => {
      callIdx++;
      if (callIdx === 1) {
        const err = new Error("ModuleNotFoundError: No module named 'pandas'");
        err.stderr = "ModuleNotFoundError: No module named 'pandas'";
        err.status = 1;
        throw err;
      }
      return callIdx === 2 ? "Successfully installed" : "ok";
    };
    return executeTool(
      "run_code",
      { language: "python", code: "import pandas" },
      { cwd: tempDir },
    );
  };

  it("CC_INSTALL_AUDIT=1: the auto-install lands in install-commands.jsonl as a pip install", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    process.env.CC_INSTALL_AUDIT = "1";

    const result = await runAutoInstallFlow();
    expect(result.success).toBe(true);

    const auditFile = path.join(tempDir, "audit", "install-commands.jsonl");
    expect(fs.existsSync(auditFile)).toBe(true);
    const lines = fs
      .readFileSync(auditFile, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const rec = lines.find((l) => l.source === "run_code_auto_install");
    expect(rec).toBeTruthy();
    expect(rec.kind).toBe("install-command");
    expect(rec.outcome).toBe("installed");
    expect(rec.command).toContain("-m pip install pandas");
    // The module invocation classifies like a direct pip call.
    expect(rec.installs).toEqual([
      {
        manager: "pip",
        subcommand: "install",
        packages: ["pandas"],
        global: false,
      },
    ]);
    expect(rec.global).toBe(false);
  });

  it("policy off (default): no unified audit line is written", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    const result = await runAutoInstallFlow();
    expect(result.success).toBe(true);

    const auditFile = path.join(tempDir, "audit", "install-commands.jsonl");
    // dependency-install-policy writes its own trail; the UNIFIED trail stays
    // silent when CC_INSTALL_AUDIT / settings installPolicy are unset.
    if (fs.existsSync(auditFile)) {
      const hasUnified = fs
        .readFileSync(auditFile, "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .some((l) => l.source === "run_code_auto_install");
      expect(hasUnified).toBe(false);
    }
  });
});
