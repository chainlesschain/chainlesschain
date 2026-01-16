# MCP 集成最佳实践指南

> **版本**: 0.2.0
> **更新时间**: 2026-01-16
> **状态**: 生产就绪

---

## 目录

1. [概述](#概述)
2. [快速开始](#快速开始)
3. [配置最佳实践](#配置最佳实践)
4. [安全最佳实践](#安全最佳实践)
5. [性能优化](#性能优化)
6. [错误处理](#错误处理)
7. [使用示例](#使用示例)
8. [故障排除](#故障排除)
9. [高级用法](#高级用法)

---

## 概述

MCP (Model Context Protocol) 是一个标准化的协议，用于扩展 AI 助手的能力。ChainlessChain 集成了 MCP 以提供：

- **文件系统访问**: 安全地读写本地文件
- **数据库查询**: 连接 PostgreSQL、SQLite 数据库
- **Git 操作**: 版本控制和代码管理
- **HTTP 请求**: 安全的网络访问

### 支持的传输方式

| 传输方式     | 适用场景        | 性能 | 安全性 |
| ------------ | --------------- | ---- | ------ |
| **stdio**    | 本地 MCP 服务器 | 最佳 | 高     |
| **HTTP+SSE** | 远程 MCP 服务器 | 良好 | 需 TLS |

---

## 快速开始

### 1. 启用 MCP

编辑 `.chainlesschain/config.json`:

```json
{
  "mcp": {
    "enabled": true,
    "servers": {
      "filesystem": {
        "enabled": true,
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:\\data"],
        "autoConnect": true
      }
    }
  }
}
```

### 2. 启动应用

```bash
cd desktop-app-vue
npm run dev
```

### 3. 验证连接

打开开发者工具 (Ctrl+Shift+I)，运行：

```javascript
await window.electronAPI.invoke("mcp:list-servers");
```

---

## 配置最佳实践

### 服务器配置模板

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
          "/path/to/data"
        ],
        "autoConnect": true,
        "permissions": {
          "allowedPaths": ["notes/", "imports/", "exports/"],
          "forbiddenPaths": ["*.db", "*.key", "private/"],
          "readOnly": false,
          "maxFileSize": 104857600
        },
        "timeout": 30000,
        "retryCount": 3
      },
      "sqlite": {
        "enabled": false,
        "command": "npx",
        "args": [
          "-y",
          "@modelcontextprotocol/server-sqlite",
          "/path/to/database.db"
        ],
        "autoConnect": false,
        "permissions": {
          "allowedTables": ["notes", "tags", "categories"],
          "forbiddenTables": ["users", "sessions", "secrets"],
          "readOnly": true
        }
      },
      "git": {
        "enabled": false,
        "command": "npx",
        "args": [
          "-y",
          "@modelcontextprotocol/server-git",
          "--repository",
          "/path/to/repo"
        ],
        "autoConnect": false,
        "permissions": {
          "allowedBranches": ["main", "develop", "feature/*"],
          "forbiddenOperations": ["push", "force-push", "delete-branch"]
        }
      }
    },
    "security": {
      "auditLog": true,
      "requireConsent": true,
      "trustRegistry": true
    },
    "performance": {
      "timeout": 30000,
      "maxConcurrentConnections": 5,
      "enableMetrics": true
    }
  }
}
```

### 配置要点

1. **最小权限原则**: 只启用需要的服务器
2. **路径限制**: 使用 `allowedPaths` 和 `forbiddenPaths`
3. **只读模式**: 对于不需要写入的场景，启用 `readOnly`
4. **超时设置**: 根据网络环境调整 `timeout`

---

## 安全最佳实践

### 1. 路径安全

```javascript
// ✅ 好的做法：使用相对路径
{
  "allowedPaths": ["notes/", "imports/"],
  "forbiddenPaths": ["*.db", "*.key", ".env", "private/"]
}

// ❌ 避免：过于宽泛的路径
{
  "allowedPaths": ["*"],  // 危险！
  "forbiddenPaths": []
}
```

### 2. 敏感数据保护

始终禁止访问的路径：

- `chainlesschain.db` - 加密数据库
- `ukey/` - 硬件密钥数据
- `did/private-keys/` - DID 私钥
- `p2p/keys/` - P2P 加密密钥
- `.env` - 环境变量

### 3. 用户同意流程

对于高风险操作，启用用户同意：

```json
{
  "security": {
    "requireConsent": true,
    "consentTimeout": 30000,
    "rememberConsent": true
  }
}
```

### 4. 审计日志

启用审计日志以追踪所有 MCP 操作：

```json
{
  "security": {
    "auditLog": true,
    "auditLogPath": ".chainlesschain/logs/mcp-audit.log"
  }
}
```

---

## 性能优化

### 1. 连接池

```javascript
// MCPClientManager 自动管理连接池
const manager = new MCPClientManager({
  maxConcurrentConnections: 5,
  connectionTimeout: 30000,
  idleTimeout: 300000, // 5分钟闲置后断开
});
```

### 2. 批量操作

```javascript
// ✅ 好的做法：批量处理
const files = ["file1.txt", "file2.txt", "file3.txt"];
const results = await Promise.all(
  files.map((f) => manager.callTool("filesystem", "read_file", { path: f })),
);

// ❌ 避免：串行处理
for (const file of files) {
  await manager.callTool("filesystem", "read_file", { path: file });
}
```

### 3. 缓存策略

```javascript
// 启用结果缓存
const manager = new MCPClientManager({
  cache: {
    enabled: true,
    ttl: 60000, // 1分钟缓存
    maxSize: 100, // 最多100条
  },
});
```

### 4. 性能监控

```javascript
// 获取性能指标
const metrics = manager.getMetrics();
console.log("总调用次数:", metrics.totalCalls);
console.log("成功率:", metrics.successRate);
console.log("平均延迟:", metrics.toolLatencies);
```

### 性能基准

| 操作         | 目标   | 可接受 | 不可接受 |
| ------------ | ------ | ------ | -------- |
| 连接时间     | <500ms | <1s    | >2s      |
| 工具调用延迟 | <100ms | <200ms | >500ms   |
| 内存占用     | <50MB  | <100MB | >200MB   |
| 错误率       | <1%    | <5%    | >10%     |

---

## 错误处理

### 1. 重试策略

```javascript
// HTTP+SSE 传输自动重试
const transport = new HttpSseTransport({
  maxRetries: 3,
  retryDelay: 1000, // 初始延迟
  // 使用指数退避: 1s, 2s, 4s
});
```

### 2. 断路器模式

```javascript
// 断路器自动保护
const transport = new HttpSseTransport({
  circuitBreakerThreshold: 5, // 5次失败后打开
  circuitBreakerTimeout: 30000, // 30秒后尝试恢复
});

// 监听断路器事件
transport.on("circuit-open", ({ consecutiveFailures }) => {
  console.warn(`断路器打开，连续失败 ${consecutiveFailures} 次`);
});
```

### 3. 错误分类处理

```javascript
try {
  await manager.callTool("filesystem", "read_file", { path: "test.txt" });
} catch (error) {
  if (error.code === "CIRCUIT_OPEN") {
    // 断路器打开，稍后重试
    console.log("服务暂时不可用，请稍后重试");
  } else if (error.message.includes("forbidden")) {
    // 安全策略阻止
    console.log("访问被拒绝：路径不在允许列表中");
  } else if (error.message.includes("timeout")) {
    // 超时
    console.log("操作超时，请检查网络连接");
  } else {
    // 其他错误
    console.error("操作失败:", error.message);
  }
}
```

---

## 使用示例

### 示例 1: 读取文件

```javascript
// 前端调用
const result = await window.electronAPI.invoke("mcp:call-tool", {
  serverName: "filesystem",
  toolName: "read_file",
  arguments: { path: "notes/meeting.md" },
});

console.log("文件内容:", result.result.content);
```

### 示例 2: 写入文件

```javascript
const result = await window.electronAPI.invoke("mcp:call-tool", {
  serverName: "filesystem",
  toolName: "write_file",
  arguments: {
    path: "exports/report.md",
    content: "# 报告\n\n这是自动生成的报告内容。",
  },
});

if (result.success) {
  console.log("文件已保存");
}
```

### 示例 3: 列出目录

```javascript
const result = await window.electronAPI.invoke("mcp:call-tool", {
  serverName: "filesystem",
  toolName: "list_directory",
  arguments: { path: "notes/" },
});

const files = result.result.entries;
files.forEach((file) => {
  console.log(`${file.type}: ${file.name}`);
});
```

### 示例 4: 数据库查询

```javascript
// 需要先启用 SQLite 服务器
const result = await window.electronAPI.invoke("mcp:call-tool", {
  serverName: "sqlite",
  toolName: "read_query",
  arguments: {
    query: "SELECT * FROM notes WHERE category = ? LIMIT 10",
    params: ["工作"],
  },
});

console.log("查询结果:", result.result.rows);
```

### 示例 5: HTTP+SSE 远程连接

```javascript
// 连接远程 MCP 服务器
await window.electronAPI.invoke("mcp:connect-server", {
  serverName: "remote-api",
  config: {
    transport: "http-sse",
    baseURL: "https://mcp-api.example.com",
    apiKey: "your-api-key",
    timeout: 60000,
  },
});

// 调用远程工具
const result = await window.electronAPI.invoke("mcp:call-tool", {
  serverName: "remote-api",
  toolName: "search",
  arguments: { query: "AI 技术" },
});
```

---

## 故障排除

### 常见问题

#### 1. "Server not found" 错误

**原因**: 服务器未连接或已断开

**解决方案**:

```javascript
// 检查服务器状态
const servers = await window.electronAPI.invoke("mcp:list-servers");
console.log("可用服务器:", servers);

// 重新连接
await window.electronAPI.invoke("mcp:connect-server", {
  serverName: "filesystem",
  config: {
    /* ... */
  },
});
```

#### 2. "Tool call blocked by security policy" 错误

**原因**: 路径不在允许列表中

**解决方案**:

1. 检查 `allowedPaths` 配置
2. 确认路径没有在 `forbiddenPaths` 中
3. 检查路径是否包含路径遍历攻击 (`../`)

#### 3. 连接超时

**原因**: 网络问题或服务器启动慢

**解决方案**:

```json
{
  "performance": {
    "timeout": 60000 // 增加超时时间
  }
}
```

#### 4. "Circuit breaker open" 错误

**原因**: 连续多次失败触发断路器

**解决方案**:

```javascript
// 等待断路器恢复
await new Promise((resolve) => setTimeout(resolve, 30000));

// 或者手动重置（重新连接）
await manager.disconnectServer("serverName");
await manager.connectServer("serverName", config);
```

### 日志位置

- **MCP 审计日志**: `.chainlesschain/logs/mcp-audit.log`
- **错误日志**: `.chainlesschain/logs/error.log`
- **性能日志**: `.chainlesschain/logs/performance.log`

---

## 高级用法

### 1. 自定义 MCP 服务器

```javascript
// 创建自定义 MCP 服务器配置
const customServer = {
  enabled: true,
  command: "node",
  args: ["./my-custom-mcp-server.js"],
  env: {
    CUSTOM_VAR: "value",
  },
};
```

### 2. 心跳监控

```javascript
// HTTP+SSE 传输支持心跳
const transport = new HttpSseTransport({
  enableHeartbeat: true,
  heartbeatInterval: 30000, // 30秒
});

transport.on("heartbeat", ({ latency }) => {
  console.log(`心跳延迟: ${latency}ms`);
});
```

### 3. 健康检查

```javascript
// 获取健康状态
const health = await transport.checkHealth();
console.log("健康状态:", health);

// 持续监控
transport.on("health-check", (health) => {
  if (!health.healthy) {
    console.warn("服务不健康:", health.error);
  }
});
```

### 4. 性能基准测试

```bash
# 运行基准测试
npm run benchmark:mcp

# 指定参数
npm run benchmark:mcp -- --iterations 500 --output results.json
```

---

## 参考资料

- [MCP 规范](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP SDK 文档](https://github.com/modelcontextprotocol/sdk)
- [ChainlessChain MCP 测试指南](../../desktop-app-vue/src/main/mcp/TESTING_GUIDE.md)
- [ChainlessChain 故障排除指南](../../CLAUDE-troubleshooting.md)

---

**维护者**: ChainlessChain 开发团队
**反馈**: 如有问题或建议，请提交 Issue
