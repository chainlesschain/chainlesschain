# mcp-client-manager

**Source**: `src/main/mcp/mcp-client-manager.js`

**Generated**: 2026-02-21T22:45:05.281Z

---

## const

```javascript
const
```

* MCP Client Manager
 *
 * Manages lifecycle of MCP (Model Context Protocol) server connections.
 * Handles server discovery, capability negotiation, and tool execution routing.
 * Supports both stdio (local) and HTTP+SSE (remote) transports.
 *
 * @module MCPClientManager

---

## const TRANSPORT_TYPES =

```javascript
const TRANSPORT_TYPES =
```

* Transport types

---

## class MCPClientManager extends EventEmitter

```javascript
class MCPClientManager extends EventEmitter
```

* @typedef {Object} ServerConfig
 * @property {string} name - Server identifier
 * @property {string} transport - Transport type: 'stdio' or 'http-sse'
 * @property {string} command - Command to launch server (stdio only)
 * @property {string[]} args - Command arguments (stdio only)
 * @property {string} baseURL - Base URL for HTTP+SSE transport
 * @property {string} apiKey - API key for authentication (HTTP+SSE only)
 * @property {boolean} autoConnect - Auto-connect on initialization
 * @property {Object} permissions - Permission configuration

---

## class MCPClientManager extends EventEmitter

```javascript
class MCPClientManager extends EventEmitter
```

* @typedef {Object} MCPTool
 * @property {string} name - Tool name
 * @property {string} description - Tool description
 * @property {Object} inputSchema - JSON Schema for parameters

---

## constructor(config =

```javascript
constructor(config =
```

* @param {Object} config - Manager configuration
   * @param {Object} deps - Optional dependencies for testing (dependency injection)
   * @param {Object} deps.mcpClient - MCP SDK client module
   * @param {Object} deps.mcpStdio - MCP SDK stdio transport module
   * @param {Object} deps.mcpTypes - MCP SDK types module
   * @param {Object} deps.httpSseTransport - HTTP+SSE transport module

---

## async connectServer(serverName, serverConfig)

```javascript
async connectServer(serverName, serverConfig)
```

* Connect to an MCP server
   * @param {string} serverName - Server identifier
   * @param {ServerConfig} serverConfig - Server configuration
   * @returns {Promise<Object>} Server capabilities (tools, resources, prompts)

---

## async disconnectServer(serverName)

```javascript
async disconnectServer(serverName)
```

* Disconnect from an MCP server
   * @param {string} serverName - Server identifier

---

## async listTools(serverName)

```javascript
async listTools(serverName)
```

* List all tools available from a server
   * @param {string} serverName - Server identifier
   * @returns {Promise<MCPTool[]>} List of available tools

---

## async listResources(serverName)

```javascript
async listResources(serverName)
```

* List all resources available from a server
   * @param {string} serverName - Server identifier
   * @returns {Promise<Object[]>} List of available resources

---

## async callTool(serverName, toolName, params =

```javascript
async callTool(serverName, toolName, params =
```

* Call a tool on an MCP server
   * @param {string} serverName - Server identifier
   * @param {string} toolName - Tool name
   * @param {Object} params - Tool parameters
   * @returns {Promise<Object>} Tool execution result

---

## async readResource(serverName, resourceUri)

```javascript
async readResource(serverName, resourceUri)
```

* Read a resource from an MCP server
   * @param {string} serverName - Server identifier
   * @param {string} resourceUri - Resource URI
   * @returns {Promise<Object>} Resource content

---

## getConnectedServers()

```javascript
getConnectedServers()
```

* Get list of connected servers
   * @returns {string[]} List of server names

---

## getServerInfo(serverName)

```javascript
getServerInfo(serverName)
```

* Get server info
   * @param {string} serverName - Server identifier
   * @returns {Object} Server information

---

## getMetrics()

```javascript
getMetrics()
```

* Get performance metrics
   * @returns {Object} Performance statistics

---

## async shutdown()

```javascript
async shutdown()
```

* Shutdown all connections

---

## async _fetchCapabilities(client, serverName)

```javascript
async _fetchCapabilities(client, serverName)
```

* Fetch server capabilities
   * @private

---

## _setupClientHandlers(client, serverName)

```javascript
_setupClientHandlers(client, serverName)
```

* Setup client event handlers
   * @private

---

## _getConnectedServer(serverName)

```javascript
_getConnectedServer(serverName)
```

* Get a connected server or throw error
   * @private

---

## _percentile(arr, p)

```javascript
_percentile(arr, p)
```

* Calculate percentile
   * @private

---

## _setupHttpSseHandlers(transport, serverName)

```javascript
_setupHttpSseHandlers(transport, serverName)
```

* Setup HTTP+SSE transport event handlers
   * @private

---

## async _connectWithHttpSse(client, transport, _serverName)

```javascript
async _connectWithHttpSse(client, transport, _serverName)
```

* Connect using HTTP+SSE transport
   * This creates a bridge between the MCP SDK client and our HTTP+SSE transport
   * @private

---

## async connectRemoteServer(serverName, config)

```javascript
async connectRemoteServer(serverName, config)
```

* Connect to a remote MCP server via HTTP+SSE
   * Convenience method for remote server connections
   * @param {string} serverName - Server identifier
   * @param {Object} config - Remote server configuration
   * @returns {Promise<Object>} Server capabilities

---

## isRemoteServer(serverName)

```javascript
isRemoteServer(serverName)
```

* Check if a server is using HTTP+SSE transport
   * @param {string} serverName - Server identifier
   * @returns {boolean}

---

