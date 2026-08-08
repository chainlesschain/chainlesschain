import { describe, expect, it, vi } from "vitest";
import { loadManagedMcp } from "../../src/runtime/mcp-config.js";

describe("managed MCP configuration scope", () => {
  it("loads provisioned servers as a highest-precedence read-only source", async () => {
    const connect = vi.fn(async (name, config) => ({
      tools: [{ name: "managed_tool", inputSchema: { type: "object" } }],
      resources: [],
      prompts: [],
      config,
    }));
    const client = {
      servers: new Map(),
      connect: async (name, config) => {
        client.servers.set(name, { config });
        return connect(name, config);
      },
      setReconnector: vi.fn(),
    };
    const result = await loadManagedMcp(
      {
        managedMcpServers: {
          corporate: {
            transport: "https",
            url: "https://mcp.example.test/api",
            sandboxPolicy: {
              requiredBoundaries: ["network", "filesystem", "network"],
            },
          },
        },
      },
      {
        managedFile: "/etc/chainlesschain/managed-settings.json",
        createClient: () => client,
      },
    );
    expect(connect).toHaveBeenCalledWith(
      "corporate",
      expect.objectContaining({
        configScope: "managed",
        configSource: "/etc/chainlesschain/managed-settings.json",
        sandboxPolicy: {
          requiredBoundaries: ["filesystem", "network"],
        },
      }),
    );
    expect(result.connected).toEqual([
      { server: "corporate", tools: 1, resources: 0, prompts: 0 },
    ]);
  });

  it("does nothing when managed settings contain no server block", async () => {
    await expect(loadManagedMcp({}, {})).resolves.toBeNull();
  });

  it("fails closed on an invalid managed server policy", async () => {
    const connect = vi.fn();
    await expect(
      loadManagedMcp(
        {
          managedMcpServers: {
            unsafe: {
              command: "node",
              sandboxPolicy: { profile: "strict" },
            },
          },
        },
        { createClient: () => ({ connect }) },
      ),
    ).rejects.toMatchObject({ code: "CC_MCP_SANDBOX_POLICY_INVALID" });
    expect(connect).not.toHaveBeenCalled();
  });
});
