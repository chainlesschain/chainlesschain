/**
 * MCP Stdio Server
 *
 * Stdio-based MCP server implementation that communicates via standard
 * input/output using JSON-RPC 2.0 messages (one per line).
 *
 * This transport is designed for local MCP servers launched as child
 * processes. Messages are read line-by-line from stdin and responses
 * are written to stdout. Diagnostic logging goes to stderr.
 *
 * Features:
 * - Line-delimited JSON-RPC 2.0 message processing
 * - Tool, resource, and prompt serving
 * - Notification broadcasting via stdout
 * - Graceful shutdown with pending request cleanup
 * - Lifecycle hooks (onStart, onStop, onError, onToolCall)
 * - Middleware pipeline support
 *
 * @module mcp/sdk/stdio-server
 */

const { logger } = require('../../utils/logger.js');
const { EventEmitter } = require('events');
const readline = require('readline');

/**
 * MCP protocol version supported by this server
 * @constant
 */
const MCP_PROTOCOL_VERSION = '2024-11-05';

/**
 * JSON-RPC 2.0 error codes
 * @constant
 */
const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
};

/**
 * Server states
 * @constant
 */
const ServerState = {
  STOPPED: 'stopped',
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  ERROR: 'error',
};

/**
 * Stdio-based MCP server implementation.
 *
 * Reads JSON-RPC 2.0 messages from stdin (one per line) and writes
 * responses to stdout. Uses readline for efficient line-by-line parsing.
 */
class MCPStdioServer extends EventEmitter {
  /**
   * Create a new MCPStdioServer
   *
   * @param {Object} config - Server configuration
   * @param {string} config.name - Server name
   * @param {string} config.version - Server version
   * @param {string} [config.description] - Server description
   * @param {Map<string, Object>} config.tools - Registered tools (name -> definition)
   * @param {Map<string, Object>} config.resources - Registered resources (uri -> definition)
   * @param {Map<string, Object>} config.prompts - Registered prompts (name -> definition)
   * @param {Function[]} [config.middleware] - Middleware functions
   * @param {Object} [config.hooks] - Lifecycle hooks
   */
  constructor(config = {}) {
    super();

    /** @type {string} Server name */
    this.name = config.name || 'mcp-stdio-server';

    /** @type {string} Server version */
    this.version = config.version || '1.0.0';

    /** @type {string} Server description */
    this.description = config.description || '';

    /** @type {Map<string, Object>} Registered tools */
    this.tools = config.tools || new Map();

    /** @type {Map<string, Object>} Registered resources */
    this.resources = config.resources || new Map();

    /** @type {Map<string, Object>} Registered prompts */
    this.prompts = config.prompts || new Map();

    /** @type {Function[]} Middleware pipeline */
    this.middleware = config.middleware || [];

    /** @type {Object} Lifecycle hooks */
    this.hooks = config.hooks || {
      onStart: [],
      onStop: [],
      onError: [],
      onToolCall: [],
      onResourceRead: [],
      onPromptGet: [],
    };

    /** @type {readline.Interface|null} Readline interface for stdin */
    this.rl = null;

    /** @type {string} Current server state */
    this.state = ServerState.STOPPED;

    /** @type {boolean} Whether the server has been initialized (MCP handshake) */
    this.initialized = false;

    /** @type {Object} Server statistics */
    this.stats = {
      startedAt: null,
      messagesReceived: 0,
      messagesSent: 0,
      toolCalls: 0,
      resourceReads: 0,
      promptGets: 0,
      errors: 0,
      lastError: null,
    };

    logger.info(
      `[MCPStdioServer] Created server "${this.name}" v${this.version}`
    );
  }

  // ===================================
  // Server Lifecycle
  // ===================================

  /**
   * Start the stdio server
   *
   * Begins reading from stdin and processing JSON-RPC messages.
   *
   * @returns {Promise<void>} Resolves when server is ready
   */
  async start() {
    if (this.state === ServerState.RUNNING) {
      logger.warn('[MCPStdioServer] Server is already running');
      return;
    }

    this.state = ServerState.STARTING;

    try {
      logger.info('[MCPStdioServer] Starting stdio server...');

      // Run onStart hooks
      await this._runHooks('onStart');

      // Set up readline for stdin
      this.rl = readline.createInterface({
        input: process.stdin,
        crlfDelay: Infinity,
        terminal: false,
      });

      // Handle incoming lines
      this.rl.on('line', (line) => {
        this._handleLine(line);
      });

      // Handle stdin close
      this.rl.on('close', () => {
        logger.info('[MCPStdioServer] stdin closed');
        this.stop();
      });

      // Handle stdin errors
      process.stdin.on('error', (error) => {
        logger.error('[MCPStdioServer] stdin error:', error);
        this.stats.errors++;
        this.stats.lastError = {
          message: error.message,
          timestamp: new Date().toISOString(),
        };
        this._runHooks('onError', error);
        this.emit('error', error);
      });

      this.state = ServerState.RUNNING;
      this.stats.startedAt = new Date().toISOString();

      logger.info(
        `[MCPStdioServer] Server "${this.name}" v${this.version} ready`
      );
      logger.info(
        `[MCPStdioServer] Capabilities: ${this.tools.size} tools, ` +
          `${this.resources.size} resources, ${this.prompts.size} prompts`
      );

      this.emit('started');
    } catch (error) {
      this.state = ServerState.ERROR;
      logger.error('[MCPStdioServer] Failed to start:', error);
      throw error;
    }
  }

  /**
   * Stop the stdio server
   *
   * Closes readline, cleans up, and emits a stopped event.
   *
   * @returns {Promise<void>} Resolves when server is stopped
   */
  async stop() {
    if (this.state === ServerState.STOPPED) {
      return;
    }

    this.state = ServerState.STOPPING;
    logger.info('[MCPStdioServer] Stopping server...');

    try {
      // Run onStop hooks
      await this._runHooks('onStop');

      // Close readline
      if (this.rl) {
        this.rl.close();
        this.rl = null;
      }

      this.state = ServerState.STOPPED;
      this.initialized = false;

      logger.info('[MCPStdioServer] Server stopped');
      this.emit('stopped');
    } catch (error) {
      this.state = ServerState.ERROR;
      logger.error('[MCPStdioServer] Error stopping server:', error);
      throw error;
    }
  }

  // ===================================
  // Message Processing
  // ===================================

  /**
   * Handle a raw line from stdin
   *
   * @private
   * @param {string} line - Raw input line
   */
  _handleLine(line) {
    // Skip empty lines
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    // Skip comment lines (some transports send diagnostic info)
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) {
      return;
    }

    this.stats.messagesReceived++;

    this.handleMessage(trimmed);
  }

  /**
   * Parse and route a JSON-RPC message
   *
   * @param {string} rawMessage - Raw JSON string
   */
  async handleMessage(rawMessage) {
    let message;

    // Parse JSON
    try {
      message = JSON.parse(rawMessage);
    } catch (parseError) {
      logger.error('[MCPStdioServer] Failed to parse message:', parseError.message);
      this.sendError(null, JSON_RPC_ERRORS.PARSE_ERROR, 'Parse error: invalid JSON');
      this.stats.errors++;
      return;
    }

    // Validate JSON-RPC format
    if (!message.jsonrpc || message.jsonrpc !== '2.0') {
      this.sendError(
        message.id || null,
        JSON_RPC_ERRORS.INVALID_REQUEST,
        'Invalid JSON-RPC version. Must be "2.0".'
      );
      this.stats.errors++;
      return;
    }

    logger.info(
      `[MCPStdioServer] Received: ${message.method || 'response'} (id: ${message.id || 'none'})`
    );

    // Run middleware pipeline
    try {
      const middlewareResult = await this._runMiddleware(message);
      if (middlewareResult && middlewareResult.blocked) {
        if (message.id !== undefined) {
          this.sendError(
            message.id,
            JSON_RPC_ERRORS.INTERNAL_ERROR,
            middlewareResult.reason || 'Request blocked by middleware'
          );
        }
        return;
      }
    } catch (error) {
      logger.error('[MCPStdioServer] Middleware error:', error);
      if (message.id !== undefined) {
        this.sendError(message.id, JSON_RPC_ERRORS.INTERNAL_ERROR, error.message);
      }
      return;
    }

    // Route to method handler
    try {
      const result = await this._routeMethod(message);

      // Only send response for requests (not notifications)
      if (message.id !== undefined) {
        this.sendResponse(message.id, result);
      }
    } catch (error) {
      logger.error(`[MCPStdioServer] Method "${message.method}" error:`, error);
      this.stats.errors++;
      this.stats.lastError = {
        message: error.message,
        method: message.method,
        timestamp: new Date().toISOString(),
      };

      if (message.id !== undefined) {
        const errorCode = error.code || JSON_RPC_ERRORS.INTERNAL_ERROR;
        this.sendError(message.id, errorCode, error.message);
      }

      this._runHooks('onError', error);
    }
  }

  /**
   * Route a JSON-RPC method to the appropriate handler
   *
   * @private
   * @param {Object} message - JSON-RPC message
   * @returns {Promise<Object>} Method result
   */
  async _routeMethod(message) {
    const { method, params = {} } = message;

    switch (method) {
      case 'initialize':
        return this._handleInitialize(params);

      case 'notifications/initialized':
        this.initialized = true;
        logger.info('[MCPStdioServer] Client initialized');
        return { acknowledged: true };

      case 'tools/list':
        return this._handleListTools(params);

      case 'tools/call':
        return this._handleToolCall(params.name, params.arguments || {});

      case 'resources/list':
        return this._handleListResources(params);

      case 'resources/read':
        return this._handleResourceRead(params.uri);

      case 'prompts/list':
        return this._handleListPrompts(params);

      case 'prompts/get':
        return this._handlePromptGet(params.name, params.arguments || {});

      case 'ping':
        return { status: 'pong', timestamp: Date.now() };

      default:
        throw Object.assign(
          new Error(`Method not found: ${method}`),
          { code: JSON_RPC_ERRORS.METHOD_NOT_FOUND }
        );
    }
  }

  // ===================================
  // MCP Protocol Handlers
  // ===================================

  /**
   * Handle MCP initialize handshake
   *
   * @private
   * @param {Object} params - Initialize parameters
   * @returns {Object} Server capabilities
   */
  _handleInitialize(params) {
    logger.info(
      `[MCPStdioServer] Initialize from client: ${params?.clientInfo?.name || 'unknown'} ` +
        `v${params?.clientInfo?.version || 'unknown'}`
    );

    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: this.tools.size > 0 ? {} : undefined,
        resources: this.resources.size > 0 ? {} : undefined,
        prompts: this.prompts.size > 0 ? {} : undefined,
      },
      serverInfo: {
        name: this.name,
        version: this.version,
        description: this.description,
      },
    };
  }

  /**
   * Handle tools/list request
   *
   * @private
   * @param {Object} [params] - List parameters
   * @returns {Object} Tool list response
   */
  _handleListTools(params) {
    const toolList = [];

    for (const [toolName, toolDef] of this.tools) {
      toolList.push({
        name: toolDef.name,
        description: toolDef.description,
        inputSchema: toolDef.inputSchema,
      });
    }

    logger.info(`[MCPStdioServer] Listed ${toolList.length} tools`);
    return { tools: toolList };
  }

  /**
   * Handle tools/call request
   *
   * @private
   * @param {string} toolName - Tool name
   * @param {Object} params - Tool parameters
   * @returns {Promise<Object>} Tool result in MCP format
   */
  async _handleToolCall(toolName, params) {
    logger.info(`[MCPStdioServer] Tool call: ${toolName}`);

    const toolDef = this.tools.get(toolName);
    if (!toolDef) {
      throw Object.assign(
        new Error(`Unknown tool: ${toolName}`),
        { code: JSON_RPC_ERRORS.METHOD_NOT_FOUND }
      );
    }

    this.stats.toolCalls++;

    // Run onToolCall hooks
    await this._runHooks('onToolCall', { toolName, params });

    try {
      const startTime = Date.now();

      // Execute the tool handler
      const result = await toolDef.handler(params);

      const latency = Date.now() - startTime;

      logger.info(`[MCPStdioServer] Tool "${toolName}" completed in ${latency}ms`);

      this.emit('tool-called', { toolName, params, result, latency });

      // Format result in MCP content format
      return this._formatToolResult(result);
    } catch (error) {
      logger.error(`[MCPStdioServer] Tool "${toolName}" failed:`, error);

      this.emit('tool-error', { toolName, params, error });

      return {
        content: [
          {
            type: 'text',
            text: `Error executing tool "${toolName}": ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Handle resources/list request
   *
   * @private
   * @param {Object} [params] - List parameters
   * @returns {Object} Resource list response
   */
  _handleListResources(params) {
    const resourceList = [];

    for (const [uri, resourceDef] of this.resources) {
      resourceList.push({
        uri: resourceDef.uri,
        name: resourceDef.name,
        description: resourceDef.description,
        mimeType: resourceDef.mimeType,
      });
    }

    logger.info(`[MCPStdioServer] Listed ${resourceList.length} resources`);
    return { resources: resourceList };
  }

  /**
   * Handle resources/read request
   *
   * @private
   * @param {string} uri - Resource URI
   * @returns {Promise<Object>} Resource content
   */
  async _handleResourceRead(uri) {
    logger.info(`[MCPStdioServer] Resource read: ${uri}`);

    const resourceDef = this.resources.get(uri);
    if (!resourceDef) {
      throw Object.assign(
        new Error(`Unknown resource: ${uri}`),
        { code: JSON_RPC_ERRORS.METHOD_NOT_FOUND }
      );
    }

    this.stats.resourceReads++;

    // Run onResourceRead hooks
    await this._runHooks('onResourceRead', { uri });

    try {
      const result = await resourceDef.handler();

      this.emit('resource-read', { uri, result });

      return {
        contents: [
          {
            uri,
            mimeType: resourceDef.mimeType || 'application/json',
            text: typeof result === 'string' ? result : JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      logger.error(`[MCPStdioServer] Resource "${uri}" read failed:`, error);
      throw error;
    }
  }

  /**
   * Handle prompts/list request
   *
   * @private
   * @param {Object} [params] - List parameters
   * @returns {Object} Prompt list response
   */
  _handleListPrompts(params) {
    const promptList = [];

    for (const [promptName, promptDef] of this.prompts) {
      promptList.push({
        name: promptDef.name,
        description: promptDef.description,
        arguments: promptDef.arguments || [],
      });
    }

    logger.info(`[MCPStdioServer] Listed ${promptList.length} prompts`);
    return { prompts: promptList };
  }

  /**
   * Handle prompts/get request
   *
   * @private
   * @param {string} promptName - Prompt name
   * @param {Object} params - Prompt parameters
   * @returns {Promise<Object>} Prompt content with messages
   */
  async _handlePromptGet(promptName, params) {
    logger.info(`[MCPStdioServer] Prompt get: ${promptName}`);

    const promptDef = this.prompts.get(promptName);
    if (!promptDef) {
      throw Object.assign(
        new Error(`Unknown prompt: ${promptName}`),
        { code: JSON_RPC_ERRORS.METHOD_NOT_FOUND }
      );
    }

    this.stats.promptGets++;

    // Run onPromptGet hooks
    await this._runHooks('onPromptGet', { promptName, params });

    try {
      const result = await promptDef.handler(params);

      this.emit('prompt-get', { promptName, params, result });

      return {
        description: promptDef.description,
        messages: result.messages || [],
      };
    } catch (error) {
      logger.error(`[MCPStdioServer] Prompt "${promptName}" get failed:`, error);
      throw error;
    }
  }

  // ===================================
  // Output Methods (stdout)
  // ===================================

  /**
   * Send a JSON-RPC success response to stdout
   *
   * @param {number|string} id - Request ID
   * @param {Object} result - Result data
   */
  sendResponse(id, result) {
    const response = {
      jsonrpc: '2.0',
      id,
      result,
    };

    this._writeToStdout(response);
  }

  /**
   * Send a JSON-RPC error response to stdout
   *
   * @param {number|string|null} id - Request ID
   * @param {number} code - JSON-RPC error code
   * @param {string} message - Error message
   * @param {Object} [data] - Additional error data
   */
  sendError(id, code, message, data) {
    const response = {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        data,
      },
    };

    this._writeToStdout(response);
  }

  /**
   * Send a JSON-RPC notification to stdout
   *
   * Notifications are messages without an id field, so the client
   * does not send a response.
   *
   * @param {string} method - Notification method name
   * @param {Object} params - Notification parameters
   */
  sendNotification(method, params) {
    const notification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this._writeToStdout(notification);
  }

  /**
   * Write a JSON-RPC message to stdout
   *
   * Each message is serialized as a single line of JSON followed by a newline.
   *
   * @private
   * @param {Object} message - JSON-RPC message
   */
  _writeToStdout(message) {
    try {
      const serialized = JSON.stringify(message);
      process.stdout.write(serialized + '\n');
      this.stats.messagesSent++;
    } catch (error) {
      logger.error('[MCPStdioServer] Failed to write to stdout:', error);
      this.stats.errors++;
    }
  }

  // ===================================
  // Status & Utility
  // ===================================

  /**
   * Get server statistics
   *
   * @returns {Object} Server statistics
   */
  getStats() {
    return {
      ...this.stats,
      state: this.state,
      initialized: this.initialized,
      uptime: this.stats.startedAt
        ? Date.now() - new Date(this.stats.startedAt).getTime()
        : 0,
      capabilities: {
        tools: this.tools.size,
        resources: this.resources.size,
        prompts: this.prompts.size,
      },
    };
  }

  /**
   * Check if the server is running
   *
   * @returns {boolean} True if server is in running state
   */
  isRunning() {
    return this.state === ServerState.RUNNING;
  }

  // ===================================
  // Internal Helpers
  // ===================================

  /**
   * Format a tool result into MCP content format
   *
   * @private
   * @param {*} result - Raw tool result
   * @returns {Object} MCP-formatted tool result
   */
  _formatToolResult(result) {
    // If already in MCP format, return as-is
    if (result && result.content && Array.isArray(result.content)) {
      return result;
    }

    // Convert to MCP content format
    let textContent;

    if (typeof result === 'string') {
      textContent = result;
    } else if (result === null || result === undefined) {
      textContent = 'null';
    } else {
      try {
        textContent = JSON.stringify(result, null, 2);
      } catch (error) {
        textContent = String(result);
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: textContent,
        },
      ],
      isError: false,
    };
  }

  /**
   * Run lifecycle hooks
   *
   * @private
   * @param {string} hookName - Hook name (onStart, onStop, etc.)
   * @param {...*} args - Arguments to pass to hook functions
   */
  async _runHooks(hookName, ...args) {
    const hooks = this.hooks[hookName] || [];

    for (const hookFn of hooks) {
      try {
        await hookFn(...args);
      } catch (error) {
        logger.error(`[MCPStdioServer] Hook "${hookName}" error:`, error);
      }
    }
  }

  /**
   * Run the middleware pipeline
   *
   * @private
   * @param {Object} message - JSON-RPC message
   * @returns {Promise<Object|null>} Middleware result (null if all passed)
   */
  async _runMiddleware(message) {
    for (const middlewareFn of this.middleware) {
      try {
        const result = await middlewareFn(message);
        if (result && result.blocked) {
          return result;
        }
      } catch (error) {
        logger.error('[MCPStdioServer] Middleware error:', error);
        return { blocked: true, reason: error.message };
      }
    }
    return null;
  }
}

module.exports = {
  MCPStdioServer,
  ServerState,
  JSON_RPC_ERRORS,
  MCP_PROTOCOL_VERSION,
};
