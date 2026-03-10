# Phase 78 — IPC域分割与懒加载系统设计

**版本**: v4.0.0-alpha
**创建日期**: 2026-03-10
**状态**: ✅ 已实现

---

## 一、模块概述

Phase 78 将单体IPC注册表拆分为10个独立域（Domain），引入LazyPhaseLoader按需加载模块，并通过IPC Middleware实现速率限制、权限校验和性能计时，大幅降低启动时间和内存占用。

### 1.1 核心目标

1. **域分割**: 将IPC Registry拆分为10个逻辑域，实现模块化管理和按需注册
2. **懒加载**: LazyPhaseLoader按需加载Phase模块，首屏启动时间减少60%以上
3. **中间件管道**: IPC Middleware支持速率限制、权限校验、请求计时、日志审计
4. **运行时监控**: 提供域状态查询和预加载能力，支持动态调度

### 1.2 技术架构

```
┌─────────────────────────────────────────────────────┐
│              IPC Domain Split System                 │
│                                                      │
│  ┌────────────────────┐  ┌────────────────────────┐ │
│  │  IPC Middleware     │  │  LazyPhaseLoader       │ │
│  │  速率限制+权限校验  │  │  按需加载+依赖解析     │ │
│  │  请求计时+日志审计  │  │  预加载+缓存管理       │ │
│  └────────────────────┘  └────────────────────────┘ │
│  ┌──────────────────────────────────────────────────┐│
│  │              Domain Registry                      ││
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌───────┐ ││
│  │  │ core │ │  ai  │ │ p2p  │ │ ent  │ │ trade │ ││
│  │  └──────┘ └──────┘ └──────┘ └──────┘ └───────┘ ││
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌───────┐ ││
│  │  │social│ │  kb  │ │ mcp  │ │ sec  │ │ admin │ ││
│  │  └──────┘ └──────┘ └──────┘ └──────┘ └───────┘ ││
│  └──────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

---

## 二、核心模块设计

### 2.1 IPC Middleware (`ipc/ipc-middleware.js`)

IPC请求中间件管道，支持链式处理。

**核心方法**:

- `use(middlewareFn)` — 注册中间件函数（按添加顺序执行）
- `execute(channel, args, handler)` — 执行中间件链并调用最终handler
- `rateLimiter({ maxRequests, windowMs })` — 速率限制中间件工厂
- `permissionCheck(requiredRole)` — 权限校验中间件工厂
- `timing()` — 请求计时中间件，记录handler耗时
- `logger()` — 请求日志中间件，记录channel和参数摘要
- `getStats()` — 获取中间件统计（总请求数、被限流数、平均耗时）

### 2.2 LazyPhaseLoader (`ipc/lazy-phase-loader.js`)

Phase模块按需加载器，支持依赖解析和预加载。

**核心方法**:

- `initialize(phaseConfig)` — 初始化加载器，注册Phase定义和依赖关系
- `loadPhase(phaseId)` — 按需加载Phase（自动解析依赖链）
- `preloadDomain(domainName)` — 预加载指定域的所有Phase
- `unloadPhase(phaseId)` — 卸载Phase释放内存
- `getLoadStatus()` — 获取所有Phase加载状态
- `getDomainStatus(domainName)` — 获取指定域的加载详情
- `getRegistryStats()` — 获取注册表统计信息

### 2.3 Domain Registry (`ipc/domains/`)

10个IPC域模块，每个域管理一组相关的IPC handler。

**域列表**:

| 域名       | 文件                    | 说明                             |
| ---------- | ----------------------- | -------------------------------- |
| core       | `domains/core.js`       | 核心系统（配置、缓存、健康检查） |
| ai         | `domains/ai.js`         | AI引擎（Cowork、LLM、技能）      |
| p2p        | `domains/p2p.js`        | P2P通信（WebRTC、信令）          |
| enterprise | `domains/enterprise.js` | 企业功能（RBAC、SSO、审计）      |
| trade      | `domains/trade.js`      | 交易系统（资产、市场）           |
| social     | `domains/social.js`     | 社交模块（DID、论坛、消息）      |
| kb         | `domains/kb.js`         | 知识库（笔记、RAG、搜索）        |
| mcp        | `domains/mcp.js`        | MCP集成（工具、服务器）          |
| security   | `domains/security.js`   | 安全模块（U-Key、加密）          |
| admin      | `domains/admin.js`      | 管理后台（监控、日志、诊断）     |

每个域文件导出:

```javascript
module.exports = {
  name: "core",
  phases: ["phase-1", "phase-2"],
  handlers: {
    /* channel -> handler mapping */
  },
  initialize(deps) {
    /* ... */
  },
};
```

---

## 三、核心文件

| 文件                                 | 说明                                  |
| ------------------------------------ | ------------------------------------- |
| `src/main/ipc/ipc-middleware.js`     | IPC中间件管道（速率限制、权限、计时） |
| `src/main/ipc/lazy-phase-loader.js`  | Phase懒加载器（按需加载、依赖解析）   |
| `src/main/ipc/domains/index.js`      | 域注册表入口（聚合所有域）            |
| `src/main/ipc/domains/core.js`       | 核心域定义                            |
| `src/main/ipc/domains/ai.js`         | AI域定义                              |
| `src/main/ipc/domains/p2p.js`        | P2P域定义                             |
| `src/main/ipc/domains/enterprise.js` | 企业域定义                            |
| `src/main/ipc/domains/trade.js`      | 交易域定义                            |
| `src/main/ipc/domains/social.js`     | 社交域定义                            |
| `src/main/ipc/domains/kb.js`         | 知识库域定义                          |
| `src/main/ipc/domains/mcp.js`        | MCP域定义                             |
| `src/main/ipc/domains/security.js`   | 安全域定义                            |
| `src/main/ipc/domains/admin.js`      | 管理域定义                            |

---

## 四、IPC Handlers

| Channel                  | 说明                                                    |
| ------------------------ | ------------------------------------------------------- |
| `ipc:get-registry-stats` | 获取IPC注册表统计（总handler数、各域handler数、加载率） |
| `ipc:get-domain-status`  | 获取指定域状态（已加载Phase、内存占用、handler列表）    |
| `ipc:preload-domain`     | 预加载指定域的所有模块（返回加载耗时和结果）            |

---

## 五、数据库表

本Phase不引入新数据库表。中间件统计和域状态均存储在内存中，通过IPC接口查询。

---

## 六、测试覆盖

| 测试文件                                           | 测试数量 | 状态        |
| -------------------------------------------------- | -------- | ----------- |
| `src/main/ipc/__tests__/ipc-middleware.test.js`    | 20       | ✅ 通过     |
| `src/main/ipc/__tests__/lazy-phase-loader.test.js` | 22       | ✅ 通过     |
| **合计**                                           | **42**   | ✅ 全部通过 |

### 测试要点

- 中间件链式执行顺序验证
- 速率限制窗口滑动和计数重置
- 权限校验拦截和放行逻辑
- Phase依赖解析和循环依赖检测
- 域预加载和卸载的内存管理
- 并发加载同一Phase的去重处理

---

## 七、前端集成

### Pinia Store

- `ipcRegistry.ts` — 域状态、注册表统计、预加载触发

### Vue Pages

- `IpcRegistryPage.vue` — 域状态可视化、handler列表、预加载操作

### Routes

- `/admin/ipc-registry` — IPC注册表管理

---

## 八、配置选项

```javascript
ipcDomainSplit: {
  enabled: true,
  lazyLoadEnabled: true,
  preloadDomains: ['core'],           // 启动时预加载的域
  rateLimitMaxRequests: 100,          // 默认速率限制（每窗口）
  rateLimitWindowMs: 60000,           // 速率限制窗口（ms）
  timingEnabled: true,                // 是否启用请求计时
  unloadIdleAfterMs: 300000,          // 空闲Phase卸载时间（ms）
}
```
