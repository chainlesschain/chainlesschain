/**
 * MCP HTTP+SSE Server
 *
 * HTTP+Server-Sent Events based MCP server implementation.
 * Provides a complete server that handles MCP protocol messages over
 * HTTP POST requests and sends notifications/responses via SSE.
 *
 * Features:
 * - JSON-RPC 2.0 message handling
 * - SSE connection management for real-time notifications
 * - CORS support for cross-origin access
 * - Pluggable authentication (bearer, api-key, basic, custom)
 * - Request middleware pipeline
 * - Lifecycle hooks (onStart, onStop, onError, onToolCall)
 * - Graceful shutdown with connection draining
 *
 * @module mcp/sdk/http-server
 */

const { logger } = require('../../utils/logger.js');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const { EventEmitter } = require('events');

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
 * HTTP+SSE MCP server implementation.
 *
 * Accepts tool/resource/prompt registrations (typically from MCPServerBuilder)
 * and serves them over HTTP with SSE for notifications.
 */
class MCPHttpServer extends EventEmitter {
  /**
   * Create a new MCPHttpServer
   *
   * @param {Object} config - Server configuration
   * @param {string} config.name - Server name
   * @param {string} config.version - Server version
   * @param {string} [config.description] - Server description
   * @param {Map<string, Object>} config.tools - Registered tools (name -> definition)
   * @param {Map<string, Object>} config.resources - Registered resources (uri -> definition)
   * @param {Map<string, Object>} config.prompts - Registered prompts (name -> definition)
   * @param {number} [config.port=3100] - HTTP port
   * @param {Object} [config.auth] - Authentication configuration
   * @param {Function[]} [config.middleware] - Middleware functions
   * @param {Object} [config.hooks] - Lifecycle hooks
   */
  constructor(config = {}) {
    super();

    /** @type {string} Server name */
    this.name = config.name || 'mcp-http-server';

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

    /** @type {number} HTTP port */
    this.port = config.port || 3100;

    /** @type {Object|null} Authentication config */
    this.authConfig = config.auth || null;

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

    /** @type {http.Server|null} HTTP server instance */
    this.server = null;

    /** @type {string} Current server state */
    this.state = ServerState.STOPPED;

    /** @type {Map<string, Object>} Active SSE connections (clientId -> response) */
    this.sseClients = new Map();

    /** @type {number} Next JSON-RPC request ID */
    this.nextRequestId = 1;

    /** @type {Object} Server statistics */
    this.stats = {
      startedAt: null,
      requestsReceived: 0,
      requestsSucceeded: 0,
      requestsFailed: 0,
      toolCalls: 0,
      resourceReads: 0,
      promptGets: 0,
      sseConnectionsTotal: 0,
      activeSSEConnections: 0,
      lastError: null,
    };

    logger.info(
      `[MCPHttpServer] Created server "${this.name}" v${this.version} on port ${this.port}`
    );
  }

  // ===================================
  // Server Lifecycle
  // ===================================

  /**
   * Start the HTTP+SSE server
   *
   * @returns {Promise<void>} Resolves when server is listening
   * @throws {Error} If server fails to start
   */
  async start() {
    if (this.state === ServerState.RUNNING) {
      logger.warn('[MCPHttpServer] Server is already running');
      return;
    }

    this.state = ServerState.STARTING;

    try {
      logger.info(`[MCPHttpServer] Starting server on port ${this.port}...`);

      // Run onStart hooks
      await this._runHooks('onStart');

      // Create HTTP server
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      // Handle server errors
      this.server.on('error', (error) => {
        logger.error('[MCPHttpServer] Server error:', error);
        this.state = ServerState.ERROR;
        this.stats.lastError = {
          message: error.message,
          code: error.code,
          timestamp: new Date().toISOString(),
        };
        this._runHooks('onError', error);
        this.emit('error', error);
      });

      // Start listening
      await new Promise((resolve, reject) => {
        this.server.listen(this.port, () => {
          resolve();
        });

        this.server.once('error', (error) => {
          reject(error);
        });
      });

      this.state = ServerState.RUNNING;
      this.stats.startedAt = new Date().toISOString();

      logger.info(
        `[MCPHttpServer] Server "${this.name}" v${this.version} listening on port ${this.port}`
      );
      logger.info(
        `[MCPHttpServer] Capabilities: ${this.tools.size} tools, ` +
          `${this.resources.size} resources, ${this.prompts.size} prompts`
      );

      this.emit('started', { port: this.port });
    } catch (error) {
      this.state = ServerState.ERROR;
      logger.error('[MCPHttpServer] Failed to start:', error);
      throw error;
    }
  }

  /**
   * Stop the HTTP+SSE server gracefully
   *
   * Closes all SSE connections and stops the HTTP server.
   *
   * @returns {Promise<void>} Resolves when server is stopped
   */
  async stop() {
    if (this.state === ServerState.STOPPED) {
      logger.warn('[MCPHttpServer] Server is already stopped');
      return;
    }

    this.state = ServerState.STOPPING;
    logger.info('[MCPHttpServer] Stopping server...');

    try {
      // Run onStop hooks
      await this._runHooks('onStop');

      // Close all SSE connections
      for (const [clientId, client] of this.sseClients) {
        try {
          client.res.end();
          logger.info(`[MCPHttpServer] Closed SSE connection: ${clientId}`);
        } catch (error) {
          logger.warn(
            `[MCPHttpServer] Error closing SSE connection ${clientId}:`,
            error.message
          );
        }
      }
      this.sseClients.clear();
      this.stats.activeSSEConnections = 0;

      // Close the HTTP server
      if (this.server) {
        await new Promise((resolve) => {
          this.server.close(() => {
            resolve();
          });
        });
        this.server = null;
      }

      this.state = ServerState.STOPPED;

      logger.info('[MCPHttpServer] Server stopped');
      this.emit('stopped');
    } catch (error) {
      this.state = ServerState.ERROR;
      logger.error('[MCPHttpServer] Error stopping server:', error);
      throw error;
    }
  }

  // ===================================
  // Request Handling
  // ===================================

  /**
   * Handle an incoming HTTP request
   *
   * Routes requests to appropriate handlers based on URL path and method.
   *
   * @param {http.IncomingMessage} req - HTTP request
   * @param {http.ServerResponse} res - HTTP response
   */
  handleRequest(req, res) {
    // Set CORS headers
    this._setCorsHeaders(res);

    // Handle preflight OPTIONS requests
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    this.stats.requestsReceived++;

    // Parse URL
    const url = new URL(req.url, `http://localhost:${this.port}`);
    const pathname = url.pathname;

    logger.info(`[MCPHttpServer] ${req.method} ${pathname}`);

    // Authenticate request (skip for SSE endpoint initial connection and health checks)
    if (pathname !== '/health') {
      const authResult = this._authenticate(req);
      if (!authResult.authenticated) {
        this._sendHttpError(res, 401, 'Unauthorized', authResult.reason);
        return;
      }
    }

    // Route request
    try {
      switch (pathname) {
        case '/sse':
          if (req.method === 'GET') {
            this.handleSSE(req, res);
          } else {
            this._sendHttpError(res, 405, 'Method Not Allowed');
          }
          break;

        case '/rpc':
        case '/message':
          if (req.method === 'POST') {
            this._handleJsonRpcRequest(req, res);
          } else {
            this._sendHttpError(res, 405, 'Method Not Allowed');
          }
          break;

        case '/health':
          this._handleHealthCheck(req, res);
          break;

        default:
          this._sendHttpError(res, 404, 'Not Found', `Unknown endpoint: ${pathname}`);
          break;
      }
    } catch (error) {
      logger.error('[MCPHttpServer] Request handling error:', error);
      this._sendHttpError(res, 500, 'Internal Server Error', error.message);
      this.stats.requestsFailed++;
    }
  }

  /**
   * Set up an SSE connection for real-time notifications
   *
   * @param {http.IncomingMessage} req - HTTP request
   * @param {http.ServerResponse} res - HTTP response
   */
  handleSSE(req, res) {
    const clientId = uuidv4();

    logger.info(`[MCPHttpServer] New SSE connection: ${clientId}`);

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Client-Id': clientId,
    });

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', clientId })}\n\n`);

    // Store client connection
    this.sseClients.set(clientId, {
      res,
      connectedAt: Date.now(),
      messagesSent: 0,
    });
    this.stats.sseConnectionsTotal++;
    this.stats.activeSSEConnections = this.sseClients.size;

    // Handle client disconnect
    req.on('close', () => {
      logger.info(`[MCPHttpServer] SSE connection closed: ${clientId}`);
      this.sseClients.delete(clientId);
      this.stats.activeSSEConnections = this.sseClients.size;
      this.emit('sse-disconnect', { clientId });
    });

    // Send heartbeat every 30 seconds to keep connection alive
    const heartbeatInterval = setInterval(() => {
      if (this.sseClients.has(clientId)) {
        try {
          res.write(`: heartbeat\n\n`);
        } catch (error) {
          logger.warn(`[MCPHttpServer] Heartbeat failed for ${clientId}:`, error.message);
          clearInterval(heartbeatInterval);
          this.sseClients.delete(clientId);
          this.stats.activeSSEConnections = this.sseClients.size;
        }
      } else {
        clearInterval(heartbeatInterval);
      }
    }, 30000);

    this.emit('sse-connect', { clientId });
  }

  // ===================================
  // JSON-RPC Message Handling
  // ===================================

  /**
   * Handle an incoming JSON-RPC request
   *
   * @private
   * @param {http.IncomingMessage} req - HTTP request
   * @param {http.ServerResponse} res - HTTP response
   */
  _handleJsonRpcRequest(req, res) {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();

      // Limit body size to 10MB
      if (body.length > 10 * 1024 * 1024) {
        this._sendHttpError(res, 413, 'Payload Too Large');
        req.destroy();
      }
    });

    req.on('end', async () => {
      try {
        // Parse JSON
        let message;
        try {
          message = JSON.parse(body);
        } catch (parseError) {
          this._sendJsonRpcError(res, null, JSON_RPC_ERRORS.PARSE_ERROR, 'Parse error');
          return;
        }

        // Validate JSON-RPC format
        if (!message.jsonrpc || message.jsonrpc !== '2.0') {
          this._sendJsonRpcError(
            res,
            message.id,
            JSON_RPC_ERRORS.INVALID_REQUEST,
            'Invalid JSON-RPC version. Must be "2.0".'
          );
          return;
        }

        // Run middleware pipeline
        const middlewareResult = await this._runMiddleware(message);
        if (middlewareResult && middlewareResult.blocked) {
          this._sendJsonRpcError(
            res,
            message.id,
            JSON_RPC_ERRORS.INTERNAL_ERROR,
            middlewareResult.reason || 'Request blocked by middleware'
          );
          return;
        }

        // Route to method handler
        const result = await this._routeMethod(message);

        // Send response
        if (message.id !== undefined) {
          // Request (expects response)
          this._sendJsonRpcResponse(res, message.id, result);
          this.stats.requestsSucceeded++;

          // Also broadcast via SSE
          this._broadcastSSE({
            jsonrpc: '2.0',
            id: message.id,
            result,
          });
        } else {
          // Notification (no response expected)
          res.writeHead(204);
          res.end();
        }
      } catch (error) {
        logger.error('[MCPHttpServer] JSON-RPC handling error:', error);
        this.stats.requestsFailed++;
        this.stats.lastError = {
          message: error.message,
          timestamp: new Date().toISOString(),
        };

        this._sendJsonRpcError(
          res,
          null,
          JSON_RPC_ERRORS.INTERNAL_ERROR,
          error.message
        );

        this._runHooks('onError', error);
      }
    });
  }

  /**
   * Route a JSON-RPC method to the appropriate handler
   *
   * @private
   * @param {Object} message - JSON-RPC message
   * @returns {Promise<Object>} Method result
   */
  async _routeMethod(message) {
    const { method, params } = message;

    logger.info(`[MCPHttpServer] Routing method: ${method}`);

    switch (method) {
      case 'initialize':
        return this.handleInitialize(params);

      case 'notifications/initialized':
        // Client acknowledgment - no response needed
        return { acknowledged: true };

      case 'tools/list':
        return this.handleListTools(params);

      case 'tools/call':
        return this.handleToolCall(params.name, params.arguments || {});

      case 'resources/list':
        return this.handleListResources(params);

      case 'resources/read':
        return this.handleResourceRead(params.uri);

      case 'prompts/list':
        return this.handleListPrompts(params);

      case 'prompts/get':
        return this.handlePromptGet(params.name, params.arguments || {});

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
   * Handle the MCP initialize handshake
   *
   * @param {Object} params - Initialize parameters
   * @returns {Object} Server capabilities
   */
  handleInitialize(params) {
    logger.info(
      `[MCPHttpServer] Initialize from client: ${params?.clientInfo?.name || 'unknown'} ` +
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
   * @param {Object} [params] - List parameters (pagination, etc.)
   * @returns {Object} Tool list response
   */
  handleListTools(params) {
    const toolList = [];

    for (const [toolName, toolDef] of this.tools) {
      toolList.push({
        name: toolDef.name,
        description: toolDef.description,
        inputSchema: toolDef.inputSchema,
      });
    }

    logger.info(`[MCPHttpServer] Listed ${toolList.length} tools`);

    return { tools: toolList };
  }

  /**
   * Execute a tool handler
   *
   * @param {string} toolName - Name of the tool to call
   * @param {Object} params - Tool parameters
   * @returns {Promise<Object>} Tool execution result in MCP format
   */
  async handleToolCall(toolName, params) {
    logger.info(`[MCPHttpServer] Tool call: ${toolName}`);

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

      logger.info(`[MCPHttpServer] Tool "${toolName}" completed in ${latency}ms`);

      this.emit('tool-called', { toolName, params, result, latency });

      // Format result in MCP content format
      return this._formatToolResult(result);
    } catch (error) {
      logger.error(`[MCPHttpServer] Tool "${toolName}" failed:`, error);

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
   * @param {Object} [params] - List parameters
   * @returns {Object} Resource list response
   */
  handleListResources(params) {
    const resourceList = [];

    for (const [uri, resourceDef] of this.resources) {
      resourceList.push({
        uri: resourceDef.uri,
        name: resourceDef.name,
        description: resourceDef.description,
        mimeType: resourceDef.mimeType,
      });
    }

    logger.info(`[MCPHttpServer] Listed ${resourceList.length} resources`);

    return { resources: resourceList };
  }

  /**
   * Read a resource by URI
   *
   * @param {string} uri - Resource URI
   * @returns {Promise<Object>} Resource content
   */
  async handleResourceRead(uri) {
    logger.info(`[MCPHttpServer] Resource read: ${uri}`);

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

      // Format result in MCP resource content format
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
      logger.error(`[MCPHttpServer] Resource "${uri}" read failed:`, error);
      throw error;
    }
  }

  /**
   * Handle prompts/list request
   *
   * @param {Object} [params] - List parameters
   * @returns {Object} Prompt list response
   */
  handleListPrompts(params) {
    const promptList = [];

    for (const [promptName, promptDef] of this.prompts) {
      promptList.push({
        name: promptDef.name,
        description: promptDef.description,
        arguments: promptDef.arguments || [],
      });
    }

    logger.info(`[MCPHttpServer] Listed ${promptList.length} prompts`);

    return { prompts: promptList };
  }

  /**
   * Get a prompt by name with parameters
   *
   * @param {string} promptName - Prompt name
   * @param {Object} params - Prompt parameters
   * @returns {Promise<Object>} Prompt content with messages
   */
  async handlePromptGet(promptName, params) {
    logger.info(`[MCPHttpServer] Prompt get: ${promptName}`);

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
      logger.error(`[MCPHttpServer] Prompt "${promptName}" get failed:`, error);
      throw error;
    }
  }

  // ===================================
  // SSE Broadcasting
  // ===================================

  /**
   * Broadcast a message to all connected SSE clients
   *
   * @param {Object} message - Message to broadcast
   */
  _broadcastSSE(message) {
    const data = JSON.stringify(message);

    for (const [clientId, client] of this.sseClients) {
      try {
        client.res.write(`data: ${data}\n\n`);
        client.messagesSent++;
      } catch (error) {
        logger.warn(
          `[MCPHttpServer] Failed to send SSE to ${clientId}:`,
          error.message
        );
        this.sseClients.delete(clientId);
        this.stats.activeSSEConnections = this.sseClients.size;
      }
    }
  }

  /**
   * Send a notification to all SSE clients
   *
   * @param {string} method - Notification method name
   * @param {Object} params - Notification parameters
   */
  sendNotification(method, params) {
    this._broadcastSSE({
      jsonrpc: '2.0',
      method,
      params,
    });
  }

  // ===================================
  // Authentication
  // ===================================

  /**
   * Authenticate an incoming request
   *
   * @private
   * @param {http.IncomingMessage} req - HTTP request
   * @returns {Object} Authentication result: { authenticated, reason? }
   */
  _authenticate(req) {
    // No auth configured - allow all
    if (!this.authConfig) {
      return { authenticated: true };
    }

    try {
      switch (this.authConfig.type) {
        case 'bearer': {
          const authHeader = req.headers['authorization'];
          if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return { authenticated: false, reason: 'Missing or invalid Bearer token' };
          }
          const token = authHeader.substring(7);
          if (token !== this.authConfig.token) {
            return { authenticated: false, reason: 'Invalid Bearer token' };
          }
          return { authenticated: true };
        }

        case 'api-key': {
          const apiKey =
            req.headers['x-api-key'] ||
            req.headers['authorization'];
          if (!apiKey) {
            return { authenticated: false, reason: 'Missing API key' };
          }
          const keyValue = apiKey.startsWith('Bearer ') ? apiKey.substring(7) : apiKey;
          if (keyValue !== this.authConfig.apiKey) {
            return { authenticated: false, reason: 'Invalid API key' };
          }
          return { authenticated: true };
        }

        case 'basic': {
          const authHeader = req.headers['authorization'];
          if (!authHeader || !authHeader.startsWith('Basic ')) {
            return { authenticated: false, reason: 'Missing Basic auth credentials' };
          }
          const decoded = Buffer.from(authHeader.substring(6), 'base64').toString();
          const [username, password] = decoded.split(':');
          if (
            username !== this.authConfig.username ||
            password !== this.authConfig.password
          ) {
            return { authenticated: false, reason: 'Invalid credentials' };
          }
          return { authenticated: true };
        }

        case 'custom': {
          const isValid = this.authConfig.validate(req);
          if (!isValid) {
            return { authenticated: false, reason: 'Custom authentication failed' };
          }
          return { authenticated: true };
        }

        default:
          return { authenticated: false, reason: `Unknown auth type: ${this.authConfig.type}` };
      }
    } catch (error) {
      logger.error('[MCPHttpServer] Authentication error:', error);
      return { authenticated: false, reason: 'Authentication error' };
    }
  }

  // ===================================
  // Response Helpers
  // ===================================

  /**
   * Send a JSON-RPC success response
   *
   * @private
   * @param {http.ServerResponse} res - HTTP response
   * @param {number|string} id - Request ID
   * @param {Object} result - Result data
   */
  _sendJsonRpcResponse(res, id, result) {
    const response = {
      jsonrpc: '2.0',
      id,
      result,
    };

    const body = JSON.stringify(response);

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  /**
   * Send a JSON-RPC error response
   *
   * @private
   * @param {http.ServerResponse} res - HTTP response
   * @param {number|string|null} id - Request ID
   * @param {number} code - JSON-RPC error code
   * @param {string} message - Error message
   * @param {Object} [data] - Additional error data
   */
  _sendJsonRpcError(res, id, code, message, data) {
    const response = {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        data,
      },
    };

    const body = JSON.stringify(response);

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  /**
   * Send an HTTP error response (non-JSON-RPC)
   *
   * @private
   * @param {http.ServerResponse} res - HTTP response
   * @param {number} statusCode - HTTP status code
   * @param {string} statusMessage - HTTP status message
   * @param {string} [detail] - Additional detail
   */
  _sendHttpError(res, statusCode, statusMessage, detail) {
    const body = JSON.stringify({
      error: statusMessage,
      detail: detail || undefined,
      timestamp: new Date().toISOString(),
    });

    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  /**
   * Set CORS headers on response
   *
   * @private
   * @param {http.ServerResponse} res - HTTP response
   */
  _setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Api-Key, X-Client-Id'
    );
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  // ===================================
  // Health & Status
  // ===================================

  /**
   * Handle health check request
   *
   * @private
   * @param {http.IncomingMessage} req - HTTP request
   * @param {http.ServerResponse} res - HTTP response
   */
  _handleHealthCheck(req, res) {
    const health = {
      status: this.state === ServerState.RUNNING ? 'healthy' : 'unhealthy',
      server: {
        name: this.name,
        version: this.version,
        state: this.state,
        uptime: this.stats.startedAt
          ? Date.now() - new Date(this.stats.startedAt).getTime()
          : 0,
      },
      capabilities: {
        tools: this.tools.size,
        resources: this.resources.size,
        prompts: this.prompts.size,
      },
      connections: {
        activeSSE: this.sseClients.size,
        totalSSE: this.stats.sseConnectionsTotal,
      },
      stats: { ...this.stats },
      timestamp: new Date().toISOString(),
    };

    const body = JSON.stringify(health);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  /**
   * Get server statistics
   *
   * @returns {Object} Server statistics
   */
  getStats() {
    return {
      ...this.stats,
      state: this.state,
      uptime: this.stats.startedAt
        ? Date.now() - new Date(this.stats.startedAt).getTime()
        : 0,
      activeSSEConnections: this.sseClients.size,
      capabilities: {
        tools: this.tools.size,
        resources: this.resources.size,
        prompts: this.prompts.size,
      },
    };
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
        logger.error(`[MCPHttpServer] Hook "${hookName}" error:`, error);
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
        logger.error('[MCPHttpServer] Middleware error:', error);
        return { blocked: true, reason: error.message };
      }
    }
    return null;
  }
}

module.exports = {
  MCPHttpServer,
  ServerState,
  JSON_RPC_ERRORS,
  MCP_PROTOCOL_VERSION,
};
