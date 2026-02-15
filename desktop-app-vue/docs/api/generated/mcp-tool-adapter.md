# mcp-tool-adapter

**Source**: `src/main/mcp/mcp-tool-adapter.js`

**Generated**: 2026-02-15T10:10:53.406Z

---

## const

```javascript
const
```

* MCP Tool Adapter
 *
 * Bridges between MCP servers and ChainlessChain's ToolManager.
 * Converts MCP tool definitions to ChainlessChain format and proxies execution.
 *
 * @module MCPToolAdapter

---

## class MCPToolAdapter extends EventEmitter

```javascript
class MCPToolAdapter extends EventEmitter
```

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

---

## async initializeServers(config)

```javascript
async initializeServers(config)
```

* Initialize and auto-connect configured MCP servers
   * @param {Object} config - MCP configuration from .chainlesschain/config.json

---

## async registerMCPServerTools(serverName, serverConfig)

```javascript
async registerMCPServerTools(serverName, serverConfig)
```

* Register all tools from an MCP server with ToolManager
   * @param {string} serverName - Server identifier
   * @param {Object} serverConfig - Server configuration
   * @returns {Promise<string[]>} Array of registered tool IDs

---

## async unregisterMCPServerTools(serverName)

```javascript
async unregisterMCPServerTools(serverName)
```

* Unregister all tools from an MCP server
   * @param {string} serverName - Server identifier

---

## getMCPTools()

```javascript
getMCPTools()
```

* Get list of all MCP tools
   * @returns {Object[]} Array of MCP tool info

---

## isMCPTool(toolId)

```javascript
isMCPTool(toolId)
```

* Check if a tool is from MCP
   * @param {string} toolId - Tool ID
   * @returns {boolean} True if tool is from MCP

---

## getToolServer(toolId)

```javascript
getToolServer(toolId)
```

* Get MCP server name for a tool
   * @param {string} toolId - Tool ID
   * @returns {string|null} Server name or null if not MCP tool

---

## async refreshServerTools(serverName)

```javascript
async refreshServerTools(serverName)
```

* Refresh tools from a server (re-fetch and update)
   * @param {string} serverName - Server identifier

---

## async _registerSingleTool(serverName, mcpTool)

```javascript
async _registerSingleTool(serverName, mcpTool)
```

* Register a single MCP tool with ToolManager
   * @private

---

## _convertMCPToolFormat(serverName, mcpTool)

```javascript
_convertMCPToolFormat(serverName, mcpTool)
```

* Convert MCP tool definition to ChainlessChain format
   * @private

---

## async _executeMCPTool(serverName, toolName, params)

```javascript
async _executeMCPTool(serverName, toolName, params)
```

* Execute an MCP tool with security checks
   * @private

---

## _transformMCPResult(mcpResult)

```javascript
_transformMCPResult(mcpResult)
```

* Transform MCP result to ChainlessChain format
   * @private

---

## _extractContent(content)

```javascript
_extractContent(content)
```

* Extract content from MCP content array
   * @private

---

## _extractErrorMessage(content)

```javascript
_extractErrorMessage(content)
```

* Extract error message from MCP error content
   * @private

---

