/**
 * Security regression tests for run_skill.
 *
 * A skill handler must never be imported into the CLI process or receive the
 * raw MCP/process authority. Executable skills run through a constrained child
 * agent; legacy/non-isolated handlers fail closed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  skills: [],
  childConfigs: [],
  childRuns: [],
  createSubAgent: vi.fn(),
}));

vi.mock("../../src/lib/plan-mode.js", () => ({
  getPlanModeManager: vi.fn(() => ({
    isActive: () => false,
    isToolAllowed: () => true,
    addPlanItem: vi.fn(),
  })),
}));

vi.mock("../../src/lib/skill-loader.js", () => ({
  CLISkillLoader: vi.fn(function () {
    return { getResolvedSkills: vi.fn(() => mocks.skills) };
  }),
}));

vi.mock("../../src/lib/sub-agent-context.js", () => ({
  SubAgentContext: {
    create: mocks.createSubAgent,
  },
}));

vi.mock("../../src/lib/project-detector.js", () => ({
  findProjectRoot: vi.fn(() => null),
  loadProjectConfig: vi.fn(() => null),
  isInsideProject: vi.fn(() => false),
}));

vi.mock("../../src/lib/hook-manager.js", () => ({
  executeHooks: vi.fn().mockResolvedValue(undefined),
  HookEvents: {
    PreToolUse: "PreToolUse",
    PostToolUse: "PostToolUse",
    ToolError: "ToolError",
  },
}));

const { executeTool } = await import("../../src/runtime/agent-core.js");

describe("run_skill controlled execution boundary", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-skill-boundary-"));
    mocks.skills.length = 0;
    mocks.childConfigs.length = 0;
    mocks.childRuns.length = 0;
    mocks.createSubAgent.mockReset();
    mocks.createSubAgent.mockImplementation((config) => {
      mocks.childConfigs.push(config);
      return {
        id: `skill-child-${mocks.childConfigs.length}`,
        run: vi.fn(async (input) => {
          mocks.childRuns.push(input);
          return {
            summary: `isolated:${input}`,
            toolsUsed: ["read_file"],
          };
        }),
      };
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function registerSkill({
    id,
    isolation = false,
    mcpServers = [],
    capabilities = [],
    body = "# Approved skill instructions",
  }) {
    mocks.skills.push({
      id,
      dirName: id,
      category: "test",
      activation: "manual",
      source: "workspace",
      hasHandler: true,
      description: id,
      skillDir: join(tempDir, id),
      mcpServers,
      capabilities,
      isolation,
      body,
    });
  }

  it("blocks a legacy direct handler without importing or mounting anything", async () => {
    const fakeMcp = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    registerSkill({
      id: "legacy-weather",
      mcpServers: [{ name: "weather", command: "npx" }],
      capabilities: ["shell-exec"],
    });

    const result = await executeTool(
      "run_skill",
      { skill_name: "legacy-weather", input: "London" },
      { cwd: tempDir, mcpClient: fakeMcp },
    );

    expect(result).toMatchObject({
      code: "CC_SKILL_DIRECT_HANDLER_BLOCKED",
      policy: { decision: "blocked", via: "skill-execution-boundary" },
    });
    expect(fakeMcp.connect).not.toHaveBeenCalled();
    expect(fakeMcp.disconnect).not.toHaveBeenCalled();
    expect(mocks.createSubAgent).not.toHaveBeenCalled();
  });

  it("runs an isolated skill as a child with read-only tools intersected with the parent ceiling", async () => {
    registerSkill({
      id: "reviewer",
      isolation: true,
      body: "# Review files\nNever modify the workspace.",
      mcpServers: [{ name: "untrusted-server", command: "node" }],
    });

    const result = await executeTool(
      "run_skill",
      { skill_name: "reviewer", input: "inspect src" },
      {
        cwd: tempDir,
        effectiveAllowedToolNames: [
          "run_skill",
          "read_file",
          "list_dir",
          "write_file",
        ],
        mcpClient: { connect: vi.fn(), callTool: vi.fn() },
      },
    );

    expect(result).toMatchObject({
      success: true,
      isolated: true,
      skill: "reviewer",
      summary: "isolated:inspect src",
      toolsUsed: ["read_file"],
    });
    expect(mocks.childRuns).toEqual(["inspect src"]);
    expect(mocks.childConfigs).toHaveLength(1);
    expect(mocks.childConfigs[0]).toMatchObject({
      role: "skill-reviewer",
      cwd: tempDir,
      allowedTools: ["read_file", "list_dir"],
    });
    expect(mocks.childConfigs[0].task).toContain("# Review files");
    expect(mocks.childConfigs[0].task).toContain("inspect src");
    expect(mocks.childConfigs[0]).not.toHaveProperty("mcpClient");
    expect(mocks.childConfigs[0]).not.toHaveProperty("processBroker");
  });

  it("awaits the host's async execution materializer before creating the child", async () => {
    registerSkill({ id: "async-authorized", isolation: true });
    const materializeSkillForExecution = vi.fn(async (skill, context) => {
      await Promise.resolve();
      expect(context.loadedBecause).toBe("run_skill");
      return { ...skill, body: "# Authorized after IDE confirmation" };
    });
    const skillLoader = {
      getResolvedSkills: () => mocks.skills,
      materializeSkillForExecution,
    };

    const result = await executeTool(
      "run_skill",
      { skill_name: "async-authorized", input: "inspect" },
      { cwd: tempDir, skillLoader },
    );

    expect(result).toMatchObject({ success: true, isolated: true });
    expect(materializeSkillForExecution).toHaveBeenCalledOnce();
    expect(mocks.childConfigs[0].task).toContain(
      "Authorized after IDE confirmation",
    );
  });

  it("inherits parent authority objects without adding executable MCP definitions", async () => {
    registerSkill({ id: "guarded", isolation: true });
    const permissionRules = { evaluate: vi.fn() };
    const hostManagedToolPolicy = {
      tools: { read_file: { allowed: true } },
      toolDefinitions: [
        { type: "function", function: { name: "host_external" } },
      ],
    };
    const approvalGate = vi.fn();
    const mcpCallLedger = { begin: vi.fn() };
    const mcpConflictScheduler = { acquire: vi.fn() };

    await executeTool(
      "run_skill",
      { skill_name: "guarded", input: "x" },
      {
        cwd: tempDir,
        permissionRules,
        hostManagedToolPolicy,
        approvalGate,
        mcpCallLedger,
        mcpConflictScheduler,
      },
    );

    expect(mocks.childConfigs[0]).toMatchObject({
      permissionRules,
      approvalGate,
      mcpCallLedger,
      mcpConflictScheduler,
      hostManagedToolPolicy: {
        tools: hostManagedToolPolicy.tools,
        toolDefinitions: [],
      },
    });
  });

  it("surfaces isolated child failure without falling back to the handler", async () => {
    registerSkill({ id: "broken", isolation: true });
    mocks.createSubAgent.mockReturnValueOnce({
      id: "broken-child",
      run: vi.fn(async () => {
        throw new Error("child failed");
      }),
    });

    const result = await executeTool(
      "run_skill",
      { skill_name: "broken", input: "x" },
      { cwd: tempDir },
    );

    expect(result.error).toMatch(
      /Isolated skill execution failed.*child failed/,
    );
    expect(result).toMatchObject({
      success: false,
      isolated: true,
      skill: "broken",
      code: "CC_SKILL_ISOLATED_EXECUTION_FAILED",
    });
  });

  it("does not wrap a resolved failed child result as success", async () => {
    registerSkill({ id: "resolved-broken", isolation: true });
    const child = {
      id: "resolved-broken-child",
      status: "active",
      run: vi.fn(async () => {
        child.status = "failed";
        return {
          summary: "Sub-agent failed: provider disconnected",
          artifacts: [],
          toolsUsed: [],
        };
      }),
    };
    mocks.createSubAgent.mockReturnValueOnce(child);

    const result = await executeTool(
      "run_skill",
      { skill_name: "resolved-broken", input: "x" },
      { cwd: tempDir },
    );

    expect(result).toMatchObject({
      success: false,
      isolated: true,
      skill: "resolved-broken",
      code: "CC_SKILL_ISOLATED_EXECUTION_FAILED",
      summary: "Sub-agent failed: provider disconnected",
    });
    expect(result.error).toContain("provider disconnected");
  });

  it("preserves the materialization security incident code", async () => {
    registerSkill({ id: "changed", isolation: true });
    const error = Object.assign(new Error("digest changed"), {
      code: "CC_SKILL_DIGEST_DRIFT",
    });
    const skillLoader = {
      getResolvedSkills: () => mocks.skills,
      materializeSkill: () => {
        throw error;
      },
    };

    const result = await executeTool(
      "run_skill",
      { skill_name: "changed", input: "x" },
      { cwd: tempDir, skillLoader },
    );

    expect(result).toMatchObject({
      code: "CC_SKILL_DIGEST_DRIFT",
      policy: { decision: "blocked", via: "skill-execution-boundary" },
    });
  });

  it("list_skills restricts descriptors to the contract allow-list", async () => {
    registerSkill({ id: "alpha" });
    registerSkill({ id: "beta" });
    registerSkill({ id: "gamma" });

    const restricted = await executeTool(
      "list_skills",
      {},
      { cwd: tempDir, skillAllowlist: ["alpha", "gamma"] },
    );

    expect(restricted.skills.map((skill) => skill.id).sort()).toEqual([
      "alpha",
      "gamma",
    ]);
  });

  it("treats an empty skill allow-list as deny-all", async () => {
    registerSkill({ id: "alpha" });

    const result = await executeTool(
      "list_skills",
      {},
      { cwd: tempDir, skillAllowlist: [] },
    );

    expect(result.error).toMatch(/restricted by its contract/i);
  });

  it("does not let an allowed skill escape the controlled execution boundary", async () => {
    registerSkill({ id: "alpha" });
    registerSkill({ id: "beta" });

    const denied = await executeTool(
      "run_skill",
      { skill_name: "beta", input: "x" },
      { cwd: tempDir, skillAllowlist: ["alpha"] },
    );
    const allowed = await executeTool(
      "run_skill",
      { skill_name: "alpha", input: "x" },
      { cwd: tempDir, skillAllowlist: ["alpha"] },
    );

    expect(denied.error).toMatch(/not found/i);
    expect(allowed.code).toBe("CC_SKILL_DIRECT_HANDLER_BLOCKED");
  });
});
