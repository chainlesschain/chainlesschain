import { describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const {
  CORE_CODING_AGENT_TOOLS,
  DEFAULT_ALLOWED_MANAGED_TOOL_NAMES,
  DEFAULT_ALLOWED_MCP_SERVER_NAMES,
  CodingAgentToolAdapter,
} = require("../coding-agent-tool-adapter.js");

describe("CodingAgentToolAdapter", () => {
  it("exposes the six core coding-agent tools with stable metadata", () => {
    const adapter = new CodingAgentToolAdapter();

    const tools = adapter.listCoreTools();

    expect(tools).toHaveLength(6);
    expect(tools.map((tool) => tool.name)).toEqual(
      CORE_CODING_AGENT_TOOLS.map((tool) => tool.name),
    );
    expect(tools.find((tool) => tool.name === "read_file")).toMatchObject({
      isReadOnly: true,
      riskLevel: "low",
      source: "desktop-core",
    });
    expect(tools.find((tool) => tool.name === "run_shell")).toMatchObject({
      isReadOnly: false,
      riskLevel: "high",
    });
  });

  it("can merge matching desktop tool-manager metadata for a core tool", async () => {
    const adapter = new CodingAgentToolAdapter({
      toolManager: {
        getToolByName: vi.fn().mockResolvedValue({
          id: "tool-1",
          name: "write_file",
          description: "Managed description",
          input_schema: JSON.stringify({
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string" },
              encoding: { type: "string" },
            },
            required: ["path", "content"],
          }),
          risk_level: "medium",
        }),
      },
    });

    const tool = await adapter.getTool("write_file");

    expect(tool).toMatchObject({
      name: "write_file",
      description: "Managed description",
      riskLevel: "medium",
      source: "desktop-tool-manager:tool-1",
      isReadOnly: false,
    });
    expect(tool.inputSchema.properties.encoding).toBeDefined();
  });

  it("exposes allowlisted managed tools alongside the core tool set", async () => {
    const adapter = new CodingAgentToolAdapter({
      toolManager: {
        getAllTools: vi.fn().mockResolvedValue([
          {
            id: "tool-2",
            name: DEFAULT_ALLOWED_MANAGED_TOOL_NAMES[0],
            description: "Managed search tool",
            parameters_schema: JSON.stringify({
              type: "object",
              properties: {
                query: { type: "string" },
              },
              required: ["query"],
            }),
            risk_level: 1,
            enabled: 1,
          },
          {
            id: "tool-3",
            name: "git_commit",
            description: "Should stay hidden",
            parameters_schema: JSON.stringify({
              type: "object",
              properties: {
                message: { type: "string" },
              },
            }),
            risk_level: 2,
            enabled: 1,
          },
        ]),
      },
    });

    const tools = await adapter.listAvailableTools();

    expect(tools).toHaveLength(7);
    expect(
      tools.find((tool) => tool.name === DEFAULT_ALLOWED_MANAGED_TOOL_NAMES[0]),
    ).toMatchObject({
      source: "desktop-tool-manager:tool-2",
      riskLevel: "low",
      isReadOnly: true,
    });
    expect(tools.some((tool) => tool.name === "git_commit")).toBe(false);
  });

  it("exposes allowlisted MCP tools alongside the core tool set", async () => {
    const adapter = new CodingAgentToolAdapter({
      mcpManager: {
        servers: new Map([
          ["weather", { state: "connected" }],
          ["github", { state: "connected" }],
        ]),
        listTools: vi.fn(async (serverName) => {
          if (serverName === "weather") {
            return [
              {
                name: "get_forecast",
                description: "Get the local weather forecast",
                inputSchema: {
                  type: "object",
                  properties: {
                    city: { type: "string" },
                  },
                  required: ["city"],
                },
              },
            ];
          }

          return [
            {
              name: "create_issue",
              description: "Create a GitHub issue",
              inputSchema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                },
              },
            },
          ];
        }),
      },
    });

    const tools = await adapter.listAvailableTools();

    expect(
      tools.find(
        (tool) =>
          tool.name ===
          `mcp_${DEFAULT_ALLOWED_MCP_SERVER_NAMES[0]}_get_forecast`,
      ),
    ).toMatchObject({
      source: `mcp:${DEFAULT_ALLOWED_MCP_SERVER_NAMES[0]}`,
      riskLevel: "low",
      isReadOnly: true,
    });
    expect(tools.some((tool) => tool.name === "mcp_github_create_issue")).toBe(
      false,
    );
  });
});
