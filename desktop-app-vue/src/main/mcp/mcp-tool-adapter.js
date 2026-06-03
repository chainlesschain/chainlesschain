/**
 * MCP Tool Adapter
 *
 * Bridges between MCP servers and ChainlessChain's ToolManager.
 * Converts MCP tool definitions to ChainlessChain format and proxies execution.
 *
 * @module MCPToolAdapter
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");

/**
 * @typedef {Object} ChainlessChainTool
 * @property {string} id - Tool ID
 * @property {string} name - Tool name
 * @property {string} display_name - Display name
 * @property {string} description - Tool description
 * @property {string} category - Tool category
 * @property {string} tool_type - Tool type
 * @property {Object} parameters_schema - JSON Schema for parameters
 * @property {Object} return_schema - JSON Schema for return values
 * @property {boolean} is_builtin - Is built-in tool
 * @property {string} plugin_id - Plugin ID
 */

class MCPToolAdapter extends EventEmitter {
  constructor(toolManager, mcpClientManager, securityPolicy = null) {
    super();

    this.toolManager = toolManager;
    this.mcpClientManager = mcpClientManager;
    this.securityPolicy = securityPolicy;

    // Track which tools came from which MCP server
    // toolId -> { serverName, originalToolName }
    this.mcpToolRegistry = new Map();

    // Server name -> tool IDs
    this.serverTools = new Map();

    logger.info("[MCPToolAdapter] Initialized");
  }

  /**
   * Initialize and auto-connect configured MCP servers
   * @param {Object} config - MCP configuration from .chainlesschain/config.json
   */
  async initializeServers(config) {
    try {
      logger.info("[MCPToolAdapter] Initializing MCP servers...");

      if (!config || !config.servers) {
        logger.info("[MCPToolAdapter] No MCP servers configured");
        return;
      }

      const connectPromises = [];

      for (const [serverName, serverConfig] of Object.entries(config.servers)) {
        if (!serverConfig.enabled) {
          logger.info(
            `[MCPToolAdapter] Server ${serverName} is disabled, skipping`,
          );
          continue;
        }

        if (!serverConfig.autoConnect) {
          logger.info(
            `[MCPToolAdapter] Server ${serverName} has autoConnect=false, skipping`,
          );
          continue;
        }

        // Connect and register tools
        connectPromises.push(
          this.registerMCPServerTools(serverName, serverConfig).catch((err) => {
            logger.error(
              `[MCPToolAdapter] Failed to initialize ${serverName}:`,
              err,
            );
            // Continue with other servers even if one fails
          }),
        );
      }

      await Promise.all(connectPromises);

      logger.info(
        `[MCPToolAdapter] Initialization complete. Registered tools from ${connectPromises.length} servers`,
      );
    } catch (error) {
      logger.error("[MCPToolAdapter] Error initializing servers:", error);
      throw error;
    }
  }

  /**
   * Register all tools from an MCP server with ToolManager
   * @param {string} serverName - Server identifier
   * @param {Object} serverConfig - Server configuration
   * @returns {Promise<string[]>} Array of registered tool IDs
   */
  async registerMCPServerTools(serverName, serverConfig) {
    try {
      logger.info(
        `[MCPToolAdapter] Registering tools from server: ${serverName}`,
      );

      // Connect to MCP server
      const capabilities = await this.mcpClientManager.connectServer(
        serverName,
        serverConfig,
      );

      const toolIds = [];

      // Register each tool
      for (const mcpTool of capabilities.tools) {
        try {
          const toolId = await this._registerSingleTool(serverName, mcpTool);
          toolIds.push(toolId);
        } catch (err) {
          logger.error(
            `[MCPToolAdapter] Failed to register tool ${mcpTool.name}:`,
            err,
          );
          // Continue with other tools
        }
      }

      // Track server -> tools mapping
      this.serverTools.set(serverName, toolIds);

      logger.info(
        `[MCPToolAdapter] Registered ${toolIds.length} tools from ${serverName}`,
      );

      this.emit("server-registered", { serverName, toolIds });

      return toolIds;
    } catch (error) {
      logger.error(
        `[MCPToolAdapter] Failed to register server ${serverName}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Unregister all tools from an MCP server
   * @param {string} serverName - Server identifier
   */
  async unregisterMCPServerTools(serverName) {
    try {
      logger.info(
        `[MCPToolAdapter] Unregistering tools from server: ${serverName}`,
      );

      const toolIds = this.serverTools.get(serverName) || [];

      for (const toolId of toolIds) {
        try {
          await this.toolManager.unregisterTool(toolId);
          this.mcpToolRegistry.delete(toolId);
        } catch (err) {
          logger.error(
            `[MCPToolAdapter] Failed to unregister tool ${toolId}:`,
            err,
          );
        }
      }

      this.serverTools.delete(serverName);

      // Disconnect from MCP server
      await this.mcpClientManager.disconnectServer(serverName);

      logger.info(
        `[MCPToolAdapter] Unregistered ${toolIds.length} tools from ${serverName}`,
      );

      this.emit("server-unregistered", { serverName });
    } catch (error) {
      logger.error(
        `[MCPToolAdapter] Failed to unregister server ${serverName}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get list of all MCP tools
   * @returns {Object[]} Array of MCP tool info
   */
  getMCPTools() {
    const tools = [];

    for (const [toolId, info] of this.mcpToolRegistry.entries()) {
      tools.push({
        toolId,
        serverName: info.serverName,
        originalToolName: info.originalToolName,
      });
    }

    return tools;
  }

  /**
   * Check if a tool is from MCP
   * @param {string} toolId - Tool ID
   * @returns {boolean} True if tool is from MCP
   */
  isMCPTool(toolId) {
    return this.mcpToolRegistry.has(toolId);
  }

  /**
   * Get MCP server name for a tool
   * @param {string} toolId - Tool ID
   * @returns {string|null} Server name or null if not MCP tool
   */
  getToolServer(toolId) {
    const info = this.mcpToolRegistry.get(toolId);
    return info ? info.serverName : null;
  }

  /**
   * Refresh tools from a server (re-fetch and update)
   * @param {string} serverName - Server identifier
   */
  async refreshServerTools(serverName) {
    try {
      logger.info(`[MCPToolAdapter] Refreshing tools from ${serverName}`);

      // Get updated tool list
      const tools = await this.mcpClientManager.listTools(serverName);

      // Get currently registered tools
      const currentToolIds = this.serverTools.get(serverName) || [];

      // Build set of current tool names
      const currentToolNames = new Set();
      for (const toolId of currentToolIds) {
        const info = this.mcpToolRegistry.get(toolId);
        if (info) {
          currentToolNames.add(info.originalToolName);
        }
      }

      // Find new tools to add
      const newTools = tools.filter((t) => !currentToolNames.has(t.name));

      // Register new tools
      for (const mcpTool of newTools) {
        try {
          const toolId = await this._registerSingleTool(serverName, mcpTool);
          currentToolIds.push(toolId);
        } catch (err) {
          logger.error(
            `[MCPToolAdapter] Failed to register new tool ${mcpTool.name}:`,
            err,
          );
        }
      }

      this.serverTools.set(serverName, currentToolIds);

      logger.info(
        `[MCPToolAdapter] Refreshed ${serverName}: added ${newTools.length} new tools`,
      );
    } catch (error) {
      logger.error(
        `[MCPToolAdapter] Failed to refresh server ${serverName}:`,
        error,
      );
      throw error;
    }
  }

  // ===================================
  // Private Methods
  // ===================================

  /**
   * Register a single MCP tool with ToolManager
   * @private
   */
  async _registerSingleTool(serverName, mcpTool) {
    // Convert MCP tool to ChainlessChain format
    const chainlessChainTool = this._convertMCPToolFormat(serverName, mcpTool);

    // Use deterministic ID based on tool name to enable upsert behavior
    // This ensures ON CONFLICT(id) DO UPDATE works correctly
    const toolId = `mcp_${serverName}_${mcpTool.name}`;
    chainlessChainTool.id = toolId;

    // Create handler function that proxies to MCP server
    const handler = async (params) => {
      return await this._executeMCPTool(serverName, mcpTool.name, params);
    };

    // Register with ToolManager (will upsert if tool already exists)
    await this.toolManager.registerTool(chainlessChainTool, handler);

    // Track MCP tool mapping
    this.mcpToolRegistry.set(toolId, {
      serverName,
      originalToolName: mcpTool.name,
    });

    logger.info(
      `[MCPToolAdapter] Registered MCP tool: ${chainlessChainTool.name} -> ${toolId}`,
    );

    return toolId;
  }

  /**
   * Convert MCP tool definition to ChainlessChain format
   * @private
   */
  _convertMCPToolFormat(serverName, mcpTool) {
    return {
      // Use mcp_ prefix to avoid name conflicts
      name: `mcp_${serverName}_${mcpTool.name}`,
      display_name: `${mcpTool.name} (MCP)`,
      description: mcpTool.description || `MCP tool from ${serverName}`,
      category: "mcp",
      tool_type: "mcp-proxy",

      // MCP uses JSON Schema for input
      parameters_schema: mcpTool.inputSchema || {
        type: "object",
        properties: {},
        required: [],
      },

      // MCP doesn't define return schema, use generic
      return_schema: {
        type: "object",
        properties: {
          content: {
            type: "array",
            description: "MCP result content",
          },
          isError: {
            type: "boolean",
            description: "Whether the result is an error",
          },
        },
      },

      is_builtin: 0,
      plugin_id: `mcp-server-${serverName}`,

      // Add metadata to identify as MCP tool
      config: JSON.stringify({
        mcpServer: serverName,
        originalToolName: mcpTool.name,
        isMCPTool: true,
      }),

      examples: [],
    };
  }

  /**
   * Execute an MCP tool with security checks
   * @private
   */
  async _executeMCPTool(serverName, toolName, params) {
    try {
      // Apply security policy if configured
      if (this.securityPolicy) {
        await this.securityPolicy.validateToolExecution(
          serverName,
          toolName,
          params,
        );
      }

      // Call MCP server
      const result = await this.mcpClientManager.callTool(
        serverName,
        toolName,
        params,
      );

      // MCP returns { content: [...], isError: boolean }
      // Transform to ChainlessChain expected format
      return this._transformMCPResult(result);
    } catch (error) {
      logger.error(`[MCPToolAdapter] MCP tool execution failed:`, error);

      // Wrap error in standard format
      return {
        success: false,
        error: error.message,
        mcpError: true,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Transform MCP result to ChainlessChain format
   * @private
   */
  _transformMCPResult(mcpResult) {
    // MCP result format: { content: [{ type, text/data }], isError }

    if (mcpResult.isError) {
      return {
        success: false,
        error: this._extractErrorMessage(mcpResult.content),
        mcpResult: mcpResult,
        timestamp: Date.now(),
      };
    }

    // Extract text/data from content array
    const extractedData = this._extractContent(mcpResult.content);

    return {
      success: true,
      data: extractedData,
      mcpResult: mcpResult, // Keep original for debugging
      timestamp: Date.now(),
    };
  }

  /**
   * Extract content from MCP content array
   * @private
   */
  _extractContent(content) {
    if (!Array.isArray(content)) {
      return content;
    }

    // If single item, return its value directly
    if (content.length === 1) {
      const item = content[0];
      return item.text || item.data || item;
    }

    // Multiple items: combine text or return array
    const texts = content.filter((c) => c.type === "text").map((c) => c.text);
    if (texts.length > 0) {
      return texts.join("\n");
    }

    // Return array of data
    return content.map((c) => c.data || c);
  }

  /**
   * Extract error message from MCP error content
   * @private
   */
  _extractErrorMessage(content) {
    if (!Array.isArray(content)) {
      return String(content);
    }

    const errorTexts = content
      .filter((c) => c.type === "text")
      .map((c) => c.text);

    return errorTexts.join("\n") || "MCP tool execution failed";
  }
}

module.exports = { MCPToolAdapter };
