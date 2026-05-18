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
  createMcpListResourcesHandler,
  createMcpReadResourceHandler,
  shapeTool,
  shapeResource,
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
    listResources: vi.fn(async (name) => {
      if (name === "filesystem") {
        return [
          {
            uri: "file:///tmp/notes.md",
            name: "Notes",
            description: "Personal notes",
            mimeType: "text/markdown",
          },
          { uri: "file:///tmp/todo.txt" },
        ];
      }
      if (name === "github") {
        return [{ uri: "github://repos/foo/bar", name: "foo/bar" }];
      }
      return [];
    }),
    readResource: vi.fn(async (server, uri) => ({
      contents: [
        {
          uri,
          mimeType: "text/plain",
          text: `content of ${uri} from ${server}`,
        },
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

describe("shapeResource", () => {
  it("preserves uri + name + description + mimeType", () => {
    expect(
      shapeResource({
        uri: "file:///x",
        name: "X",
        description: "y",
        mimeType: "text/plain",
      }),
    ).toEqual({
      uri: "file:///x",
      name: "X",
      description: "y",
      mimeType: "text/plain",
    });
  });

  it("defaults missing fields to null/empty-string", () => {
    expect(shapeResource({ uri: "file:///x" })).toEqual({
      uri: "file:///x",
      name: null,
      description: "",
      mimeType: null,
    });
  });

  it("returns null for non-object inputs", () => {
    expect(shapeResource(null)).toBeNull();
    expect(shapeResource("file:///x")).toBeNull();
  });
});

describe("mcp.list_resources — aggregate", () => {
  it("returns one entry per connected server with their resources", async () => {
    const mcpManager = makeStubManager();
    const handler = createMcpListResourcesHandler({ mcpManager });
    const result = await handler({});
    expect(result.servers).toHaveLength(2);
    const fs = result.servers.find((s) => s.name === "filesystem");
    expect(fs.resources).toHaveLength(2);
    expect(fs.resources[0].uri).toBe("file:///tmp/notes.md");
    expect(fs.resources[1].name).toBeNull(); // shape default
  });

  it("isolates per-server failures into {error}", async () => {
    const mcpManager = makeStubManager({
      listResources: vi.fn(async (name) => {
        if (name === "github") {
          throw new Error("rate_limited");
        }
        return [{ uri: "file:///x" }];
      }),
    });
    const handler = createMcpListResourcesHandler({ mcpManager });
    const result = await handler({});
    const gh = result.servers.find((s) => s.name === "github");
    expect(gh.error).toBe("rate_limited");
    expect(gh.resources).toEqual([]);
  });
});

describe("mcp.list_resources — single server", () => {
  it("returns one server entry when serverName given", async () => {
    const mcpManager = makeStubManager();
    const handler = createMcpListResourcesHandler({ mcpManager });
    const result = await handler({ serverName: "github" });
    expect(result.server.name).toBe("github");
    expect(result.server.resources).toEqual([
      {
        uri: "github://repos/foo/bar",
        name: "foo/bar",
        description: "",
        mimeType: null,
      },
    ]);
  });

  it("propagates listResources errors when serverName is given", async () => {
    const mcpManager = makeStubManager({
      listResources: vi.fn(async () => {
        throw new Error("not_supported");
      }),
    });
    const handler = createMcpListResourcesHandler({ mcpManager });
    await expect(handler({ serverName: "filesystem" })).rejects.toThrow(
      "not_supported",
    );
  });

  it("throws mcp_unavailable on null mcpManager", async () => {
    const handler = createMcpListResourcesHandler({ mcpManager: null });
    await expect(handler({})).rejects.toThrow("mcp_unavailable");
  });
});

describe("mcp.read_resource", () => {
  it("forwards serverName + uri to readResource", async () => {
    const mcpManager = makeStubManager();
    const handler = createMcpReadResourceHandler({ mcpManager });
    const result = await handler({
      serverName: "filesystem",
      uri: "file:///tmp/notes.md",
    });
    expect(mcpManager.readResource).toHaveBeenCalledWith(
      "filesystem",
      "file:///tmp/notes.md",
    );
    expect(result.contents[0].text).toContain("file:///tmp/notes.md");
  });

  it("throws server_name_required when serverName is missing", async () => {
    const handler = createMcpReadResourceHandler({
      mcpManager: makeStubManager(),
    });
    await expect(handler({ uri: "file:///x" })).rejects.toThrow(
      "server_name_required",
    );
  });

  it("throws uri_required when uri is missing or non-string", async () => {
    const handler = createMcpReadResourceHandler({
      mcpManager: makeStubManager(),
    });
    await expect(handler({ serverName: "filesystem" })).rejects.toThrow(
      "uri_required",
    );
    await expect(
      handler({ serverName: "filesystem", uri: "" }),
    ).rejects.toThrow("uri_required");
    await expect(
      handler({ serverName: "filesystem", uri: 123 }),
    ).rejects.toThrow("uri_required");
  });

  it("throws mcp_unavailable when manager is null", async () => {
    const handler = createMcpReadResourceHandler({ mcpManager: null });
    await expect(
      handler({ serverName: "filesystem", uri: "file:///x" }),
    ).rejects.toThrow("mcp_unavailable");
  });

  it("propagates readResource errors verbatim", async () => {
    const mcpManager = makeStubManager({
      readResource: vi.fn(async () => {
        throw new Error("not_found");
      }),
    });
    const handler = createMcpReadResourceHandler({ mcpManager });
    await expect(
      handler({ serverName: "filesystem", uri: "file:///gone" }),
    ).rejects.toThrow("not_found");
  });
});
