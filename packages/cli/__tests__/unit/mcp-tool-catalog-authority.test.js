import { describe, expect, it, vi } from "vitest";
import {
  assertMcpCatalogBinding,
  captureMcpToolCatalog,
  mergeMcpToolCatalog,
  projectMcpToolCatalog,
  publishMcpToolCatalog,
  readMcpToolCatalog,
  restrictMcpToolCatalog,
} from "../../src/lib/mcp-tool-catalog-authority.js";
import { setupMcpFromConfig } from "../../src/runtime/mcp-config.js";
import { maybeApplyToolSearch } from "../../src/runtime/mcp-tool-search.js";
import { createInheritedMcpToolCatalog } from "../../src/lib/subagent-inheritance.js";

vi.mock("../../src/lib/mcp-oauth.js", () => ({
  ensureValidToken: vi.fn(async () => "fixture-oauth-token"),
}));

const name = "mcp__weather__get";
const tool = () => ({
  name: "get",
  inputSchema: { type: "object", properties: { city: { type: "string" } } },
});

async function host(config = {}) {
  const client = {
    servers: new Map(),
    connect: vi.fn(async (server, config) => {
      const entry = {
        config,
        state: "connected",
        tools: [tool()],
        instructions: "Use city names.",
      };
      client.servers.set(server, entry);
      return entry;
    }),
  };
  const result = await setupMcpFromConfig(
    {
      weather: {
        url: "http://localhost:1/mcp",
        headers: { Authorization: "fixture" },
        ...config,
      },
    },
    { createClient: () => client },
  );
  return { result, client, authority: result.mcpToolCatalog };
}

describe("MCP host catalog authority", () => {
  it("rejects forged or copied authority objects without invoking their methods", () => {
    const read = vi.fn();
    expect(() => captureMcpToolCatalog({ read })).toThrow(
      expect.objectContaining({
        code: "CC_MCP_TOOL_CATALOG_AUTHORITY_INVALID",
      }),
    );
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps published routes and schemas immutable, and ignores unpublished array additions", async () => {
    const { result, authority } = await host();
    const snapshot = readMcpToolCatalog(authority);
    result.extraToolDefinitions.push({
      type: "function",
      function: { name: "mcp__private__write" },
    });
    expect(readMcpToolCatalog(authority)).toBe(snapshot);
    expect(
      snapshot.extraToolDefinitions.map((def) => def.function.name),
    ).toEqual([name]);
    expect(() => {
      result.externalToolExecutors[name].serverName = "private";
    }).toThrow();
    expect(() => {
      snapshot.extraToolDefinitions[0].function.parameters.properties.city.type =
        "integer";
    }).toThrow();
    expect(() => captureMcpToolCatalog({ ...authority })).toThrow();
  });

  it("does not delegate a name invented by a derived catalog", async () => {
    const { authority } = await host();
    const derived = projectMcpToolCatalog(authority, (snapshot) => ({
      ...snapshot,
      extraToolDefinitions: [
        ...snapshot.extraToolDefinitions,
        { type: "function", function: { name: "mcp__private__write" } },
      ],
    }));
    expect(
      readMcpToolCatalog(derived).extraToolDefinitions.map(
        (def) => def.function.name,
      ),
    ).toEqual([name]);
  });

  it.each(["disconnect", "refreshing", "replacement"])(
    "invalidates bindings when the transport is %s",
    async (change) => {
      const { client, authority } = await host();
      const binding = { authority, snapshot: readMcpToolCatalog(authority) };
      if (change === "disconnect")
        client.servers.get("weather").state = "disconnected";
      else if (change === "refreshing")
        client.servers.get("weather")._toolInventoryDirty = true;
      else
        client.servers.set("weather", { state: "connected", tools: [tool()] });
      expect(() => assertMcpCatalogBinding(binding, name)).toThrow(
        expect.objectContaining({
          code: "CC_MCP_TOOL_CATALOG_STALE",
          dispatched: false,
        }),
      );
    },
  );

  it("updates known server inventory and never grants an unknown client connection", async () => {
    const { client, authority } = await host();
    client.servers.get("weather").tools = [
      tool(),
      { name: "forecast", inputSchema: { type: "object" } },
    ];
    client.servers.set("private", {
      state: "connected",
      tools: [{ name: "write", inputSchema: { type: "object" } }],
    });
    expect(
      readMcpToolCatalog(authority).extraToolDefinitions.map(
        (def) => def.function.name,
      ),
    ).toEqual([name, "mcp__weather__forecast"]);
  });

  it.each([
    { url: "http://localhost:2/mcp" },
    { url: "http://localhost:1/mcp?tenant=other" },
    { headers: { Authorization: "other-principal" } },
    { command: "different-executable", args: ["--unsafe"] },
    { configScope: "managed" },
    { env: { TENANT: "other" } },
    { sandboxPolicy: { network: "allow" } },
  ])(
    "revokes a same-name connection with changed source: %j",
    async (change) => {
      const { client, authority } = await host();
      const snapshot = readMcpToolCatalog(authority);
      const entry = client.servers.get("weather");
      entry.config = { ...entry.config, ...change };
      expect(readMcpToolCatalog(authority).extraToolDefinitions).toEqual([]);
      expect(() =>
        assertMcpCatalogBinding({ authority, snapshot }, name),
      ).toThrow(expect.objectContaining({ code: "CC_MCP_TOOL_CATALOG_STALE" }));
    },
  );

  it("allows host OAuth bearer rotation but retains the approved endpoint and headers", async () => {
    const { client, authority } = await host({
      headers: { "X-Tenant": "one" },
    });
    const entry = client.servers.get("weather");
    client.servers.set("weather", {
      ...entry,
      config: {
        ...entry.config,
        transport: "http",
        headers: { "X-Tenant": "one", Authorization: "Bearer refreshed" },
      },
    });
    expect(
      readMcpToolCatalog(authority).extraToolDefinitions.map(
        (def) => def.function.name,
      ),
    ).toEqual([name]);
    client.servers.get("weather").config.headers["X-Tenant"] = "two";
    expect(readMcpToolCatalog(authority).extraToolDefinitions).toEqual([]);
  });

  it("rejects an oversized refreshed inventory and recovers after a valid inventory arrives", async () => {
    const { client, authority } = await host({ maxTools: 1 });
    client.servers.get("weather").tools = [tool(), { name: "too-many" }];
    expect(readMcpToolCatalog(authority).extraToolDefinitions).toEqual([]);
    client.servers.get("weather").tools = [tool()];
    expect(
      readMcpToolCatalog(authority).extraToolDefinitions.map(
        (def) => def.function.name,
      ),
    ).toEqual([name]);
  });

  it("preserves unchanged tool identity across a separate server addition", async () => {
    const { result, client, authority } = await host();
    const binding = { authority, snapshot: readMcpToolCatalog(authority) };
    await setupMcpFromConfig(
      {
        other: {
          url: "http://localhost:2/mcp",
          headers: { Authorization: "fixture" },
        },
      },
      { into: result, createClient: () => client },
    );
    expect(() => assertMcpCatalogBinding(binding, name)).not.toThrow();
  });

  it("retains compact discovery settings when the initial directory is empty", async () => {
    const result = await setupMcpFromConfig(
      {},
      { createClient: () => ({ connect: async () => ({ tools: [tool()] }) }) },
    );
    maybeApplyToolSearch(result, {
      config: {
        enabled: true,
        catalogMode: "compact",
        maxResults: 2,
        alwaysLoad: [],
      },
    });
    await setupMcpFromConfig(
      {
        weather: {
          url: "http://localhost:1/mcp",
          headers: { Authorization: "fixture" },
        },
      },
      { into: result },
    );
    const snapshot = readMcpToolCatalog(result.mcpToolCatalog);
    expect(
      snapshot.externalToolExecutors.tool_search.registry.catalogMode,
    ).toBe("compact");
    expect(snapshot.externalToolExecutors.tool_search.registry.maxResults).toBe(
      2,
    );
  });

  it("admits a late connection to the approved source after initial connection failure", async () => {
    const config = {
      url: "http://localhost:1/mcp",
      headers: { Authorization: "fixture" },
    };
    const client = {
      servers: new Map(),
      connect: vi.fn(async () => {
        throw new Error("not ready");
      }),
    };
    const result = await setupMcpFromConfig(
      { weather: config },
      { createClient: () => client },
    );
    expect(
      readMcpToolCatalog(result.mcpToolCatalog).extraToolDefinitions,
    ).toEqual([]);
    client.servers.set("weather", {
      state: "connected",
      config: { ...config },
      tools: [tool()],
    });
    expect(
      readMcpToolCatalog(result.mcpToolCatalog).extraToolDefinitions.map(
        (def) => def.function.name,
      ),
    ).toEqual([name]);
  });

  it("preserves per-child discovery across unrelated server changes and resets replaced schemas", async () => {
    const { result, client, authority } = await host();
    maybeApplyToolSearch(result, {
      config: {
        enabled: true,
        catalogMode: "compact",
        alwaysLoad: [],
        maxResults: 5,
      },
    });
    const parent = { mcpToolCatalog: authority };
    const child = createInheritedMcpToolCatalog(parent, ["weather"], null, []);
    const sibling = createInheritedMcpToolCatalog(
      parent,
      ["weather"],
      null,
      [],
    );
    readMcpToolCatalog(
      child,
    ).externalToolExecutors.tool_search.registry.loaded.add(name);
    expect(
      readMcpToolCatalog(sibling).externalToolExecutors.tool_search.registry
        .loaded.size,
    ).toBe(0);
    await setupMcpFromConfig(
      {
        other: {
          url: "http://localhost:2/mcp",
          headers: { Authorization: "fixture" },
        },
      },
      { into: result },
    );
    const refreshed = readMcpToolCatalog(child);
    expect(
      refreshed.externalToolExecutors.tool_search.registry.loaded.has(name),
    ).toBe(true);
    expect(
      readMcpToolCatalog(sibling).externalToolExecutors.tool_search.registry
        .loaded.size,
    ).toBe(0);
    expect(result.toolSearchRegistry.loaded.size).toBe(0);
    client.servers.get("weather").tools = [
      { ...tool(), description: "replacement schema" },
    ];
    expect(
      readMcpToolCatalog(child).externalToolExecutors.tool_search.registry
        .loaded.size,
    ).toBe(0);
    expect(() =>
      assertMcpCatalogBinding({ authority: child, snapshot: refreshed }, name),
    ).toThrow();
  });

  it("does not widen an explicit selection, and retains unrelated host tools", async () => {
    const { authority } = await host();
    const snapshot = readMcpToolCatalog(authority);
    const options = {
      enabledToolNames: [],
      extraToolDefinitions: [
        { type: "function", function: { name: "team_send" } },
      ],
      externalToolExecutors: { team_send: { kind: "team-message" } },
    };
    const merged = mergeMcpToolCatalog(options, snapshot, authority);
    expect(merged.enabledToolNames).toEqual([]);
    expect(merged.externalToolExecutors.team_send).toBe(
      options.externalToolExecutors.team_send,
    );
    const none = projectMcpToolCatalog(authority, (current) =>
      restrictMcpToolCatalog(current, []),
    );
    expect(readMcpToolCatalog(none).externalToolExecutors).toEqual({});
  });

  it.each([
    {
      selected: ["list_files", "read_file"],
      expected: ["list_files", "read_file", name],
    },
    { selected: ["list_files"], expected: ["list_files"] },
    { selected: [], expected: [] },
  ])(
    "only extends the captured implicit selection: %j",
    async ({ selected, expected }) => {
      const { authority } = await host();
      const child = projectMcpToolCatalog(authority, (snapshot) => snapshot, {
        extendSelection: true,
        selectionBase: ["list_files", "read_file"],
      });
      expect(
        mergeMcpToolCatalog(
          { enabledToolNames: selected },
          readMcpToolCatalog(child),
          child,
        ).enabledToolNames,
      ).toEqual(expected);
    },
  );

  it("does not extend an unbound selection", async () => {
    const { authority } = await host();
    const child = projectMcpToolCatalog(authority, (snapshot) => snapshot, {
      extendSelection: true,
    });
    expect(
      mergeMcpToolCatalog(
        { enabledToolNames: [] },
        readMcpToolCatalog(child),
        child,
      ).enabledToolNames,
    ).toEqual([]);
  });
});
