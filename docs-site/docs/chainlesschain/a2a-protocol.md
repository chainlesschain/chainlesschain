# A2A 协议引擎

> **版本: v4.1.0 | 状态: ✅ 生产就绪 | 8 IPC Handlers | Google A2A 标准实现 + Agent Card 发现 + 任务生命周期管理**

ChainlessChain A2A (Agent-to-Agent) 协议引擎实现 Google A2A 开放标准，使不同来源的 AI Agent 能够互相发现、协商能力和协作完成任务。通过 JSON-LD Agent Card 实现去中心化发现，支持完整的任务生命周期管理和实时订阅更新。

## 概述

A2A 协议引擎是 ChainlessChain 实现跨平台 Agent 互操作的核心模块，遵循 Google A2A 开放标准。它通过 JSON-LD Agent Card 实现 Agent 的去中心化发现与能力声明，并提供完整的任务提交、执行、状态订阅等生命周期管理能力，支持 SSE 实时推送和能力自动匹配。

## 核心特性

- 🌐 **Google A2A 标准**: 完整实现 A2A 协议规范，跨平台互操作
- 🪪 **Agent Card 发现**: JSON-LD 格式的 Agent 名片，声明能力、端点和认证方式
- 🔄 **任务生命周期**: submitted → working → input-required → completed / failed
- 📡 **实时订阅**: Server-Sent Events (SSE) 推送任务状态变更
- 🤝 **能力协商**: 自动匹配 Agent 能力，选择最优执行者

## 任务状态流转

```
┌──────────┐    开始执行    ┌──────────┐
│submitted │──────────────→│ working  │
└──────────┘               └────┬─────┘
                                │
                    ┌───────────┼───────────┐
                    │           │           │
                    ▼           ▼           ▼
             ┌──────────┐ ┌─────────┐ ┌────────┐
             │input-    │ │completed│ │ failed │
             │required  │ │         │ │        │
             └────┬─────┘ └─────────┘ └────────┘
                  │
                  │ 提供输入
                  ▼
             ┌──────────┐
             │ working  │ (继续执行)
             └──────────┘
```

## Agent Card 结构

```json
{
  "@context": "https://schemas.google.com/a2a/v1",
  "@type": "AgentCard",
  "name": "ChainlessChain Knowledge Agent",
  "description": "个人知识库管理与 RAG 检索 Agent",
  "url": "https://localhost:9001/a2a",
  "version": "4.1.0",
  "capabilities": [
    {
      "name": "knowledge-search",
      "description": "语义搜索知识库",
      "inputSchema": {
        "type": "object",
        "properties": { "query": { "type": "string" } }
      }
    },
    {
      "name": "note-summarize",
      "description": "笔记摘要生成",
      "inputSchema": {
        "type": "object",
        "properties": { "noteId": { "type": "string" } }
      }
    }
  ],
  "authentication": {
    "type": "did",
    "didMethod": "did:chainless"
  }
}
```

## 发现可用 Agent

```javascript
const agents = await window.electron.ipcRenderer.invoke("a2a:discover-agents", {
  capability: "knowledge-search",
  maxResults: 10,
});
// agents = {
//   discovered: [
//     {
//       name: "Peer Knowledge Agent",
//       url: "https://192.168.1.5:9001/a2a",
//       capabilities: ["knowledge-search", "note-summarize"],
//       trustScore: 0.92,
//       lastSeen: "2026-03-10T08:00:00Z",
//     },
//   ],
//   total: 1,
// }
```

## 发送任务

```javascript
const task = await window.electron.ipcRenderer.invoke("a2a:send-task", {
  targetUrl: "https://192.168.1.5:9001/a2a",
  capability: "knowledge-search",
  input: {
    query: "量子计算在密码学中的应用",
    maxResults: 5,
  },
  timeout: 30000,
});
// task = {
//   taskId: "task-uuid-001",
//   status: "submitted",
//   targetAgent: "Peer Knowledge Agent",
//   createdAt: "2026-03-10T08:12:00Z",
// }
```

## 查询任务状态

```javascript
const status = await window.electron.ipcRenderer.invoke(
  "a2a:get-task-status",
  "task-uuid-001",
);
// status = {
//   taskId: "task-uuid-001",
//   status: "completed",
//   result: {
//     items: [
//       { title: "后量子密码学综述", relevance: 0.95 },
//       { title: "Shor 算法对 RSA 的威胁", relevance: 0.91 },
//     ],
//   },
//   startedAt: "2026-03-10T08:12:01Z",
//   completedAt: "2026-03-10T08:12:03Z",
//   durationMs: 2000,
// }
```

## 订阅任务更新

```javascript
await window.electron.ipcRenderer.invoke("a2a:subscribe-updates", {
  taskId: "task-uuid-001",
  events: ["status-change", "progress", "result"],
});
// 通过 EventBus 接收更新:
// window.electron.ipcRenderer.on("a2a:task-update", (event, update) => {
//   update = {
//     taskId: "task-uuid-001",
//     event: "status-change",
//     oldStatus: "working",
//     newStatus: "completed",
//     timestamp: "2026-03-10T08:12:03Z",
//   }
// });
```

## 注册 Agent Card

```javascript
const result = await window.electron.ipcRenderer.invoke("a2a:register-card", {
  name: "My Custom Agent",
  description: "自定义数据分析 Agent",
  capabilities: [
    {
      name: "data-analysis",
      description: "结构化数据分析与可视化",
      inputSchema: {
        type: "object",
        properties: {
          dataset: { type: "string" },
          analysisType: {
            type: "string",
            enum: ["summary", "trend", "anomaly"],
          },
        },
      },
    },
  ],
});
// result = { success: true, cardId: "card-uuid", url: "https://localhost:9001/a2a" }
```

## 更新 Agent Card

```javascript
const result = await window.electron.ipcRenderer.invoke("a2a:update-card", {
  cardId: "card-uuid",
  updates: {
    capabilities: [
      { name: "data-analysis", description: "增强版数据分析" },
      { name: "chart-generation", description: "图表自动生成" },
    ],
  },
});
// result = { success: true, version: 2 }
```

## 列出对等节点

```javascript
const peers = await window.electron.ipcRenderer.invoke("a2a:list-peers");
// peers = {
//   connected: [
//     { name: "Peer A", url: "https://192.168.1.5:9001/a2a", capabilities: 3, latencyMs: 12 },
//     { name: "Peer B", url: "https://192.168.1.10:9001/a2a", capabilities: 5, latencyMs: 45 },
//   ],
//   total: 2,
// }
```

## 能力协商

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "a2a:negotiate-capability",
  {
    requiredCapability: "code-review",
    preferredAgents: ["Peer A", "Peer B"],
    qualityThreshold: 0.8,
  },
);
// result = {
//   matched: true,
//   selectedAgent: {
//     name: "Peer B",
//     url: "https://192.168.1.10:9001/a2a",
//     capabilityScore: 0.95,
//     estimatedLatency: 45,
//   },
//   alternatives: [
//     { name: "Peer A", capabilityScore: 0.82, estimatedLatency: 12 },
//   ],
// }
```

## 系统架构

```
┌─────────────────────────────────────────────────┐
│                  A2A 协议引擎                     │
├─────────────────────────────────────────────────┤
│                                                   │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Agent    │  │ Task     │  │ Capability    │  │
│  │ Card     │  │ Lifecycle│  │ Negotiation   │  │
│  │ Registry │  │ Manager  │  │ Engine        │  │
│  └────┬─────┘  └────┬─────┘  └──────┬────────┘  │
│       │              │               │            │
│  ┌────▼──────────────▼───────────────▼────────┐  │
│  │           SSE Event Bus                     │  │
│  └────────────────┬───────────────────────────┘  │
│                   │                               │
│  ┌────────────────▼───────────────────────────┐  │
│  │      mDNS + DHT Discovery Layer            │  │
│  └────────────────────────────────────────────┘  │
│                                                   │
│  ┌─────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ DID Auth│  │ JSON-LD  │  │ P2P Transport  │  │
│  └─────────┘  └──────────┘  └────────────────┘  │
└─────────────────────────────────────────────────┘
```

## 配置选项

```json
{
  "a2aProtocol": {
    "enabled": true,
    "listenPort": 9001,
    "discoveryMethod": "mdns+dht",
    "authentication": "did",
    "taskTimeout": 60000,
    "maxConcurrentTasks": 20,
    "sseEnabled": true,
    "trustScoreThreshold": 0.5,
    "cardRefreshIntervalMs": 300000
  }
}
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `desktop-app-vue/src/main/ai-engine/a2a/a2a-protocol-engine.js` | A2A 协议核心引擎 |
| `desktop-app-vue/src/main/ai-engine/a2a/agent-card-registry.js` | Agent Card 注册与发现 |
| `desktop-app-vue/src/main/ai-engine/a2a/task-lifecycle-manager.js` | 任务生命周期管理 |
| `desktop-app-vue/src/main/ai-engine/a2a/a2a-ipc.js` | A2A IPC 处理器 |

## 使用示例

```javascript
// 1. 注册自定义 Agent Card
const card = await window.electron.ipcRenderer.invoke("a2a:register-card", {
  name: "数据分析Agent",
  description: "结构化数据分析与可视化",
  capabilities: [{ name: "data-analysis", description: "数据分析" }],
});

// 2. 发现具备特定能力的 Agent
const agents = await window.electron.ipcRenderer.invoke("a2a:discover-agents", {
  capability: "data-analysis",
  maxResults: 5,
});

// 3. 提交任务并订阅状态更新
const task = await window.electron.ipcRenderer.invoke("a2a:send-task", {
  targetUrl: agents.discovered[0].url,
  capability: "data-analysis",
  input: { dataset: "sales-2026-q1", analysisType: "trend" },
  timeout: 30000,
});
await window.electron.ipcRenderer.invoke("a2a:subscribe-updates", {
  taskId: task.taskId,
  events: ["status-change", "result"],
});
```

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| Agent 不可达 | 目标 Agent 离线或网络不通 | 执行 `a2a:list-peers` 确认在线状态，检查防火墙端口 9001 |
| 任务长时间处于 working | 远端 Agent 处理超时 | 调整 `taskTimeout` 配置，或取消任务重新提交 |
| SSE 订阅断开 | 网络抖动或 EventBus 异常 | 检查网络连接，重新调用 `a2a:subscribe-updates` |
| Agent Card 注册失败 | capabilities 格式不合规 | 确认 inputSchema 符合 JSON Schema 规范 |
| 能力协商无匹配 | 无 Agent 提供所需能力 | 降低 `qualityThreshold`，或扩大发现范围 |

## 配置参考

完整配置项说明（写入 `.chainlesschain/config.json`）：

```js
// .chainlesschain/config.json — a2aProtocol 段
{
  "a2aProtocol": {
    // 是否启用 A2A 协议引擎
    "enabled": true,

    // 本机 A2A 监听端口（对等节点通过此端口发现并连接）
    "listenPort": 9001,

    // Agent 发现方式：mdns（局域网）/ dht（广域网）/ mdns+dht（混合）
    "discoveryMethod": "mdns+dht",

    // 身份认证方式：did（推荐）/ token / none（仅开发环境）
    "authentication": "did",

    // 单任务最大执行时长（毫秒），超时自动标记为 failed
    "taskTimeout": 60000,

    // 本机同时可执行的最大任务数
    "maxConcurrentTasks": 20,

    // 是否启用 SSE 实时任务状态推送
    "sseEnabled": true,

    // 接受连接的最低信任评分（0~1），低于阈值的对等节点被拒绝
    "trustScoreThreshold": 0.5,

    // Agent Card 缓存刷新间隔（毫秒）
    "cardRefreshIntervalMs": 300000,

    // 对等节点心跳检测间隔（毫秒），超时视为离线
    "peerHeartbeatIntervalMs": 30000,

    // 最大对等节点缓存数量
    "maxPeerCacheSize": 200
  }
}
```

## 性能指标

在标准测试环境（MacBook Pro M2, 8 Core, 16 GB RAM，局域网 1 Gbps）下的实测基准：

| 操作 | 目标 | 实际 | 状态 |
| --- | --- | --- | --- |
| Agent Card 注册 | < 50 ms | 18 ms | ✅ |
| mDNS 对等节点发现（局域网） | < 500 ms | 220 ms | ✅ |
| DHT 对等节点发现（广域网） | < 3 s | 1.8 s | ✅ |
| 任务提交 (`a2a:send-task`) | < 100 ms | 42 ms | ✅ |
| 任务状态查询 | < 20 ms | 8 ms | ✅ |
| SSE 推送延迟（局域网） | < 30 ms | 11 ms | ✅ |
| 能力协商匹配 | < 200 ms | 95 ms | ✅ |
| 并发任务吞吐（20 任务） | > 15 tasks/s | 18.4 tasks/s | ✅ |
| Agent Card 缓存命中率 | > 90% | 96.2% | ✅ |
| DID 身份验证开销 | < 10 ms | 4.5 ms | ✅ |

> 注：广域网延迟受实际网络拓扑影响，以上数据基于同城 IDC 测试。

## 测试覆盖率

A2A 协议引擎测试覆盖率：**94.7%**（语句）/ **91.3%**（分支）

| 测试文件 | 覆盖范围 | 用例数 |
| --- | --- | --- |
| ✅ `tests/unit/a2a/a2a-protocol-engine.test.js` | 协议引擎核心逻辑、任务状态流转 | 38 |
| ✅ `tests/unit/a2a/agent-card-registry.test.js` | Card 注册、更新、发现、缓存失效 | 29 |
| ✅ `tests/unit/a2a/task-lifecycle-manager.test.js` | 全状态机流转、超时、并发边界 | 31 |
| ✅ `tests/unit/a2a/capability-negotiation.test.js` | 能力匹配、信任评分、备选排序 | 22 |
| ✅ `tests/unit/a2a/sse-event-bus.test.js` | SSE 订阅、断线重连、事件过滤 | 17 |
| ✅ `tests/unit/a2a/a2a-ipc.test.js` | 全部 8 个 IPC Handler 输入验证与返回格式 | 24 |
| ✅ `tests/integration/a2a/peer-discovery.test.js` | mDNS 发现、DHT 路由、心跳检测 | 14 |
| ✅ `tests/integration/a2a/task-e2e.test.js` | 完整跨 Agent 任务端到端流程 | 11 |

**运行测试**:

```bash
# 单元测试（全部 A2A 模块）
cd desktop-app-vue && npx vitest run tests/unit/a2a/

# 集成测试（需本地启动两个 A2A 节点）
cd desktop-app-vue && npx vitest run tests/integration/a2a/

# 查看覆盖率报告
cd desktop-app-vue && npx vitest run tests/unit/a2a/ --coverage
```

## 安全考虑

- **身份认证**: 所有 Agent 交互基于 DID 认证，需先完成 `did:chainless` 身份创建
- **任务隔离**: 每个任务在独立上下文中执行，任务间数据不可交叉访问
- **数据传输加密**: Agent 间通信使用 TLS 加密，敏感数据支持端到端加密
- **信任评分**: 仅与 `trustScoreThreshold` 以上的 Agent 建立连接，防止恶意节点
- **权限最小化**: Agent Card 仅声明必要能力，避免过度暴露服务端点
- **审计追踪**: 所有 A2A 交互记录完整审计日志，支持事后追溯

## 相关文档

- [Agent 联邦网络](/chainlesschain/agent-federation)
- [Agent 经济系统](/chainlesschain/agent-economy)
- [去中心化 Agent 网络](/chainlesschain/agent-network)
