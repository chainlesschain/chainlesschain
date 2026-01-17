/**
 * MCP Integration Example
 *
 * Complete example of integrating MCP into ChainlessChain's main process.
 * This shows how to set up and use MCP in production.
 */

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
      console.log('[MCP] Initializing MCP system...');

      // 1. Load configuration
      this.configLoader = new MCPConfigLoader();
      const config = this.configLoader.load(true); // Enable hot-reload

      if (!config.enabled) {
        console.log('[MCP] MCP is disabled in configuration');
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
      console.log('[MCP] Initialization complete');

      return true;

    } catch (error) {
      console.error('[MCP] Initialization failed:', error);
      return false;
    }
  }

  /**
   * Setup event handlers
   */
  _setupEventHandlers() {
    // MCP Client Manager events
    this.mcpManager.on('server-connected', ({ serverName, capabilities, connectionTime }) => {
      console.log(`[MCP] Server connected: ${serverName} (${connectionTime}ms)`);
      this.performanceMonitor.recordConnection(serverName, connectionTime, true);
    });

    this.mcpManager.on('server-error', ({ serverName, error }) => {
      console.error(`[MCP] Server error: ${serverName}`, error.message);
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
      console.log('[MCP] Configuration changed:', changes);

      // Handle server additions/removals
      // (Production would implement smart reloading)
    });

    // Security policy events
    this.securityPolicy.on('consent-required', ({ serverName, toolName, callback }) => {
      // In production, this would show a UI dialog
      // For POC, we auto-allow
      console.warn(`[MCP] User consent required: ${serverName}.${toolName}`);
      callback('allow'); // Auto-allow for POC
    });

    this.securityPolicy.on('audit-log', (entry) => {
      // In production, write to persistent log
      if (entry.decision === 'DENIED') {
        console.warn(`[MCP] Security: Access denied - ${entry.details}`);
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

      console.log('[MCP] Tool execution result:', result);

      return result;

    } catch (error) {
      console.error('[MCP] Tool execution failed:', error);
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

      console.log('[MCP] Direct call result:', result);

      return result;

    } catch (error) {
      console.error('[MCP] Direct call failed:', error);
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

    console.log(`[MCP] Available MCP tools: ${mcpTools.length}`);
    mcpTools.forEach(tool => {
      console.log(`  - ${tool.toolId} (from ${tool.serverName})`);
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

    console.log('[MCP] Performance metrics:');
    console.log(`  Connections: ${summary.connections.total} (${summary.connections.successRate} success)`);
    console.log(`  Tool calls: ${summary.toolCalls.total} (${summary.toolCalls.successRate} success)`);
    console.log(`  Avg connection time: ${summary.connections.avgTime.toFixed(2)}ms`);

    if (summary.baselines.overhead !== null) {
      console.log(`  stdio overhead: ${summary.baselines.overhead.toFixed(2)}ms`);
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
      console.log('[MCP] Shutting down...');

      if (this.mcpManager) {
        await this.mcpManager.shutdown();
      }

      if (this.configLoader) {
        this.configLoader.stopWatching();
      }

      // Print final performance report
      if (this.performanceMonitor) {
        console.log(this.performanceMonitor.generateReport());
      }

      console.log('[MCP] Shutdown complete');

    } catch (error) {
      console.error('[MCP] Shutdown error:', error);
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
    console.log('[Main] MCP integration successful');

    // Use MCP tools
    try {
      await mcpIntegration.exampleListMCPTools();
      await mcpIntegration.exampleUseMCPTool();
    } catch (error) {
      console.error('[Main] MCP example failed:', error);
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
