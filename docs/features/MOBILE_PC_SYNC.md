# 移动端与PC端P2P同步功能说明

## 概述

ChainlessChain实现了移动端与PC端的P2P通讯和数据同步功能，允许移动端访问PC端的知识库和项目文件，同时监控PC端的运行状态。

## 架构

```
┌─────────────┐         WebSocket信令服务器         ┌─────────────┐
│  移动端App   │◄──────────────┬──────────────────►│  PC端应用    │
│ (uni-app)   │                │                    │  (Electron)  │
└─────────────┘                │                    └─────────────┘
      ▲                        │                           ▲
      │    WebRTC DataChannel  │                           │
      └────────────────────────┴───────────────────────────┘
                          P2P直连通讯
```

### 技术栈

**移动端：**
- WebRTC：端到端数据传输
- WebSocket：信令交换
- uni-app：跨平台UI框架

**PC端：**
- libp2p：P2P网络框架
- WebRTC (wrtc)：与移动端桥接
- Node.js：主进程后端

**信令服务器：**
- WebSocket (ws库)
- 支持离线消息队列
- 24小时消息保留

## 功能模块

### 1. 设备配对

#### PC端扫描移动端二维码

```
移动端操作流程：
1. 打开"设备配对"页面
2. 生成6位配对码和二维码
3. 等待PC端扫描（5分钟有效期）

PC端操作流程：
1. 点击"扫描移动设备"按钮
2. 使用摄像头扫描二维码
3. 确认配对信息
4. 建立WebRTC连接
5. 完成配对
```

#### 配对码手动输入

```
如果摄像头不可用，PC端可以手动输入配对码：
- 移动端显示的6位数字码
- PC端输入验证
```

### 2. 知识库同步

#### 功能清单

- ✅ 获取笔记列表（支持分页、排序、文件夹筛选）
- ✅ 获取笔记详情（完整Markdown内容）
- ✅ 全文搜索笔记
- ✅ 获取文件夹树形结构
- ✅ 获取标签列表和统计
- ✅ 本地缓存策略

#### 移动端使用示例

```javascript
import { getKnowledgeSyncService } from '@/services/knowledge-sync'

// 初始化
const syncService = getKnowledgeSyncService()
await syncService.initialize(pcPeerId)

// 获取笔记列表
const { notes, total } = await syncService.listNotes({
  folderId: null,    // 可选，筛选特定文件夹
  limit: 50,
  offset: 0,
  sortBy: 'updated_at',
  sortOrder: 'DESC'
})

// 获取笔记详情
const note = await syncService.getNote(noteId)

// 搜索笔记
const { notes, total } = await syncService.searchNotes('关键词', {
  limit: 20,
  offset: 0
})

// 获取文件夹列表
const folders = await syncService.getFolders()

// 获取标签列表
const tags = await syncService.getTags()
```

### 3. 项目文件共享

#### 功能清单

- ✅ 获取项目列表
- ✅ 获取项目详情和统计信息
- ✅ 获取文件树（支持递归深度控制）
- ✅ 获取文件内容
- ✅ 搜索项目文件（支持文件类型筛选）
- ✅ 文件缓存

#### 移动端使用示例

```javascript
import { getProjectSyncService } from '@/services/project-sync'

// 初始化
const syncService = getProjectSyncService()
await syncService.initialize(pcPeerId)

// 获取项目列表
const { projects, total } = await syncService.listProjects({
  limit: 50,
  offset: 0
})

// 获取项目详情
const project = await syncService.getProject(projectId)

// 获取文件树
const fileTree = await syncService.getFileTree(projectId, {
  maxDepth: 3,
  useCache: true
})

// 获取文件内容
const { content, size, modifiedAt } = await syncService.getFile(
  projectId,
  'src/index.js'
)

// 搜索文件
const { files } = await syncService.searchFiles(projectId, '关键词', {
  fileTypes: ['.js', '.vue', '.ts']
})
```

### 4. PC状态监控

#### 功能清单

- ✅ 获取系统信息（CPU、内存、磁盘、平台）
- ✅ 获取服务状态（数据库、P2P、LLM）
- ✅ 实时性能监控（CPU使用率、内存占用）
- ✅ 订阅状态更新（推送模式）

#### 移动端使用示例

```javascript
import { getPCStatusService } from '@/services/pc-status'

// 初始化
const statusService = getPCStatusService()
await statusService.initialize(pcPeerId)

// 获取系统信息
const systemInfo = await statusService.getSystemInfo()
console.log(systemInfo.hostname, systemInfo.platform)

// 获取服务状态
const services = await statusService.getServices()
services.forEach(service => {
  console.log(`${service.name}: ${service.status}`)
})

// 获取实时状态
const status = await statusService.getRealtimeStatus()
console.log(`CPU: ${status.cpu.usage}%`)
console.log(`内存: ${status.memory.usagePercent}%`)

// 订阅状态更新（每30秒推送一次）
await statusService.subscribe(30000)

// 监听状态变化
const unsubscribe = statusService.onStatusUpdate(status => {
  console.log('状态更新:', status)
})

// 取消监听
unsubscribe()
```

## PC端集成指南

### 1. 在主进程中初始化模块

```javascript
// desktop-app-vue/src/main/index.js

const MobileBridge = require('./p2p/mobile-bridge');
const DevicePairingHandler = require('./p2p/device-pairing-handler');
const KnowledgeSyncHandler = require('./p2p/knowledge-sync-handler');
const ProjectSyncHandler = require('./p2p/project-sync-handler');
const PCStatusHandler = require('./p2p/pc-status-handler');

// 初始化MobileBridge
let mobileBridge = null;
let devicePairingHandler = null;
let knowledgeSyncHandler = null;
let projectSyncHandler = null;
let pcStatusHandler = null;

async function initializeMobileBridge(p2pManager) {
  // 创建MobileBridge
  mobileBridge = new MobileBridge(p2pManager, {
    signalingUrl: 'ws://localhost:9001'
  });

  await mobileBridge.connect();

  // 创建设备配对处理器
  devicePairingHandler = new DevicePairingHandler(
    p2pManager,
    mobileBridge,
    deviceManager
  );

  // 创建知识库同步处理器
  knowledgeSyncHandler = new KnowledgeSyncHandler(
    database,
    p2pManager
  );

  // 创建项目同步处理器
  projectSyncHandler = new ProjectSyncHandler(
    database,
    p2pManager
  );

  // 创建PC状态处理器
  pcStatusHandler = new PCStatusHandler(p2pManager);

  console.log('[Main] MobileBridge已初始化');
}

// 注册IPC处理器
ipcMain.handle('mobile:start-qr-scanner', async () => {
  return await devicePairingHandler.startQRCodeScanner();
});

ipcMain.handle('mobile:pair-with-code', async (event, pairingCode, mobileDid, deviceInfo) => {
  return await devicePairingHandler.pairWithCode(pairingCode, mobileDid, deviceInfo);
});

ipcMain.handle('mobile:get-bridge-stats', async () => {
  return mobileBridge.getStats();
});
```

### 2. 启动信令服务器

```bash
# 方式1：独立启动
cd signaling-server
npm install
npm start

# 方式2：集成到docker-compose
# 已在docker-compose.yml中添加：
docker-compose up -d signaling-server
```

### 3. 配置数据库表

PC端数据库需要包含以下表：
- `notes` - 笔记表
- `notes_fts` - 全文搜索虚拟表
- `folders` - 文件夹表
- `projects` - 项目表
- `settings` - 配置表

### 4. PC端UI集成

在设置页面添加"移动设备管理"部分：

```vue
<template>
  <div class="mobile-device-section">
    <h3>移动设备配对</h3>
    <button @click="startScanner">扫描二维码</button>
    <div v-if="pairedDevices.length > 0">
      <h4>已配对设备</h4>
      <ul>
        <li v-for="device in pairedDevices" :key="device.deviceId">
          {{ device.deviceName }} ({{ device.platform }})
        </li>
      </ul>
    </div>
  </div>
</template>

<script>
export default {
  data() {
    return {
      pairedDevices: []
    }
  },
  methods: {
    async startScanner() {
      try {
        const result = await window.electron.invoke('mobile:start-qr-scanner')
        console.log('配对成功:', result)
        await this.loadPairedDevices()
      } catch (error) {
        console.error('配对失败:', error)
      }
    },
    async loadPairedDevices() {
      // 从数据库加载已配对设备列表
    }
  }
}
</script>
```

## 移动端UI开发指南

### 页面结构

```
mobile-app-uniapp/src/pages/
├── device-pairing/         # 设备配对页面 (✅ 已完成)
│   └── index.vue
├── knowledge/              # 知识库页面 (待开发)
│   ├── index.vue           # 笔记列表
│   ├── detail.vue          # 笔记详情
│   └── search.vue          # 笔记搜索
├── projects/               # 项目页面 (待开发)
│   ├── index.vue           # 项目列表
│   ├── detail.vue          # 项目详情
│   ├── file-tree.vue       # 文件树
│   └── file-viewer.vue     # 文件查看器
└── pc-status/              # PC状态页面 (待开发)
    └── index.vue           # 系统监控面板
```

### 路由配置

```javascript
// mobile-app-uniapp/src/pages.json
{
  "pages": [
    {
      "path": "pages/device-pairing/index",
      "style": {
        "navigationBarTitleText": "设备配对"
      }
    },
    {
      "path": "pages/knowledge/index",
      "style": {
        "navigationBarTitleText": "知识库"
      }
    },
    {
      "path": "pages/projects/index",
      "style": {
        "navigationBarTitleText": "项目"
      }
    },
    {
      "path": "pages/pc-status/index",
      "style": {
        "navigationBarTitleText": "PC状态"
      }
    }
  ]
}
```

## 安全性

### 1. 配对安全

- 6位随机配对码（100万种组合）
- 5分钟过期时间
- 一次性使用
- PC端需用户确认

### 2. 传输安全

- WebRTC DTLS加密
- 端到端加密通道
- 未来集成Signal Protocol

### 3. 权限控制

- PC端文件访问需在项目目录内
- 路径注入防护
- 敏感文件过滤（.git, node_modules等）

## 性能优化

### 1. 缓存策略

- 移动端智能缓存笔记列表和文件树
- 文件内容按需加载
- LRU缓存淘汰策略

### 2. 分页加载

- 笔记列表分页（默认50条）
- 项目列表分页
- 搜索结果分页

### 3. 离线支持

- 离线消息队列（信令服务器）
- 本地缓存持久化（uni.storage）
- 断线重连机制

## 故障排除

### 信令服务器连接失败

```bash
# 检查服务器状态
curl http://localhost:9001

# 查看日志
cd signaling-server
npm run dev
```

### WebRTC连接失败

1. 检查STUN服务器可达性
2. 确认防火墙设置
3. 查看浏览器控制台WebRTC日志

### 配对超时

1. 确认移动端和PC端在同一网络
2. 检查信令服务器连接
3. 尝试手动输入配对码

## 开发路线图

### 已完成 ✅

- [x] 信令服务器
- [x] PC端WebRTC桥接
- [x] 设备配对机制
- [x] 知识库同步协议
- [x] 项目文件共享协议
- [x] PC状态监控
- [x] 移动端服务层

### 进行中 🚧

- [ ] 移动端UI页面（知识库、项目、状态）
- [ ] PC端UI集成（扫描、设备管理）
- [ ] Signal Protocol加密

### 规划中 📋

- [ ] 离线缓存优化
- [ ] 实时协作编辑
- [ ] 语音输入同步
- [ ] 文件上传（移动端→PC端）
- [ ] 推送通知

## 贡献指南

欢迎贡献代码和提出建议！请参考 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## License

MIT License
