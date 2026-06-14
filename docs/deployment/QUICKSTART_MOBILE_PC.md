# 移动端与PC端P2P通讯 - 快速开始指南

## 前置条件

- Node.js >= 16.0.0
- PC端应用已安装并运行
- 移动端已构建（uni-app）

## 步骤1：启动信令服务器

```bash
# 进入信令服务器目录
cd signaling-server

# 安装依赖
npm install

# 启动服务器
npm start
```

信令服务器将在 `ws://localhost:9001` 启动。

## 步骤2：配置PC端

### 2.1 安装wrtc依赖

```bash
cd desktop-app-vue
npm install wrtc ws
```

### 2.2 修改主进程（desktop-app-vue/src/main/index.js）

在P2P管理器初始化后添加：

```javascript
const MobileBridge = require('./p2p/mobile-bridge');
const DevicePairingHandler = require('./p2p/device-pairing-handler');
const KnowledgeSyncHandler = require('./p2p/knowledge-sync-handler');
const ProjectSyncHandler = require('./p2p/project-sync-handler');
const PCStatusHandler = require('./p2p/pc-status-handler');

let mobileBridge = null;
let devicePairingHandler = null;
let knowledgeSyncHandler = null;
let projectSyncHandler = null;
let pcStatusHandler = null;

// 在P2P管理器初始化后调用
async function initMobileSync() {
  console.log('[Main] 初始化移动端同步...');

  // 创建Mobile Bridge
  mobileBridge = new MobileBridge(p2pManager, {
    signalingUrl: 'ws://localhost:9001'
  });

  await mobileBridge.connect();

  // 创建设备配对处理器
  devicePairingHandler = new DevicePairingHandler(
    p2pManager,
    mobileBridge,
    deviceManager // 确保deviceManager已初始化
  );

  // 创建同步处理器
  knowledgeSyncHandler = new KnowledgeSyncHandler(db, p2pManager);
  projectSyncHandler = new ProjectSyncHandler(db, p2pManager);
  pcStatusHandler = new PCStatusHandler(p2pManager);

  console.log('[Main] 移动端同步已初始化');
}

// 在app ready后调用
app.whenReady().then(async () => {
  // ... 其他初始化代码 ...

  // 初始化P2P
  await p2pManager.initialize();

  // 初始化移动端同步
  await initMobileSync();

  // ... 其他代码 ...
});
```

### 2.3 添加IPC处理器

```javascript
// 二维码扫描
ipcMain.handle('mobile:start-scanner', async () => {
  try {
    const result = await devicePairingHandler.startQRCodeScanner();
    return { success: true, device: result.device };
  } catch (error) {
    console.error('[IPC] 扫描失败:', error);
    return { success: false, error: error.message };
  }
});

// 手动输入配对码
ipcMain.handle('mobile:pair-with-code', async (event, code) => {
  try {
    const result = await devicePairingHandler.pairWithCode(
      code,
      null, // mobileDid - 将从二维码数据获取
      null  // deviceInfo - 将从二维码数据获取
    );
    return { success: true, device: result.device };
  } catch (error) {
    console.error('[IPC] 配对失败:', error);
    return { success: false, error: error.message };
  }
});

// 获取统计信息
ipcMain.handle('mobile:get-stats', async () => {
  return {
    bridge: mobileBridge?.getStats() || {},
    knowledge: knowledgeSyncHandler?.getStats() || {},
    project: projectSyncHandler?.getStats() || {}
  };
});
```

## 步骤3：配置移动端

### 3.1 安装依赖

移动端无需额外依赖，WebRTC是浏览器原生支持。

### 3.2 配置信令服务器地址

修改 `mobile-app-uniapp/src/services/p2p/p2p-manager.js`:

```javascript
this.config = {
  // 本地开发
  signalingServer: config.signalingServer || 'ws://localhost:9001',

  // 生产环境（替换为实际服务器地址）
  // signalingServer: config.signalingServer || 'wss://your-domain.com/signal',

  // ... 其他配置
}
```

### 3.3 添加路由配置

在 `mobile-app-uniapp/src/pages.json` 中确保包含：

```json
{
  "pages": [
    {
      "path": "pages/index/index",
      "style": {
        "navigationBarTitleText": "首页"
      }
    },
    {
      "path": "pages/device-pairing/index",
      "style": {
        "navigationBarTitleText": "设备配对"
      }
    }
  ]
}
```

## 步骤4：测试配对流程

### 4.1 移动端操作

```javascript
// 在移动端首页添加按钮
<button @click="goPairing">配对PC设备</button>

// 方法
methods: {
  goPairing() {
    uni.navigateTo({
      url: '/pages/device-pairing/index'
    })
  }
}
```

打开配对页面后：
1. 自动生成6位配对码
2. 显示二维码（如果支持）
3. 等待PC端扫描

### 4.2 PC端操作

在PC端设置页面：
1. 点击"扫描移动设备"按钮
2. 使用摄像头扫描移动端二维码
3. 或手动输入6位配对码
4. 确认配对

### 4.3 验证连接

配对成功后，在移动端检查连接状态：

```javascript
import { getP2PManager } from '@/services/p2p/p2p-manager'

const p2pManager = getP2PManager()
const stats = p2pManager.getStats()

console.log('P2P状态:', stats)
// 输出：
// {
//   isInitialized: true,
//   isConnected: true,
//   peersCount: 1,
//   dataChannelsCount: 1,
//   messageQueueSize: 0,
//   natType: 'unknown'
// }
```

## 步骤5：测试数据同步

### 5.1 测试知识库同步

```javascript
import { getKnowledgeSyncService } from '@/services/knowledge-sync'

// 初始化（使用PC的peerId）
const syncService = getKnowledgeSyncService()
await syncService.initialize(pcPeerId)

// 获取笔记列表
const { notes, total } = await syncService.listNotes({
  limit: 10
})

console.log(`共有 ${total} 条笔记，获取了前 ${notes.length} 条`)
notes.forEach(note => {
  console.log(`- ${note.title}`)
})
```

### 5.2 测试项目同步

```javascript
import { getProjectSyncService } from '@/services/project-sync'

const syncService = getProjectSyncService()
await syncService.initialize(pcPeerId)

// 获取项目列表
const { projects, total } = await syncService.listProjects()

console.log(`共有 ${total} 个项目`)
projects.forEach(project => {
  console.log(`- ${project.name}: ${project.fileCount} 个文件`)
})
```

### 5.3 测试PC状态监控

```javascript
import { getPCStatusService } from '@/services/pc-status'

const statusService = getPCStatusService()
await statusService.initialize(pcPeerId)

// 获取系统信息
const systemInfo = await statusService.getSystemInfo()
console.log(`PC: ${systemInfo.hostname}`)
console.log(`平台: ${systemInfo.platform}`)
console.log(`CPU: ${systemInfo.cpuModel}`)

// 获取实时状态
const status = await statusService.getRealtimeStatus()
console.log(`CPU使用率: ${status.cpu.usage}%`)
console.log(`内存使用: ${statusService.formatBytes(status.memory.used)}`)
```

## 故障排除

### 问题1：信令服务器连接失败

**症状：** 移动端无法连接到信令服务器

**解决方案：**
```bash
# 检查信令服务器是否运行
netstat -an | grep 9001

# 检查防火墙
sudo ufw allow 9001/tcp  # Ubuntu
firewall-cmd --add-port=9001/tcp --permanent  # CentOS

# 查看服务器日志
cd signaling-server
npm run dev
```

### 问题2：WebRTC连接失败

**症状：** 配对成功但无法建立数据通道

**解决方案：**
1. 检查STUN服务器：
   ```javascript
   // 在mobile-app-uniapp/src/services/p2p/p2p-manager.js
   iceServers: [
     { urls: 'stun:stun.l.google.com:19302' },
     { urls: 'stun:stun1.l.google.com:19302' }
   ]
   ```

2. 查看浏览器控制台WebRTC日志

3. 尝试使用TURN服务器（如果在不同网络）

### 问题3：PC端数据库查询失败

**症状：** 移动端请求返回错误

**解决方案：**
1. 确认PC端数据库已初始化
2. 检查表结构是否正确
3. 查看PC端主进程日志

### 问题4：配对码过期

**症状：** 扫描二维码提示"配对码已过期"

**解决方案：**
- 移动端点击"刷新二维码"按钮
- 配对码有效期为5分钟

## 下一步

- 查看完整文档：[MOBILE_PC_SYNC.md](./MOBILE_PC_SYNC.md)
- 开发移动端UI页面
- 集成PC端UI
- 部署生产环境

## 支持

遇到问题？
- 提交Issue: https://github.com/yourusername/chainlesschain/issues
- 查看文档: [MOBILE_PC_SYNC.md](./MOBILE_PC_SYNC.md)

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：移动端与PC端P2P通讯 - 快速开始指南。

### 2. 核心特性
见正文要点 / 特性 / 范围章节。

### 3. 系统架构
见正文架构 / 设计章节（或项目根 docs/design/ 系统设计主文档）。

### 4. 系统定位
见正文定位 / 背景章节。

### 5. 核心功能
见正文功能 / 内容章节。

### 6. 技术架构
见正文技术 / 实现章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数 / 环境章节。

### 11. 性能指标
见正文性能 / 指标章节（如有）。

### 12. 测试覆盖
见正文测试 / 验证章节（如有）。

### 13. 安全考虑
见正文安全 / 权限章节（如适用）。

### 14. 故障排除
见正文故障 / 已知限制 / 常见问题章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文命令 / 操作 / API 示例。

### 17. 相关文档
见正文相关链接；项目根 docs/design/ 系统设计主文档与对应模块文档。
