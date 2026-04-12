# 层次化记忆系统 2.0

> **版本: v4.1.0 | 状态: ✅ 生产就绪 | 8 IPC Handlers | 4 层记忆架构 + 遗忘曲线 + 记忆巩固 + 跨 Agent 共享**

ChainlessChain 层次化记忆系统 2.0 模仿人类认知的多层记忆结构，提供工作记忆、短期记忆、长期记忆和核心记忆四个层次。系统基于 Ebbinghaus 遗忘曲线自动管理记忆衰减与巩固，支持情景记忆和语义记忆检索，并实现跨 Agent 记忆安全共享。

## 概述

层次化记忆系统 2.0 模拟人类认知的四层记忆架构（工作记忆/短期记忆/长期记忆/核心记忆），通过 Ebbinghaus 遗忘曲线自动管理记忆衰减，高频访问的记忆自动巩固提升层级。系统提供情景记忆（时间线检索）和语义记忆（向量相似度联想）两种检索模式，并支持基于 DID 认证的跨 Agent 记忆安全共享。

## 核心特性

- 🧠 **4 层记忆架构**: 工作记忆 → 短期记忆 → 长期记忆 → 核心记忆
- 📉 **遗忘曲线**: 基于 Ebbinghaus 模型，自动衰减不常访问的记忆
- 🔄 **记忆巩固**: 高频访问记忆自动提升层级，重要信息固化到核心层
- 🤝 **跨 Agent 共享**: 基于 DID 认证的记忆安全共享协议
- 🔍 **情景记忆检索**: 基于时间线和上下文的事件回忆
- 🧩 **语义记忆检索**: 基于向量相似度的概念联想

## 系统架构

```
┌────────────┐     ┌──────────────────┐     ┌───────────────────┐
│  Vue3 前端  │────→│  IPC 处理器       │────→│  Memory Manager   │
│  记忆管理   │     │  memory:*         │     │  4 层记忆引擎      │
└────────────┘     └──────────────────┘     └────────┬──────────┘
                                                      │
              ┌──────────┬──────────┬─────────────────┼──────────┐
              ▼          ▼          ▼                  ▼          ▼
        ┌──────────┐ ┌────────┐ ┌──────────┐  ┌──────────┐ ┌────────┐
        │ 工作记忆 │ │ 短期   │ │ 长期记忆 │  │ 核心记忆 │ │ 跨Agent│
        │ 30分钟   │ │ 7天    │ │ 90天     │  │ 永久     │ │ 共享   │
        └────┬─────┘ └───┬────┘ └────┬─────┘  └──────────┘ └────────┘
             │ 巩固 ↑    │ 巩固 ↑    │ 巩固 ↑
             └───────────┘───────────┘
                    遗忘曲线 (Ebbinghaus)
                    retention = e^(-t/S)
```

## 记忆层次架构

```
┌─────────────────────────────────────────────────┐
│                核心记忆 (Core)                    │
│  容量: 无限 | 衰减: 永不 | 内容: 身份/价值观/核心知识  │
├─────────────────────────────────────────────────┤
│              长期记忆 (Long-term)                  │
│  容量: 100K | 衰减: 90天 | 内容: 经验/技能/深度知识    │
├─────────────────────────────────────────────────┤
│              短期记忆 (Short-term)                 │
│  容量: 10K  | 衰减: 7天  | 内容: 近期对话/任务上下文   │
├─────────────────────────────────────────────────┤
│              工作记忆 (Working)                    │
│  容量: 100  | 衰减: 30分钟| 内容: 当前任务/活跃上下文  │
└─────────────────────────────────────────────────┘

巩固流程 (自下而上):
  工作记忆 ──[频繁访问]──→ 短期记忆 ──[重复强化]──→ 长期记忆 ──[标记重要]──→ 核心记忆

遗忘曲线 (Ebbinghaus):
  retention = e^(-t/S)
  t = 距上次访问的时间
  S = 记忆强度 (访问次数越多，S 越大)
```

## 存储记忆

```javascript
const result = await window.electron.ipcRenderer.invoke("memory:store", {
  content: "用户偏好使用 Vue3 Composition API 而非 Options API",
  type: "semantic", // semantic | episodic
  layer: "short-term", // working | short-term | long-term | core
  metadata: {
    source: "conversation",
    topic: "coding-preference",
    importance: 0.8,
    tags: ["vue", "coding-style"],
  },
});
// result = {
//   memoryId: "mem-uuid-001",
//   layer: "short-term",
//   strength: 1.0,
//   expiresAt: "2026-03-17T08:00:00Z",
//   embedding: true,
// }
```

## 回忆记忆

```javascript
const memories = await window.electron.ipcRenderer.invoke("memory:recall", {
  query: "用户的编码风格偏好",
  layers: ["short-term", "long-term", "core"], // 可指定搜索层
  maxResults: 5,
  minRelevance: 0.7,
});
// memories = {
//   results: [
//     {
//       memoryId: "mem-uuid-001",
//       content: "用户偏好使用 Vue3 Composition API 而非 Options API",
//       layer: "short-term",
//       relevance: 0.95,
//       strength: 1.0,
//       accessCount: 3,
//       lastAccessed: "2026-03-10T08:30:00Z",
//     },
//     {
//       memoryId: "mem-uuid-042",
//       content: "用户偏好 TypeScript 严格模式",
//       layer: "long-term",
//       relevance: 0.82,
//       strength: 3.2,
//       accessCount: 15,
//       lastAccessed: "2026-03-09T14:00:00Z",
//     },
//   ],
//   total: 2,
//   searchTimeMs: 12,
// }
```

## 触发记忆巩固

```javascript
const result = await window.electron.ipcRenderer.invoke("memory:consolidate", {
  sourceLayers: ["working", "short-term"],
  strategy: "frequency", // frequency | importance | hybrid
  dryRun: false,
});
// result = {
//   promoted: [
//     { memoryId: "mem-uuid-001", from: "short-term", to: "long-term", reason: "accessCount=15" },
//     { memoryId: "mem-uuid-007", from: "working", to: "short-term", reason: "importance=0.9" },
//   ],
//   pruned: [
//     { memoryId: "mem-uuid-099", layer: "working", reason: "strength < 0.1" },
//   ],
//   totalPromoted: 2,
//   totalPruned: 1,
// }
```

## 跨 Agent 共享记忆

```javascript
const result = await window.electron.ipcRenderer.invoke("memory:share", {
  memoryIds: ["mem-uuid-001", "mem-uuid-042"],
  targetAgentDid: "did:chainless:agent-bob",
  permissions: {
    read: true,
    write: false,
    reshare: false,
    expiresAt: "2026-04-10T00:00:00Z",
  },
});
// result = {
//   shared: 2,
//   shareToken: "share-token-uuid",
//   targetAgent: "did:chainless:agent-bob",
//   expiresAt: "2026-04-10T00:00:00Z",
// }
```

## 获取记忆统计

```javascript
const stats = await window.electron.ipcRenderer.invoke("memory:get-stats");
// stats = {
//   layers: {
//     working: { count: 23, capacityUsed: "23%", avgStrength: 0.8, oldestAge: "25m" },
//     "short-term": { count: 1842, capacityUsed: "18%", avgStrength: 1.5, oldestAge: "6d" },
//     "long-term": { count: 45230, capacityUsed: "45%", avgStrength: 3.2, oldestAge: "89d" },
//     core: { count: 156, capacityUsed: "N/A", avgStrength: "∞", oldestAge: "365d" },
//   },
//   totalMemories: 47251,
//   consolidationRuns: 128,
//   lastConsolidation: "2026-03-10T06:00:00Z",
//   sharedMemories: 42,
//   forgettingRate: 0.02,
// }
```

## 清理过期记忆

```javascript
const result = await window.electron.ipcRenderer.invoke("memory:prune", {
  layers: ["working", "short-term"],
  strengthThreshold: 0.1,
  dryRun: true,
});
// result = {
//   dryRun: true,
//   candidates: [
//     { memoryId: "mem-uuid-099", layer: "working", strength: 0.05, lastAccessed: "2026-03-10T07:00:00Z" },
//     { memoryId: "mem-uuid-103", layer: "short-term", strength: 0.08, lastAccessed: "2026-03-03T12:00:00Z" },
//   ],
//   totalCandidates: 2,
//   estimatedFreedMB: 0.5,
// }
```

## 情景记忆检索

```javascript
const episodes = await window.electron.ipcRenderer.invoke(
  "memory:search-episodic",
  {
    timeRange: {
      start: "2026-03-01T00:00:00Z",
      end: "2026-03-10T23:59:59Z",
    },
    context: "代码审查讨论",
    maxResults: 10,
  },
);
// episodes = {
//   results: [
//     {
//       memoryId: "mem-ep-001",
//       content: "与用户讨论了 PR #42 的安全漏洞，建议使用参数化查询",
//       timestamp: "2026-03-08T14:30:00Z",
//       context: { conversationId: "conv-123", topic: "code-review" },
//       emotionalValence: 0.3,
//     },
//   ],
//   total: 1,
// }
```

## 语义记忆检索

```javascript
const concepts = await window.electron.ipcRenderer.invoke(
  "memory:search-semantic",
  {
    concept: "依赖注入设计模式",
    associationDepth: 2, // 联想深度
    minSimilarity: 0.75,
  },
);
// concepts = {
//   results: [
//     {
//       memoryId: "mem-sem-001",
//       content: "IoC 容器通过构造函数注入管理组件依赖",
//       similarity: 0.96,
//       associations: ["SOLID 原则", "单例模式", "工厂模式"],
//     },
//     {
//       memoryId: "mem-sem-015",
//       content: "ServiceContainer 支持 singleton/transient/scoped 三种生命周期",
//       similarity: 0.88,
//       associations: ["ChainlessChain DI", "资源管理"],
//     },
//   ],
//   total: 2,
//   associationGraph: {
//     "依赖注入": ["IoC 容器", "SOLID 原则", "ServiceContainer"],
//     "IoC 容器": ["工厂模式", "单例模式"],
//   },
// }
```

## 配置选项

```json
{
  "hierarchicalMemory": {
    "enabled": true,
    "layers": {
      "working": { "maxCapacity": 100, "ttlMs": 1800000 },
      "short-term": { "maxCapacity": 10000, "ttlMs": 604800000 },
      "long-term": { "maxCapacity": 100000, "ttlMs": 7776000000 },
      "core": { "maxCapacity": -1, "ttlMs": -1 }
    },
    "forgettingCurve": {
      "enabled": true,
      "baseStrength": 1.0,
      "decayRate": 0.1,
      "reinforcementBonus": 0.5
    },
    "consolidation": {
      "intervalMs": 3600000,
      "strategy": "hybrid",
      "promotionThreshold": { "frequency": 10, "importance": 0.8 }
    },
    "sharing": {
      "enabled": true,
      "requireDIDAuth": true,
      "maxShareDuration": 2592000000
    },
    "embedding": {
      "model": "text-embedding-3-small",
      "dimensions": 1536
    }
  }
}
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/main/ai-engine/memory/hierarchical-memory-manager.js` | 4 层记忆核心引擎（存储/回忆/巩固/遗忘） |
| `src/main/ai-engine/memory/hierarchical-memory-ipc.js` | IPC 处理器（8 个通道） |
| `src/main/ai-engine/memory/forgetting-curve.js` | Ebbinghaus 遗忘曲线计算 |
| `src/main/ai-engine/memory/memory-sharing.js` | 跨 Agent DID 认证记忆共享 |
| `src/renderer/stores/hierarchicalMemory.ts` | Pinia 状态管理 |

## 使用示例

```javascript
// 1. 存储一条语义记忆到短期层
const mem = await window.electron.ipcRenderer.invoke("memory:store", {
  content: "项目使用 Vitest 替代 Jest 进行单元测试",
  type: "semantic",
  layer: "short-term",
  metadata: { topic: "testing", importance: 0.7 },
});

// 2. 根据关键词检索相关记忆
const results = await window.electron.ipcRenderer.invoke("memory:recall", {
  query: "单元测试框架选择",
  layers: ["short-term", "long-term", "core"],
  maxResults: 5,
  minRelevance: 0.6,
});

// 3. 触发记忆巩固（将高频记忆提升层级）
const consolidated = await window.electron.ipcRenderer.invoke("memory:consolidate", {
  sourceLayers: ["working", "short-term"],
  strategy: "hybrid",
  dryRun: false,
});
```

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 记忆存储后检索不到 | 嵌入向量未生成或层级不匹配 | 确认 embedding 服务可用，检查 `layers` 查询参数 |
| 巩固操作无记忆提升 | 访问频率或重要性未达阈值 | 调低 `promotionThreshold` 或使用 `importance` 策略 |
| 工作记忆容量已满 | 当前任务产生大量临时记忆 | 调用 `memory:prune` 清理低强度记忆，或增大 `maxCapacity` |
| 跨 Agent 共享失败 | DID 认证未通过 | 确认双方 DID 有效且已互相信任 |
| 遗忘曲线衰减过快 | `decayRate` 设置过高 | 调低 `forgettingCurve.decayRate`，增加 `reinforcementBonus` |

## 安全考虑

- **隐私保护**: 记忆内容默认仅本地存储，跨 Agent 共享需显式授权
- **加密存储**: 所有记忆数据通过 SQLCipher (AES-256) 加密，密钥由 U-Key 保护
- **访问控制**: 共享记忆支持细粒度权限（只读/读写/转授权），可设置过期时间
- **敏感记忆标记**: 包含密码、密钥等敏感信息的记忆自动标记，禁止跨 Agent 共享
- **审计日志**: 记忆的存储、访问、共享、删除操作均记录审计日志
- **数据最小化**: 遗忘曲线机制自动清理过期和低价值记忆，减少数据暴露面

## 相关文档

- [LLM 记忆系统 →](/chainlesschain/llm-memory)
- [会话管理 →](/chainlesschain/session)
- [DID 身份系统 →](/chainlesschain/did)
