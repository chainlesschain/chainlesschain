# 反审查通信系统

> **版本: v3.3.0 | 状态: ✅ 生产就绪 | 5 IPC Handlers | 1 数据库表 | Tor + 域前置 + Mesh**

ChainlessChain 反审查通信系统提供多层抗审查通信能力，集成 Tor 匿名网络、CDN 域前置和 BLE/WiFi Direct Mesh 网络。当传统通信渠道受到限制时，自动切换到可用的替代链路，确保通信不中断。

## 概述

反审查通信系统为 ChainlessChain 提供多层抗审查通信能力，集成 Tor 匿名服务、CDN 域前置流量混淆和 BLE/WiFi Direct Mesh 点对点网络三种技术路径。系统能在传统通信渠道受限时自动切换到可用替代链路，并提供实时连通性评估报告。

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

## 使用示例

### 启用 Tor 匿名通信

1. 打开「反审查通信」页面
2. 点击「启动 Tor」按钮，等待电路建立（约 10-30 秒）
3. 查看状态卡片确认 `circuitEstablished: true`
4. 系统自动生成 `.onion` 隐藏服务地址
5. 所有后续通信自动通过 Tor 匿名网络路由

### 配置 CDN 域前置

1. 切换到「域前置」面板
2. 填写前端域名（CDN 域名）和真实目标域名
3. 选择 CDN 提供商（Cloudflare / AWS / Azure）
4. 点击「启用」，流量将伪装为正常 HTTPS 请求

### 建立 Mesh 应急网络

1. 确保设备蓝牙或 WiFi Direct 功能已开启
2. 点击「启动 Mesh」，系统自动扫描附近设备
3. 当互联网中断时，Mesh 网络自动接管通信
4. 查看连通性报告了解各链路状态

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| Tor 电路建立失败 | 本地防火墙阻断或 Tor 入口节点不可达 | 检查防火墙规则，配置 Tor 桥接节点 |
| 域前置连接超时 | CDN 提供商策略变更或域名被封锁 | 更换 CDN 提供商或使用备用前端域名 |
| Mesh 无法发现对等节点 | 蓝牙/WiFi Direct 未开启 | 开启设备无线功能，确保距离在有效范围内 |
| 连通性报告全部不可用 | 所有通信链路均被阻断 | 尝试更换网络环境，启用 Mesh 离线模式 |
| Tor 延迟过高（>1s） | 多跳中继路径较长 | 属于正常现象，可优先使用域前置低延迟链路 |
| 隐藏服务地址变化 | Tor 进程重启导致新地址 | 配置持久化隐藏服务密钥避免地址变化 |

## 配置参考

```javascript
// desktop-app-vue/src/main/security/anti-censorship-manager.js
const DEFAULT_CONFIG = {
  // Tor 匿名网络
  tor: {
    enabled: false,                   // 是否自动启动 Tor
    socksPort: 9050,                  // Tor SOCKS5 代理端口
    controlPort: 9051,                // Tor 控制端口
    circuitTimeout: 30000,            // 电路建立超时 (ms)
    hiddenServiceDir: ".tor/hidden",  // 隐藏服务密钥目录（持久化地址）
    bridges: [],                      // 桥接节点列表，被封锁时使用
  },

  // CDN 域前置
  domainFronting: {
    enabled: false,                   // 是否启用域前置
    provider: "cloudflare",           // CDN 提供商: cloudflare | aws | azure
    frontDomain: "",                  // 前端域名（CDN 域名）
    targetDomain: "",                 // 真实目标域名
    timeout: 10000,                   // 连接超时 (ms)
  },

  // Mesh 网络
  mesh: {
    enabled: false,                   // 是否自动启动 Mesh
    transport: "ble",                 // 传输方式: ble | wifi-direct | both
    scanInterval: 5000,               // 扫描附近节点间隔 (ms)
    maxPeers: 20,                     // 最大连接节点数
  },

  // 智能路由
  routing: {
    autoSwitch: true,                 // 是否自动切换最优链路
    checkInterval: 30000,             // 链路健康检查间隔 (ms)
    latencyThreshold: 2000,           // 链路延迟告警阈值 (ms)
  },
};
```

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `tor.socksPort` | `9050` | Tor SOCKS5 代理端口，需与本地 Tor 实例一致 |
| `tor.circuitTimeout` | `30000` | 毫秒，超时后报告电路建立失败 |
| `tor.hiddenServiceDir` | `.tor/hidden` | 持久化隐藏服务密钥，避免重启后地址变更 |
| `tor.bridges` | `[]` | 桥接节点列表，格式 `obfs4 <ip>:<port> <fingerprint>` |
| `domainFronting.provider` | `cloudflare` | CDN 提供商，决定可用的前端域名范围 |
| `domainFronting.timeout` | `10000` | 域前置连接超时，建议 5000~15000 |
| `mesh.transport` | `ble` | `ble` 低功耗蓝牙，`wifi-direct` 高带宽，`both` 双模式 |
| `mesh.maxPeers` | `20` | 过大影响电量和内存，建议不超过 50 |
| `routing.autoSwitch` | `true` | 关闭后需手动切换链路 |
| `routing.checkInterval` | `30000` | 毫秒，健康检查过于频繁会增加指纹暴露风险 |

---

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
| --- | --- | --- | --- |
| Tor 电路建立 | <30s | ~15s | ✅ |
| 域前置连接延迟 | <200ms | ~120ms | ✅ |
| Mesh 节点发现 | <10s | ~6s | ✅ |
| 连通性报告生成 | <500ms | ~300ms | ✅ |
| 链路自动切换 | <2s | ~800ms | ✅ |
| Tor 匿名通信延迟 | <1000ms | ~350ms | ✅ |

---

## 安全考虑

- **流量混淆**: 深度包检测无法识别 Tor 流量，域前置将流量伪装为正常 HTTPS
- **端到端加密**: 所有通信内容在发送前加密，中继节点无法读取明文
- **无日志策略**: 反审查模块不记录用户通信内容和路由路径
- **Mesh 隔离**: BLE/WiFi Direct 通信使用独立加密通道，防止邻近设备窃听
- **自动链路切换**: 当某条链路被检测到异常时，自动切换到备用链路
- **密钥轮换**: 通信密钥定期轮换，降低长期密钥泄露风险
- **最小信息暴露**: 连通性报告仅记录延迟和可用性，不包含通信内容

## 相关文档

- [卫星通信 →](/chainlesschain/satellite-comm)
- [加密系统 →](/chainlesschain/encryption)
- [去中心化社交 →](/chainlesschain/social)
