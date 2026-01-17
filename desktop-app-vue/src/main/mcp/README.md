# MCP Integration POC (Model Context Protocol)

**Created**: 2026-01-16
**Status**: Proof of Concept
**Version**: 0.1.0

---

## 📋 Overview

This directory contains the Proof of Concept (POC) implementation for integrating the **Model Context Protocol (MCP)** into ChainlessChain's Skill-Tool system.

### Goals

1. **Validate feasibility** of MCP integration with existing architecture
2. **Measure performance** impact (stdio communication overhead)
3. **Test security** model (permissions, sandboxing)
4. **Evaluate user experience** improvements

### Non-Goals (for POC)

- Full migration of existing tools to MCP
- Production-ready implementation
- UI integration beyond basic configuration

---

## 🏗️ Architecture

```
desktop-app-vue/src/main/
├── mcp/
│   ├── README.md                      # This file
│   ├── mcp-client-manager.js         # Core MCP client orchestrator
│   ├── mcp-tool-adapter.js           # Bridge between MCP and ToolManager
│   ├── mcp-security-policy.js        # Security & permission enforcement
│   ├── mcp-config-loader.js          # Configuration management
│   ├── mcp-performance-monitor.js    # Performance tracking
│   ├── transports/
│   │   ├── stdio-transport.js        # Stdio communication layer (local servers)
│   │   └── http-sse-transport.js     # HTTP+SSE transport (remote servers) ✅ Implemented
│   ├── servers/
│   │   ├── server-registry.json      # Trusted server whitelist
│   │   └── server-configs/
│   │       ├── filesystem.json       # Filesystem server config
│   │       └── postgres.json         # PostgreSQL server config
│   └── __tests__/
│       ├── mcp-client-manager.test.js
│       ├── mcp-security.test.js
│       └── mcp-performance.test.js
```

---

## 🔧 Components

### 1. MCPClientManager
**File**: `mcp-client-manager.js`

**Responsibilities**:
- Manage lifecycle of MCP server connections
- Handle server discovery and capability negotiation
- Route tool calls to appropriate MCP servers
- Implement connection pooling and error recovery

**API**:
```javascript
const manager = new MCPClientManager(config);
await manager.connectServer('filesystem', serverConfig);
const tools = await manager.listTools('filesystem');
const result = await manager.callTool('filesystem', 'read_file', { path: '/data/test.txt' });
await manager.disconnectServer('filesystem');
```

### 2. MCPToolAdapter
**File**: `mcp-tool-adapter.js`

**Responsibilities**:
- Convert MCP tool definitions to ChainlessChain tool format
- Register MCP tools with ToolManager
- Proxy tool execution requests to MCP servers
- Handle result transformation and error mapping

**API**:
```javascript
const adapter = new MCPToolAdapter(toolManager, mcpClientManager);
await adapter.registerMCPServerTools('filesystem');
// Now MCP tools are available through ToolManager
const result = await toolManager.executeTool('mcp_read_file', { path: '...' });
```

### 3. MCPSecurityPolicy
**File**: `mcp-security-policy.js`

**Responsibilities**:
- Enforce file path restrictions
- Validate MCP server authenticity
- Implement user consent flow
- Audit tool execution for security violations

**API**:
```javascript
const policy = new MCPSecurityPolicy(config);
policy.validateAccess('filesystem', 'read', '/data/notes/file.txt'); // ✅ Allowed
policy.validateAccess('filesystem', 'read', '/data/ukey/private.key'); // ❌ Throws SecurityError
```

### 4. MCPConfigLoader
**File**: `mcp-config-loader.js`

**Responsibilities**:
- Load MCP configuration from `.chainlesschain/config.json`
- Provide server-specific configurations
- Hot-reload configuration changes

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd desktop-app-vue
npm install @modelcontextprotocol/sdk
```

### 2. Configure MCP Servers

Edit `.chainlesschain/config.json`:

```json
{
  "mcp": {
    "enabled": true,
    "servers": {
      "filesystem": {
        "enabled": true,
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:\\code\\chainlesschain\\data"],
        "autoConnect": true,
        "permissions": {
          "allowedPaths": ["notes/", "imports/", "exports/"],
          "forbiddenPaths": ["ukey/", "did/private-keys/"],
          "readOnly": false
        }
      }
    }
  }
}
```

### 3. Initialize MCP System

```javascript
// In src/main/index.js
const { MCPClientManager } = require('./mcp/mcp-client-manager');
const { MCPToolAdapter } = require('./mcp/mcp-tool-adapter');

// During app initialization
const mcpManager = new MCPClientManager(config.mcp);
const mcpAdapter = new MCPToolAdapter(toolManager, mcpManager);

// Auto-connect enabled servers
await mcpAdapter.initializeServers();
```

### 4. Use MCP Tools

```javascript
// MCP tools are now available through ToolManager
const result = await toolManager.executeTool('mcp_read_file', {
  path: 'notes/example.txt'
});
```

---

## 🔒 Security Model

### Principle: Defense in Depth

1. **Server Whitelist**: Only trusted MCP servers can be loaded
2. **Path Restrictions**: File access limited to allowed directories
3. **User Consent**: Sensitive operations require explicit approval
4. **Sandboxing**: MCP servers run in isolated processes
5. **Audit Logging**: All MCP operations are logged

### Forbidden Operations

The following operations are **always blocked**:

- Access to `data/chainlesschain.db` (encrypted database)
- Access to `data/ukey/` (hardware key data)
- Access to `data/did/private-keys/` (DID private keys)
- Access to `data/p2p/keys/` (P2P encryption keys)

### User Consent Flow

For high-risk operations:

1. MCP tool requests execution
2. Security policy intercepts and evaluates
3. If high-risk, display consent dialog to user
4. User approves/denies
5. Decision is cached for session (or "always allow")

---

## 📊 Performance Monitoring

### Metrics Tracked

- **Connection Time**: Time to establish MCP server connection
- **Tool Call Latency**: End-to-end execution time
- **stdio Overhead**: Additional latency vs direct function call
- **Memory Usage**: MCP client and server process memory
- **Error Rate**: Failed tool calls / total calls

### Performance Targets (POC)

| Metric | Target | Acceptable | Unacceptable |
|--------|--------|-----------|--------------|
| Connection Time | < 500ms | < 1s | > 2s |
| Tool Call Latency | < 100ms | < 200ms | > 500ms |
| stdio Overhead | < 50ms | < 100ms | > 200ms |
| Memory per Server | < 50MB | < 100MB | > 200MB |
| Error Rate | < 1% | < 5% | > 10% |

---

## 🧪 Testing

### Unit Tests

```bash
npm run test:mcp
```

### Performance Benchmarks

```bash
npm run benchmark:mcp
```

### Integration Tests

```bash
npm run test:mcp:integration
```

---

## 📈 POC Success Criteria

After 2 weeks of testing, evaluate:

### ✅ Must Have

1. **Functionality**: MCP tools work correctly
2. **Stability**: Error rate < 5%
3. **Security**: No path traversal or unauthorized access
4. **Performance**: stdio overhead < 100ms

### 🎯 Should Have

1. **User Experience**: MCP tools are easier to use than custom implementations
2. **Developer Experience**: Adding new MCP server takes < 30 minutes
3. **Documentation**: Clear setup and usage guides

### 💡 Nice to Have

1. **Performance**: stdio overhead < 50ms
2. **Ecosystem**: Successfully integrated 3+ useful MCP servers
3. **Community**: Published ChainlessChain MCP server

---

## 🔄 Decision Points

### After Week 1

- **If performance acceptable**: Continue to Week 2
- **If security issues found**: Fix and re-test
- **If fundamentally broken**: Abort POC

### After Week 2

- **If all success criteria met**: Proceed to Phase 2 (expand integration)
- **If some criteria met**: Extend POC by 1 week
- **If criteria not met**: Document findings and archive POC

---

## 📚 References

- [MCP Specification](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP SDK Documentation](https://github.com/modelcontextprotocol/sdk)
- [ChainlessChain MCP Evaluation Report](../../../.chainlesschain/MCP_INTEGRATION_EVALUATION_REPORT.md)

---

## 🐛 Known Limitations (POC)

1. **Windows-focused**: Some paths and commands assume Windows environment
2. **Synchronous consent**: User consent dialogs block execution

---

## 🌐 HTTP+SSE Transport

**Status**: ✅ Implemented (v0.18.0)

HTTP+SSE transport enables connections to **remote MCP servers** via HTTP for requests and Server-Sent Events (SSE) for responses. This is ideal for:

- Cloud-hosted MCP servers
- Web-based MCP services
- Cross-network MCP integrations

### Features

| Feature | Description |
|---------|-------------|
| **Automatic Reconnection** | Exponential backoff (1s, 2s, 4s, 8s) |
| **Heartbeat** | 30s interval, auto-reconnect on 3 missed |
| **Health Check** | 60s interval with history tracking |
| **Circuit Breaker** | Opens after 5 failures, half-open after 30s |
| **Authentication** | Bearer token via Authorization header |
| **Token Refresh** | Callback for automatic token refresh |

### Configuration Example

```json
{
  "mcp": {
    "servers": {
      "remote-api": {
        "enabled": true,
        "transport": "http-sse",
        "baseURL": "https://api.example.com/mcp",
        "apiKey": "your-api-key-here",
        "timeout": 30000,
        "maxRetries": 3,
        "autoConnect": false,
        "headers": {
          "X-Custom-Header": "value"
        }
      }
    }
  }
}
```

### Usage

```javascript
const { MCPClientManager } = require('./mcp/mcp-client-manager');

const manager = new MCPClientManager(config);

// Method 1: Explicit transport type
await manager.connectServer('remote-api', {
  transport: 'http-sse',
  baseURL: 'https://api.example.com/mcp',
  apiKey: 'your-api-key'
});

// Method 2: Convenience method
await manager.connectRemoteServer('remote-api', {
  baseURL: 'https://api.example.com/mcp',
  apiKey: 'your-api-key'
});

// Use tools same as local servers
const tools = await manager.listTools('remote-api');
const result = await manager.callTool('remote-api', 'some_tool', { param: 'value' });

// Check if server is remote
console.log(manager.isRemoteServer('remote-api')); // true
```

### Events

```javascript
manager.on('server-connected', ({ serverName, capabilities }) => {
  console.log('Connected:', serverName);
});

manager.on('server-disconnected', ({ serverName, transport }) => {
  if (transport === 'http-sse') {
    console.log('Remote server disconnected:', serverName);
  }
});

manager.on('server-reconnected', ({ serverName }) => {
  console.log('Reconnected:', serverName);
});

manager.on('server-error', ({ serverName, error, transport }) => {
  console.error('Error:', serverName, error.message);
});
```

### Health Monitoring

```javascript
// Get transport instance for advanced monitoring
const server = manager.servers.get('remote-api');
const transport = server.transport;

// Get health status
const health = await transport.checkHealth();
console.log('Connected:', health.connected);
console.log('Latency:', health.latency, 'ms');
console.log('Circuit State:', health.circuitState);

// Get full statistics
const stats = transport.getStats();
console.log('Success Rate:', stats.successRate);
console.log('Uptime:', stats.uptime, 'ms');
```

### Circuit Breaker Pattern

The HTTP+SSE transport implements a circuit breaker to prevent cascading failures:

```
CLOSED (Normal)
    ↓ 5 consecutive failures
OPEN (Reject all requests)
    ↓ 30 seconds
HALF_OPEN (Test with one request)
    ↓ Success → CLOSED
    ↓ Failure → OPEN
```

---

## 💬 Feedback

Please report issues or suggestions to the development team.
