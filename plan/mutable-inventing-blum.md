# P2P混合传输与NAT穿透 - 实施计划

## 概述

为ChainlessChain P2P系统添加多传输层支持（WebRTC + WebSocket + TCP）和智能NAT穿透能力，同时保持向后兼容v0.16的纯TCP节点。

**核心策略**：
- 使用免费公共STUN服务器（Google STUN）进行NAT穿透
- 利用现有libp2p.io bootstrap节点作为Circuit Relay中继
- 智能检测NAT类型并自动选择最优传输层
- 自动降级到TCP以兼容旧版本节点

**实施时间**: 6-8天
**风险级别**: 中等

---

## 第一阶段：依赖安装与配置基础 (第1天)

### 1.1 安装新依赖包

在 `desktop-app-vue/` 目录执行：

```bash
npm install @libp2p/circuit-relay-v2@latest
npm install @libp2p/dcutr@latest
npm install @libp2p/identify@latest
npm install @chainsafe/libp2p-yamux@latest
npm install stun@latest
```

**说明**：
- `@libp2p/webrtc` 和 `@libp2p/websockets` 已安装，无需重复安装
- `circuit-relay-v2`: 通过中继节点建立连接
- `dcutr`: 将中继连接升级为直连（NAT打洞）
- `identify`: 协议协商，支持能力检测
- `yamux`: 适合WebRTC的流多路复用器
- `stun`: 用于NAT类型检测

### 1.2 添加P2P配置到数据库

**文件**: `src/main/database.js`
**位置**: `initDefaultSettings()` 方法，第3464行之后

在现有配置段后添加P2P配置节：

```javascript
// P2P 网络配置
{ key: 'p2p.transports.webrtc.enabled', value: 'true', type: 'boolean', description: '启用WebRTC传输（推荐）' },
{ key: 'p2p.transports.websocket.enabled', value: 'true', type: 'boolean', description: '启用WebSocket传输' },
{ key: 'p2p.transports.tcp.enabled', value: 'true', type: 'boolean', description: '启用TCP传输（向后兼容）' },
{ key: 'p2p.transports.autoSelect', value: 'true', type: 'boolean', description: '智能自动选择传输层' },

// STUN 配置（仅公共免费服务器）
{ key: 'p2p.stun.servers', value: JSON.stringify([
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun2.l.google.com:19302'
]), type: 'json', description: 'STUN服务器列表' },

// Circuit Relay 配置
{ key: 'p2p.relay.enabled', value: 'true', type: 'boolean', description: '启用Circuit Relay v2中继' },
{ key: 'p2p.relay.maxReservations', value: '2', type: 'number', description: '最大中继预留数量' },
{ key: 'p2p.relay.autoUpgrade', value: 'true', type: 'boolean', description: '自动升级中继为直连（DCUTr）' },

// NAT 穿透配置
{ key: 'p2p.nat.autoDetect', value: 'true', type: 'boolean', description: '启动时自动检测NAT类型' },
{ key: 'p2p.nat.detectionInterval', value: '3600000', type: 'number', description: 'NAT检测间隔（毫秒，默认1小时）' },

// 连接配置
{ key: 'p2p.connection.dialTimeout', value: '30000', type: 'number', description: '连接超时时间（毫秒）' },
{ key: 'p2p.connection.maxRetries', value: '3', type: 'number', description: '最大重试次数' },
{ key: 'p2p.connection.healthCheckInterval', value: '60000', type: 'number', description: '健康检查间隔（毫秒）' },

// WebSocket 端口配置
{ key: 'p2p.websocket.port', value: '9001', type: 'number', description: 'WebSocket监听端口' },

// 向后兼容
{ key: 'p2p.compatibility.detectLegacy', value: 'true', type: 'boolean', description: '自动检测并兼容旧版TCP节点' },
```

**说明**：按照现有的llm、vector等配置风格，使用点分层级键名。

---

## 第二阶段：NAT检测与诊断 (第2天)

### 2.1 创建NAT检测器

**新文件**: `src/main/p2p/nat-detector.js`

**核心功能**：
1. 使用STUN协议检测NAT类型（Full Cone / Restricted / Port Restricted / Symmetric）
2. 发现公网IP地址
3. 检测防火墙限制
4. 结果缓存（TTL: 1小时）

**关键方法**：
```javascript
class NATDetector {
  async detectNATType(stunServers)  // 主检测逻辑
  async querySTUNServer(server)     // 查询单个STUN服务器
  getPublicIP()                     // 获取公网IP
  getCachedResult()                 // 获取缓存结果
  invalidateCache()                 // 使缓存失效
}
```

**检测流程**：
1. 向第一个STUN服务器发送绑定请求
2. 收到响应后提取映射地址（Mapped Address）
3. 向不同IP的STUN服务器发送请求
4. 根据响应一致性判断NAT类型
5. 返回结果：`{ type: 'full-cone|restricted|port-restricted|symmetric|none', publicIP: '...', localIP: '...', timestamp: ... }`

### 2.2 创建传输诊断工具

**新文件**: `src/main/p2p/transport-diagnostics.js`

**核心功能**：
1. 测试每个传输层的可用性
2. 测量延迟和成功率
3. 健康状态追踪

**关键方法**：
```javascript
class TransportDiagnostics {
  async testTransport(transport, targetPeer)  // 测试单个传输
  async runFullDiagnostics()                  // 完整诊断
  getTransportHealth(transport)               // 获取健康指标
  startHealthMonitoring(interval)             // 开始监控
  stopHealthMonitoring()                      // 停止监控
}
```

---

## 第三阶段：多传输层集成 (第3-4天)

### 3.1 升级P2P Manager

**文件**: `src/main/p2p/p2p-manager.js`
**主要修改**: `initialize()` 方法（第62-110行）

#### 修改点1: 加载P2P配置（第62行之前插入）

```javascript
async loadP2PConfig() {
  // 从数据库加载P2P配置
  const Database = require('../database');
  const db = Database.getInstance();
  const settings = await db.getAllSettings();

  return {
    transports: {
      webrtc: settings['p2p.transports.webrtc.enabled'] !== false,
      websocket: settings['p2p.transports.websocket.enabled'] !== false,
      tcp: settings['p2p.transports.tcp.enabled'] !== false,
      autoSelect: settings['p2p.transports.autoSelect'] !== false,
    },
    stun: {
      servers: JSON.parse(settings['p2p.stun.servers'] || '[]'),
    },
    relay: {
      enabled: settings['p2p.relay.enabled'] !== false,
      maxReservations: parseInt(settings['p2p.relay.maxReservations']) || 2,
      autoUpgrade: settings['p2p.relay.autoUpgrade'] !== false,
    },
    nat: {
      autoDetect: settings['p2p.nat.autoDetect'] !== false,
      detectionInterval: parseInt(settings['p2p.nat.detectionInterval']) || 3600000,
    },
    connection: {
      dialTimeout: parseInt(settings['p2p.connection.dialTimeout']) || 30000,
      maxRetries: parseInt(settings['p2p.connection.maxRetries']) || 3,
      healthCheckInterval: parseInt(settings['p2p.connection.healthCheckInterval']) || 60000,
    },
    websocket: {
      port: parseInt(settings['p2p.websocket.port']) || 9001,
    },
    compatibility: {
      detectLegacy: settings['p2p.compatibility.detectLegacy'] !== false,
    },
  };
}
```

#### 修改点2: 动态导入新模块（第64-86行扩展）

在现有动态导入后添加：

```javascript
// 新增导入
const { webSockets } = await import('@libp2p/websockets');
const { webRTC } = await import('@libp2p/webrtc');
const { yamux } = await import('@chainsafe/libp2p-yamux');
const { circuitRelayTransport } = await import('@libp2p/circuit-relay-v2');
const { dcutr } = await import('@libp2p/dcutr');
const { identify } = await import('@libp2p/identify');
```

#### 修改点3: NAT检测（第90行之后插入）

```javascript
// NAT类型检测
this.p2pConfig = await this.loadP2PConfig();
this.natDetector = new NATDetector();
this.natInfo = null;

if (this.p2pConfig.nat.autoDetect) {
  console.log('[P2P] 正在检测NAT类型...');
  this.natInfo = await this.natDetector.detectNATType(this.p2pConfig.stun.servers);
  console.log(`[P2P] NAT类型: ${this.natInfo.type}, 公网IP: ${this.natInfo.publicIP}`);

  // 定期重新检测
  setInterval(() => {
    this.natDetector.detectNATType(this.p2pConfig.stun.servers).then(info => {
      this.natInfo = info;
    });
  }, this.p2pConfig.nat.detectionInterval);
}
```

#### 修改点4: 构建传输层数组（替换第105行）

```javascript
// 根据配置和NAT类型智能选择传输层
const transports = this.buildTransports({
  tcp,
  webSockets,
  webRTC,
  circuitRelayTransport,
  config: this.p2pConfig,
  natInfo: this.natInfo,
});
```

#### 修改点5: 添加新服务（第106-109行之间插入）

```javascript
services: {
  identify: identify(),           // 协议协商
  dcutr: dcutr(),                // NAT打洞
  dht: this.config.enableDHT ? kadDHT() : undefined,
}
```

#### 修改点6: 添加连接管理器配置（第109行之后）

```javascript
connectionManager: {
  maxConnections: 100,
  minConnections: 5,
  dialTimeout: this.p2pConfig.connection.dialTimeout,
  maxParallelDials: 5,
  maxDialsPerPeer: this.p2pConfig.connection.maxRetries,
}
```

#### 修改点7: 添加辅助方法（文件末尾）

```javascript
buildTransports({ tcp, webSockets, webRTC, circuitRelayTransport, config, natInfo }) {
  const transports = [];

  // 根据NAT类型和配置智能选择
  if (config.transports.autoSelect && natInfo) {
    // Full Cone NAT: WebRTC最优
    if (natInfo.type === 'full-cone' && config.transports.webrtc) {
      transports.push(webRTC({ iceServers: this.buildICEServers() }));
    }
    // 严格防火墙: WebSocket最优
    if (natInfo.type === 'symmetric' && config.transports.websocket) {
      transports.push(webSockets());
    }
    // 本地网络: TCP最优
    if (natInfo.type === 'none' && config.transports.tcp) {
      transports.push(tcp());
    }
  } else {
    // 非智能模式：启用所有配置的传输层
    if (config.transports.webrtc) {
      transports.push(webRTC({ iceServers: this.buildICEServers() }));
    }
    if (config.transports.websocket) {
      transports.push(webSockets());
    }
    if (config.transports.tcp) {
      transports.push(tcp());
    }
  }

  // Circuit Relay 作为通用后备
  if (config.relay.enabled) {
    transports.push(circuitRelayTransport({
      discoverRelays: 2,
      reservationCompletionTimeout: 10000,
    }));
  }

  return transports;
}

buildICEServers() {
  return this.p2pConfig.stun.servers.map(server => ({ urls: server }));
}
```

### 3.2 创建连接管理器

**新文件**: `src/main/p2p/connection-manager.js`

**核心功能**：
1. 智能拨号：自动选择最优传输层
2. 传输层降级：失败时尝试其他传输
3. 旧版本检测：自动降级到TCP连接v0.16节点
4. 中继升级：使用DCUTr将中继连接升级为直连

**关键方法**：
```javascript
class ConnectionManager {
  async smartDial(peerId, options)           // 智能拨号主入口
  async dialWithFallback(peerId, options)    // 带降级的拨号
  async detectPeerCapabilities(peerId)       // 检测对端能力
  async attemptDCUTrUpgrade(connection)      // 尝试升级为直连
  isLegacyPeer(peerId)                       // 检测是否为旧版节点
  filterMultiaddrsByTransport(addrs, transport) // 按传输过滤地址
}
```

**智能拨号流程**：
1. 获取对端的所有multiaddrs
2. 如果启用了能力检测，查询对端支持的协议
3. 检测是否为旧版TCP-only节点
4. 根据NAT类型和对端能力选择传输优先级
5. 按优先级尝试拨号，失败则降级
6. 如果建立的是中继连接，异步尝试DCUTr升级

---

## 第四阶段：UI集成 (第5天)

### 4.1 添加P2P设置UI标签

**文件**: `src/renderer/pages/settings/SystemSettings.vue`

#### 修改点1: 添加新标签（tabs数组中）

```vue
<a-tab-pane key="p2p" tab="P2P 网络">
  <template #tab>
    <GlobalOutlined />
    P2P 网络
  </template>

  <!-- P2P网络配置内容 -->
</a-tab-pane>
```

#### 修改点2: 添加P2P配置表单

创建4个配置卡片：

**卡片1: 传输层配置**
- WebRTC开关（默认开启，推荐）
- WebSocket开关（默认开启）
- TCP开关（默认开启，向后兼容必需）
- 智能自动选择开关

**卡片2: NAT穿透状态**
- 当前NAT类型显示（带颜色标识）
- 公网IP显示
- 本地IP显示
- 刷新检测按钮

**卡片3: Circuit Relay设置**
- 启用中继开关
- 最大预留数量（1-5）
- 自动升级为直连开关
- 当前已连接中继节点列表

**卡片4: 网络诊断**
- 运行诊断按钮
- 诊断结果显示（表格形式）
  - 传输层 | 状态 | 延迟 | 成功率

#### 修改点3: config ref添加p2p节（第515行附近）

```javascript
const config = ref({
  project: { ... },
  llm: { ... },
  vector: { ... },
  // 新增
  p2p: {
    transports: {
      webrtc: { enabled: true },
      websocket: { enabled: true },
      tcp: { enabled: true },
      autoSelect: true,
    },
    relay: {
      enabled: true,
      maxReservations: 2,
      autoUpgrade: true,
    },
    nat: {
      autoDetect: true,
    },
    // ... 其他配置
  }
});
```

#### 修改点4: 添加NAT状态响应式数据

```javascript
const natInfo = ref(null);
const relayInfo = ref([]);
const diagnosticResults = ref(null);
```

#### 修改点5: 添加方法

```javascript
// NAT检测
async function handleDetectNAT() {
  try {
    natInfo.value = await window.electronAPI.p2p.detectNAT();
    message.success('NAT检测完成');
  } catch (error) {
    message.error('NAT检测失败');
  }
}

// 刷新中继信息
async function handleRefreshRelays() {
  try {
    relayInfo.value = await window.electronAPI.p2p.getRelayInfo();
    message.success('中继信息已更新');
  } catch (error) {
    message.error('获取中继信息失败');
  }
}

// 运行诊断
async function handleRunDiagnostics() {
  try {
    diagnosticResults.value = await window.electronAPI.p2p.runDiagnostics();
    message.success('诊断完成');
  } catch (error) {
    message.error('诊断失败');
  }
}

// NAT类型名称和颜色
function getNATTypeName(type) {
  const names = {
    'none': '无NAT（公网IP）',
    'full-cone': '完全锥形NAT',
    'restricted': '受限锥形NAT',
    'port-restricted': '端口受限NAT',
    'symmetric': '对称NAT',
  };
  return names[type] || '未知';
}

function getNATTypeColor(type) {
  const colors = {
    'none': 'green',
    'full-cone': 'green',
    'restricted': 'blue',
    'port-restricted': 'orange',
    'symmetric': 'red',
  };
  return colors[type] || 'gray';
}
```

### 4.2 添加IPC处理器

**文件**: `src/main/index.js`
**位置**: 在现有P2P handlers后添加（第4630行之后）

```javascript
// NAT检测
ipcMain.handle('p2p:detect-nat', async () => {
  if (!this.p2pManager || !this.p2pManager.natDetector) {
    throw new Error('P2P管理器未初始化');
  }
  return await this.p2pManager.natDetector.detectNATType(
    this.p2pManager.p2pConfig.stun.servers
  );
});

// 获取NAT信息
ipcMain.handle('p2p:get-nat-info', async () => {
  if (!this.p2pManager) {
    throw new Error('P2P管理器未初始化');
  }
  return this.p2pManager.natInfo;
});

// 获取中继信息
ipcMain.handle('p2p:get-relay-info', async () => {
  if (!this.p2pManager || !this.p2pManager.node) {
    return [];
  }

  const connections = this.p2pManager.node.getConnections();
  const relays = connections.filter(conn =>
    conn.remoteAddr.toString().includes('/p2p-circuit')
  );

  return relays.map(relay => ({
    peerId: relay.remotePeer.toString(),
    addr: relay.remoteAddr.toString(),
    status: relay.status,
  }));
});

// 运行诊断
ipcMain.handle('p2p:run-diagnostics', async () => {
  if (!this.p2pManager || !this.p2pManager.transportDiagnostics) {
    throw new Error('P2P管理器未初始化');
  }
  return await this.p2pManager.transportDiagnostics.runFullDiagnostics();
});
```

### 4.3 更新Preload API

**文件**: `src/preload/index.js`
**位置**: p2p对象中（第386行附近）

```javascript
p2p: {
  // ... 现有方法

  // 新增方法
  detectNAT: () => ipcRenderer.invoke('p2p:detect-nat'),
  getNATInfo: () => ipcRenderer.invoke('p2p:get-nat-info'),
  getRelayInfo: () => ipcRenderer.invoke('p2p:get-relay-info'),
  runDiagnostics: () => ipcRenderer.invoke('p2p:run-diagnostics'),
}
```

### 4.4 修改P2P Manager初始化

**文件**: `src/main/index.js`
**位置**: 第425-430行

替换为：

```javascript
// 从数据库加载P2P配置
const p2pSettings = await this.database.getAllSettings();
const p2pPort = parseInt(p2pSettings['p2p.port']) || 9000;
const enableMDNS = p2pSettings['p2p.enableMDNS'] !== false;
const enableDHT = p2pSettings['p2p.enableDHT'] !== false;

this.p2pManager = new P2PManager({
  port: p2pPort,
  enableMDNS: enableMDNS,
  enableDHT: enableDHT,
  dataPath: path.join(app.getPath('userData'), 'p2p'),
});

// P2P 初始化可能较慢，使用后台初始化
this.p2pManager.initialize().then((initialized) => {
  if (!initialized) {
    console.warn('P2P管理器未启用');
  } else {
    console.log('[P2P] 多传输层P2P网络已启动');
    console.log(`[P2P] NAT类型: ${this.p2pManager.natInfo?.type || '未检测'}`);
  }
}).catch((error) => {
  console.error('P2P初始化失败:', error);
});
```

---

## 第五阶段：测试与验证 (第6天)

### 5.1 创建自动化测试脚本

**新文件**: `desktop-app-vue/test-p2p-nat-traversal.js`

**测试内容**：
1. NAT检测功能
2. 多传输层初始化
3. STUN服务器连通性
4. Circuit Relay发现
5. 传输健康检查

**运行方式**：
```bash
cd desktop-app-vue
node test-p2p-nat-traversal.js
```

### 5.2 手动测试检查清单

**环境1: 本地测试**
- [ ] 启动应用，检查P2P设置UI是否正常显示
- [ ] 点击"检测NAT"按钮，验证检测结果
- [ ] 查看Console日志，确认多传输层已启动
- [ ] 检查启用/禁用各传输层开关是否生效（需重启）

**环境2: 局域网测试**
- [ ] 两台设备在同一WiFi下
- [ ] 验证mDNS自动发现
- [ ] 验证TCP连接优先（本地网络）
- [ ] 测试设备间消息收发

**环境3: NAT穿透测试**
- [ ] 一台设备使用移动热点（模拟NAT）
- [ ] 另一台设备在公网或其他网络
- [ ] 验证WebRTC连接建立
- [ ] 验证Circuit Relay降级机制
- [ ] 测试DCUTr中继升级（查看日志）

**环境4: 旧版本兼容测试**
- [ ] 运行v0.16版本（TCP-only）
- [ ] 运行v0.17版本（多传输层）
- [ ] 验证自动降级到TCP
- [ ] 验证双向消息收发正常

---

## 第六阶段：文档与收尾 (第7天)

### 6.1 用户文档

**新文件**: `desktop-app-vue/docs/P2P_NAT_TRAVERSAL_GUIDE.md`

**章节**：
1. P2P网络简介
2. 传输层类型说明（WebRTC / WebSocket / TCP）
3. NAT类型说明和对照表
4. 如何配置P2P设置
5. 如何解读网络诊断结果
6. 常见问题排查
7. 性能优化建议

### 6.2 开发者文档

**新文件**: `desktop-app-vue/docs/P2P_ARCHITECTURE.md`

**章节**：
1. 架构设计概览
2. 传输层选择逻辑
3. NAT穿透策略
4. Circuit Relay工作原理
5. DCUTr升级机制
6. 向后兼容实现
7. 扩展开发指南

### 6.3 更新CLAUDE.md

在 `CLAUDE.md` 中更新：
- 依赖列表（新增的@libp2p包）
- P2P配置说明
- NAT穿透能力说明
- 测试命令

---

## 关键文件清单

### 需要修改的文件

| 文件 | 修改内容 | 行数范围 |
|------|---------|---------|
| `src/main/p2p/p2p-manager.js` | 多传输层初始化、NAT检测、智能传输选择 | 62-110, 文件末尾 |
| `src/main/database.js` | 添加P2P配置项到initDefaultSettings() | 3464+ |
| `src/main/index.js` | 从数据库加载配置、新增IPC handlers | 425-430, 4630+ |
| `src/renderer/pages/settings/SystemSettings.vue` | 新增P2P设置标签、NAT状态显示、诊断工具 | 整个文件 |
| `src/preload/index.js` | 暴露新的P2P API | 386+ |
| `package.json` | 添加新依赖 | dependencies |
| `CLAUDE.md` | 更新文档 | 技术栈、配置部分 |

### 需要创建的新文件

| 文件 | 用途 |
|------|------|
| `src/main/p2p/nat-detector.js` | NAT类型检测 |
| `src/main/p2p/transport-diagnostics.js` | 传输层健康诊断 |
| `src/main/p2p/connection-manager.js` | 智能连接管理 |
| `test-p2p-nat-traversal.js` | 自动化测试脚本 |
| `docs/P2P_NAT_TRAVERSAL_GUIDE.md` | 用户指南 |
| `docs/P2P_ARCHITECTURE.md` | 开发者文档 |

---

## 风险与缓解措施

### 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| libp2p版本兼容性 | 高 | 在开发前验证所有新包与libp2p@3.1.2兼容 |
| WebRTC在Electron中不工作 | 高 | Electron 39+内置WebRTC支持，已验证可用 |
| STUN服务器不稳定 | 中 | 配置3个Google STUN服务器作为冗余 |
| Circuit Relay节点不可用 | 中 | libp2p.io的bootstrap节点稳定运行多年 |
| NAT检测不准确 | 低 | 允许用户手动刷新，提供多服务器验证 |

### 兼容性风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 破坏现有TCP连接 | 高 | 保持TCP传输始终启用，优先级调整不影响现有连接 |
| 数据库迁移失败 | 中 | 配置是增量添加，不修改现有表结构 |
| 配置冲突 | 低 | 使用深度合并，提供默认值 |

---

## 成功标准

### 功能验证 ✓

- [ ] WebRTC传输成功初始化
- [ ] WebSocket传输成功初始化
- [ ] TCP传输保持可用（向后兼容）
- [ ] NAT检测返回正确的NAT类型
- [ ] STUN服务器查询成功
- [ ] Circuit Relay发现至少1个中继节点
- [ ] DCUTr尝试升级中继连接
- [ ] 传输层降级机制工作正常
- [ ] 旧版本自动检测并降级到TCP
- [ ] P2P设置UI正常显示和保存
- [ ] 网络诊断工具提供有用信息

### 性能验证 ✓

- [ ] NAT检测完成时间 < 5秒
- [ ] 直连建立时间 < 10秒
- [ ] 中继连接建立时间 < 30秒
- [ ] DCUTr升级成功率 > 70%（非对称NAT）
- [ ] 内存占用增加 < 50MB
- [ ] 现有TCP连接性能无退化

---

## 实施时间线

| 天数 | 阶段 | 任务 |
|------|------|------|
| Day 1 | 基础设施 | 安装依赖、数据库配置、环境准备 |
| Day 2 | NAT检测 | NAT检测器、传输诊断工具 |
| Day 3 | 核心功能 | P2P Manager升级、多传输层集成 |
| Day 4 | 连接管理 | 连接管理器、智能降级、DCUTr |
| Day 5 | UI集成 | P2P设置UI、IPC handlers、Preload API |
| Day 6 | 测试 | 自动化测试、手动测试、性能测试 |
| Day 7 | 文档 | 用户文档、开发者文档、代码注释 |
| Day 8 | 缓冲 | Bug修复、优化、最终验证 |

---

## 总结

本计划采用渐进式升级策略，在保持向后兼容的前提下，为ChainlessChain添加强大的NAT穿透能力。通过智能传输选择和自动降级机制，确保在各种网络环境下都能建立稳定的P2P连接。实施过程中优先使用免费公共资源（STUN服务器、libp2p bootstrap节点），避免额外的基础设施成本。
