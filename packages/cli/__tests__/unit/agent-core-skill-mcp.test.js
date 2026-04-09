/**
 * Integration test: run_skill tool mounts/unmounts skill-embedded MCP
 * servers around handler.execute, and exposes mcpClient via taskContext.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/lib/plan-mode.js", () => ({
  getPlanModeManager: vi.fn(() => ({
    isActive: () => false,
    isToolAllowed: () => true,
    addPlanItem: vi.fn(),
  })),
}));

// We feed mock skills directly so we don't depend on the on-disk layer.
const _mockSkills = [];

vi.mock("../../src/lib/skill-loader.js", () => ({
  CLISkillLoader: vi.fn().mockImplementation(() => ({
    getResolvedSkills: vi.fn(() => _mockSkills),
  })),
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

describe("run_skill: Skill-Embedded MCP integration", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-skill-mcp-"));
    _mockSkills.length = 0;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function registerSkill({
    id,
    mcpServers = [],
    handlerBody = "return { success: true, receivedMcp: !!taskContext.mcpClient, mounted: taskContext.mountedMcpServers };",
  }) {
    const skillDir = join(tempDir, id);
    mkdirSync(skillDir, { recursive: true });
    const handlerPath = join(skillDir, "handler.js");
    writeFileSync(
      handlerPath,
      `export default {
  async execute(task, taskContext, skill) {
    ${handlerBody}
  }
};
`,
      "utf8",
    );
    _mockSkills.push({
      id,
      dirName: id,
      category: "test",
      activation: "manual",
      source: "workspace",
      hasHandler: true,
      description: id,
      skillDir,
      mcpServers,
      isolation: false,
    });
  }

  it("mounts declared MCP servers before handler and unmounts after", async () => {
    const connectCalls = [];
    const disconnectCalls = [];
    const fakeMcp = {
      connect: vi.fn(async (name, cfg) => {
        connectCalls.push({ name, cfg });
      }),
      disconnect: vi.fn(async (name) => {
        disconnectCalls.push(name);
      }),
    };

    registerSkill({
      id: "weather-skill",
      mcpServers: [
        { name: "weather", command: "npx", args: ["-y", "@mcp/weather"] },
      ],
    });

    const result = await executeTool(
      "run_skill",
      { skill_name: "weather-skill", input: "London" },
      { cwd: tempDir, mcpClient: fakeMcp },
    );

    expect(result.success).toBe(true);
    expect(result.receivedMcp).toBe(true);
    expect(result.mounted).toEqual(["weather"]);
    expect(connectCalls).toHaveLength(1);
    expect(connectCalls[0].name).toBe("weather");
    expect(connectCalls[0].cfg.command).toBe("npx");
    // Unmount must happen after handler returns
    expect(disconnectCalls).toEqual(["weather"]);
  });

  it("unmounts servers even when handler throws", async () => {
    const disconnectCalls = [];
    const fakeMcp = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(async (name) => {
        disconnectCalls.push(name);
      }),
    };

    registerSkill({
      id: "broken-skill",
      mcpServers: [{ name: "fs", command: "node", args: ["s.js"] }],
      handlerBody: 'throw new Error("boom");',
    });

    const result = await executeTool(
      "run_skill",
      { skill_name: "broken-skill", input: "x" },
      { cwd: tempDir, mcpClient: fakeMcp },
    );

    expect(result.error).toMatch(/Skill execution failed.*boom/);
    expect(disconnectCalls).toEqual(["fs"]);
  });

  it("skips mounting when skill has no mcpServers", async () => {
    const fakeMcp = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    registerSkill({ id: "plain-skill", mcpServers: [] });

    const result = await executeTool(
      "run_skill",
      { skill_name: "plain-skill", input: "x" },
      { cwd: tempDir, mcpClient: fakeMcp },
    );

    expect(result.success).toBe(true);
    expect(fakeMcp.connect).not.toHaveBeenCalled();
    expect(fakeMcp.disconnect).not.toHaveBeenCalled();
  });

  it("skips mounting when mcpClient is null but still runs handler", async () => {
    registerSkill({
      id: "weather-skill",
      mcpServers: [{ name: "weather", command: "npx" }],
    });

    const result = await executeTool(
      "run_skill",
      { skill_name: "weather-skill", input: "x" },
      { cwd: tempDir, mcpClient: null },
    );

    // Handler still runs; receivedMcp false because mcpClient is null
    expect(result.success).toBe(true);
    expect(result.receivedMcp).toBe(false);
    expect(result.mounted).toEqual([]);
  });

  it("returns error if mountSkillMcpServers throws (bad client)", async () => {
    // Provide an object that has neither .connect nor validation will fail
    // on the pre-flight inside mountSkillMcpServers.
    const badMcp = {}; // no .connect

    registerSkill({
      id: "weather-skill",
      mcpServers: [{ name: "weather", command: "npx" }],
    });

    const result = await executeTool(
      "run_skill",
      { skill_name: "weather-skill", input: "x" },
      { cwd: tempDir, mcpClient: badMcp },
    );

    expect(result.error).toMatch(/Skill MCP mount failed/);
  });

  it("records skipped servers on partial mount failure but still runs handler", async () => {
    const connectCalls = [];
    const fakeMcp = {
      connect: vi.fn(async (name) => {
        connectCalls.push(name);
        if (name === "bad") throw new Error("refused");
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    registerSkill({
      id: "partial-skill",
      mcpServers: [
        { name: "ok", command: "x" },
        { name: "bad", command: "y" },
      ],
    });

    const result = await executeTool(
      "run_skill",
      { skill_name: "partial-skill", input: "x" },
      { cwd: tempDir, mcpClient: fakeMcp },
    );

    expect(result.success).toBe(true);
    expect(result.mounted).toEqual(["ok"]);
    expect(connectCalls).toEqual(["ok", "bad"]);
    // Only successfully-mounted servers are unmounted
    expect(fakeMcp.disconnect).toHaveBeenCalledExactlyOnceWith("ok");
  });
});
