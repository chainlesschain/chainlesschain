# 共享资源层与依赖注入

> **版本: v4.0.0-alpha | 状态: ✅ 生产就绪 | 4 IPC Handlers | 依赖注入容器 + 共享缓存 + 事件总线 + 资源池**

ChainlessChain 共享资源层为主进程各模块提供统一的依赖注入、缓存管理、事件通信和资源池化能力。ServiceContainer 支持循环依赖检测和生命周期管理，SharedCacheManager 提供 LRU+TTL 多策略缓存，EventBus 实现跨模块发布/订阅，ResourcePool 管理数据库连接等有限资源。

## 核心特性

- 🏗️ **ServiceContainer**: 依赖注入容器，支持单例/瞬态/作用域生命周期，循环依赖检测
- 💾 **SharedCacheManager**: LRU + TTL 双策略缓存，命名空间隔离，命中率统计
- 📡 **EventBus**: 发布/订阅模式，支持通配符订阅、优先级、异步广播
- 🔄 **ResourcePool**: 连接池管理，自动回收、健康检查、水位线告警

## 系统架构

```
┌─────────────────────────────────────────────────┐
│              应用层 (IPC Handlers)                │
│ cache-stats │ event-bus-stats │ service-health   │
├─────────────┴─────────────────┴─────────────────┤
│           ServiceContainer (DI 容器)              │
│   register → resolve → inject (拓扑排序)         │
│   lifecycle: singleton | transient | scoped      │
├────────────────┬──────────────┬──────────────────┤
│ SharedCache    │ EventBus     │ ResourcePool     │
│ Manager        │ (Pub/Sub)    │ (连接池)          │
│ LRU+TTL+NS   │ 通配符+优先级 │ 健康检查+水位线  │
├────────────────┴──────────────┴──────────────────┤
│         各业务模块 (AIEngine, RAG, P2P, ...)      │
└─────────────────────────────────────────────────┘
```

## 依赖注入架构

```
ServiceContainer
  │
  ├── register("database", DatabaseService, { lifecycle: "singleton" })
  ├── register("cache", SharedCacheManager, { lifecycle: "singleton" })
  ├── register("eventBus", EventBus, { lifecycle: "singleton" })
  ├── register("resourcePool", ResourcePool, { lifecycle: "singleton" })
  │
  ├── register("aiEngine", AIEngine, {
  │     lifecycle: "singleton",
  │     dependencies: ["database", "cache", "eventBus"]
  │   })
  │
  └── resolve("aiEngine")
        ├─ 检测循环依赖 (DFS 拓扑排序)
        ├─ 递归解析 dependencies
        ├─ 注入 { database, cache, eventBus }
        └─ 返回已初始化的 AIEngine 实例

生命周期:
  singleton  → 全局唯一，应用级共享
  transient  → 每次 resolve 创建新实例
  scoped     → 每个请求/会话创建一次
```

## 查看缓存统计

```javascript
const stats = await window.electron.ipcRenderer.invoke("core:cache-stats");
// stats = {
//   namespaces: {
//     "rag": { size: 256, maxSize: 1000, hitRate: 0.87, ttlMs: 300000 },
//     "llm-response": { size: 128, maxSize: 500, hitRate: 0.92, ttlMs: 600000 },
//     "user-profile": { size: 42, maxSize: 200, hitRate: 0.95, ttlMs: 3600000 },
//   },
//   totalEntries: 426,
//   totalHits: 18432,
//   totalMisses: 2104,
//   overallHitRate: 0.898,
//   memoryUsageMB: 12.4,
// }
```

## 查看事件总线统计

```javascript
const stats = await window.electron.ipcRenderer.invoke("core:event-bus-stats");
// stats = {
//   totalEvents: 45,
//   totalSubscribers: 128,
//   eventDetails: {
//     "note:created": { subscribers: 5, emitCount: 342 },
//     "ai:response-ready": { subscribers: 3, emitCount: 1024 },
//     "p2p:peer-connected": { subscribers: 8, emitCount: 56 },
//   },
//   wildcardSubscriptions: 4,
//   deadLetterCount: 2,
// }
```

## 服务健康检查

```javascript
const health = await window.electron.ipcRenderer.invoke("core:service-health");
// health = {
//   services: {
//     database: { status: "healthy", uptime: 3600000, memoryMB: 45.2 },
//     cache: { status: "healthy", uptime: 3600000, memoryMB: 12.4 },
//     eventBus: { status: "healthy", uptime: 3600000, pendingEvents: 0 },
//     resourcePool: { status: "healthy", uptime: 3600000, activeConnections: 3 },
//     aiEngine: { status: "healthy", uptime: 3580000, memoryMB: 128.5 },
//   },
//   circularDeps: [],
//   unresolvedDeps: [],
//   totalRegistered: 18,
//   totalResolved: 15,
// }
```

## 资源使用情况

```javascript
const usage = await window.electron.ipcRenderer.invoke("core:resource-usage");
// usage = {
//   pools: {
//     "db-connections": {
//       active: 3,
//       idle: 7,
//       max: 20,
//       waitQueue: 0,
//       avgAcquireTimeMs: 2.1,
//       healthCheckInterval: 30000,
//     },
//     "http-clients": {
//       active: 2,
//       idle: 3,
//       max: 10,
//       waitQueue: 0,
//       avgAcquireTimeMs: 0.5,
//     },
//   },
//   watermarks: {
//     "db-connections": { low: 5, high: 15, current: 10, status: "normal" },
//   },
//   totalAllocated: 15,
//   totalRecycled: 1024,
// }
```

## ServiceContainer 使用示例

```javascript
const { ServiceContainer } = require("./shared/service-container");

const container = new ServiceContainer();

// 注册服务
container.register("logger", LoggerService, { lifecycle: "singleton" });
container.register("database", DatabaseService, {
  lifecycle: "singleton",
  dependencies: ["logger"],
});
container.register("noteService", NoteService, {
  lifecycle: "scoped",
  dependencies: ["database", "logger"],
});

// 解析 (自动注入依赖)
const noteService = container.resolve("noteService");

// 循环依赖检测 — 注册时即抛出错误
container.register("a", ServiceA, { dependencies: ["b"] });
container.register("b", ServiceB, { dependencies: ["a"] });
// throws: CircularDependencyError: a → b → a
```

## 配置选项

```json
{
  "sharedResources": {
    "cache": {
      "defaultMaxSize": 1000,
      "defaultTtlMs": 300000,
      "evictionPolicy": "lru",
      "namespaces": {
        "rag": { "maxSize": 1000, "ttlMs": 300000 },
        "llm-response": { "maxSize": 500, "ttlMs": 600000 }
      }
    },
    "eventBus": {
      "maxListenersPerEvent": 20,
      "deadLetterEnabled": true,
      "asyncBroadcast": true
    },
    "resourcePool": {
      "dbConnections": { "min": 5, "max": 20, "idleTimeoutMs": 60000 },
      "healthCheckIntervalMs": 30000
    },
    "container": {
      "circularDepDetection": true,
      "autoDispose": true
    }
  }
}
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `desktop-app-vue/src/main/core/service-container.js` | DI 容器（循环依赖检测、生命周期管理） |
| `desktop-app-vue/src/main/core/shared-cache-manager.js` | LRU+TTL 多策略缓存管理 |
| `desktop-app-vue/src/main/core/event-bus.js` | 发布/订阅事件总线 |
| `desktop-app-vue/src/main/core/resource-pool.js` | 资源池（连接池、健康检查） |
| `desktop-app-vue/src/main/ipc/ipc-core.js` | 共享资源层 IPC Handler |

## 相关文档

- [数据库演进](/chainlesschain/database-evolution) — 数据库迁移与查询优化
- [性能优化](/chainlesschain/performance) — 缓存与资源池调优
- [IPC 系统](/chainlesschain/ipc) — IPC 域拆分与中间件
```
