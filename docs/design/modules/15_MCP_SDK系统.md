# MCP SDK 系统

## 模块概述

**版本**: v0.34.0
**状态**: ✅ 已实现
**MCP协议版本**: 2024-11-05
**最后更新**: 2026-02-15

MCP SDK 系统提供 Model Context Protocol 服务器构建工具包，支持 HTTP+SSE 和 Stdio 两种传输方式。内置社区注册中心，预收录 8 个常用 MCP Server，支持一键发现和安装。

### 核心特性

- **Fluent API**: 链式调用构建 MCP Server，极简开发体验
- **双传输**: HTTP+SSE (远程) 和 Stdio (本地) 传输方式
- **多种认证**: Bearer, API-Key, Basic, Custom 四种认证方式
- **社区注册中心**: 8 个预收录 Server，支持发现和安装
- **协议兼容**: 完整实现 MCP 2024-11-05 规范
- **TypeScript 支持**: 完整类型定义

---

## 1. 架构设计

### 1.1 整体架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                        前端 (Vue3)                                │
├──────────────────────────────────────────────────────────────────┤
│  MCPServerMarketplace │ MCPServerBuilder │ MCPServerManager      │
│        ↓                      ↓                   ↓               │
│                     Pinia Store: mcp.ts                           │
└──────────────────────────────────────────────────────────────────┘
                              ↕ IPC
┌──────────────────────────────────────────────────────────────────┐
│                        主进程 (Electron)                          │
├──────────────────────────────────────────────────────────────────┤
│                       mcp-sdk-ipc.js                              │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ MCPServerBuilder │ MCPHttpServer │ MCPStdioServer           │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ CommunityRegistry │ SDK Entry (index.js)                   │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
                    ↕ HTTP+SSE / Stdio
┌──────────────────────────────────────────────────────────────────┐
│                     MCP Client (AI应用)                           │
├──────────────────────────────────────────────────────────────────┤
│  Claude Desktop │ ChainlessChain │ 其他MCP客户端                  │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 SDK 分层架构

```
SDK Entry (index.js)
    ↓ 导出
┌─────────────────────────┐
│     MCPServerBuilder    │  ← Fluent API 构建层
├─────────────────────────┤
│  MCPHttpServer          │  ← HTTP+SSE 传输层
│  MCPStdioServer         │  ← Stdio 传输层
├─────────────────────────┤
│  JSON-RPC 2.0 协议层    │  ← 请求/响应/通知处理
├─────────────────────────┤
│  CommunityRegistry      │  ← 社区注册中心
└─────────────────────────┘
```

### 1.3 核心组件

| 组件 | 文件 | 行数 | 说明 |
|------|------|------|------|
| MCPServerBuilder | `mcp-server-builder.js` | ~400 | Fluent API 构建器 |
| MCPHttpServer | `mcp-http-server.js` | ~450 | HTTP+SSE 传输 |
| MCPStdioServer | `mcp-stdio-server.js` | ~300 | Stdio 传输 |
| CommunityRegistry | `community-registry.js` | ~350 | 社区注册中心 |
| SDK Entry | `index.js` | ~50 | 统一导出入口 |

---

## 2. 核心模块

### 2.1 MCPServerBuilder

Fluent API 链式构建器，快速创建 MCP Server。

**使用示例**:

```javascript
const { MCPServerBuilder } = require('@chainlesschain/mcp-sdk');

const server = new MCPServerBuilder()
  .name('my-server')
  .version('1.0.0')
  .description('自定义MCP服务器')

  // 添加工具
  .addTool({
    name: 'search_notes',
    description: '搜索个人笔记',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' }
      },
      required: ['query']
    },
    handler: async (params) => {
      const results = await noteService.search(params.query);
      return { content: [{ type: 'text', text: JSON.stringify(results) }] };
    }
  })

  // 添加资源
  .addResource({
    uri: 'notes://recent',
    name: '最近笔记',
    description: '最近编辑的笔记列表',
    mimeType: 'application/json',
    handler: async () => {
      return { contents: [{ uri: 'notes://recent', text: '...' }] };
    }
  })

  // 添加提示模板
  .addPrompt({
    name: 'summarize',
    description: '总结笔记内容',
    arguments: [
      { name: 'noteId', description: '笔记ID', required: true }
    ],
    handler: async (args) => {
      return { messages: [{ role: 'user', content: { type: 'text', text: '...' } }] };
    }
  })

  // 配置传输
  .transport('http', { port: 3000, cors: true })

  // 配置认证
  .auth('bearer', { token: process.env.MCP_TOKEN })

  // 构建并启动
  .build();

await server.start();
```

**核心方法**:

```javascript
class MCPServerBuilder {
  // 基本信息
  name(name) { return this; }
  version(version) { return this; }
  description(description) { return this; }

  // 能力注册
  addTool(toolDef) { return this; }
  addResource(resourceDef) { return this; }
  addPrompt(promptDef) { return this; }

  // 传输配置
  transport(type, options) { return this; }

  // 认证配置
  auth(type, options) { return this; }

  // 中间件
  use(middleware) { return this; }

  // 事件钩子
  onConnect(handler) { return this; }
  onDisconnect(handler) { return this; }
  onError(handler) { return this; }

  // 构建
  build() { return new MCPServer(...); }
}
```

### 2.2 MCPHttpServer

HTTP+SSE 传输实现，支持 CORS 和多种认证方式。

**功能特性**:
- HTTP POST 接收 JSON-RPC 请求
- Server-Sent Events (SSE) 推送通知
- CORS 跨域配置
- 四种认证方式
- 请求限流

**端点**:

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/mcp/v1/message` | 发送 JSON-RPC 请求 |
| GET | `/mcp/v1/sse` | 建立 SSE 连接 |
| GET | `/mcp/v1/health` | 健康检查 |
| GET | `/mcp/v1/info` | 服务器信息 |

**核心方法**:

```javascript
class MCPHttpServer {
  // 启动服务器
  async start() { }

  // 停止服务器
  async stop() { }

  // 处理JSON-RPC请求
  async handleMessage(request) { }

  // 发送SSE事件
  sendSSEEvent(clientId, event, data) { }

  // 广播通知
  broadcast(event, data) { }
}
```

**认证方式**:

| 类型 | 说明 | Header格式 |
|------|------|------------|
| Bearer | Bearer Token 认证 | `Authorization: Bearer <token>` |
| API-Key | API密钥认证 | `X-API-Key: <key>` |
| Basic | HTTP Basic 认证 | `Authorization: Basic <base64>` |
| Custom | 自定义认证 | 用户自定义 Header |

### 2.3 MCPStdioServer

标准输入/输出 (Stdio) 传输实现，用于本地进程间通信。

**功能特性**:
- stdin 读取 JSON-RPC 请求 (行分隔)
- stdout 写入 JSON-RPC 响应
- stderr 用于日志输出
- 自动重连和错误恢复

**核心方法**:

```javascript
class MCPStdioServer {
  // 启动监听
  async start() { }

  // 停止监听
  async stop() { }

  // 处理请求
  async handleRequest(request) { }

  // 发送通知
  sendNotification(method, params) { }
}
```

**JSON-RPC 消息格式**:

```json
// 请求
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}

// 响应
{"jsonrpc":"2.0","id":1,"result":{"tools":[...]}}

// 通知
{"jsonrpc":"2.0","method":"notifications/resources/updated","params":{"uri":"notes://recent"}}
```

### 2.4 CommunityRegistry

社区注册中心，预收录 8 个常用 MCP Server。

**预收录服务器**:

| # | 名称 | 说明 | 传输 |
|---|------|------|------|
| 1 | Filesystem | 文件系统操作 (读/写/搜索) | Stdio |
| 2 | PostgreSQL | PostgreSQL 数据库查询 | Stdio |
| 3 | SQLite | SQLite 数据库操作 | Stdio |
| 4 | Git | Git 仓库操作 (status/log/diff) | Stdio |
| 5 | Brave Search | Brave 搜索引擎集成 | HTTP |
| 6 | Puppeteer | 浏览器自动化 | Stdio |
| 7 | Memory | 知识图谱持久化 | Stdio |
| 8 | Fetch | HTTP 请求和网页抓取 | Stdio |

**核心方法**:

```javascript
class CommunityRegistry {
  // 获取所有预收录服务器
  async getAll() { }

  // 搜索服务器
  async search(query) { }

  // 获取服务器详情
  async getDetail(serverId) { }

  // 安装服务器
  async install(serverId) { }

  // 卸载服务器
  async uninstall(serverId) { }

  // 获取已安装列表
  async getInstalled() { }

  // 检查更新
  async checkUpdates() { }

  // 刷新注册中心
  async refresh() { }
}
```

---

## 3. MCP 协议实现

### 3.1 支持的方法

**生命周期**:

| 方法 | 说明 |
|------|------|
| `initialize` | 初始化连接，交换能力 |
| `initialized` | 初始化完成通知 |
| `ping` | 心跳检测 |

**工具 (Tools)**:

| 方法 | 说明 |
|------|------|
| `tools/list` | 列出可用工具 |
| `tools/call` | 调用工具 |

**资源 (Resources)**:

| 方法 | 说明 |
|------|------|
| `resources/list` | 列出可用资源 |
| `resources/read` | 读取资源内容 |
| `resources/subscribe` | 订阅资源更新 |
| `resources/unsubscribe` | 取消订阅 |

**提示模板 (Prompts)**:

| 方法 | 说明 |
|------|------|
| `prompts/list` | 列出可用提示模板 |
| `prompts/get` | 获取提示模板内容 |

**通知 (Notifications)**:

| 方法 | 说明 |
|------|------|
| `notifications/resources/updated` | 资源更新通知 |
| `notifications/tools/list_changed` | 工具列表变更通知 |
| `notifications/prompts/list_changed` | 提示模板列表变更通知 |

### 3.2 能力声明

```json
{
  "protocolVersion": "2024-11-05",
  "capabilities": {
    "tools": { "listChanged": true },
    "resources": { "subscribe": true, "listChanged": true },
    "prompts": { "listChanged": true },
    "logging": {}
  },
  "serverInfo": {
    "name": "my-server",
    "version": "1.0.0"
  }
}
```

---

## 4. 前端页面

### 4.1 MCPServerMarketplace.vue

MCP Server 市场页:
- 8 个预收录 Server 卡片展示
- 每个卡片: 名称、描述、传输类型标签、安装状态
- 搜索筛选
- 一键安装/卸载
- 已安装 Server 列表和状态管理
- Server 配置编辑面板

### 4.2 MCPServerBuilder UI (集成在现有MCP页面)

可视化 Server 构建:
- 拖拽式工具/资源/提示模板定义
- 实时预览生成的配置
- 传输方式和认证配置表单
- 测试连接按钮
- 导出配置文件

---

## 5. SDK 入口 (index.js)

```javascript
// @chainlesschain/mcp-sdk 导出
module.exports = {
  // 构建器
  MCPServerBuilder,

  // 传输层
  MCPHttpServer,
  MCPStdioServer,

  // 社区
  CommunityRegistry,

  // 工具函数
  createServer: (options) => new MCPServerBuilder().from(options).build(),
  createHttpServer: (options) => new MCPHttpServer(options),
  createStdioServer: (options) => new MCPStdioServer(options),

  // 常量
  PROTOCOL_VERSION: '2024-11-05',
  AUTH_TYPES: ['bearer', 'api-key', 'basic', 'custom'],
  TRANSPORT_TYPES: ['http', 'stdio']
};
```

---

## 6. 安全设计

### 6.1 传输安全

- HTTP 传输建议使用 HTTPS (TLS 1.2+)
- Stdio 传输仅限本地进程
- CORS 默认关闭，需要显式启用
- 请求限流保护 (默认 100 req/min)

### 6.2 认证安全

- Bearer Token: 推荐长度 32+ 字符
- API-Key: 支持 Key 轮换
- Basic Auth: 仅在 HTTPS 下使用
- Custom Auth: 用户自定义验证逻辑

### 6.3 输入验证

- JSON-RPC 请求格式验证
- 工具输入参数 JSON Schema 验证
- 资源 URI 格式验证
- 防止 JSON 注入

### 6.4 社区安全

- 预收录 Server 经过审核
- 安装时显示权限声明
- 沙箱执行环境
- 可疑行为检测

---

## 7. 配置选项

### 7.1 HTTP Server 配置

```javascript
{
  transport: 'http',
  port: 3000,
  host: '127.0.0.1',
  cors: {
    enabled: false,
    origins: ['*'],
    methods: ['GET', 'POST'],
    headers: ['Content-Type', 'Authorization']
  },
  auth: {
    type: 'bearer',  // 'bearer' | 'api-key' | 'basic' | 'custom'
    token: 'your-secret-token',
    // 或 apiKey: 'your-api-key'
    // 或 username: 'user', password: 'pass'
    // 或 handler: async (req) => { return true/false; }
  },
  rateLimit: {
    enabled: true,
    maxRequests: 100,
    windowMs: 60000
  },
  sse: {
    heartbeatInterval: 30000,
    maxConnections: 50
  }
}
```

### 7.2 Stdio Server 配置

```javascript
{
  transport: 'stdio',
  encoding: 'utf-8',
  maxMessageSize: 10 * 1024 * 1024, // 10MB
  logToStderr: true
}
```

---

## 8. 文件结构

```
desktop-app-vue/src/main/mcp/sdk/
├── index.js                 # SDK入口，统一导出
├── mcp-server-builder.js    # Fluent API 构建器
├── mcp-http-server.js       # HTTP+SSE 传输
├── mcp-stdio-server.js      # Stdio 传输
├── community-registry.js    # 社区注册中心
├── json-rpc.js              # JSON-RPC 2.0 协议处理
├── auth/                    # 认证模块
│   ├── bearer.js
│   ├── api-key.js
│   ├── basic.js
│   └── custom.js
└── catalog/                 # 预收录 Server 配置
    ├── filesystem.json
    ├── postgresql.json
    ├── sqlite.json
    ├── git.json
    ├── brave-search.json
    ├── puppeteer.json
    ├── memory.json
    └── fetch.json

desktop-app-vue/src/renderer/
├── pages/mcp/
│   └── MCPServerMarketplace.vue  # MCP Server市场
└── stores/mcp.ts                 # MCP状态管理 (扩展)
```

---

## 9. 使用示例

### 9.1 最简 Server

```javascript
const { createServer } = require('@chainlesschain/mcp-sdk');

const server = createServer({
  name: 'hello-server',
  version: '1.0.0',
  transport: { type: 'stdio' },
  tools: [{
    name: 'hello',
    description: '问候',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } }
    },
    handler: async ({ name }) => ({
      content: [{ type: 'text', text: `你好, ${name}!` }]
    })
  }]
});

server.start();
```

### 9.2 HTTP Server + 认证

```javascript
const { MCPServerBuilder } = require('@chainlesschain/mcp-sdk');

const server = new MCPServerBuilder()
  .name('secure-server')
  .version('1.0.0')
  .transport('http', { port: 8080, cors: true })
  .auth('api-key', { key: process.env.API_KEY })
  .addTool({
    name: 'query_data',
    description: '查询数据',
    inputSchema: { type: 'object', properties: { sql: { type: 'string' } } },
    handler: async ({ sql }) => {
      const result = await db.query(sql);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  })
  .build();

await server.start();
console.log('MCP Server 运行在 http://localhost:8080');
```

---

## 10. 相关文档

- [MCP与配置系统](08_MCP与配置系统.md)
- [MCP用户指南](../../features/MCP_USER_GUIDE.md)
- [插件市场系统](12_插件市场系统.md)
- [MCP协议规范](https://spec.modelcontextprotocol.io/specification/2024-11-05/)

---

**文档版本**: 1.0
**最后更新**: 2026-02-15
