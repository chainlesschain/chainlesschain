import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const { UnifiedToolRegistry } = require("../unified-tool-registry.js");

describe("UnifiedToolRegistry", () => {
  let registry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new UnifiedToolRegistry();
  });

  it("normalizes FunctionCaller tools into canonical descriptors", () => {
    registry.bindFunctionCaller({
      getAllToolDefinitions: vi.fn(() => [
        {
          name: "read_file",
          description: "Read file via FunctionCaller",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
        {
          name: "custom-tool",
          description: "Custom builtin tool",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
          },
        },
      ]),
      isToolAvailable: vi.fn((name) => name !== "custom-tool"),
    });

    registry._importFunctionCallerTools();

    const tools = registry.getAllTools();
    expect(tools).toHaveLength(2);

    const readFile = tools.find((tool) => tool.name === "read_file");
    expect(readFile).toMatchObject({
      title: "Read File",
      kind: "filesystem",
      source: "builtin",
      category: "read",
      available: true,
    });
    expect(readFile.parameters).toEqual(readFile.inputSchema);
    expect(readFile.permissions).toEqual({
      level: "readonly",
      scopes: ["filesystem:read"],
    });
    expect(readFile.telemetry.tags).toContain("tool:read_file");

    const customTool = tools.find((tool) => tool.name === "custom_tool");
    expect(customTool).toMatchObject({
      title: "Custom Tool",
      kind: "builtin",
      category: "execute",
      available: false,
      riskLevel: "medium",
    });
    expect(customTool.parameters).toEqual(customTool.inputSchema);

    tools[0].title = "mutated";
    expect(registry.getAllTools()[0].title).not.toBe("mutated");
  });

  it("normalizes MCP tools and preserves LLM parameters compatibility", () => {
    registry.bindFunctionCaller({
      getAllToolDefinitions: vi.fn(() => [
        {
          name: "mcp_demo_fetch",
          description: "Fetch from MCP",
          parameters: {
            type: "object",
            properties: { url: { type: "string" } },
            required: ["url"],
          },
        },
      ]),
    });
    registry.bindMCPAdapter({
      getMCPTools: vi.fn(() => [
        {
          toolId: "mcp_demo_fetch",
          serverName: "demo",
        },
      ]),
      on: vi.fn(),
    });

    registry._importMCPTools();

    const [tool] = registry.getAllTools();
    expect(tool).toMatchObject({
      name: "mcp_demo_fetch",
      title: "Mcp Demo Fetch",
      kind: "mcp",
      source: "mcp",
      category: "execute",
      available: true,
    });
    expect(tool.permissions).toEqual({
      level: "standard",
      scopes: ["mcp:invoke"],
    });
    expect(tool.tags).toEqual(
      expect.arrayContaining(["mcp", "demo", "server:demo"]),
    );

    const llmTools = registry.getToolsForLLM();
    expect(llmTools).toEqual([
      {
        name: "mcp_demo_fetch",
        description: "Fetch from MCP",
        parameters: {
          type: "object",
          properties: { url: { type: "string" } },
          required: ["url"],
        },
      },
    ]);
  });

  it("links skill metadata onto canonical tools and returns cloned context", () => {
    registry.bindFunctionCaller({
      getAllToolDefinitions: vi.fn(() => [
        {
          name: "custom-tool",
          description: "Custom builtin tool",
          parameters: {
            type: "object",
            properties: { input: { type: "string" } },
          },
        },
      ]),
      isToolAvailable: vi.fn(() => true),
    });
    registry.bindSkillRegistry({
      getAllSkills: vi.fn(() => [
        {
          skillId: "automation-skill",
          name: "Automation Skill",
          description: "Automates repetitive work",
          category: "automation",
          instructions: "Use carefully",
          examples: ["custom-tool with sample input"],
          tags: ["automation"],
          tools: ["custom-tool"],
        },
      ]),
      on: vi.fn(),
    });

    registry._importFunctionCallerTools();
    registry._importSkills();

    const context = registry.getToolContext("custom_tool");
    expect(context).toMatchObject({
      tool: {
        name: "custom_tool",
        skillName: "automation-skill",
        skillCategory: "automation",
        category: "automation",
        instructions: "Use carefully",
      },
      skill: {
        name: "automation-skill",
        category: "automation",
      },
    });
    expect(context.tool.tags).toEqual(
      expect.arrayContaining(["source:builtin", "skill:automation-skill"]),
    );

    context.tool.instructions = "mutated";
    context.skill.description = "mutated";

    const freshContext = registry.getToolContext("custom_tool");
    expect(freshContext.tool.instructions).toBe("Use carefully");
    expect(freshContext.skill.description).toBe("Automates repetitive work");
    expect(registry.getStats().byCategory.automation).toBe(1);
  });

  it("filters getToolsForLLM by activeSkillNames", () => {
    registry.bindFunctionCaller({
      getAllToolDefinitions: vi.fn(() => [
        {
          name: "tool-a",
          description: "A",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "tool-b",
          description: "B",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "file_read",
          description: "always-on",
          parameters: { type: "object", properties: {} },
        },
      ]),
      isToolAvailable: vi.fn(() => true),
    });
    registry.bindSkillRegistry({
      getAllSkills: vi.fn(() => [
        { skillId: "skill-a", name: "Skill A", tools: ["tool-a"] },
        { skillId: "skill-b", name: "Skill B", tools: ["tool-b"] },
      ]),
      on: vi.fn(),
    });

    registry._importFunctionCallerTools();
    registry._importSkills();

    // No filter → all tools
    expect(
      registry
        .getToolsForLLM()
        .map((t) => t.name)
        .sort(),
    ).toEqual(["file_read", "tool_a", "tool_b"]);

    // Filter by active skill
    const filtered = registry.getToolsForLLM({ activeSkillNames: "skill-a" });
    expect(filtered.map((t) => t.name)).toEqual(["tool_a"]);

    // Filter + alwaysAvailable
    const withAlways = registry.getToolsForLLM({
      activeSkillNames: ["skill-a"],
      alwaysAvailable: ["file_read"],
    });
    expect(withAlways.map((t) => t.name).sort()).toEqual([
      "file_read",
      "tool_a",
    ]);

    // Multiple active skills
    const multi = registry.getToolsForLLM({
      activeSkillNames: ["skill-a", "skill-b"],
    });
    expect(multi.map((t) => t.name).sort()).toEqual(["tool_a", "tool_b"]);
  });
});
