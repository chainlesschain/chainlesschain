# 反审查通信系统

> **版本: v3.3.0 | 状态: ✅ 生产就绪 | 5 IPC Handlers | 1 数据库表 | Tor + 域前置 + Mesh**

ChainlessChain 反审查通信系统提供多层抗审查通信能力，集成 Tor 匿名网络、CDN 域前置和 BLE/WiFi Direct Mesh 网络。当传统通信渠道受到限制时，自动切换到可用的替代链路，确保通信不中断。

## 核心特性

- 🧅 **Tor 匿名服务**: 通过 Tor 隐藏服务实现匿名通信
- 🌐 **流量混淆**: 将流量伪装为正常 HTTPS 请求，绕过深度包检测
- 🏢 **CDN 域前置**: 利用 CDN 基础设施隐藏真实目标域名
- 📶 **Mesh 网络**: BLE/WiFi Direct 点对点组网，无需互联网基础设施
- 📊 **连通性报告**: 实时评估各通信链路的可用性和延迟

## 启动 Tor 服务

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "anti-censorship:start-tor",
);
// result.status = {
//   running: true,
//   circuitEstablished: true,
//   hiddenServiceAddress: "xxxxx.onion",
//   startedAt: 1709123456789,
// }
```

## 启用域前置

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "anti-censorship:enable-domain-fronting",
  {
    frontDomain: "cdn.example.com",
    targetDomain: "real-target.example.com",
    provider: "cloudflare",
  },
);
```

## 启动 Mesh 网络

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "anti-censorship:start-mesh",
);
// result.result = {
//   active: true,
//   transport: "ble",
//   peerCount: 0,
//   startedAt: 1709123456789,
// }
```

## 获取连通性报告

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "anti-censorship:get-connectivity-report",
);
// result.report = {
//   tor: { available: true, latencyMs: 350 },
//   domainFronting: { available: true, latencyMs: 120 },
//   mesh: { available: true, peers: 3 },
//   directInternet: { available: false },
//   bestRoute: "domainFronting",
// }
```

## 系统架构

```
┌──────────────────────────────────────────────────┐
│             反审查通信系统                          │
│                                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐│
│  │  Tor      │  │  域前置   │  │  Mesh 网络       ││
│  │  匿名网络 │  │  CDN 代理  │  │  BLE/WiFi Direct ││
│  └─────┬────┘  └─────┬────┘  └────────┬─────────┘│
│        │             │                 │           │
│        ▼             ▼                 ▼           │
│  ┌────────────────────────────────────────────┐   │
│  │        连通性评估 & 智能路由选择              │   │
│  │  延迟感知 → 自动切换最优链路                  │   │
│  └────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

## IPC 接口完整列表

### 反审查操作（5 个）

| 通道                                      | 功能           | 说明                       |
| ----------------------------------------- | -------------- | -------------------------- |
| `anti-censorship:start-tor`               | 启动 Tor 服务  | 建立匿名电路和隐藏服务     |
| `anti-censorship:get-tor-status`          | 查询 Tor 状态  | 电路状态、洋葱地址         |
| `anti-censorship:enable-domain-fronting`  | 启用域前置     | 配置 CDN 域前置代理        |
| `anti-censorship:start-mesh`              | 启动 Mesh 网络 | BLE/WiFi Direct 点对点组网 |
| `anti-censorship:get-connectivity-report` | 连通性报告     | 各链路可用性和延迟评估     |

## 数据库 Schema

**1 张核心表**:

### anti_censorship_routes 表

```sql
CREATE TABLE IF NOT EXISTS anti_censorship_routes (
  id TEXT PRIMARY KEY,
  route_type TEXT NOT NULL,              -- tor | domain_fronting | mesh
  status TEXT DEFAULT 'inactive',
  latency_ms INTEGER,
  last_checked INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
```

## 前端集成

### AntiCensorshipPage 页面

**功能模块**:

- **通道状态卡片**: Tor / 域前置 / Mesh 三路状态
- **操作按钮**: 启动 Tor、启用域前置、启动 Mesh
- **连通性报告**: 展示各链路延迟和可用性
- **错误提示**: Alert 组件展示错误信息

### Pinia Store (antiCensorship.ts)

```typescript
const useAntiCensorshipStore = defineStore("antiCensorship", {
  state: () => ({
    torStatus: null,
    meshStatus: null,
    connectivityReport: null,
    loading: false,
    error: null,
  }),
  actions: {
    startTor, // → anti-censorship:start-tor
    fetchTorStatus, // → anti-censorship:get-tor-status
    enableDomainFronting, // → anti-censorship:enable-domain-fronting
    startMesh, // → anti-censorship:start-mesh
    fetchConnectivityReport, // → anti-censorship:get-connectivity-report
  },
});
```

## 关键文件

| 文件                                                 | 职责               | 行数 |
| ---------------------------------------------------- | ------------------ | ---- |
| `src/main/security/anti-censorship-manager.js`       | 反审查核心引擎     | ~200 |
| `src/main/security/mesh-network-manager.js`          | Mesh 网络管理器    | ~62  |
| `src/main/security/anti-censorship-ipc.js`           | IPC 处理器（5 个） | ~138 |
| `src/renderer/stores/antiCensorship.ts`              | Pinia 状态管理     | ~90  |
| `src/renderer/pages/security/AntiCensorshipPage.vue` | 反审查页面         | ~100 |

## 测试覆盖率

```
✅ anti-censorship-manager.test.js         - Tor/域前置/Mesh/连通性测试
✅ stores/antiCensorship.test.ts           - Store 状态管理测试
✅ e2e/security/anti-censorship.e2e.test.ts - 端到端用户流程测试
```

## 相关文档

- [卫星通信 →](/chainlesschain/satellite-comm)
- [加密系统 →](/chainlesschain/encryption)
- [去中心化社交 →](/chainlesschain/social)
