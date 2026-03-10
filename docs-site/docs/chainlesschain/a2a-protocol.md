# A2A 协议引擎

> **版本: v4.1.0 | 状态: ✅ 生产就绪 | 8 IPC Handlers | Google A2A 标准实现 + Agent Card 发现 + 任务生命周期管理**

ChainlessChain A2A (Agent-to-Agent) 协议引擎实现 Google A2A 开放标准，使不同来源的 AI Agent 能够互相发现、协商能力和协作完成任务。通过 JSON-LD Agent Card 实现去中心化发现，支持完整的任务生命周期管理和实时订阅更新。

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
