# 统一应用运行时

> **Phase 98 | v5.0.0 | 状态: ✅ 生产就绪 | 8 IPC Handlers**

ChainlessChain 统一应用运行时实现了 Desktop / Web / Mobile 三端统一代码库架构，基于 Electron + Capacitor + Web 三合一方案。内置 Plugin SDK 2.0（TypeScript SDK + CLI 脚手架）、无重启热更新、火焰图性能分析器和 CRDT 增强同步引擎，为跨平台一致性体验提供基础设施。

## 核心特性

- 🖥️ **三端统一代码库**: Electron（Desktop）+ Capacitor（iOS/Android）+ 纯 Web，共享 95%+ 业务逻辑，平台差异通过 Adapter 层抽象
- 🔧 **Plugin SDK 2.0**: TypeScript 类型安全 SDK + CLI 脚手架（`chainless plugin create`），支持热重载开发、自动化测试、文档生成
- ⚡ **无重启热更新**: 基于 Module Federation 的运行时代码注入，插件/模块更新无需重启应用，支持回滚
- 🔥 **内置性能分析器**: 火焰图（Flame Graph）可视化 CPU/内存热点，支持实时采样与离线分析，定位性能瓶颈
- 🔄 **CRDT 增强同步引擎**: 基于 Yjs CRDT 的多设备状态同步，支持离线编辑 + 自动冲突解决，延迟 < 100ms

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

## 相关链接

- [智能插件生态 2.0](/chainlesschain/plugin-ecosystem-v2)
- [工作流自动化引擎](/chainlesschain/workflow-automation)
- [协作治理](/chainlesschain/collaboration-governance)
