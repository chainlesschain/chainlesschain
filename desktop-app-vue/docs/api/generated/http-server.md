# http-server

**Source**: `src/main/mcp/sdk/http-server.js`

**Generated**: 2026-02-21T22:04:25.818Z

---

## const

```javascript
const
```

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

---

## const MCP_PROTOCOL_VERSION = '2024-11-05';

```javascript
const MCP_PROTOCOL_VERSION = '2024-11-05';
```

* MCP protocol version supported by this server
 * @constant

---

## const JSON_RPC_ERRORS =

```javascript
const JSON_RPC_ERRORS =
```

* JSON-RPC 2.0 error codes
 * @constant

---

## const ServerState =

```javascript
const ServerState =
```

* Server states
 * @constant

---

## class MCPHttpServer extends EventEmitter

```javascript
class MCPHttpServer extends EventEmitter
```

* HTTP+SSE MCP server implementation.
 *
 * Accepts tool/resource/prompt registrations (typically from MCPServerBuilder)
 * and serves them over HTTP with SSE for notifications.

---

## constructor(config =

```javascript
constructor(config =
```

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

---

## this.name = config.name || 'mcp-http-server';

```javascript
this.name = config.name || 'mcp-http-server';
```

@type {string} Server name

---

## this.version = config.version || '1.0.0';

```javascript
this.version = config.version || '1.0.0';
```

@type {string} Server version

---

## this.description = config.description || '';

```javascript
this.description = config.description || '';
```

@type {string} Server description

---

## this.tools = config.tools || new Map();

```javascript
this.tools = config.tools || new Map();
```

@type {Map<string, Object>} Registered tools

---

## this.resources = config.resources || new Map();

```javascript
this.resources = config.resources || new Map();
```

@type {Map<string, Object>} Registered resources

---

## this.prompts = config.prompts || new Map();

```javascript
this.prompts = config.prompts || new Map();
```

@type {Map<string, Object>} Registered prompts

---

## this.port = config.port || 3100;

```javascript
this.port = config.port || 3100;
```

@type {number} HTTP port

---

## this.authConfig = config.auth || null;

```javascript
this.authConfig = config.auth || null;
```

@type {Object|null} Authentication config

---

## this.middleware = config.middleware || [];

```javascript
this.middleware = config.middleware || [];
```

@type {Function[]} Middleware pipeline

---

## this.hooks = config.hooks ||

```javascript
this.hooks = config.hooks ||
```

@type {Object} Lifecycle hooks

---

## this.server = null;

```javascript
this.server = null;
```

@type {http.Server|null} HTTP server instance

---

## this.state = ServerState.STOPPED;

```javascript
this.state = ServerState.STOPPED;
```

@type {string} Current server state

---

## this.sseClients = new Map();

```javascript
this.sseClients = new Map();
```

@type {Map<string, Object>} Active SSE connections (clientId -> response)

---

## this.nextRequestId = 1;

```javascript
this.nextRequestId = 1;
```

@type {number} Next JSON-RPC request ID

---

## this.stats =

```javascript
this.stats =
```

@type {Object} Server statistics

---

## async start()

```javascript
async start()
```

* Start the HTTP+SSE server
   *
   * @returns {Promise<void>} Resolves when server is listening
   * @throws {Error} If server fails to start

---

## async stop()

```javascript
async stop()
```

* Stop the HTTP+SSE server gracefully
   *
   * Closes all SSE connections and stops the HTTP server.
   *
   * @returns {Promise<void>} Resolves when server is stopped

---

## handleRequest(req, res)

```javascript
handleRequest(req, res)
```

* Handle an incoming HTTP request
   *
   * Routes requests to appropriate handlers based on URL path and method.
   *
   * @param {http.IncomingMessage} req - HTTP request
   * @param {http.ServerResponse} res - HTTP response

---

## handleSSE(req, res)

```javascript
handleSSE(req, res)
```

* Set up an SSE connection for real-time notifications
   *
   * @param {http.IncomingMessage} req - HTTP request
   * @param {http.ServerResponse} res - HTTP response

---

## _handleJsonRpcRequest(req, res)

```javascript
_handleJsonRpcRequest(req, res)
```

* Handle an incoming JSON-RPC request
   *
   * @private
   * @param {http.IncomingMessage} req - HTTP request
   * @param {http.ServerResponse} res - HTTP response

---

## async _routeMethod(message)

```javascript
async _routeMethod(message)
```

* Route a JSON-RPC method to the appropriate handler
   *
   * @private
   * @param {Object} message - JSON-RPC message
   * @returns {Promise<Object>} Method result

---

## handleInitialize(params)

```javascript
handleInitialize(params)
```

* Handle the MCP initialize handshake
   *
   * @param {Object} params - Initialize parameters
   * @returns {Object} Server capabilities

---

## handleListTools(params)

```javascript
handleListTools(params)
```

* Handle tools/list request
   *
   * @param {Object} [params] - List parameters (pagination, etc.)
   * @returns {Object} Tool list response

---

## async handleToolCall(toolName, params)

```javascript
async handleToolCall(toolName, params)
```

* Execute a tool handler
   *
   * @param {string} toolName - Name of the tool to call
   * @param {Object} params - Tool parameters
   * @returns {Promise<Object>} Tool execution result in MCP format

---

## handleListResources(params)

```javascript
handleListResources(params)
```

* Handle resources/list request
   *
   * @param {Object} [params] - List parameters
   * @returns {Object} Resource list response

---

## async handleResourceRead(uri)

```javascript
async handleResourceRead(uri)
```

* Read a resource by URI
   *
   * @param {string} uri - Resource URI
   * @returns {Promise<Object>} Resource content

---

## handleListPrompts(params)

```javascript
handleListPrompts(params)
```

* Handle prompts/list request
   *
   * @param {Object} [params] - List parameters
   * @returns {Object} Prompt list response

---

## async handlePromptGet(promptName, params)

```javascript
async handlePromptGet(promptName, params)
```

* Get a prompt by name with parameters
   *
   * @param {string} promptName - Prompt name
   * @param {Object} params - Prompt parameters
   * @returns {Promise<Object>} Prompt content with messages

---

## _broadcastSSE(message)

```javascript
_broadcastSSE(message)
```

* Broadcast a message to all connected SSE clients
   *
   * @param {Object} message - Message to broadcast

---

## sendNotification(method, params)

```javascript
sendNotification(method, params)
```

* Send a notification to all SSE clients
   *
   * @param {string} method - Notification method name
   * @param {Object} params - Notification parameters

---

## _authenticate(req)

```javascript
_authenticate(req)
```

* Authenticate an incoming request
   *
   * @private
   * @param {http.IncomingMessage} req - HTTP request
   * @returns {Object} Authentication result: { authenticated, reason? }

---

## _sendJsonRpcResponse(res, id, result)

```javascript
_sendJsonRpcResponse(res, id, result)
```

* Send a JSON-RPC success response
   *
   * @private
   * @param {http.ServerResponse} res - HTTP response
   * @param {number|string} id - Request ID
   * @param {Object} result - Result data

---

## _sendJsonRpcError(res, id, code, message, data)

```javascript
_sendJsonRpcError(res, id, code, message, data)
```

* Send a JSON-RPC error response
   *
   * @private
   * @param {http.ServerResponse} res - HTTP response
   * @param {number|string|null} id - Request ID
   * @param {number} code - JSON-RPC error code
   * @param {string} message - Error message
   * @param {Object} [data] - Additional error data

---

## _sendHttpError(res, statusCode, statusMessage, detail)

```javascript
_sendHttpError(res, statusCode, statusMessage, detail)
```

* Send an HTTP error response (non-JSON-RPC)
   *
   * @private
   * @param {http.ServerResponse} res - HTTP response
   * @param {number} statusCode - HTTP status code
   * @param {string} statusMessage - HTTP status message
   * @param {string} [detail] - Additional detail

---

## _setCorsHeaders(res)

```javascript
_setCorsHeaders(res)
```

* Set CORS headers on response
   *
   * @private
   * @param {http.ServerResponse} res - HTTP response

---

## _handleHealthCheck(req, res)

```javascript
_handleHealthCheck(req, res)
```

* Handle health check request
   *
   * @private
   * @param {http.IncomingMessage} req - HTTP request
   * @param {http.ServerResponse} res - HTTP response

---

## getStats()

```javascript
getStats()
```

* Get server statistics
   *
   * @returns {Object} Server statistics

---

## _formatToolResult(result)

```javascript
_formatToolResult(result)
```

* Format a tool result into MCP content format
   *
   * @private
   * @param {*} result - Raw tool result
   * @returns {Object} MCP-formatted tool result

---

## async _runHooks(hookName, ...args)

```javascript
async _runHooks(hookName, ...args)
```

* Run lifecycle hooks
   *
   * @private
   * @param {string} hookName - Hook name (onStart, onStop, etc.)
   * @param {...*} args - Arguments to pass to hook functions

---

## async _runMiddleware(message)

```javascript
async _runMiddleware(message)
```

* Run the middleware pipeline
   *
   * @private
   * @param {Object} message - JSON-RPC message
   * @returns {Promise<Object|null>} Middleware result (null if all passed)

---

