/**
 * MCP IPC Handlers
 *
 * IPC communication layer between renderer and main process for MCP operations.
 * Provides secure access to MCP servers and tools.
 *
 * @module MCP_IPC
 */

const { logger } = require("../utils/logger.js");
const { ipcMain } = require("electron");

// 跟踪基础配置IPC是否已注册
let basicConfigIPCRegistered = false;

/**
 * Register basic MCP config IPC handlers (always needed, even when MCP is disabled)
 * This allows users to enable/disable MCP through the UI
 */
function registerBasicMCPConfigIPC() {
  if (basicConfigIPCRegistered) {
    logger.info(
      "[MCP IPC] Basic config IPC handlers already registered, skipping",
    );
    return;
  }

  logger.info("[MCP IPC] Registering basic config IPC handlers");

  /**
   * Get MCP configuration (always available)
   */
  ipcMain.handle("mcp:get-config", async () => {
    try {
      const {
        getUnifiedConfigManager,
      } = require("../config/unified-config-manager");
      const configManager = getUnifiedConfigManager();

      const mcpConfig = configManager.getConfig("mcp") || {
        enabled: false,
        servers: {},
      };

      return {
        success: true,
        config: mcpConfig,
      };
    } catch (error) {
      logger.error("[MCP IPC] Failed to get config:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * Update MCP configuration (always available)
   */
  ipcMain.handle("mcp:update-config", async (event, { config }) => {
    try {
      const {
        getUnifiedConfigManager,
      } = require("../config/unified-config-manager");
      const configManager = getUnifiedConfigManager();

      configManager.updateConfig({ mcp: config });

      return {
        success: true,
      };
    } catch (error) {
      logger.error("[MCP IPC] Failed to update config:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * List all available MCP servers from registry (always available)
   */
  ipcMain.handle("mcp:list-servers", async () => {
    try {
      const registry = require("./servers/server-registry.json");
      return {
        success: true,
        servers: registry.trustedServers,
      };
    } catch (error) {
      logger.error("[MCP IPC] Failed to list servers:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  basicConfigIPCRegistered = true;
  logger.info("[MCP IPC] Basic config IPC handlers registered (3 handlers)");
}

/**
 * Register all MCP-related IPC handlers
 * @param {MCPClientManager} mcpManager - MCP client manager instance
 * @param {MCPToolAdapter} mcpAdapter - MCP tool adapter instance
 * @param {MCPSecurityPolicy} securityPolicy - Security policy instance
 */
function registerMCPIPC(mcpManager, mcpAdapter, securityPolicy) {
  logger.info("[MCP IPC] Registering full MCP IPC handlers");

  // 确保基础配置 IPC 已注册
  registerBasicMCPConfigIPC();

  // ==================== Server Management ====================

  /**
   * Get connected servers status
   */
  ipcMain.handle("mcp:get-connected-servers", async () => {
    try {
      const servers = [];

      for (const [serverName, serverData] of mcpManager.servers.entries()) {
        servers.push({
          name: serverName,
          state: serverData.state,
          tools: serverData.tools?.length || 0,
          resources: serverData.resources?.length || 0,
          prompts: serverData.prompts?.length || 0,
        });
      }

      return {
        success: true,
        servers,
      };
    } catch (error) {
      logger.error("[MCP IPC] Failed to get connected servers:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * Connect to an MCP server
   */
  ipcMain.handle(
    "mcp:connect-server",
    async (event, { serverName, config }) => {
      try {
        logger.info(`[MCP IPC] Connecting to server: ${serverName}`);

        // Validate server is in trusted registry
        const registry = require("./servers/server-registry.json");
        const serverInfo = registry.trustedServers.find(
          (s) => s.id === serverName,
        );

        if (!serverInfo) {
          throw new Error(`Server ${serverName} is not in trusted registry`);
        }

        // Security check
        if (serverInfo.securityLevel === "high") {
          const consent = await securityPolicy.requestUserConsent({
            operation: "connect-server",
            serverName,
            securityLevel: serverInfo.securityLevel,
            permissions: serverInfo.requiredPermissions,
          });

          if (!consent) {
            throw new Error("User denied server connection");
          }
        }

        // Connect to server
        const capabilities = await mcpManager.connectServer(serverName, config);

        // Register server permissions with security policy
        if (config && config.permissions) {
          securityPolicy.setServerPermissions(serverName, config.permissions);
          logger.info(`[MCP IPC] Registered permissions for ${serverName}`);
        } else {
          // Set default permissive permissions if none provided
          securityPolicy.setServerPermissions(serverName, {
            allowedPaths: [],
            forbiddenPaths: [],
            readOnly: false,
            requireConsent: true,
          });
          logger.info(`[MCP IPC] Set default permissions for ${serverName}`);
        }

        // Register tools with ToolManager
        await mcpAdapter.registerMCPServerTools(serverName);

        // Serialize capabilities to plain objects for IPC (avoid "object could not be cloned" error)
        const serializableCapabilities = {
          tools: (capabilities.tools || []).map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
          resources: (capabilities.resources || []).map((r) => ({
            uri: r.uri,
            name: r.name,
            description: r.description,
            mimeType: r.mimeType,
          })),
          prompts: (capabilities.prompts || []).map((p) => ({
            name: p.name,
            description: p.description,
            arguments: p.arguments,
          })),
        };

        return {
          success: true,
          capabilities: serializableCapabilities,
        };
      } catch (error) {
        logger.error(`[MCP IPC] Failed to connect to ${serverName}:`, error);
        return {
          success: false,
          error: error.message,
        };
      }
    },
  );

  /**
   * Disconnect from an MCP server
   */
  ipcMain.handle("mcp:disconnect-server", async (event, { serverName }) => {
    try {
      logger.info(`[MCP IPC] Disconnecting from server: ${serverName}`);

      await mcpManager.disconnectServer(serverName);

      return {
        success: true,
      };
    } catch (error) {
      logger.error(`[MCP IPC] Failed to disconnect from ${serverName}:`, error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ==================== Tool Management ====================

  /**
   * List all available tools from MCP servers
   */
  ipcMain.handle("mcp:list-tools", async (event, { serverName }) => {
    try {
      let tools;

      // Helper to serialize tool for IPC
      const serializeTool = (t, srvName = null) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        ...(srvName ? { serverName: srvName } : {}),
      });

      if (serverName) {
        // List tools from specific server
        const rawTools = await mcpManager.listTools(serverName);
        tools = rawTools.map((t) => serializeTool(t));
      } else {
        // List tools from all connected servers
        tools = [];
        for (const [srvName] of mcpManager.servers.entries()) {
          const serverTools = await mcpManager.listTools(srvName);
          tools.push(...serverTools.map((t) => serializeTool(t, srvName)));
        }
      }

      return {
        success: true,
        tools,
      };
    } catch (error) {
      logger.error("[MCP IPC] Failed to list tools:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * Call an MCP tool
   */
  ipcMain.handle(
    "mcp:call-tool",
    async (event, { serverName, toolName, arguments: args }) => {
      try {
        logger.info(`[MCP IPC] Calling tool: ${toolName} on ${serverName}`);

        // Security validation
        const allowed = securityPolicy.validateToolCall(
          serverName,
          toolName,
          args,
        );
        if (!allowed.permitted) {
          throw new Error(
            `Tool call blocked by security policy: ${allowed.reason}`,
          );
        }

        // Execute tool
        const result = await mcpManager.callTool(serverName, toolName, args);

        return {
          success: true,
          result,
        };
      } catch (error) {
        logger.error(`[MCP IPC] Failed to call tool ${toolName}:`, error);
        return {
          success: false,
          error: error.message,
        };
      }
    },
  );

  // ==================== Resource Management ====================

  /**
   * List available resources from MCP servers
   */
  ipcMain.handle("mcp:list-resources", async (event, { serverName }) => {
    try {
      let resources;

      // Helper to serialize resource for IPC
      const serializeResource = (r, srvName = null) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
        ...(srvName ? { serverName: srvName } : {}),
      });

      if (serverName) {
        const rawResources = await mcpManager.listResources(serverName);
        resources = rawResources.map((r) => serializeResource(r));
      } else {
        resources = [];
        for (const [srvName] of mcpManager.servers.entries()) {
          const serverResources = await mcpManager.listResources(srvName);
          resources.push(
            ...serverResources.map((r) => serializeResource(r, srvName)),
          );
        }
      }

      return {
        success: true,
        resources,
      };
    } catch (error) {
      logger.error("[MCP IPC] Failed to list resources:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * Read a resource from an MCP server
   */
  ipcMain.handle(
    "mcp:read-resource",
    async (event, { serverName, resourceUri }) => {
      try {
        logger.info(
          `[MCP IPC] Reading resource: ${resourceUri} from ${serverName}`,
        );

        // Security validation
        const allowed = securityPolicy.validateResourceAccess(
          serverName,
          resourceUri,
        );
        if (!allowed.permitted) {
          throw new Error(`Resource access blocked: ${allowed.reason}`);
        }

        const content = await mcpManager.readResource(serverName, resourceUri);

        return {
          success: true,
          content,
        };
      } catch (error) {
        logger.error(
          `[MCP IPC] Failed to read resource ${resourceUri}:`,
          error,
        );
        return {
          success: false,
          error: error.message,
        };
      }
    },
  );

  // ==================== Performance Monitoring ====================

  /**
   * Get MCP performance metrics
   */
  ipcMain.handle("mcp:get-metrics", async () => {
    try {
      const metrics = {
        ...mcpManager.metrics,
        servers: [],
      };

      for (const [serverName, serverData] of mcpManager.servers.entries()) {
        metrics.servers.push({
          name: serverName,
          state: serverData.state,
          connectionTime:
            mcpManager.metrics.connectionTimes.get(serverName) || 0,
          errorCount: mcpManager.metrics.errorCounts.get(serverName) || 0,
        });
      }

      return {
        success: true,
        metrics,
      };
    } catch (error) {
      logger.error("[MCP IPC] Failed to get metrics:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ==================== Security & Consent ====================
  // Note: mcp:get-config and mcp:update-config are registered in registerBasicMCPConfigIPC()

  /**
   * Handle consent response from renderer
   */
  ipcMain.handle(
    "mcp:consent-response",
    async (event, { requestId, decision }) => {
      try {
        logger.info(`[MCP IPC] Consent response: ${requestId} -> ${decision}`);

        const result = securityPolicy.handleConsentResponse(
          requestId,
          decision,
        );

        return {
          success: result.success,
          allowed: result.allowed,
          error: result.error,
        };
      } catch (error) {
        logger.error("[MCP IPC] Failed to handle consent response:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    },
  );

  /**
   * Get pending consent requests
   */
  ipcMain.handle("mcp:get-pending-consents", async () => {
    try {
      const pending = securityPolicy.getPendingConsentRequests();

      return {
        success: true,
        requests: pending,
      };
    } catch (error) {
      logger.error("[MCP IPC] Failed to get pending consents:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * Cancel a pending consent request
   */
  ipcMain.handle("mcp:cancel-consent", async (event, { requestId }) => {
    try {
      const cancelled = securityPolicy.cancelConsentRequest(requestId);

      return {
        success: cancelled,
        error: cancelled ? null : "Request not found",
      };
    } catch (error) {
      logger.error("[MCP IPC] Failed to cancel consent:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * Clear consent cache
   */
  ipcMain.handle("mcp:clear-consent-cache", async () => {
    try {
      securityPolicy.clearConsentCache();

      return {
        success: true,
      };
    } catch (error) {
      logger.error("[MCP IPC] Failed to clear consent cache:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * Get security statistics
   */
  ipcMain.handle("mcp:get-security-stats", async () => {
    try {
      const stats = securityPolicy.getStatistics();

      return {
        success: true,
        stats,
      };
    } catch (error) {
      logger.error("[MCP IPC] Failed to get security stats:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * Get audit log
   */
  ipcMain.handle("mcp:get-audit-log", async (event, filters = {}) => {
    try {
      const log = securityPolicy.getAuditLog(filters);

      return {
        success: true,
        log,
      };
    } catch (error) {
      logger.error("[MCP IPC] Failed to get audit log:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * Get server config for a specific server
   */
  ipcMain.handle("mcp:get-server-config", async (event, { serverName }) => {
    try {
      const {
        getUnifiedConfigManager,
      } = require("../config/unified-config-manager");
      const configManager = getUnifiedConfigManager();

      const mcpConfig = configManager.getConfig("mcp") || {};
      const serverConfig = mcpConfig.servers?.[serverName] || null;

      return {
        success: true,
        config: serverConfig,
      };
    } catch (error) {
      logger.error("[MCP IPC] Failed to get server config:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * Update server config for a specific server
   */
  ipcMain.handle(
    "mcp:update-server-config",
    async (event, { serverName, config }) => {
      try {
        const {
          getUnifiedConfigManager,
        } = require("../config/unified-config-manager");
        const configManager = getUnifiedConfigManager();

        const mcpConfig = configManager.getConfig("mcp") || { servers: {} };

        // Update server config
        if (!mcpConfig.servers) {
          mcpConfig.servers = {};
        }
        mcpConfig.servers[serverName] = config;

        // Save to config manager
        configManager.updateConfig({ mcp: mcpConfig });

        // Also update security policy permissions if applicable
        if (config.permissions) {
          securityPolicy.setServerPermissions(serverName, config.permissions);
        }

        return {
          success: true,
        };
      } catch (error) {
        logger.error("[MCP IPC] Failed to update server config:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    },
  );

  logger.info("[MCP IPC] All handlers registered successfully");
}

module.exports = { registerMCPIPC, registerBasicMCPConfigIPC };
