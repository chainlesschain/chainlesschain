# IPC 域分割与懒加载

> **版本: v4.0.0-alpha | 状态: ✅ 生产就绪 | 3 IPC Handlers | 10 域文件 | 主进程 IPC 拆分与按需加载**

ChainlessChain IPC 域分割系统将单体 `index.js` 中的 200+ IPC handler 按业务领域拆分为 10 个独立域文件，并通过 LazyPhaseLoader 实现按需加载，显著降低启动时间和内存占用。IPC Middleware 层提供速率限制、权限检查和性能计时等横切关注点。

## 核心特性

- 📂 **10 域文件拆分**: core / ai / enterprise / social / security / p2p / evomap / infra / marketplace / autonomous
- ⚡ **LazyPhaseLoader**: 按需加载域文件，未使用的域零内存开销
- 🛡️ **IPC Middleware**: 速率限制、权限检查、执行计时、错误标准化
- 📊 **注册表统计**: 实时查看各域 handler 注册状态与调用频次
- 🔄 **预加载策略**: 支持预测性预加载高频域，减少首次调用延迟

## 系统架构

```
┌─────────────────────────────────────────────────┐
│                  Renderer Process                │
│              (Vue3 ipcRenderer.invoke)           │
└──────────────────────┬──────────────────────────┘
                       │ IPC 调用
                       ▼
┌─────────────────────────────────────────────────┐
│              IPC Middleware 层                    │
│  ┌─────────────┬─────────────┬───────────────┐  │
│  │ RateLimiter │ PermGuard   │ TimingLogger  │  │
│  └──────┬──────┴──────┬──────┴───────┬───────┘  │
└─────────┼─────────────┼─────────────┼───────────┘
          │             │             │
          ▼             ▼             ▼
┌─────────────────────────────────────────────────┐
│            LazyPhaseLoader (按需加载)            │
│  ┌──────┐ ┌────┐ ┌──────────┐ ┌──────┐ ┌────┐  │
│  │ core │ │ ai │ │enterprise│ │social│ │ p2p│  │
│  └──────┘ └────┘ └──────────┘ └──────┘ └────┘  │
│  ┌────────┐ ┌──────┐ ┌─────┐ ┌───────────────┐ │
│  │security│ │evomap│ │infra│ │  marketplace  │ │
│  └────────┘ └──────┘ └─────┘ └───────────────┘ │
│  ┌────────────┐                                  │
│  │ autonomous │                                  │
│  └────────────┘                                  │
└─────────────────────────────────────────────────┘
```

## 域分割架构

```
src/main/
├── index.js                    ← 入口，初始化 LazyPhaseLoader
├── ipc-domains/
│   ├── core.domain.js          ← 基础功能 (笔记/搜索/配置)
│   ├── ai.domain.js            ← AI 引擎 (LLM/RAG/Cowork)
│   ├── enterprise.domain.js    ← 企业功能 (RBAC/SSO/审计)
│   ├── social.domain.js        ← 社交功能 (DID/论坛/消息)
│   ├── security.domain.js      ← 安全功能 (U-Key/加密)
│   ├── p2p.domain.js           ← P2P 网络 (WebRTC/信令)
│   ├── evomap.domain.js        ← EvoMap 生态 (基因/治理)
│   ├── infra.domain.js         ← 基础设施 (数据库/日志/分析)
│   ├── marketplace.domain.js   ← 交易市场 (资产/合约)
│   └── autonomous.domain.js    ← 自主代理 (工作流/联邦)
├── ipc-middleware/
│   ├── rate-limiter.js         ← 滑动窗口速率限制
│   ├── permission-guard.js     ← RBAC 权限校验
│   └── timing-logger.js        ← 调用耗时记录
└── lazy-phase-loader.js        ← 按需加载调度器
```

## 域加载流程

```
应用启动
  │
  ├─ 立即加载: core.domain.js (基础功能)
  │
  ├─ 用户触发 AI 功能
  │   └─ LazyPhaseLoader.load("ai")
  │       ├─ 动态 require("./ipc-domains/ai.domain.js")
  │       ├─ 注册该域所有 IPC handlers
  │       └─ 标记为已加载，后续调用直接跳过
  │
  ├─ IPC 调用流经 Middleware
  │   ├─ rate-limiter    → 检查是否超限
  │   ├─ permission-guard → 检查 RBAC 权限
  │   ├─ timing-logger   → 记录开始时间
  │   ├─ [actual handler] → 执行业务逻辑
  │   └─ timing-logger   → 记录耗时
  │
  └─ 未使用的域保持未加载状态 (零开销)
```

## 查看注册表统计

```javascript
const stats = await window.electron.ipcRenderer.invoke(
  "ipc:get-registry-stats",
);
// stats = {
//   totalHandlers: 213,
//   loadedDomains: ["core", "ai"],
//   unloadedDomains: ["enterprise", "social", "security", "p2p", "evomap", "infra", "marketplace", "autonomous"],
//   handlersByDomain: {
//     core: 42,
//     ai: 58,
//   },
//   callFrequency: {
//     "core:search-notes": 1280,
//     "ai:chat-completion": 456,
//   },
// }
```

## 查看域状态

```javascript
const status = await window.electron.ipcRenderer.invoke(
  "ipc:get-domain-status",
  "ai",
);
// status = {
//   domain: "ai",
//   loaded: true,
//   loadedAt: "2026-03-10T08:12:34.567Z",
//   handlerCount: 58,
//   totalCalls: 1024,
//   avgResponseTime: 45.2,
//   middlewareStats: {
//     rateLimitBlocked: 3,
//     permissionDenied: 12,
//   },
// }
```

## 预加载域

```javascript
const result = await window.electron.ipcRenderer.invoke("ipc:preload-domain", {
  domain: "enterprise",
  priority: "high", // high | normal | low
});
// result = {
//   success: true,
//   domain: "enterprise",
//   handlerCount: 35,
//   loadTimeMs: 120,
// }
```

## Middleware 配置

```json
{
  "ipcMiddleware": {
    "rateLimiter": {
      "enabled": true,
      "windowMs": 60000,
      "maxRequests": 100,
      "perChannel": true
    },
    "permissionGuard": {
      "enabled": true,
      "defaultPolicy": "allow",
      "auditLog": true
    },
    "timingLogger": {
      "enabled": true,
      "slowThresholdMs": 500,
      "logLevel": "warn"
    }
  },
  "lazyLoader": {
    "preloadDomains": ["core"],
    "predictivePreload": true,
    "unloadIdleMs": 300000
  }
}
```

## 配置选项

```json
{
  "ipcDomainSplit": {
    "enabled": true,
    "domainDir": "ipc-domains",
    "middlewareOrder": ["rate-limiter", "permission-guard", "timing-logger"],
    "preloadOnStartup": ["core"],
    "lazyLoadTimeout": 5000,
    "maxHandlersPerDomain": 100
  }
}
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/main/index.js` | 应用入口，初始化 LazyPhaseLoader |
| `src/main/ipc/lazy-phase-loader.js` | 按需加载调度器，管理域注册与卸载 |
| `src/main/ipc/ipc-middleware.js` | Middleware 管道，串联速率限制/权限/计时 |
| `src/main/ipc/domains/core.domain.js` | 核心域 IPC handlers（笔记/搜索/配置） |
| `src/main/ipc/domains/ai.domain.js` | AI 域 IPC handlers（LLM/RAG/Cowork） |
| `src/main/ipc/domains/enterprise.domain.js` | 企业域 IPC handlers（RBAC/SSO/审计） |

## 使用示例

```javascript
// 1. 查看当前域加载状态
const stats = await window.electron.ipcRenderer.invoke("ipc:get-registry-stats");
console.log("已加载域:", stats.loadedDomains);
console.log("未加载域:", stats.unloadedDomains);

// 2. 预加载高频使用的域（减少首次调用延迟）
await window.electron.ipcRenderer.invoke("ipc:preload-domain", {
  domain: "ai",
  priority: "high",
});

// 3. 查看特定域的调用统计与中间件拦截情况
const aiStatus = await window.electron.ipcRenderer.invoke("ipc:get-domain-status", "ai");
console.log("平均响应时间:", aiStatus.avgResponseTime, "ms");
console.log("权限拒绝次数:", aiStatus.middlewareStats.permissionDenied);
```

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| IPC 调用返回 handler 未注册 | 对应域尚未加载 | 确认域名拼写正确，或手动预加载 `ipc:preload-domain` |
| 域加载超时 | 域文件依赖模块加载缓慢 | 调大 `lazyLoadTimeout`，检查域文件是否有重量级依赖 |
| 速率限制触发过频 | 前端高频轮询同一通道 | 增大 `maxRequests` 或使用 EventBus 订阅替代轮询 |
| 权限检查拒绝 | 用户角色无该通道权限 | 检查 RBAC 配置，确认角色拥有对应 IPC 通道权限 |
| Middleware 导致响应变慢 | 计时日志或权限检查开销大 | 关闭 `timingLogger` 或调高 `slowThresholdMs` |

## 安全考虑

- **权限守卫**: 每个 IPC 调用经过 PermissionGuard 中间件校验 RBAC 权限
- **速率限制**: 滑动窗口速率限制防止 DoS 攻击，支持按通道独立配置
- **域隔离**: 各域文件独立加载，一个域的异常不影响其他域正常运行
- **审计日志**: TimingLogger 记录所有 IPC 调用耗时，慢调用自动告警
- **最小加载**: 未使用的域保持未加载状态，减少攻击面
- **默认策略**: `permissionGuard.defaultPolicy` 生产环境建议设为 `deny`

## 相关文档

- [DI 容器](/chainlesschain/di-container)
- [Cowork 多智能体协作](/chainlesschain/cowork)
- [权限管理](/chainlesschain/compliance)
- [审计与合规](/chainlesschain/audit)
