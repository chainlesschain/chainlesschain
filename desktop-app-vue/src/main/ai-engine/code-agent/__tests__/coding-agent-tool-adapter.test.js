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
  it("exposes the seven core coding-agent tools with stable metadata", () => {
    const adapter = new CodingAgentToolAdapter();

    const tools = adapter.listCoreTools();

    expect(tools).toHaveLength(7);
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
    expect(tools.find((tool) => tool.name === "git")).toMatchObject({
      isReadOnly: false,
      riskLevel: "high",
      planModeBehavior: "readonly-conditional",
      readOnlySubcommands: expect.arrayContaining(["status", "diff", "log"]),
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

    expect(tools).toHaveLength(8);
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

  it("blocks untrusted MCP servers even when they are explicitly allowlisted", async () => {
    const adapter = new CodingAgentToolAdapter({
      allowedMcpServerNames: ["custom-weather"],
      mcpManager: {
        servers: new Map([["custom-weather", { state: "connected" }]]),
        listTools: vi.fn().mockResolvedValue([
          {
            name: "get_forecast",
            description: "Get weather from an untrusted server",
            inputSchema: {
              type: "object",
              properties: {
                city: { type: "string" },
              },
            },
          },
        ]),
      },
    });

    const tools = await adapter.listAvailableTools();

    expect(
      tools.some((tool) => tool.name === "mcp_custom-weather_get_forecast"),
    ).toBe(false);
  });

  it("keeps trusted high-risk MCP servers disabled unless explicitly opted in", async () => {
    const mcpManager = {
      servers: new Map([["github", { state: "connected" }]]),
      listTools: vi.fn().mockResolvedValue([
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
      ]),
    };

    const blockedAdapter = new CodingAgentToolAdapter({
      allowedMcpServerNames: ["github"],
      mcpManager,
    });
    const allowedAdapter = new CodingAgentToolAdapter({
      allowedMcpServerNames: ["github"],
      allowHighRiskMcpServers: true,
      mcpManager,
    });

    const blockedTools = await blockedAdapter.listAvailableTools();
    const allowedTools = await allowedAdapter.listAvailableTools();

    expect(
      blockedTools.some((tool) => tool.name === "mcp_github_create_issue"),
    ).toBe(false);
    expect(
      allowedTools.find((tool) => tool.name === "mcp_github_create_issue"),
    ).toMatchObject({
      riskLevel: "high",
      isReadOnly: false,
      mcpMetadata: expect.objectContaining({
        trusted: true,
        securityLevel: "high",
      }),
    });
  });

  it("uses the higher risk between the trusted MCP server and the tool descriptor", async () => {
    const adapter = new CodingAgentToolAdapter({
      mcpManager: {
        servers: new Map([["weather", { state: "connected" }]]),
        listTools: vi.fn().mockResolvedValue([
          {
            name: "admin_override",
            description: "Escalated weather maintenance action",
            risk_level: "high",
            inputSchema: {
              type: "object",
              properties: {
                city: { type: "string" },
              },
            },
          },
        ]),
      },
    });

    const tools = await adapter.listAvailableTools();

    expect(
      tools.find((tool) => tool.name === "mcp_weather_admin_override"),
    ).toMatchObject({
      riskLevel: "high",
      isReadOnly: false,
      mcpMetadata: expect.objectContaining({
        securityLevel: "low",
      }),
    });
  });
});
