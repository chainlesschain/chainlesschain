/**
 * `mcp.list_tools` / `mcp.call_tool` WS handlers — Phase 2 first batch
 * (2026-04-30).
 *
 * Surfaces the desktop's `MCPClientManager` singleton (initialised in
 * `index.js#initializeMCPSystem`, lives at `app.mcpManager`) to the
 * embedded web-panel so the SPA can list connected MCP servers + their
 * tools and invoke a tool — no `ws.execute('cc mcp …')` round-trip
 * (which doesn't work inside Electron, see skill-list-handler header).
 *
 * Frames (server → client wrapped by ws-cli-loader as
 *   `{ type: "<topic>.result", id, ok, result | error }`):
 *
 *   client → server: { id, type: "mcp.list_tools", serverName? }
 *   result.shape:
 *     - serverName given: { server: { name, state, tools: [...] } }
 *     - omitted:           { servers: [{ name, state, tools, error? }, ...] }
 *
 *   client → server: { id, type: "mcp.call_tool",
 *                     serverName, toolName, params? }
 *   result.shape: whatever `MCPClientManager.callTool()` returns (passthrough).
 *
 * The aggregate path tolerates per-server `listTools()` failures —
 * a single bad server records `{ name, state, error: <message> }`
 * instead of failing the whole frame. The SPA decides how to render.
 *
 * Construction (DI for unit tests):
 *
 *     createMcpListToolsHandler({ mcpManager })
 *     createMcpCallToolHandler({ mcpManager })
 *
 * `mcpManager` is captured by reference — so passing the live `app.mcpManager`
 * from main works even if it's null when registered (MCP disabled). Each
 * call re-checks at call time and throws `mcp_unavailable` if still null,
 * which gives ws-cli-loader an envelope error instead of a crash.
 */

/** Trim a tool to the fields the SPA will actually render. */
function shapeTool(tool) {
  if (!tool || typeof tool !== "object") {
    return null;
  }
  return {
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: tool.inputSchema ?? null,
  };
}

/** Trim an MCP resource to the fields the SPA needs. */
function shapeResource(resource) {
  if (!resource || typeof resource !== "object") {
    return null;
  }
  return {
    uri: resource.uri,
    name: resource.name ?? null,
    description: resource.description ?? "",
    mimeType: resource.mimeType ?? null,
  };
}

function getManager(options) {
  const mgr = options.mcpManager;
  if (!mgr) {
    throw new Error("mcp_unavailable");
  }
  return mgr;
}

/**
 * Build the `mcp.list_tools` topic handler.
 *
 * @param {{ mcpManager: object | null }} options
 * @returns {(frame: any) => Promise<object>}
 */
function createMcpListToolsHandler(options = {}) {
  return async function mcpListToolsHandler(frame) {
    const mgr = getManager(options);

    if (frame?.serverName) {
      const name = String(frame.serverName);
      const tools = await mgr.listTools(name);
      const info = mgr.getServerInfo(name);
      return {
        server: {
          name,
          state: info?.state ?? null,
          tools: Array.isArray(tools)
            ? tools.map(shapeTool).filter(Boolean)
            : [],
        },
      };
    }

    const connected = mgr.getConnectedServers() || [];
    const servers = await Promise.all(
      connected.map(async (name) => {
        try {
          const tools = await mgr.listTools(name);
          const info = mgr.getServerInfo(name);
          return {
            name,
            state: info?.state ?? null,
            tools: Array.isArray(tools)
              ? tools.map(shapeTool).filter(Boolean)
              : [],
          };
        } catch (err) {
          // Per-server failure must not break the aggregate — surface it
          // alongside the healthy servers.
          let state = null;
          try {
            state = mgr.getServerInfo(name)?.state ?? null;
          } catch {
            // getServerInfo can throw "Server not found" — leave state null.
          }
          return {
            name,
            state,
            tools: [],
            error: err?.message ?? String(err),
          };
        }
      }),
    );
    return { servers };
  };
}

/**
 * Build the `mcp.call_tool` topic handler.
 *
 * @param {{ mcpManager: object | null }} options
 * @returns {(frame: any) => Promise<object>}
 */
function createMcpCallToolHandler(options = {}) {
  return async function mcpCallToolHandler(frame) {
    const mgr = getManager(options);
    const serverName = frame?.serverName;
    const toolName = frame?.toolName;
    if (typeof serverName !== "string" || !serverName) {
      throw new Error("server_name_required");
    }
    if (typeof toolName !== "string" || !toolName) {
      throw new Error("tool_name_required");
    }
    const params =
      frame?.params && typeof frame.params === "object" ? frame.params : {};
    return mgr.callTool(serverName, toolName, params);
  };
}

/**
 * Build the `mcp.list_resources` topic handler. Same aggregate-or-single
 * shape as `mcp.list_tools`:
 *   serverName given → { server: { name, state, resources:[...] } }
 *   omitted          → { servers: [{ name, state, resources, error? }, ...] }
 *
 * Per-server failures in the aggregate path are isolated into `{error}` so
 * one disconnected server can't blank out the SPA's resource browser.
 *
 * @param {{ mcpManager: object | null }} options
 * @returns {(frame: any) => Promise<object>}
 */
function createMcpListResourcesHandler(options = {}) {
  return async function mcpListResourcesHandler(frame) {
    const mgr = getManager(options);

    if (frame?.serverName) {
      const name = String(frame.serverName);
      const resources = await mgr.listResources(name);
      const info = mgr.getServerInfo(name);
      return {
        server: {
          name,
          state: info?.state ?? null,
          resources: Array.isArray(resources)
            ? resources.map(shapeResource).filter(Boolean)
            : [],
        },
      };
    }

    const connected = mgr.getConnectedServers() || [];
    const servers = await Promise.all(
      connected.map(async (name) => {
        try {
          const resources = await mgr.listResources(name);
          const info = mgr.getServerInfo(name);
          return {
            name,
            state: info?.state ?? null,
            resources: Array.isArray(resources)
              ? resources.map(shapeResource).filter(Boolean)
              : [],
          };
        } catch (err) {
          let state = null;
          try {
            state = mgr.getServerInfo(name)?.state ?? null;
          } catch {
            // getServerInfo throws "Server not found" on disconnected servers.
          }
          return {
            name,
            state,
            resources: [],
            error: err?.message ?? String(err),
          };
        }
      }),
    );
    return { servers };
  };
}

/**
 * Build the `mcp.read_resource` topic handler.
 *
 *   client → server: { id, type: "mcp.read_resource", serverName, uri }
 *   result.shape: passthrough of `MCPClientManager.readResource()` —
 *     typically `{ contents: [{ uri, mimeType, text|blob }] }`.
 *
 * @param {{ mcpManager: object | null }} options
 * @returns {(frame: any) => Promise<object>}
 */
function createMcpReadResourceHandler(options = {}) {
  return async function mcpReadResourceHandler(frame) {
    const mgr = getManager(options);
    const serverName = frame?.serverName;
    const uri = frame?.uri;
    if (typeof serverName !== "string" || !serverName) {
      throw new Error("server_name_required");
    }
    if (typeof uri !== "string" || !uri) {
      throw new Error("uri_required");
    }
    return mgr.readResource(serverName, uri);
  };
}

/**
 * Build the `mcp.list_servers` topic handler.
 *
 * Returns the list of CONFIGURED MCP servers from `.chainlesschain/config.json`
 * (the source of truth users edit via Settings → MCP). Distinct from
 * mcp.list_tools, which only enumerates CONNECTED servers — a server can be
 * configured but disconnected, and we want the dashboard count to reflect
 * intent, not connection state.
 *
 *   client → server: { id, type: "mcp.list_servers" }
 *   result.shape: { servers: [{ name, command?, url?, transport?, autoConnect? }, ...] }
 *
 * Required so the dashboard's MCP-count widget no longer has to shell out to
 * `cc mcp servers --json` (which reads a different db under the CLI's userData
 * dir and was returning 0 even when desktop config has 9 servers).
 *
 * @param {{ mcpConfigLoader: object | null }} options
 * @returns {(frame: any) => Promise<object>}
 */
function createMcpListServersHandler(options = {}) {
  return async function mcpListServersHandler() {
    const loader = options.mcpConfigLoader;
    if (!loader || !loader.config) {
      return { servers: [] };
    }
    const map = loader.config.servers || {};
    const servers = Object.entries(map).map(([name, cfg]) => ({
      name,
      command: cfg?.command ?? null,
      url: cfg?.url ?? null,
      transport: cfg?.transport ?? null,
      autoConnect: !!cfg?.autoConnect,
    }));
    return { servers };
  };
}

module.exports = {
  createMcpListToolsHandler,
  createMcpCallToolHandler,
  createMcpListResourcesHandler,
  createMcpReadResourceHandler,
  createMcpListServersHandler,
  shapeTool,
  shapeResource,
};
