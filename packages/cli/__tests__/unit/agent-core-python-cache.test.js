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

// Mock detectPython returning { found: false }
vi.mock("../../src/lib/cli-anything-bridge.js", () => ({
  detectPython: vi.fn(() => ({
    found: false,
  })),
}));

const { getCachedPython, getEnvironmentInfo } =
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
    const info = getEnvironmentInfo();
    expect(info.python).toBeNull();
    expect(info.pip).toBe(false);
    // Other fields should still be present
    expect(info.os).toBe(process.platform);
    expect(info.arch).toBe(process.arch);
    expect(info.node).toBeTruthy();
  });
});
