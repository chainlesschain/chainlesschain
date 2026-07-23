import { describe, it, expect, vi } from "vitest";

// Mock plan-mode, skill-loader, hook-manager before importing agent-core
vi.mock("../../src/lib/plan-mode.js", () => ({
  getPlanModeManager: vi.fn(() => ({
    isActive: () => false,
    isToolAllowed: () => true,
    addPlanItem: vi.fn(),
  })),
}));

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

// Mock detectPython returning { found: false }
vi.mock("../../src/lib/cli-anything-bridge.js", () => ({
  detectPython: vi.fn(() => ({
    found: false,
  })),
}));

const { getCachedPython, getEnvironmentInfo, _environmentProcessDeps } =
  await import("../../src/lib/agent-core.js");

describe("getCachedPython — Python not found", () => {
  it("returns { found: false } when detectPython says not found", () => {
    const result = getCachedPython();
    expect(result).toBeDefined();
    expect(result.found).toBe(false);
  });

  it("returns same reference on second call (caching)", () => {
    const first = getCachedPython();
    const second = getCachedPython();
    expect(first).toBe(second); // same reference
  });
});

describe("getEnvironmentInfo — Python unavailable", () => {
  it("shows Python as unavailable", () => {
    const originalRunner = _environmentProcessDeps.run;
    const run = vi.fn((file) =>
      file === process.execPath ? "v22.22.2\n" : "git version 2.51.0\n",
    );
    _environmentProcessDeps.run = run;

    try {
      const info = getEnvironmentInfo();
      expect(info.python).toBeNull();
      expect(info.pip).toBe(false);
      expect(info.os).toBe(process.platform);
      expect(info.arch).toBe(process.arch);
      expect(info.node).toBe("v22.22.2");
      expect(info.git).toBe(true);
      expect(run).toHaveBeenCalledWith(
        process.execPath,
        ["--version"],
        expect.objectContaining({
          origin: "agent-core:environment-probe",
          policy: "allow",
          scope: "agent-core",
        }),
      );
      expect(run).toHaveBeenCalledWith(
        "git",
        ["--version"],
        expect.objectContaining({
          origin: "agent-core:environment-probe",
          policy: "allow",
          scope: "agent-core",
        }),
      );
    } finally {
      _environmentProcessDeps.run = originalRunner;
    }
  });
});
