# MCP Integration Testing Guide

**Last Updated**: 2026-01-16
**Status**: POC (Proof of Concept)
**Version**: 0.1.0

---

## 📋 Overview

This guide provides step-by-step instructions for testing the MCP (Model Context Protocol) integration in ChainlessChain.

---

## 🚀 Quick Start Testing

### 1. Prerequisites

Ensure you have the following installed:

```bash
# Check Node.js version (>=18.0.0 required)
node --version

# Check npm version
npm --version

# Install MCP SDK (already done)
cd desktop-app-vue
npm list @modelcontextprotocol/sdk
```

### 2. Configure MCP

Edit `.chainlesschain/config.json`:

```json
{
  "mcp": {
    "enabled": true,
    "servers": {
      "filesystem": {
        "enabled": true,
        "command": "npx",
        "args": [
          "-y",
          "@modelcontextprotocol/server-filesystem",
          "D:\\code\\chainlesschain\\data"
        ],
        "autoConnect": true,
        "permissions": {
          "allowedPaths": ["notes/", "imports/", "exports/"],
          "forbiddenPaths": ["chainlesschain.db", "ukey/", "did/private-keys/"],
          "readOnly": false,
          "maxFileSize": 104857600
        }
      }
    }
  }
}
```

**Important**: Replace `D:\\code\\chainlesschain\\data` with your actual data directory path.

### 3. Start the Application

```bash
cd desktop-app-vue
npm run dev
```

Watch the console logs for:

```
[Main] 初始化MCP系统...
[MCPConfigLoader] Loading MCP config
[MCPClientManager] Initialized
[MCPSecurityPolicy] Initialized
[Main] MCP IPC handlers已注册
[MCPToolAdapter] Auto-connecting to filesystem server
[MCPClientManager] Connecting to server: filesystem
[Main] MCP系统初始化完成
```

---

## 🧪 Testing Scenarios

### Test 1: List MCP Servers

**Objective**: Verify that MCP servers are registered correctly.

**Steps**:

1. Open Developer Tools (Ctrl+Shift+I)
2. Go to Console
3. Run:
   ```javascript
   await window.electronAPI.invoke("mcp:list-servers");
   ```

**Expected Result**:

```javascript
{
  success: true,
  servers: [
    {
      id: "filesystem",
      name: "Filesystem Server",
      vendor: "@modelcontextprotocol",
      // ...
    },
    // ... more servers
  ]
}
```

### Test 2: Connect to Filesystem Server

**Objective**: Verify MCP server connection.

**Steps**:

1. Run in console:
   ```javascript
   await window.electronAPI.invoke("mcp:connect-server", {
     serverName: "filesystem",
     config: {
       command: "npx",
       args: [
         "-y",
         "@modelcontextprotocol/server-filesystem",
         "D:\\code\\chainlesschain\\data",
       ],
     },
   });
   ```

**Expected Result**:

```javascript
{
  success: true,
  capabilities: {
    tools: [...],    // List of available tools
    resources: [...], // List of available resources
    prompts: []
  }
}
```

### Test 3: List Available Tools

**Objective**: Verify MCP tools are accessible.

**Steps**:

1. Run in console:
   ```javascript
   await window.electronAPI.invoke("mcp:list-tools", {
     serverName: "filesystem",
   });
   ```

**Expected Result**:

```javascript
{
  success: true,
  tools: [
    {
      name: "read_file",
      description: "Read the complete contents of a file",
      inputSchema: { /* JSON Schema */ }
    },
    {
      name: "write_file",
      description: "Create a new file or overwrite an existing file",
      inputSchema: { /* JSON Schema */ }
    },
    // ... more tools
  ]
}
```

### Test 4: Call MCP Tool (Read File)

**Objective**: Verify MCP tool execution.

**Prerequisites**: Create a test file at `data/notes/mcp-test.txt`

**Steps**:

1. Create test file:

   ```bash
   mkdir -p data/notes
   echo "Hello from MCP!" > data/notes/mcp-test.txt
   ```

2. Run in console:
   ```javascript
   await window.electronAPI.invoke("mcp:call-tool", {
     serverName: "filesystem",
     toolName: "read_file",
     arguments: { path: "notes/mcp-test.txt" },
   });
   ```

**Expected Result**:

```javascript
{
  success: true,
  result: {
    content: "Hello from MCP!",
    mimeType: "text/plain"
  }
}
```

### Test 5: Security Policy Enforcement

**Objective**: Verify security policy blocks forbidden paths.

**Steps**:

1. Try to access forbidden path:
   ```javascript
   await window.electronAPI.invoke("mcp:call-tool", {
     serverName: "filesystem",
     toolName: "read_file",
     arguments: { path: "chainlesschain.db" },
   });
   ```

**Expected Result**:

```javascript
{
  success: false,
  error: "Tool call blocked by security policy: Access denied to forbidden path"
}
```

### Test 6: Performance Metrics

**Objective**: Verify performance monitoring.

**Steps**:

1. After running several tool calls, run:
   ```javascript
   await window.electronAPI.invoke("mcp:get-metrics");
   ```

**Expected Result**:

```javascript
{
  success: true,
  metrics: {
    connectionTimes: Map { 'filesystem' => 1234 }, // in ms
    toolCallLatencies: Map { 'read_file' => [12, 15, 10] },
    errorCounts: Map { 'filesystem' => 0 },
    totalCalls: 5,
    successfulCalls: 5,
    servers: [
      {
        name: 'filesystem',
        state: 'connected',
        connectionTime: 1234,
        errorCount: 0
      }
    ]
  }
}
```

---

## 📊 Performance Benchmarks

Run these tests to measure MCP performance:

### Benchmark 1: Connection Time

**Target**: < 500ms (Acceptable: < 1s)

```javascript
const start = Date.now();
await window.electronAPI.invoke("mcp:connect-server", {
  serverName: "filesystem",
  config: {
    /* ... */
  },
});
const elapsed = Date.now() - start;
console.log(`Connection time: ${elapsed}ms`);
```

### Benchmark 2: Tool Call Latency

**Target**: < 100ms (Acceptable: < 200ms)

```javascript
const start = Date.now();
await window.electronAPI.invoke("mcp:call-tool", {
  serverName: "filesystem",
  toolName: "read_file",
  arguments: { path: "notes/test.txt" },
});
const elapsed = Date.now() - start;
console.log(`Tool call latency: ${elapsed}ms`);
```

---

## 🐛 Troubleshooting

### Issue: "MCP系统已禁用（在配置中）"

**Solution**: Check `.chainlesschain/config.json` and ensure `mcp.enabled` is `true`.

### Issue: "Server filesystem is not in trusted registry"

**Solution**: Verify `server-registry.json` contains the server definition.

### Issue: "Tool call blocked by security policy"

**Solution**: Check the path is in `allowedPaths` and not in `forbiddenPaths`.

### Issue: "Failed to start process"

**Solution**:

- Ensure `npx` is available in PATH
- Try installing the server globally: `npm install -g @modelcontextprotocol/server-filesystem`

### Issue: Connection timeout

**Solution**: Increase timeout in config:

```json
{
  "mcp": {
    "performance": {
      "timeout": 60000
    }
  }
}
```

---

## 📝 Automated Testing

### Run Unit Tests

```bash
cd desktop-app-vue
npm run test:mcp
```

### Run Performance Benchmarks

```bash
cd desktop-app-vue
npm run benchmark:mcp
```

### Run Integration Tests

```bash
cd desktop-app-vue
npm run test:mcp:integration
```

---

## ✅ Success Criteria Checklist

After completing all tests, verify:

- [ ] MCP configuration loads correctly
- [ ] MCP servers can be listed from registry
- [ ] Filesystem server connects successfully
- [ ] Tools are listed and callable
- [ ] Security policy blocks forbidden operations
- [ ] Performance metrics are collected
- [ ] Connection time < 1s
- [ ] Tool call latency < 200ms
- [ ] Error rate < 5%
- [ ] No crashes or memory leaks

---

## 🎯 Next Steps

If all tests pass:

1. **Enable more servers**: Add PostgreSQL, SQLite, etc.
2. **Integrate with UI**: Add MCP server management UI
3. **Production testing**: Test with real-world workloads
4. **Documentation**: Write user-facing documentation

If tests fail:

1. Review error messages and logs
2. Check `desktop-app-vue/src/main/mcp/` implementation
3. Verify MCP SDK version compatibility
4. Report issues to development team

---

## 📚 References

- [MCP Specification](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP SDK Documentation](https://github.com/modelcontextprotocol/sdk)
- [ChainlessChain MCP README](./README.md)

---

**Questions or Issues?**
Contact the development team or file an issue on GitHub.
