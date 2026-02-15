# mcp-ipc

**Source**: `src/main/mcp/mcp-ipc.js`

**Generated**: 2026-02-15T08:42:37.223Z

---

## const

```javascript
const
```

* MCP IPC Handlers
 *
 * IPC communication layer between renderer and main process for MCP operations.
 * Provides secure access to MCP servers and tools.
 *
 * @module MCP_IPC

---

## function registerBasicMCPConfigIPC()

```javascript
function registerBasicMCPConfigIPC()
```

* Register basic MCP config IPC handlers (always needed, even when MCP is disabled)
 * This allows users to enable/disable MCP through the UI

---

## ipcMain.handle("mcp:get-config", async () =>

```javascript
ipcMain.handle("mcp:get-config", async () =>
```

* Get MCP configuration (always available)

---

## ipcMain.handle("mcp:update-config", async (event,

```javascript
ipcMain.handle("mcp:update-config", async (event,
```

* Update MCP configuration (always available)

---

## ipcMain.handle("mcp:list-servers", async () =>

```javascript
ipcMain.handle("mcp:list-servers", async () =>
```

* List all available MCP servers from registry (always available)

---

## ipcMain.handle("mcp:get-server-config", async (event,

```javascript
ipcMain.handle("mcp:get-server-config", async (event,
```

* Get server config for a specific server (always available)

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Update server config for a specific server (always available)
   * Note: Security policy permissions are only updated when MCP is enabled

---

## function registerMCPIPC(mcpManager, mcpAdapter, securityPolicy)

```javascript
function registerMCPIPC(mcpManager, mcpAdapter, securityPolicy)
```

* Register all MCP-related IPC handlers
 * @param {MCPClientManager} mcpManager - MCP client manager instance
 * @param {MCPToolAdapter} mcpAdapter - MCP tool adapter instance
 * @param {MCPSecurityPolicy} securityPolicy - Security policy instance

---

## ipcMain.handle("mcp:get-connected-servers", async () =>

```javascript
ipcMain.handle("mcp:get-connected-servers", async () =>
```

* Get connected servers status

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Connect to an MCP server

---

## ipcMain.handle("mcp:disconnect-server", async (event,

```javascript
ipcMain.handle("mcp:disconnect-server", async (event,
```

* Disconnect from an MCP server

---

## ipcMain.handle("mcp:list-tools", async (event,

```javascript
ipcMain.handle("mcp:list-tools", async (event,
```

* List all available tools from MCP servers

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Call an MCP tool

---

## ipcMain.handle("mcp:list-resources", async (event,

```javascript
ipcMain.handle("mcp:list-resources", async (event,
```

* List available resources from MCP servers

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Read a resource from an MCP server

---

## ipcMain.handle("mcp:get-metrics", async () =>

```javascript
ipcMain.handle("mcp:get-metrics", async () =>
```

* Get MCP performance metrics

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Handle consent response from renderer

---

## ipcMain.handle("mcp:get-pending-consents", async () =>

```javascript
ipcMain.handle("mcp:get-pending-consents", async () =>
```

* Get pending consent requests

---

## ipcMain.handle("mcp:cancel-consent", async (event,

```javascript
ipcMain.handle("mcp:cancel-consent", async (event,
```

* Cancel a pending consent request

---

## ipcMain.handle("mcp:clear-consent-cache", async () =>

```javascript
ipcMain.handle("mcp:clear-consent-cache", async () =>
```

* Clear consent cache

---

## ipcMain.handle("mcp:get-security-stats", async () =>

```javascript
ipcMain.handle("mcp:get-security-stats", async () =>
```

* Get security statistics

---

## ipcMain.handle("mcp:get-audit-log", async (event, filters =

```javascript
ipcMain.handle("mcp:get-audit-log", async (event, filters =
```

* Get audit log

---

