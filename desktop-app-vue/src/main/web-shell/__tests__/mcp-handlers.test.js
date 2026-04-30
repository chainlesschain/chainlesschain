/**
 * Phase 2 mcp.list_tools / mcp.call_tool — unit tests.
 *
 * The handlers DI-inject `mcpManager`, so the suite never needs a live
 * MCPClientManager (which would pull in @modelcontextprotocol/sdk, child
 * processes, etc). We pass a minimal stub that records calls.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createMcpListToolsHandler,
  createMcpCallToolHandler,
  shapeTool,
} from "../handlers/mcp-handlers.js";

function makeStubManager(overrides = {}) {
  return {
    getConnectedServers: () => ["filesystem", "github"],
    listTools: vi.fn(async (name) => {
      if (name === "filesystem") {
        return [
          {
            name: "read_file",
            description: "Read a file",
            inputSchema: { type: "object" },
          },
          {
            name: "write_file",
            description: "Write a file",
            inputSchema: { type: "object" },
          },
        ];
      }
      if (name === "github") {
        return [{ name: "list_repos", description: "List repos" }];
      }
      return [];
    }),
    getServerInfo: vi.fn((name) => ({
      name,
      state: "connected",
      connectedAt: 1700000000000,
      toolCount: 2,
      resourceCount: 0,
      promptCount: 0,
      errorCount: 0,
    })),
    callTool: vi.fn(async (server, tool, params) => ({
      content: [
        { type: "text", text: `${server}.${tool}(${JSON.stringify(params)})` },
      ],
    })),
    ...overrides,
  };
}

describe("shapeTool", () => {
  it("preserves name + description + inputSchema", () => {
    const t = shapeTool({
      name: "read_file",
      description: "x",
      inputSchema: { type: "object" },
    });
    expect(t).toEqual({
      name: "read_file",
      description: "x",
      inputSchema: { type: "object" },
    });
  });

  it("defaults missing description and inputSchema", () => {
    const t = shapeTool({ name: "foo" });
    expect(t).toEqual({
      name: "foo",
      description: "",
      inputSchema: null,
    });
  });

  it("returns null on a non-object input", () => {
    expect(shapeTool(null)).toBeNull();
    expect(shapeTool(undefined)).toBeNull();
    expect(shapeTool(42)).toBeNull();
  });
});

describe("mcp.list_tools — aggregate (no serverName)", () => {
  it("returns one entry per connected server with their tools", async () => {
    const mcpManager = makeStubManager();
    const handler = createMcpListToolsHandler({ mcpManager });
    const result = await handler({});
    expect(result.servers).toHaveLength(2);
    const fs = result.servers.find((s) => s.name === "filesystem");
    expect(fs.state).toBe("connected");
    expect(fs.tools.map((t) => t.name)).toEqual(["read_file", "write_file"]);
    const gh = result.servers.find((s) => s.name === "github");
    expect(gh.tools).toHaveLength(1);
  });

  it("returns servers:[] when nothing is connected", async () => {
    const mcpManager = makeStubManager({ getConnectedServers: () => [] });
    const handler = createMcpListToolsHandler({ mcpManager });
    const result = await handler({});
    expect(result.servers).toEqual([]);
  });

  it("isolates a per-server failure into {error} without breaking the aggregate", async () => {
    const mcpManager = makeStubManager({
      listTools: vi.fn(async (name) => {
        if (name === "github") {
          throw new Error("github_disconnected");
        }
        return [{ name: "read_file" }];
      }),
    });
    const handler = createMcpListToolsHandler({ mcpManager });
    const result = await handler({});
    const fs = result.servers.find((s) => s.name === "filesystem");
    const gh = result.servers.find((s) => s.name === "github");
    expect(fs.tools).toHaveLength(1);
    expect(fs.error).toBeUndefined();
    expect(gh.error).toBe("github_disconnected");
    expect(gh.tools).toEqual([]);
  });

  it("survives a getServerInfo throw on a failing server", async () => {
    const mcpManager = makeStubManager({
      listTools: vi.fn(async () => {
        throw new Error("listTools failed");
      }),
      getServerInfo: vi.fn(() => {
        throw new Error("Server not found");
      }),
    });
    const handler = createMcpListToolsHandler({ mcpManager });
    const result = await handler({});
    expect(result.servers).toHaveLength(2);
    expect(result.servers[0].error).toBe("listTools failed");
    expect(result.servers[0].state).toBeNull();
  });
});

describe("mcp.list_tools — single server", () => {
  it("returns just the requested server when serverName is given", async () => {
    const mcpManager = makeStubManager();
    const handler = createMcpListToolsHandler({ mcpManager });
    const result = await handler({ serverName: "filesystem" });
    expect(result.server.name).toBe("filesystem");
    expect(result.server.state).toBe("connected");
    expect(result.server.tools).toHaveLength(2);
    expect(mcpManager.listTools).toHaveBeenCalledWith("filesystem");
    expect(mcpManager.listTools).toHaveBeenCalledTimes(1);
  });

  it("propagates listTools errors when serverName is given (no swallow)", async () => {
    const mcpManager = makeStubManager({
      listTools: vi.fn(async () => {
        throw new Error("not_connected");
      }),
    });
    const handler = createMcpListToolsHandler({ mcpManager });
    await expect(handler({ serverName: "filesystem" })).rejects.toThrow(
      "not_connected",
    );
  });
});

describe("mcp.list_tools — manager unavailable", () => {
  it("throws mcp_unavailable when mcpManager is null", async () => {
    const handler = createMcpListToolsHandler({ mcpManager: null });
    await expect(handler({})).rejects.toThrow("mcp_unavailable");
  });

  it("throws mcp_unavailable when option is missing", async () => {
    const handler = createMcpListToolsHandler();
    await expect(handler({})).rejects.toThrow("mcp_unavailable");
  });
});

describe("mcp.call_tool", () => {
  it("forwards serverName + toolName + params to the manager", async () => {
    const mcpManager = makeStubManager();
    const handler = createMcpCallToolHandler({ mcpManager });
    const result = await handler({
      serverName: "filesystem",
      toolName: "read_file",
      params: { path: "/tmp/foo" },
    });
    expect(mcpManager.callTool).toHaveBeenCalledWith(
      "filesystem",
      "read_file",
      { path: "/tmp/foo" },
    );
    expect(result.content[0].text).toContain(
      'filesystem.read_file({"path":"/tmp/foo"})',
    );
  });

  it("defaults params to {} when omitted", async () => {
    const mcpManager = makeStubManager();
    const handler = createMcpCallToolHandler({ mcpManager });
    await handler({ serverName: "github", toolName: "list_repos" });
    expect(mcpManager.callTool).toHaveBeenCalledWith(
      "github",
      "list_repos",
      {},
    );
  });

  it("throws server_name_required when serverName is missing or non-string", async () => {
    const handler = createMcpCallToolHandler({ mcpManager: makeStubManager() });
    await expect(handler({ toolName: "x" })).rejects.toThrow(
      "server_name_required",
    );
    await expect(handler({ serverName: "", toolName: "x" })).rejects.toThrow(
      "server_name_required",
    );
    await expect(handler({ serverName: 42, toolName: "x" })).rejects.toThrow(
      "server_name_required",
    );
  });

  it("throws tool_name_required when toolName is missing or non-string", async () => {
    const handler = createMcpCallToolHandler({ mcpManager: makeStubManager() });
    await expect(handler({ serverName: "filesystem" })).rejects.toThrow(
      "tool_name_required",
    );
    await expect(
      handler({ serverName: "filesystem", toolName: "" }),
    ).rejects.toThrow("tool_name_required");
  });

  it("throws mcp_unavailable when mcpManager is null", async () => {
    const handler = createMcpCallToolHandler({ mcpManager: null });
    await expect(
      handler({ serverName: "filesystem", toolName: "read_file" }),
    ).rejects.toThrow("mcp_unavailable");
  });

  it("propagates callTool errors verbatim", async () => {
    const mcpManager = makeStubManager({
      callTool: vi.fn(async () => {
        throw new Error("permission_denied");
      }),
    });
    const handler = createMcpCallToolHandler({ mcpManager });
    await expect(
      handler({ serverName: "filesystem", toolName: "read_file" }),
    ).rejects.toThrow("permission_denied");
  });
});
