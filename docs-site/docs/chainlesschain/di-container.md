# 共享资源层与依赖注入

> **版本: v4.0.0-alpha | 状态: ✅ 生产就绪 | 4 IPC Handlers | 依赖注入容器 + 共享缓存 + 事件总线 + 资源池**

## 概述

共享资源层为 Electron 主进程各模块提供统一的基础设施，包括 ServiceContainer（依赖注入 + 循环依赖检测）、SharedCacheManager（LRU+TTL 多策略缓存）、EventBus（发布/订阅通信）和 ResourcePool（连接池管理）。四大组件协同工作，解耦模块间依赖并统一管理共享资源的生命周期。

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

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| CircularDependencyError | 服务 A 依赖 B，B 又依赖 A | 重新设计依赖关系，引入中间服务或使用事件总线解耦 |
| 服务解析返回 undefined | 服务未注册或名称拼写错误 | 调用 `core:service-health` 查看已注册服务列表 |
| 缓存命中率低 | TTL 设置过短或命名空间配置不当 | 查看 `core:cache-stats` 调整 TTL 和 maxSize |
| EventBus 死信过多 | 订阅者已销毁但未取消订阅 | 在模块 dispose 时调用 `eventBus.off()` 清理订阅 |
| 资源池连接耗尽 | 并发请求超过 max 连接数 | 增大 `dbConnections.max`，检查是否有连接泄漏 |

## 配置参考

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `cache.defaultMaxSize` | number | `1000` | 缓存命名空间默认最大条目数 |
| `cache.defaultTtlMs` | number | `300000` | 缓存默认 TTL（毫秒，5 分钟） |
| `cache.evictionPolicy` | string | `"lru"` | 淘汰策略：`lru`（最近最少使用） |
| `cache.namespaces.rag.maxSize` | number | `1000` | RAG 命名空间最大条目数 |
| `cache.namespaces.rag.ttlMs` | number | `300000` | RAG 缓存 TTL（毫秒） |
| `cache.namespaces.llm-response.maxSize` | number | `500` | LLM 响应缓存最大条目数 |
| `cache.namespaces.llm-response.ttlMs` | number | `600000` | LLM 响应缓存 TTL（毫秒，10 分钟） |
| `eventBus.maxListenersPerEvent` | number | `20` | 单事件最大订阅者数量 |
| `eventBus.deadLetterEnabled` | boolean | `true` | 是否启用死信队列（无订阅者时记录） |
| `eventBus.asyncBroadcast` | boolean | `true` | 是否异步广播（避免阻塞发布方） |
| `resourcePool.dbConnections.min` | number | `5` | 数据库连接池最小连接数 |
| `resourcePool.dbConnections.max` | number | `20` | 数据库连接池最大连接数 |
| `resourcePool.dbConnections.idleTimeoutMs` | number | `60000` | 空闲连接回收超时（毫秒） |
| `resourcePool.healthCheckIntervalMs` | number | `30000` | 连接健康检查间隔（毫秒） |
| `container.circularDepDetection` | boolean | `true` | 是否在注册时检测循环依赖 |
| `container.autoDispose` | boolean | `true` | 容器销毁时是否自动调用服务的 `dispose()` |

---

## 性能指标

| 指标 | 典型值 | 说明 |
| --- | --- | --- |
| 服务注册耗时 | < 1ms | 单次 `container.register()` 同步调用 |
| 服务解析耗时（无依赖） | < 0.1ms | 单例命中缓存，直接返回 |
| 服务解析耗时（3 级依赖树） | < 5ms | 含循环依赖检测（DFS 拓扑排序） |
| 缓存读取延迟（命中） | < 0.05ms | LRU Map 直接命中 |
| 缓存写入延迟 | < 0.1ms | 含 TTL 设置和 LRU 更新 |
| 整体缓存命中率（典型） | 87–95% | 取决于命名空间 TTL 与访问频率配置 |
| EventBus 同步广播延迟 | < 1ms | 10 个订阅者以内 |
| EventBus 异步广播延迟 | < 5ms | `asyncBroadcast: true`，基于微任务队列 |
| 连接池获取连接耗时 | < 3ms | 有空闲连接时直接返回；无空闲时等待回收 |
| 连接健康检查间隔 | 30s | `healthCheckIntervalMs` 默认值 |
| 内存占用（全量加载） | ~12–20MB | 含所有命名空间缓存和连接池元数据 |

> **优化建议**: 对访问频繁但数据变化慢的命名空间（如 `user-profile`）适当增大 `ttlMs`；RAG 缓存命中率低于 0.7 时应增大 `maxSize` 而非缩短 TTL。

---

## 测试覆盖率

| 模块 | 测试文件 | 测试数 | 覆盖率 |
| --- | --- | --- | --- |
| ServiceContainer（DI 容器） | `tests/unit/core/service-container.test.js` | 38 | 97% |
| SharedCacheManager（缓存） | `tests/unit/core/shared-cache-manager.test.js` | 44 | 96% |
| EventBus（事件总线） | `tests/unit/core/event-bus.test.js` | 36 | 95% |
| ResourcePool（资源池） | `tests/unit/core/resource-pool.test.js` | 32 | 93% |
| IPC Handlers（4 个） | `tests/unit/ipc/ipc-core.test.js` | 28 | 94% |
| 循环依赖检测 | `tests/unit/core/circular-dep-detection.test.js` | 18 | 100% |
| **合计** | 6 文件 | **196** | **96%** |

运行测试：

```bash
# 共享资源层全量测试
cd desktop-app-vue && npx vitest run tests/unit/core/

# 含 IPC Handler 测试
cd desktop-app-vue && npx vitest run tests/unit/core/ tests/unit/ipc/ipc-core.test.js

# 单模块测试（如循环依赖检测）
cd desktop-app-vue && npx vitest run tests/unit/core/circular-dep-detection.test.js
```

---

## 安全考虑

- **服务隔离**: scoped 生命周期确保请求间服务实例独立，防止状态泄漏
- **循环依赖检测**: 注册时即检测循环依赖并抛出错误，防止运行时死锁
- **缓存命名空间**: 不同模块缓存通过命名空间隔离，防止数据污染
- **资源池健康检查**: 定期检测连接健康状态，自动回收失效连接
- **EventBus 权限**: 敏感事件支持发布者/订阅者权限校验
- **自动释放**: `autoDispose` 确保服务销毁时释放持有的资源，防止内存泄漏

## 使用示例

### 服务注册与依赖注入

```javascript
const { ServiceContainer } = require('./shared/service-container');
const container = new ServiceContainer();

// 注册单例服务（全局唯一实例）
container.register('logger', LoggerService, { lifecycle: 'singleton' });
container.register('database', DatabaseService, {
  lifecycle: 'singleton',
  dependencies: ['logger']
});

// 注册作用域服务（每个请求/会话独立实例）
container.register('noteService', NoteService, {
  lifecycle: 'scoped',
  dependencies: ['database', 'logger']
});

// 解析服务时自动注入所有声明的依赖
const noteService = container.resolve('noteService');
// noteService 已自动获得 database 和 logger 实例
```

### 生命周期管理

```javascript
// 瞬态服务：每次 resolve 创建新实例（适用于无状态工具类）
container.register('validator', ValidatorService, { lifecycle: 'transient' });
const v1 = container.resolve('validator');
const v2 = container.resolve('validator');
// v1 !== v2，每次都是新实例

// 销毁时自动释放资源（需开启 autoDispose）
// 单例服务在容器销毁时调用 dispose() 方法释放数据库连接等资源
```

### 循环依赖检测

```javascript
// 注册时即检测循环依赖，立刻抛出错误而非运行时死锁
container.register('serviceA', ServiceA, { dependencies: ['serviceB'] });
container.register('serviceB', ServiceB, { dependencies: ['serviceA'] });
// 抛出: CircularDependencyError: serviceA → serviceB → serviceA
// 解决方案：引入中间服务或使用 EventBus 解耦
```

### 标签查询与服务发现

```javascript
// 通过 IPC 查看所有已注册服务的健康状态
const health = await window.electron.ipcRenderer.invoke('core:service-health');
// health.services 列出每个服务的 status/uptime/memoryMB
// health.circularDeps 为空数组表示无循环依赖
// health.unresolvedDeps 列出尚未解析的依赖项

// 查看缓存命名空间统计（辅助调优 TTL 和 maxSize）
const cacheStats = await window.electron.ipcRenderer.invoke('core:cache-stats');
// 关注 hitRate 低于 0.5 的命名空间，考虑增大 TTL 或 maxSize
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
