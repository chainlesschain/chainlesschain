/**
 * MCP Client Manager
 *
 * Manages lifecycle of MCP (Model Context Protocol) server connections.
 * Handles server discovery, capability negotiation, and tool execution routing.
 * Supports both stdio (local) and HTTP+SSE (remote) transports.
 *
 * @module MCPClientManager
 */

const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  StdioClientTransport,
} = require("@modelcontextprotocol/sdk/client/stdio.js");
const { HttpSseTransport } = require("./transports/http-sse-transport");
const EventEmitter = require("events");
const { spawn } = require("child_process");

/**
 * Transport types
 */
const TRANSPORT_TYPES = {
  STDIO: "stdio",
  HTTP_SSE: "http-sse",
};

/**
 * @typedef {Object} ServerConfig
 * @property {string} name - Server identifier
 * @property {string} transport - Transport type: 'stdio' or 'http-sse'
 * @property {string} command - Command to launch server (stdio only)
 * @property {string[]} args - Command arguments (stdio only)
 * @property {string} baseURL - Base URL for HTTP+SSE transport
 * @property {string} apiKey - API key for authentication (HTTP+SSE only)
 * @property {boolean} autoConnect - Auto-connect on initialization
 * @property {Object} permissions - Permission configuration
 */

/**
 * @typedef {Object} MCPTool
 * @property {string} name - Tool name
 * @property {string} description - Tool description
 * @property {Object} inputSchema - JSON Schema for parameters
 */

class MCPClientManager extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = config;

    // Server name -> { client, transport, tools, resources, state }
    this.servers = new Map();

    // Performance tracking
    this.metrics = {
      connectionTimes: new Map(), // serverName -> ms
      toolCallLatencies: new Map(), // toolName -> [ms]
      errorCounts: new Map(), // serverName -> count
      totalCalls: 0,
      successfulCalls: 0,
    };

    // Connection states
    this.STATES = {
      DISCONNECTED: "disconnected",
      CONNECTING: "connecting",
      CONNECTED: "connected",
      ERROR: "error",
    };

    console.log("[MCPClientManager] Initialized");
  }

  /**
   * Connect to an MCP server
   * @param {string} serverName - Server identifier
   * @param {ServerConfig} serverConfig - Server configuration
   * @returns {Promise<Object>} Server capabilities (tools, resources, prompts)
   */
  async connectServer(serverName, serverConfig) {
    const startTime = Date.now();

    try {
      console.log(`[MCPClientManager] Connecting to server: ${serverName}`);

      // Check if already connected
      if (this.servers.has(serverName)) {
        const existing = this.servers.get(serverName);
        if (existing.state === this.STATES.CONNECTED) {
          console.log(
            `[MCPClientManager] Server ${serverName} already connected`,
          );
          return {
            tools: existing.tools || [],
            resources: existing.resources || [],
            prompts: existing.prompts || [],
          };
        }
      }

      // Create MCP client
      const client = new Client(
        {
          name: "chainlesschain-desktop",
          version: "0.16.0",
        },
        {
          capabilities: {
            // What capabilities our client supports
            experimental: {},
            sampling: {}, // Support for server-initiated LLM sampling
          },
        },
      );

      // Set up event handlers
      this._setupClientHandlers(client, serverName);

      // Create transport based on type
      const transportType = serverConfig.transport || TRANSPORT_TYPES.STDIO;
      let transport;

      if (transportType === TRANSPORT_TYPES.HTTP_SSE) {
        // HTTP+SSE transport for remote servers
        console.log(
          `[MCPClientManager] Using HTTP+SSE transport for ${serverName}`,
        );
        transport = new HttpSseTransport({
          baseURL: serverConfig.baseURL,
          apiKey: serverConfig.apiKey,
          headers: serverConfig.headers || {},
          timeout: serverConfig.timeout || 30000,
          useSSL: serverConfig.baseURL?.startsWith("https") || false,
          maxRetries: serverConfig.maxRetries || 3,
        });

        // Setup HTTP+SSE event handlers
        this._setupHttpSseHandlers(transport, serverName);

        // Start the transport
        await transport.start();

        // For HTTP+SSE, we need to use a custom connection approach
        // The SDK's Client doesn't directly support HttpSseTransport
        // So we wrap the transport in a compatible interface
        await this._connectWithHttpSse(client, transport, serverName);
      } else {
        // Default: stdio transport for local servers
        console.log(
          `[MCPClientManager] Using stdio transport for ${serverName}`,
        );
        transport = new StdioClientTransport({
          command: serverConfig.command,
          args: serverConfig.args,
          env: {
            ...process.env,
            // Add any custom environment variables
            CHAINLESSCHAIN_DATA_PATH: serverConfig.dataPath || process.cwd(),
          },
        });

        // Connect to server
        await client.connect(transport);
      }

      console.log(`[MCPClientManager] Connected to ${serverName}`);

      // Fetch server capabilities
      const capabilities = await this._fetchCapabilities(client, serverName);

      // Store server info
      this.servers.set(serverName, {
        client,
        transport,
        config: serverConfig,
        state: this.STATES.CONNECTED,
        connectedAt: Date.now(),
        ...capabilities,
      });

      // Track connection time
      const connectionTime = Date.now() - startTime;
      this.metrics.connectionTimes.set(serverName, connectionTime);

      console.log(
        `[MCPClientManager] Server ${serverName} ready (${connectionTime}ms)`,
      );
      console.log(`  Tools: ${capabilities.tools.length}`);
      console.log(`  Resources: ${capabilities.resources.length}`);
      console.log(`  Prompts: ${capabilities.prompts.length}`);

      this.emit("server-connected", {
        serverName,
        capabilities,
        connectionTime,
      });

      return capabilities;
    } catch (error) {
      console.error(
        `[MCPClientManager] Failed to connect to ${serverName}:`,
        error,
      );

      this.servers.set(serverName, {
        state: this.STATES.ERROR,
        error: error.message,
        lastError: Date.now(),
      });

      this.metrics.errorCounts.set(
        serverName,
        (this.metrics.errorCounts.get(serverName) || 0) + 1,
      );

      this.emit("server-error", { serverName, error });

      throw error;
    }
  }

  /**
   * Disconnect from an MCP server
   * @param {string} serverName - Server identifier
   */
  async disconnectServer(serverName) {
    try {
      console.log(
        `[MCPClientManager] Disconnecting from server: ${serverName}`,
      );

      const server = this.servers.get(serverName);
      if (!server) {
        console.warn(`[MCPClientManager] Server ${serverName} not found`);
        return;
      }

      if (server.client) {
        await server.client.close();
      }

      this.servers.delete(serverName);
      console.log(`[MCPClientManager] Server ${serverName} disconnected`);

      this.emit("server-disconnected", { serverName });
    } catch (error) {
      console.error(
        `[MCPClientManager] Error disconnecting from ${serverName}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * List all tools available from a server
   * @param {string} serverName - Server identifier
   * @returns {Promise<MCPTool[]>} List of available tools
   */
  async listTools(serverName) {
    const server = this._getConnectedServer(serverName);

    try {
      const response = await server.client.listTools();

      // Update cached tools
      server.tools = response.tools || [];

      return server.tools;
    } catch (error) {
      console.error(
        `[MCPClientManager] Failed to list tools from ${serverName}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * List all resources available from a server
   * @param {string} serverName - Server identifier
   * @returns {Promise<Object[]>} List of available resources
   */
  async listResources(serverName) {
    const server = this._getConnectedServer(serverName);

    try {
      const response = await server.client.listResources();

      // Update cached resources
      server.resources = response.resources || [];

      return server.resources;
    } catch (error) {
      console.error(
        `[MCPClientManager] Failed to list resources from ${serverName}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Call a tool on an MCP server
   * @param {string} serverName - Server identifier
   * @param {string} toolName - Tool name
   * @param {Object} params - Tool parameters
   * @returns {Promise<Object>} Tool execution result
   */
  async callTool(serverName, toolName, params = {}) {
    const startTime = Date.now();
    const server = this._getConnectedServer(serverName);

    try {
      this.metrics.totalCalls++;

      console.log(`[MCPClientManager] Calling tool: ${serverName}.${toolName}`);
      console.log(`  Parameters:`, JSON.stringify(params, null, 2));

      const result = await server.client.callTool({
        name: toolName,
        arguments: params,
      });

      // Track latency
      const latency = Date.now() - startTime;
      if (!this.metrics.toolCallLatencies.has(toolName)) {
        this.metrics.toolCallLatencies.set(toolName, []);
      }
      this.metrics.toolCallLatencies.get(toolName).push(latency);

      this.metrics.successfulCalls++;

      console.log(`[MCPClientManager] Tool call successful (${latency}ms)`);

      this.emit("tool-called", {
        serverName,
        toolName,
        params,
        latency,
        result,
      });

      return result;
    } catch (error) {
      const latency = Date.now() - startTime;

      console.error(
        `[MCPClientManager] Tool call failed (${latency}ms):`,
        error,
      );

      this.metrics.errorCounts.set(
        serverName,
        (this.metrics.errorCounts.get(serverName) || 0) + 1,
      );

      this.emit("tool-error", { serverName, toolName, params, latency, error });

      throw error;
    }
  }

  /**
   * Read a resource from an MCP server
   * @param {string} serverName - Server identifier
   * @param {string} resourceUri - Resource URI
   * @returns {Promise<Object>} Resource content
   */
  async readResource(serverName, resourceUri) {
    const server = this._getConnectedServer(serverName);

    try {
      console.log(`[MCPClientManager] Reading resource: ${resourceUri}`);

      const result = await server.client.readResource({
        uri: resourceUri,
      });

      console.log(`[MCPClientManager] Resource read successfully`);

      return result;
    } catch (error) {
      console.error(`[MCPClientManager] Failed to read resource:`, error);
      throw error;
    }
  }

  /**
   * Get list of connected servers
   * @returns {string[]} List of server names
   */
  getConnectedServers() {
    return Array.from(this.servers.entries())
      .filter(([_, server]) => server.state === this.STATES.CONNECTED)
      .map(([name, _]) => name);
  }

  /**
   * Get server info
   * @param {string} serverName - Server identifier
   * @returns {Object} Server information
   */
  getServerInfo(serverName) {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`Server not found: ${serverName}`);
    }

    return {
      name: serverName,
      state: server.state,
      connectedAt: server.connectedAt,
      toolCount: server.tools?.length || 0,
      resourceCount: server.resources?.length || 0,
      promptCount: server.prompts?.length || 0,
      errorCount: this.metrics.errorCounts.get(serverName) || 0,
    };
  }

  /**
   * Get performance metrics
   * @returns {Object} Performance statistics
   */
  getMetrics() {
    // Calculate average latencies
    const avgLatencies = {};
    for (const [
      toolName,
      latencies,
    ] of this.metrics.toolCallLatencies.entries()) {
      const sum = latencies.reduce((a, b) => a + b, 0);
      avgLatencies[toolName] = {
        avg: (sum / latencies.length).toFixed(2),
        min: Math.min(...latencies),
        max: Math.max(...latencies),
        p95: this._percentile(latencies, 95),
        count: latencies.length,
      };
    }

    return {
      totalCalls: this.metrics.totalCalls,
      successfulCalls: this.metrics.successfulCalls,
      failedCalls: this.metrics.totalCalls - this.metrics.successfulCalls,
      successRate:
        (
          (this.metrics.successfulCalls / this.metrics.totalCalls) *
          100
        ).toFixed(2) + "%",
      connectionTimes: Object.fromEntries(this.metrics.connectionTimes),
      toolLatencies: avgLatencies,
      errorCounts: Object.fromEntries(this.metrics.errorCounts),
    };
  }

  /**
   * Shutdown all connections
   */
  async shutdown() {
    console.log("[MCPClientManager] Shutting down all connections...");

    const disconnectPromises = [];
    for (const [serverName, _] of this.servers) {
      disconnectPromises.push(
        this.disconnectServer(serverName).catch((err) => {
          console.error(`Error disconnecting ${serverName}:`, err);
        }),
      );
    }

    await Promise.all(disconnectPromises);

    console.log("[MCPClientManager] All connections closed");
  }

  // ===================================
  // Private Methods
  // ===================================

  /**
   * Fetch server capabilities
   * @private
   */
  async _fetchCapabilities(client, serverName) {
    try {
      const [toolsResponse, resourcesResponse, promptsResponse] =
        await Promise.all([
          client.listTools().catch((err) => {
            console.warn(
              `Failed to list tools from ${serverName}:`,
              err.message,
            );
            return { tools: [] };
          }),
          client.listResources().catch((err) => {
            console.warn(
              `Failed to list resources from ${serverName}:`,
              err.message,
            );
            return { resources: [] };
          }),
          client.listPrompts().catch((err) => {
            console.warn(
              `Failed to list prompts from ${serverName}:`,
              err.message,
            );
            return { prompts: [] };
          }),
        ]);

      return {
        tools: toolsResponse.tools || [],
        resources: resourcesResponse.resources || [],
        prompts: promptsResponse.prompts || [],
      };
    } catch (error) {
      console.error(`[MCPClientManager] Error fetching capabilities:`, error);
      return {
        tools: [],
        resources: [],
        prompts: [],
      };
    }
  }

  /**
   * Setup client event handlers
   * @private
   */
  _setupClientHandlers(client, serverName) {
    // Handle server notifications
    client.setNotificationHandler((notification) => {
      console.log(
        `[MCPClientManager] Notification from ${serverName}:`,
        notification,
      );
      this.emit("server-notification", { serverName, notification });
    });

    // Handle logging from server
    client.setLoggingHandler((log) => {
      console.log(
        `[MCPClientManager] Log from ${serverName} [${log.level}]:`,
        log.data,
      );
      this.emit("server-log", { serverName, log });
    });
  }

  /**
   * Get a connected server or throw error
   * @private
   */
  _getConnectedServer(serverName) {
    const server = this.servers.get(serverName);

    if (!server) {
      throw new Error(`Server not found: ${serverName}`);
    }

    if (server.state !== this.STATES.CONNECTED) {
      throw new Error(
        `Server ${serverName} is not connected (state: ${server.state})`,
      );
    }

    return server;
  }

  /**
   * Calculate percentile
   * @private
   */
  _percentile(arr, p) {
    if (arr.length === 0) return 0;

    const sorted = arr.slice().sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;

    return sorted[index];
  }

  /**
   * Setup HTTP+SSE transport event handlers
   * @private
   */
  _setupHttpSseHandlers(transport, serverName) {
    transport.on("connected", () => {
      console.log(`[MCPClientManager] HTTP+SSE connected to ${serverName}`);
    });

    transport.on("disconnected", () => {
      console.log(
        `[MCPClientManager] HTTP+SSE disconnected from ${serverName}`,
      );
      const server = this.servers.get(serverName);
      if (server) {
        server.state = this.STATES.DISCONNECTED;
      }
      this.emit("server-disconnected", { serverName, transport: "http-sse" });
    });

    transport.on("reconnected", () => {
      console.log(`[MCPClientManager] HTTP+SSE reconnected to ${serverName}`);
      const server = this.servers.get(serverName);
      if (server) {
        server.state = this.STATES.CONNECTED;
      }
      this.emit("server-reconnected", { serverName, transport: "http-sse" });
    });

    transport.on("error", (error) => {
      console.error(
        `[MCPClientManager] HTTP+SSE error from ${serverName}:`,
        error,
      );
      this.metrics.errorCounts.set(
        serverName,
        (this.metrics.errorCounts.get(serverName) || 0) + 1,
      );
      this.emit("server-error", { serverName, error, transport: "http-sse" });
    });

    transport.on("notification", (notification) => {
      console.log(
        `[MCPClientManager] HTTP+SSE notification from ${serverName}:`,
        notification,
      );
      this.emit("server-notification", { serverName, notification });
    });
  }

  /**
   * Connect using HTTP+SSE transport
   * This creates a bridge between the MCP SDK client and our HTTP+SSE transport
   * @private
   */
  async _connectWithHttpSse(client, transport, serverName) {
    // Create a transport adapter that bridges HTTP+SSE to the MCP SDK interface
    const transportAdapter = {
      start: async () => {
        // Transport already started
        return;
      },
      close: async () => {
        await transport.stop();
      },
      send: async (message) => {
        return await transport.send(message);
      },
    };

    // Override client methods to use our transport
    // This is a workaround since the SDK doesn't natively support HTTP+SSE
    const originalCallTool = client.callTool.bind(client);
    const originalListTools = client.listTools.bind(client);
    const originalListResources = client.listResources.bind(client);
    const originalListPrompts = client.listPrompts.bind(client);
    const originalReadResource = client.readResource.bind(client);

    // Wrap methods to use HTTP+SSE transport
    client.callTool = async (params) => {
      const response = await transport.send({
        jsonrpc: "2.0",
        method: "tools/call",
        params,
      });
      return response;
    };

    client.listTools = async () => {
      const response = await transport.send({
        jsonrpc: "2.0",
        method: "tools/list",
        params: {},
      });
      return response;
    };

    client.listResources = async () => {
      const response = await transport.send({
        jsonrpc: "2.0",
        method: "resources/list",
        params: {},
      });
      return response;
    };

    client.listPrompts = async () => {
      const response = await transport.send({
        jsonrpc: "2.0",
        method: "prompts/list",
        params: {},
      });
      return response;
    };

    client.readResource = async (params) => {
      const response = await transport.send({
        jsonrpc: "2.0",
        method: "resources/read",
        params,
      });
      return response;
    };

    // Store adapter reference for cleanup
    client._httpSseTransport = transport;
    client._transportAdapter = transportAdapter;

    // Initialize the connection by getting server info
    try {
      const serverInfo = await transport.send({
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {
            experimental: {},
            sampling: {},
          },
          clientInfo: {
            name: "chainlesschain-desktop",
            version: "0.16.0",
          },
        },
      });

      console.log(`[MCPClientManager] HTTP+SSE server info:`, serverInfo);

      // Send initialized notification
      await transport.send({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });
    } catch (error) {
      console.warn(
        `[MCPClientManager] HTTP+SSE initialize warning:`,
        error.message,
      );
      // Some servers might not require initialize, continue anyway
    }
  }

  /**
   * Connect to a remote MCP server via HTTP+SSE
   * Convenience method for remote server connections
   * @param {string} serverName - Server identifier
   * @param {Object} config - Remote server configuration
   * @returns {Promise<Object>} Server capabilities
   */
  async connectRemoteServer(serverName, config) {
    return this.connectServer(serverName, {
      ...config,
      transport: TRANSPORT_TYPES.HTTP_SSE,
    });
  }

  /**
   * Check if a server is using HTTP+SSE transport
   * @param {string} serverName - Server identifier
   * @returns {boolean}
   */
  isRemoteServer(serverName) {
    const server = this.servers.get(serverName);
    return server && server.config?.transport === TRANSPORT_TYPES.HTTP_SSE;
  }
}

// Export transport types for external use
MCPClientManager.TRANSPORT_TYPES = TRANSPORT_TYPES;

module.exports = MCPClientManager;
