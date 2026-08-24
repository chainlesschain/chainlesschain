import { redactConfigObject } from "../../lib/config-redaction.js";

function requireString(value, code) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(code);
  }
  return value;
}

function shapeTool(tool) {
  if (!tool || typeof tool !== "object" || !tool.name) return null;
  return {
    name: String(tool.name),
    description: tool.description ?? "",
    inputSchema:
      tool.inputSchema ?? tool.input_schema ?? tool.parameters_schema ?? null,
  };
}

function shapeResource(resource) {
  if (!resource || typeof resource !== "object" || !resource.uri) return null;
  return {
    uri: String(resource.uri),
    name: resource.name ?? null,
    description: resource.description ?? "",
    mimeType: resource.mimeType ?? null,
  };
}

function connectedServerMap(mcpClient) {
  if (!mcpClient || typeof mcpClient.listServers !== "function") {
    return new Map();
  }
  const rows = mcpClient.listServers();
  return new Map(
    (Array.isArray(rows) ? rows : [])
      .filter((row) => row?.name)
      .map((row) => [String(row.name), row]),
  );
}

function configuredServers(configStore, cwd) {
  if (!configStore || typeof configStore.list !== "function") return [];
  const rows = configStore.list({ cwd });
  return (Array.isArray(rows) ? rows : []).map((row) =>
    redactConfigObject({
      name: row.name,
      command: row.command ?? null,
      args: Array.isArray(row.args) ? row.args : [],
      url: row.url ?? null,
      transport: row.transport ?? null,
      autoConnect: row.autoConnect === true,
      configScope: row.configScope ?? null,
      configSource: row.configSource ?? null,
    }),
  );
}

function listServerTools(mcpClient, name) {
  if (!mcpClient || typeof mcpClient.listTools !== "function") return [];
  return (mcpClient.listTools(name) || []).map(shapeTool).filter(Boolean);
}

function listServerResources(mcpClient, name) {
  if (!mcpClient || typeof mcpClient.listResources !== "function") return [];
  return (mcpClient.listResources(name) || [])
    .map(shapeResource)
    .filter(Boolean);
}

/**
 * Build the MCP topics used by the standalone `cc ui` web panel.
 *
 * `cc ui` already owns one long-lived MCPClient for agent sessions. Exposing
 * that same client here preserves connection state across list/call requests.
 * The previous web-panel fallback spawned `cc mcp servers` and `cc mcp tools`
 * as unrelated child processes, so the tools process could never observe the
 * connection and the page had to parse bootstrap logs as if they were data.
 */
export function createMcpTopicHandlers(options = {}) {
  const { mcpClient = null, configStore = null, cwd = process.cwd() } = options;

  function aggregate(kind) {
    const configured = configuredServers(configStore, cwd);
    const connected = connectedServerMap(mcpClient);
    const configsByName = new Map(
      configured.filter((row) => row?.name).map((row) => [row.name, row]),
    );
    const names = new Set([...configsByName.keys(), ...connected.keys()]);

    return [...names]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => {
        const config = configsByName.get(name) || { name };
        const live = connected.get(name) || null;
        const record = {
          ...config,
          name,
          state: live?.state ?? "disconnected",
          error: live?.toolsError ?? null,
          [kind]: [],
        };
        if (!live) return record;
        try {
          record[kind] =
            kind === "tools"
              ? listServerTools(mcpClient, name)
              : listServerResources(mcpClient, name);
        } catch (error) {
          record.error = error?.message || String(error);
        }
        return record;
      });
  }

  return {
    "mcp.list_servers": async () => ({ servers: aggregate("tools") }),

    "mcp.list_tools": async (frame) => {
      if (!frame?.serverName) return { servers: aggregate("tools") };
      const name = String(frame.serverName);
      const server = aggregate("tools").find((row) => row.name === name);
      if (!server) throw new Error("mcp_server_not_found");
      return { server };
    },

    "mcp.call_tool": async (frame) => {
      const serverName = requireString(
        frame?.serverName,
        "server_name_required",
      );
      const toolName = requireString(frame?.toolName, "tool_name_required");
      if (!mcpClient || typeof mcpClient.callTool !== "function") {
        throw new Error("mcp_unavailable");
      }
      const params =
        frame?.params &&
        typeof frame.params === "object" &&
        !Array.isArray(frame.params)
          ? frame.params
          : {};
      return mcpClient.callTool(serverName, toolName, params);
    },

    "mcp.list_resources": async (frame) => {
      if (!frame?.serverName) return { servers: aggregate("resources") };
      const name = String(frame.serverName);
      const server = aggregate("resources").find((row) => row.name === name);
      if (!server) throw new Error("mcp_server_not_found");
      return { server };
    },

    "mcp.read_resource": async (frame) => {
      const serverName = requireString(
        frame?.serverName,
        "server_name_required",
      );
      const uri = requireString(frame?.uri, "uri_required");
      if (!mcpClient || typeof mcpClient.readResource !== "function") {
        throw new Error("mcp_unavailable");
      }
      return mcpClient.readResource(serverName, uri);
    },
  };
}

export { shapeTool, shapeResource };
