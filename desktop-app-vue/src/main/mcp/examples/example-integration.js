/**
 * MCP Integration Example
 *
 * Complete example of integrating MCP into ChainlessChain's main process.
 * This shows how to set up and use MCP in production.
 */

const { logger, createLogger } = require('../../utils/logger.js');
const { MCPClientManager } = require('../mcp-client-manager');
const { MCPToolAdapter } = require('../mcp-tool-adapter');
const { MCPSecurityPolicy } = require('../mcp-security-policy');
const { MCPConfigLoader } = require('../mcp-config-loader');
const MCPPerformanceMonitor = require('../mcp-performance-monitor');

class MCPIntegrationExample {
  constructor(toolManager) {
    this.toolManager = toolManager;

    // Core components
    this.configLoader = null;
    this.securityPolicy = null;
    this.mcpManager = null;
    this.mcpAdapter = null;
    this.performanceMonitor = null;

    this.isInitialized = false;
  }

  /**
   * Initialize MCP system
   */
  async initialize() {
    try {
      logger.info('[MCP] Initializing MCP system...');

      // 1. Load configuration
      this.configLoader = new MCPConfigLoader();
      const config = this.configLoader.load(true); // Enable hot-reload

      if (!config.enabled) {
        logger.info('[MCP] MCP is disabled in configuration');
        return false;
      }

      // 2. Setup security policy
      this.securityPolicy = new MCPSecurityPolicy(config);

      // Configure permissions for each server
      for (const [serverName, serverConfig] of Object.entries(config.servers || {})) {
        if (serverConfig.permissions) {
          this.securityPolicy.setServerPermissions(serverName, serverConfig.permissions);
        }
      }

      // 3. Setup performance monitor
      this.performanceMonitor = new MCPPerformanceMonitor();

      // 4. Create MCP client manager
      this.mcpManager = new MCPClientManager(config);

      // 5. Create tool adapter
      this.mcpAdapter = new MCPToolAdapter(
        this.toolManager,
        this.mcpManager,
        this.securityPolicy
      );

      // 6. Wire up event handlers
      this._setupEventHandlers();

      // 7. Initialize servers and register tools
      await this.mcpAdapter.initializeServers(config);

      this.isInitialized = true;
      logger.info('[MCP] Initialization complete');

      return true;

    } catch (error) {
      logger.error('[MCP] Initialization failed:', error);
      return false;
    }
  }

  /**
   * Setup event handlers
   */
  _setupEventHandlers() {
    // MCP Client Manager events
    this.mcpManager.on('server-connected', ({ serverName, capabilities, connectionTime }) => {
      logger.info(`[MCP] Server connected: ${serverName} (${connectionTime}ms)`);
      this.performanceMonitor.recordConnection(serverName, connectionTime, true);
    });

    this.mcpManager.on('server-error', ({ serverName, error }) => {
      logger.error(`[MCP] Server error: ${serverName}`, error.message);
      this.performanceMonitor.recordError('connection', error, { serverName });
    });

    this.mcpManager.on('tool-called', ({ serverName, toolName, latency, result }) => {
      this.performanceMonitor.recordToolCall(serverName, toolName, latency, true);
    });

    this.mcpManager.on('tool-error', ({ serverName, toolName, latency, error }) => {
      this.performanceMonitor.recordToolCall(serverName, toolName, latency, false);
      this.performanceMonitor.recordError('tool_call', error, { serverName, toolName });
    });

    // Config reload
    this.configLoader.on('config-changed', async ({ changes }) => {
      logger.info('[MCP] Configuration changed:', changes);

      // Handle server additions/removals
      // (Production would implement smart reloading)
    });

    // Security policy events
    this.securityPolicy.on('consent-required', ({ serverName, toolName, callback }) => {
      // In production, this would show a UI dialog
      // For POC, we auto-allow
      logger.warn(`[MCP] User consent required: ${serverName}.${toolName}`);
      callback('allow'); // Auto-allow for POC
    });

    this.securityPolicy.on('audit-log', (entry) => {
      // In production, write to persistent log
      if (entry.decision === 'DENIED') {
        logger.warn(`[MCP] Security: Access denied - ${entry.details}`);
      }
    });

    // Performance monitoring (periodic sample)
    setInterval(() => {
      this.performanceMonitor.sampleMemory();
    }, 60000); // Every minute
  }

  /**
   * Example: Use an MCP tool through ToolManager
   */
  async exampleUseMCPTool() {
    if (!this.isInitialized) {
      throw new Error('MCP not initialized');
    }

    try {
      // MCP tools are registered with ToolManager automatically
      // Call them like any other tool

      const result = await this.toolManager.executeTool('mcp_filesystem_read_file', {
        path: 'notes/example.txt'
      });

      logger.info('[MCP] Tool execution result:', result);

      return result;

    } catch (error) {
      logger.error('[MCP] Tool execution failed:', error);
      throw error;
    }
  }

  /**
   * Example: Directly call MCP server (bypass ToolManager)
   */
  async exampleDirectMCPCall() {
    if (!this.isInitialized) {
      throw new Error('MCP not initialized');
    }

    try {
      // Direct call to MCP server
      const result = await this.mcpManager.callTool('filesystem', 'list_directory', {
        path: 'notes/'
      });

      logger.info('[MCP] Direct call result:', result);

      return result;

    } catch (error) {
      logger.error('[MCP] Direct call failed:', error);
      throw error;
    }
  }

  /**
   * Example: List all available MCP tools
   */
  async exampleListMCPTools() {
    if (!this.isInitialized) {
      throw new Error('MCP not initialized');
    }

    const mcpTools = this.mcpAdapter.getMCPTools();

    logger.info(`[MCP] Available MCP tools: ${mcpTools.length}`);
    mcpTools.forEach(tool => {
      logger.info(`  - ${tool.toolId} (from ${tool.serverName})`);
    });

    return mcpTools;
  }

  /**
   * Example: Get performance metrics
   */
  getPerformanceMetrics() {
    if (!this.performanceMonitor) {
      return null;
    }

    const summary = this.performanceMonitor.getSummary();

    logger.info('[MCP] Performance metrics:');
    logger.info(`  Connections: ${summary.connections.total} (${summary.connections.successRate} success)`);
    logger.info(`  Tool calls: ${summary.toolCalls.total} (${summary.toolCalls.successRate} success)`);
    logger.info(`  Avg connection time: ${summary.connections.avgTime.toFixed(2)}ms`);

    if (summary.baselines.overhead !== null) {
      logger.info(`  stdio overhead: ${summary.baselines.overhead.toFixed(2)}ms`);
    }

    return summary;
  }

  /**
   * Example: Generate performance report
   */
  generatePerformanceReport() {
    if (!this.performanceMonitor) {
      return '';
    }

    return this.performanceMonitor.generateReport();
  }

  /**
   * Example: Get security audit log
   */
  getSecurityAuditLog(filters = {}) {
    if (!this.securityPolicy) {
      return [];
    }

    return this.securityPolicy.getAuditLog(filters);
  }

  /**
   * Shutdown MCP system
   */
  async shutdown() {
    try {
      logger.info('[MCP] Shutting down...');

      if (this.mcpManager) {
        await this.mcpManager.shutdown();
      }

      if (this.configLoader) {
        this.configLoader.stopWatching();
      }

      // Print final performance report
      if (this.performanceMonitor) {
        logger.info(this.performanceMonitor.generateReport());
      }

      logger.info('[MCP] Shutdown complete');

    } catch (error) {
      logger.error('[MCP] Shutdown error:', error);
    }
  }
}

// ===================================
// Usage Example in main/index.js
// ===================================

async function integrateIntoMainProcess(toolManager) {
  const mcpIntegration = new MCPIntegrationExample(toolManager);

  // Initialize during app startup
  const success = await mcpIntegration.initialize();

  if (success) {
    logger.info('[Main] MCP integration successful');

    // Use MCP tools
    try {
      await mcpIntegration.exampleListMCPTools();
      await mcpIntegration.exampleUseMCPTool();
    } catch (error) {
      logger.error('[Main] MCP example failed:', error);
    }

    // Get metrics periodically
    setInterval(() => {
      mcpIntegration.getPerformanceMetrics();
    }, 300000); // Every 5 minutes
  }

  // Handle app shutdown
  process.on('beforeExit', async () => {
    await mcpIntegration.shutdown();
  });

  return mcpIntegration;
}

module.exports = { MCPIntegrationExample, integrateIntoMainProcess };
