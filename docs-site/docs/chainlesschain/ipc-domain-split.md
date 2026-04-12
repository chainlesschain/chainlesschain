# IPC 域分割与懒加载

> **版本: v4.0.0-alpha | 状态: ✅ 生产就绪 | 3 IPC Handlers | 10 域文件 | 主进程 IPC 拆分与按需加载**

ChainlessChain IPC 域分割系统将单体 `index.js` 中的 200+ IPC handler 按业务领域拆分为 10 个独立域文件，并通过 LazyPhaseLoader 实现按需加载，显著降低启动时间和内存占用。IPC Middleware 层提供速率限制、权限检查和性能计时等横切关注点。

## 概述

IPC 域分割与懒加载系统将 200+ IPC handler 按业务领域拆分为 10 个独立域文件（core/ai/enterprise/social/security 等），通过 LazyPhaseLoader 实现按需加载，未使用的域零内存开销。系统配套 IPC Middleware 管道提供速率限制、RBAC 权限校验和执行计时等横切关注点，支持预测性预加载和域加载状态实时监控。

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

## H2 IPC Registry 拆分收官 (v0.45.30 → v0.45.60)

H2 任务把 `ipc-registry.js` 从 4925 行拆到 493 行（−4432，−90%），共抽出 16 个 phase 模块、88 个 phase。详见 `docs/design/modules/43_IPC域分割与懒加载系统.md` 第九节。

收官阶段（v0.45.59~60）做了两件事：

- **修掉两处隐藏的 ReferenceError**：Phase 5 / Phase 9-15 的 `deps` 构造曾用 `{ mcpClientManager, mcpToolAdapter }` 简写但顶部从未声明这两个标识符。由于 `...dependencies` 已经覆盖了它们，简写引用纯属冗余 + 真实潜在 bug——`dependencies` 入参缺失任一字段时立即抛 `ReferenceError`，导致主进程启动失败。
- **清掉死解构块**：主文件顶部 30+ 行的 destructure（绝大多数项只解构出来又通过 `...dependencies` 转发）压缩到只剩 5 个本文件直接引用的 manager (`app` / `database` / `mainWindow` / `llmManager` / `aiEngineManager`)，其余通过 `...dependencies` 透传。

最终 `ipc-registry.js` 从 493 → 446 行，职责收敛到 "协调注册顺序 + 工具函数 + 全局守卫"。

## M2 启动期同步 IO 异步化 (v0.45.55~58)

M2 任务的目标是把启动关键路径上的同步 IO 全部转为 `fs.promises`，避免阻塞 Electron 主进程事件循环。共改造 11 个模块：

- **Config 加载层**：unified-config-manager / ai-engine-config / tool-skill-mapper-config / mcp-config-loader / database-config — 全部新增 `loadAsync()` + `prewarmXxx()` 入口
- **Logger**：构造期 IO `setImmediate` 延迟到下个事件循环
- **Git**：`git-auto-commit.isGitRepository()` 改用 `fs.promises.stat` + ENOENT/ENOTDIR 容错
- **Project**：`project-config.js` 新增 `initializeAsync` / `loadConfigAsync` / `saveConfigAsync` + `getProjectConfigAsync()` 工厂
- **AI Engine**：`ai-engine-manager.js` / `ai-engine-manager-p1.js` / `ai-engine-manager-optimized.js` 三个变体的 `initialize()` 改用 `await getProjectConfigAsync()`，消除 IPC 注册路径上最后一处启动期 `existsSync` + `readFileSync`

所有改造均使用 `_deps` 注入模式（`module.exports._deps = _deps`）以保持单元测试可 mock，同步 API 作为运行时快路径保留。

## 相关文档

- [DI 容器](/chainlesschain/di-container)
- [Cowork 多智能体协作](/chainlesschain/cowork)
- [权限管理](/chainlesschain/compliance)
- [审计与合规](/chainlesschain/audit)
