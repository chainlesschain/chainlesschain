# 统一应用运行时

> **Phase 98 | v5.0.1 | 状态: ✅ 生产就绪 | 8 IPC Handlers**

ChainlessChain 统一应用运行时实现了 Desktop / Web / Mobile 三端统一代码库架构，基于 Electron + Capacitor + Web 三合一方案。内置 Plugin SDK 2.0（TypeScript SDK + CLI 脚手架）、无重启热更新、火焰图性能分析器和 CRDT 增强同步引擎，为跨平台一致性体验提供基础设施。

## 概述

统一应用运行时是 ChainlessChain 的跨平台基础设施层，通过 Electron + Capacitor + Web 三合一架构实现 95%+ 业务逻辑共享。它提供 Plugin SDK 2.0 用于插件开发与热重载、基于 Module Federation 的无重启热更新、火焰图性能分析器定位 CPU/内存热点，以及基于 Yjs CRDT 的多设备状态同步引擎（延迟 < 100ms）。

## 核心特性

- 🖥️ **三端统一代码库**: Electron（Desktop）+ Capacitor（iOS/Android）+ 纯 Web，共享 95%+ 业务逻辑，平台差异通过 Adapter 层抽象
- 🔧 **Plugin SDK 2.0**: TypeScript 类型安全 SDK + CLI 脚手架（`chainless plugin create`），支持热重载开发、自动化测试、文档生成
- ⚡ **无重启热更新**: 基于 Module Federation 的运行时代码注入，插件/模块更新无需重启应用，支持回滚
- 🔥 **内置性能分析器**: 火焰图（Flame Graph）可视化 CPU/内存热点，支持实时采样与离线分析，定位性能瓶颈
- 🔄 **CRDT 增强同步引擎**: 基于 Yjs CRDT 的多设备状态同步，支持离线编辑 + 自动冲突解决，延迟 < 100ms

## 系统架构

```
┌──────────────────────────────────────────────┐
│           统一应用运行时 (Universal Runtime)    │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │       共享业务逻辑层 (95%+)           │    │
│  │  Vue3 / Pinia / Plugin SDK 2.0       │    │
│  └──────────────────┬───────────────────┘    │
│         ┌───────────┼───────────┐            │
│         ▼           ▼           ▼            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│  │ Electron │ │Capacitor │ │   Web    │     │
│  │ Adapter  │ │ Adapter  │ │ Adapter  │     │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘     │
│       │            │            │            │
│  ┌────┴────┐ ┌─────┴────┐ ┌────┴──────┐    │
│  │热更新   │ │CRDT 同步 │ │性能分析器 │    │
│  │Module   │ │Yjs Engine│ │Flame Graph│    │
│  │Federation│ │         │ │          │    │
│  └─────────┘ └──────────┘ └───────────┘    │
└──────────────────────────────────────────────┘
```

---

## 关键文件

| 文件 | 职责 |
|------|------|
| `desktop-app-vue/src/main/runtime/universal-runtime.js` | 统一运行时核心引擎 |
| `desktop-app-vue/src/main/runtime/hot-update.js` | 无重启热更新 (Module Federation) |
| `desktop-app-vue/src/main/runtime/profiler.js` | 火焰图性能分析器 |
| `desktop-app-vue/src/main/collaboration/crdt-sync.js` | CRDT 增强同步引擎 (Yjs) |
| `desktop-app-vue/src/main/runtime/plugin-sdk.js` | Plugin SDK 2.0 运行时 |

## 相关文档

- [智能插件生态 2.0](/chainlesschain/plugin-ecosystem-v2)
- [工作流自动化引擎](/chainlesschain/workflow-automation)
- [协作治理](/chainlesschain/collaboration-governance)
- [产品路线图](/chainlesschain/product-roadmap)

---

## 平台适配架构

```
┌─────────────────────────────────────────┐
│           共享业务逻辑层 (95%+)          │
│   Vue3 Components / Pinia Stores / API  │
├──────────┬──────────┬───────────────────┤
│ Electron │ Capacitor│     Web           │
│ Adapter  │ Adapter  │   Adapter         │
├──────────┼──────────┼───────────────────┤
│ Node.js  │ Native   │   Service Worker  │
│ IPC      │ Bridge   │   + IndexedDB     │
└──────────┴──────────┴───────────────────┘
```

---

## 加载插件

```javascript
// 运行时动态加载插件
const plugin = await window.electron.ipcRenderer.invoke("runtime:load-plugin", {
  pluginId: "analytics-dashboard",
  version: "2.1.0",
  source: "marketplace", // "marketplace" | "local" | "url"
  config: {
    refreshInterval: 30000,
    theme: "dark",
  },
});
// plugin = { id: "analytics-dashboard", version: "2.1.0", status: "loaded", entryPoint: "/plugins/analytics-dashboard/index.js", capabilities: ["ui", "data-access"] }
```

## 热更新

```javascript
// 无重启推送模块更新
const update = await window.electron.ipcRenderer.invoke("runtime:hot-update", {
  moduleId: "ai-engine",
  version: "4.5.1",
  strategy: "graceful", // "graceful" | "immediate" | "scheduled"
  rollbackOnError: true,
});
// update = { moduleId: "ai-engine", previousVersion: "4.5.0", newVersion: "4.5.1", status: "applied", restartRequired: false, rollbackAvailable: true }
```

## 性能分析

```javascript
// 启动火焰图分析器
const profile = await window.electron.ipcRenderer.invoke("runtime:profile", {
  type: "cpu", // "cpu" | "memory" | "network" | "rendering"
  duration: 10000, // 采样持续时间 10s
  sampleRate: 1000, // 采样频率 1000Hz
  includeModules: true, // 包含模块级细分
});
// profile = {
//   type: "cpu",
//   duration: 10000,
//   samples: 10000,
//   flameGraph: { name: "root", value: 10000, children: [...] },
//   hotspots: [
//     { function: "vectorSearch", module: "rag-engine", selfTime: 2300, totalTime: 3100 },
//     { function: "renderMarkdown", module: "editor", selfTime: 1200, totalTime: 1800 },
//   ],
//   summary: { idle: 42, userCode: 38, systemCode: 15, gc: 5 }
// }
```

## CRDT 状态同步

```javascript
// 跨设备状态同步
const sync = await window.electron.ipcRenderer.invoke("runtime:sync-state", {
  scope: "document",
  documentId: "doc-001",
  operation: "merge", // "merge" | "push" | "pull" | "status"
  conflictStrategy: "crdt-auto", // "crdt-auto" | "last-write-wins" | "manual"
});
// sync = { documentId: "doc-001", status: "synced", peers: 3, conflicts: 0, lastSyncAt: 1710000000, latencyMs: 45 }
```

## 平台信息

```javascript
const platformInfo = await window.electron.ipcRenderer.invoke(
  "runtime:get-platform-info",
);
// platformInfo = {
//   platform: "electron",       // "electron" | "capacitor-ios" | "capacitor-android" | "web"
//   version: "5.0.0",
//   os: { name: "Windows", version: "10.0.19045", arch: "x64" },
//   runtime: { node: "20.11.0", chromium: "128.0.6613.178", electron: "39.2.6" },
//   capabilities: ["filesystem", "native-crypto", "hardware-key", "local-llm", "webrtc"],
//   plugins: { loaded: 12, available: 45 }
// }
```

## 运行时配置

```javascript
const config = await window.electron.ipcRenderer.invoke("runtime:configure", {
  hotUpdate: { enabled: true, checkInterval: 3600000 },
  sync: { enabled: true, syncInterval: 5000, maxPeers: 10 },
  profiler: { autoCapture: false, retentionHours: 24 },
  plugins: { autoLoad: true, sandboxMode: "strict" },
});
```

## 健康检查

```javascript
const health = await window.electron.ipcRenderer.invoke("runtime:health-check");
// health = {
//   status: "healthy",
//   uptime: 86400,
//   modules: [
//     { name: "ai-engine", status: "healthy", version: "4.5.1", memory: "128MB" },
//     { name: "sync-engine", status: "healthy", peers: 3, latency: "45ms" },
//     { name: "plugin-host", status: "degraded", loaded: 12, errors: 1 },
//   ],
//   resources: { cpuPercent: 12, memoryMB: 580, diskFreeMB: 45000 }
// }
```

## 运行时指标

```javascript
const metrics = await window.electron.ipcRenderer.invoke("runtime:get-metrics");
// metrics = {
//   uptime: 86400,
//   requests: { total: 125000, avgLatencyMs: 12, p99LatencyMs: 85 },
//   hotUpdates: { applied: 3, rolledBack: 0, pending: 1 },
//   sync: { totalOps: 45000, conflicts: 12, autoResolved: 12 },
//   plugins: { loaded: 12, crashed: 0, avgLoadTimeMs: 230 },
//   profiler: { capturesCount: 5, lastCaptureAt: 1710000000 }
// }
```

---

## IPC 通道

| 通道                        | 参数                                                 | 返回值       |
| --------------------------- | ---------------------------------------------------- | ------------ |
| `runtime:load-plugin`       | `{ pluginId, version?, source?, config? }`           | 插件加载结果 |
| `runtime:hot-update`        | `{ moduleId, version, strategy?, rollbackOnError? }` | 更新结果     |
| `runtime:profile`           | `{ type, duration?, sampleRate? }`                   | 性能分析数据 |
| `runtime:sync-state`        | `{ scope, documentId?, operation }`                  | 同步状态     |
| `runtime:get-platform-info` | 无                                                   | 平台信息     |
| `runtime:configure`         | `{ hotUpdate?, sync?, profiler?, plugins? }`         | 配置结果     |
| `runtime:health-check`      | 无                                                   | 健康状态     |
| `runtime:get-metrics`       | 无                                                   | 运行时指标   |

---

## 配置

在 `.chainlesschain/config.json` 中配置：

```json
{
  "universalRuntime": {
    "enabled": true,
    "platform": "auto",
    "hotUpdate": {
      "enabled": true,
      "checkInterval": 3600000,
      "autoApply": false,
      "rollbackOnError": true
    },
    "sync": {
      "enabled": true,
      "engine": "yjs-crdt",
      "syncInterval": 5000,
      "maxPeers": 10,
      "conflictStrategy": "crdt-auto"
    },
    "profiler": {
      "enabled": true,
      "autoCapture": false,
      "retentionHours": 24,
      "defaultSampleRate": 1000
    },
    "pluginSDK": {
      "version": "2.0",
      "sandboxMode": "strict",
      "maxPlugins": 50,
      "autoLoad": true
    }
  }
}
```

---

## 故障排查

| 问题 | 原因分析 | 解决方案 |
|------|---------|---------|
| 插件加载失败 | 插件版本不兼容或入口文件路径错误 | 检查插件 `version` 与运行时 SDK 版本兼容性，确认 `entryPoint` 路径存在且可访问 |
| 热更新后功能异常 | 新版本模块存在兼容性问题 | 系统自动回滚（`rollbackOnError: true`），检查更新日志确认变更内容；使用 `graceful` 策略避免中断 |
| CRDT 同步冲突 | 多设备离线编辑后同时上线 | 使用 `crdt-auto` 策略自动解决；若结果不理想，切换到 `manual` 策略手动合并 |
| 性能分析器采样数据为空 | 采样时间过短或 `sampleRate` 设置过低 | 增大 `duration`（建议 10 秒以上）和 `sampleRate`（建议 1000Hz），确保有足够的采样数据 |
| 平台适配层报错 | Capacitor 原生桥接未正确初始化 | 确认 Capacitor 插件已安装且配置正确，iOS/Android 端检查原生权限设置 |
| 健康检查显示 degraded | 某个模块出现错误或资源使用异常 | 查看 `health-check` 返回的 `modules` 详情，定位异常模块并检查其日志 |
| 同步延迟超过 100ms | 网络状况差或 peer 数量过多 | 减少 `maxPeers` 数量，优化网络环境；检查是否有大文档导致同步包过大 |

## 安全考虑

### 插件沙箱安全
- **沙箱模式**: 插件默认在 `strict` 沙箱模式下运行，禁止直接访问文件系统、网络和 IPC 通道，所有能力需通过权限声明获取
- **权限最小化**: 插件安装时用户需明确授权每项权限（`filesystem`、`network`、`ipc`），运行时严格执行权限边界
- **插件隔离**: 不同插件之间相互隔离，一个插件崩溃不会影响主应用或其他插件的运行

### 热更新安全
- **签名验证**: 热更新包在下载和应用前进行数字签名验证，拒绝未签名或签名不匹配的更新包
- **回滚机制**: 热更新后自动运行健康检查，异常时立即回滚到上一版本（`rollbackAvailable: true`）
- **灰度发布**: 支持 `scheduled` 策略在低峰时段推送更新，降低更新失败对用户的影响

### CRDT 同步安全
- **端到端加密**: 设备间的 CRDT 同步数据通过端到端加密传输，中间节点无法读取同步内容
- **设备认证**: 只有通过身份认证的设备才能加入同步网络，未授权设备的同步请求被拒绝
- **冲突审计**: 所有自动解决的冲突记录到日志中，用户可查看冲突历史并手动修正

### 性能分析隐私
- **本地分析**: 火焰图数据在本地生成和存储，不上传到外部服务器，`retentionHours`（默认 24 小时）后自动清理
- **采样数据脱敏**: 性能采样数据不包含用户输入内容或业务数据，仅记录函数调用栈和耗时信息

## 使用示例

### 插件加载与管理

```bash
# 1. 从市场加载插件
# IPC: runtime:load-plugin { pluginId: "analytics-dashboard", version: "2.1.0", source: "marketplace" }
# → status: "loaded", capabilities: ["ui", "data-access"]

# 2. 查看运行时健康状态，确认插件加载正常
# IPC: runtime:health-check
# → modules: [{ name: "plugin-host", status: "healthy", loaded: 13 }]

# 3. 卸载异常插件后重新加载
# IPC: runtime:load-plugin { pluginId: "analytics-dashboard", version: "2.1.1", source: "marketplace" }
```

### 免重启热更新

```bash
# 1. 推送 AI 引擎模块更新（graceful 策略等待当前请求完成）
# IPC: runtime:hot-update { moduleId: "ai-engine", version: "4.5.1", strategy: "graceful", rollbackOnError: true }
# → status: "applied", restartRequired: false

# 2. 若更新后功能异常，系统自动回滚
# → rollbackAvailable: true，健康检查失败时自动触发回滚

# 3. 查看热更新历史
# IPC: runtime:get-metrics
# → hotUpdates: { applied: 3, rolledBack: 0, pending: 1 }
```

### 火焰图性能分析

```bash
# 1. 采集 10 秒 CPU 火焰图
# IPC: runtime:profile { type: "cpu", duration: 10000, sampleRate: 1000, includeModules: true }

# 2. 分析热点函数
# → hotspots: [{ function: "vectorSearch", module: "rag-engine", selfTime: 2300ms }]
# → summary: { idle: 42%, userCode: 38%, systemCode: 15%, gc: 5% }

# 3. 针对热点优化后重新采样对比
# IPC: runtime:profile { type: "memory", duration: 10000 }
```

## 相关链接

- [智能插件生态 2.0](/chainlesschain/plugin-ecosystem-v2)
- [工作流自动化引擎](/chainlesschain/workflow-automation)
- [协作治理](/chainlesschain/collaboration-governance)
