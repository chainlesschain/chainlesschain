# 远程控制模块

基于 P2P 网络的远程命令系统，支持 Android 设备远程控制 PC。

**版本**: v1.0.0
**文件数量**: 41 个
**代码行数**: ~45,000 行

## 目录结构

```
remote/
├── index.js                          # 模块主入口，导出所有组件
├── remote-gateway.js                 # 远程网关（核心，741 行）
├── p2p-command-adapter.js            # P2P 命令适配器（793 行）
├── permission-gate.js                # 权限验证器（1,876 行）
├── command-router.js                 # 命令路由器（287 行）
├── remote-ipc.js                     # IPC 处理器（1,437 行）
│
├── handlers/                         # 命令处理器目录（24 个）
│   ├── ai-handler.js                 # AI 命令处理器
│   ├── ai-handler-enhanced.js        # AI 增强处理器（715 行）
│   ├── system-handler.js             # 系统命令处理器
│   ├── system-handler-enhanced.js    # 系统增强处理器（727 行）
│   ├── file-transfer-handler.js      # 文件传输处理器（1,256 行）
│   ├── remote-desktop-handler.js     # 远程桌面处理器
│   ├── knowledge-handler.js          # 知识库处理器
│   ├── command-history-handler.js    # 命令历史处理器
│   ├── device-manager-handler.js     # 设备管理处理器（940 行）
│   ├── clipboard-handler.js          # 剪贴板同步处理器
│   ├── notification-handler.js       # 通知处理器
│   ├── workflow-handler.js           # 工作流自动化处理器（743 行）
│   ├── browser-handler.js            # 浏览器自动化处理器
│   ├── power-handler.js              # 电源控制处理器
│   ├── process-handler.js            # 进程管理处理器
│   ├── media-handler.js              # 媒体控制处理器
│   ├── network-handler.js            # 网络信息处理器（1,116 行）
│   ├── storage-handler.js            # 存储信息处理器（1,027 行）
│   ├── display-handler.js            # 显示器信息处理器
│   ├── input-handler.js              # 输入控制处理器（961 行）
│   ├── application-handler.js        # 应用程序管理处理器（745 行）
│   ├── system-info-handler.js        # 系统信息处理器（967 行）
│   ├── security-handler.js           # 安全操作处理器
│   └── user-browser-handler.js       # 用户浏览器控制处理器（1,265 行）
│
├── logging/                          # 日志系统目录
│   ├── index.js                      # LoggingManager（240 行）
│   ├── command-logger.js             # 命令日志记录器（614 行）
│   ├── batched-command-logger.js     # 批量日志记录器（457 行）
│   ├── statistics-collector.js       # 统计信息收集器（681 行）
│   └── performance-config.js         # 性能配置（262 行）
│
├── browser-extension/                # 浏览器扩展目录
│   ├── browser-extension-server.js   # WebSocket 服务器（3,326 行）
│   ├── background.js                 # 扩展 Service Worker（15,077 行）
│   ├── content.js                    # Content Script（1,035 行）
│   ├── popup.js                      # 扩展弹窗脚本
│   ├── popup.html                    # 扩展弹窗 HTML
│   ├── manifest.json                 # Chrome 扩展清单
│   └── icons/                        # 扩展图标
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
│
├── workflow/                         # 工作流引擎目录
│   └── workflow-engine.js            # 工作流引擎（812 行）
│
├── __tests__/                        # 单元测试目录
│   ├── command-router.test.js        # 命令路由器测试
│   ├── permission-gate.test.js       # 权限验证器测试
│   └── remote-gateway.test.js        # 远程网关测试
│
└── README.md                         # 本文件
```

## 快速开始

### 1. 初始化远程网关

在主进程中（如 `index.js`）：

```javascript
const { createRemoteGateway } = require("./remote");

// 假设已有这些管理器实例
const p2pManager = require("./p2p/p2p-manager");
const didManager = require("./did/did-manager");
const ukeyManager = require("./ukey/ukey-manager");
const { getDatabase } = require("./database");

// 创建远程网关
const gateway = await createRemoteGateway(
  {
    p2pManager,
    didManager,
    ukeyManager,
    database: getDatabase(),
    mainWindow,
    aiEngine: null, // 可选
    ragManager: null, // 可选
  },
  {
    enableP2P: true,
    enableWebSocket: true,
    browserExtension: {
      port: 18790, // 浏览器扩展 WebSocket 端口
    },
    p2p: {
      requestTimeout: 30000,
      enableHeartbeat: true,
    },
    permission: {
      timestampWindow: 300000,
      enableRateLimit: true,
    },
  },
);

console.log("远程网关已启动");
```

### 2. 监听事件

```javascript
// 设备连接
gateway.on("device:connected", (peerId) => {
  console.log("设备已连接:", peerId);
});

// 设备注册
gateway.on("device:registered", ({ peerId, did }) => {
  console.log("设备已注册:", did);

  // 设置设备权限（默认为 Level 1）
  gateway.setDevicePermission(did, 2, {
    deviceName: "My Android Phone",
    grantedBy: "admin",
  });
});

// 命令完成
gateway.on("command:completed", ({ method, success, duration }) => {
  console.log(`命令 ${method} ${success ? "成功" : "失败"} (${duration}ms)`);
});

// 浏览器扩展连接
gateway.on("extension:connected", ({ clientId }) => {
  console.log("浏览器扩展已连接:", clientId);
});
```

### 3. 主动发送命令到 Android

```javascript
// 获取已连接设备
const devices = gateway.getConnectedDevices();

if (devices.length > 0) {
  const device = devices[0];

  // 发送命令
  const response = await gateway.sendCommand(device.peerId, "mobile.vibrate", {
    duration: 500,
  });

  console.log("命令响应:", response);
}
```

### 4. 广播事件到所有设备

```javascript
// 当 PC 端发生某事件时，通知所有移动设备
gateway.broadcastEvent("pc.status.changed", {
  status: "busy",
  message: "PC is running a task",
});
```

## 支持的命令（24 个命名空间）

### AI 命令 (ai.\*)

| 命令                  | 权限   | 说明         |
| --------------------- | ------ | ------------ |
| `ai.chat`             | Normal | AI 对话      |
| `ai.getConversations` | Public | 查询对话历史 |
| `ai.getModels`        | Public | 获取可用模型 |
| `ai.ragSearch`        | Normal | RAG 搜索     |
| `ai.controlAgent`     | Normal | 控制 Agent   |

### 系统命令 (system.\*)

| 命令                 | 权限   | 说明            |
| -------------------- | ------ | --------------- |
| `system.getStatus`   | Public | 获取系统状态    |
| `system.getInfo`     | Public | 获取系统信息    |
| `system.screenshot`  | Normal | 截图            |
| `system.notify`      | Normal | 发送通知        |
| `system.execCommand` | Admin  | 执行 Shell 命令 |

### 文件命令 (file.\*)

| 命令          | 权限   | 说明     |
| ------------- | ------ | -------- |
| `file.read`   | Normal | 读取文件 |
| `file.write`  | Admin  | 写入文件 |
| `file.create` | Admin  | 创建文件 |
| `file.delete` | Admin  | 删除文件 |
| `file.mkdir`  | Admin  | 创建目录 |

### 电源命令 (power.\*)

| 命令                | 权限   | 说明         |
| ------------------- | ------ | ------------ |
| `power.lock`        | Normal | 锁定屏幕     |
| `power.sleep`       | Admin  | 睡眠         |
| `power.hibernate`   | Admin  | 休眠         |
| `power.shutdown`    | Root   | 关机         |
| `power.restart`     | Root   | 重启         |
| `power.getSchedule` | Public | 获取定时任务 |

### 进程命令 (process.\*)

| 命令             | 权限   | 说明         |
| ---------------- | ------ | ------------ |
| `process.list`   | Public | 列出进程     |
| `process.get`    | Normal | 获取进程详情 |
| `process.search` | Public | 搜索进程     |
| `process.start`  | Admin  | 启动进程     |
| `process.kill`   | Admin  | 终止进程     |

### 媒体命令 (media.\*)

| 命令                 | 权限   | 说明         |
| -------------------- | ------ | ------------ |
| `media.getVolume`    | Public | 获取音量     |
| `media.setVolume`    | Normal | 设置音量     |
| `media.mute`         | Normal | 静音         |
| `media.unmute`       | Normal | 取消静音     |
| `media.playSound`    | Normal | 播放声音     |
| `media.mediaControl` | Normal | 媒体播放控制 |

### 网络命令 (network.\*)

| 命令                     | 权限   | 说明         |
| ------------------------ | ------ | ------------ |
| `network.getStatus`      | Public | 获取网络状态 |
| `network.getInterfaces`  | Public | 获取网卡列表 |
| `network.getPublicIP`    | Public | 获取公网 IP  |
| `network.getConnections` | Normal | 获取连接列表 |
| `network.ping`           | Normal | Ping 测试    |
| `network.traceroute`     | Admin  | 路由追踪     |

### 存储命令 (storage.\*)

| 命令                    | 权限   | 说明         |
| ----------------------- | ------ | ------------ |
| `storage.getDisks`      | Public | 获取磁盘列表 |
| `storage.getUsage`      | Public | 获取使用情况 |
| `storage.getStats`      | Normal | 获取统计信息 |
| `storage.getLargeFiles` | Normal | 获取大文件   |
| `storage.cleanup`       | Admin  | 清理存储     |

### 显示命令 (display.\*)

| 命令                    | 权限   | 说明           |
| ----------------------- | ------ | -------------- |
| `display.getDisplays`   | Public | 获取显示器列表 |
| `display.getPrimary`    | Public | 获取主显示器   |
| `display.getResolution` | Public | 获取分辨率     |
| `display.getBrightness` | Public | 获取亮度       |
| `display.screenshot`    | Normal | 显示器截图     |
| `display.setBrightness` | Admin  | 设置亮度       |

### 输入命令 (input.\*)

| 命令                      | 权限   | 说明         |
| ------------------------- | ------ | ------------ |
| `input.getCursorPosition` | Public | 获取光标位置 |
| `input.sendKeyPress`      | Normal | 发送按键     |
| `input.sendKeyCombo`      | Normal | 发送组合键   |
| `input.typeText`          | Normal | 输入文本     |
| `input.mouseClick`        | Normal | 鼠标点击     |
| `input.mouseDrag`         | Admin  | 鼠标拖拽     |

### 应用命令 (app.\*)

| 命令                | 权限   | 说明           |
| ------------------- | ------ | -------------- |
| `app.listInstalled` | Public | 列出已安装应用 |
| `app.listRunning`   | Public | 列出运行中应用 |
| `app.search`        | Public | 搜索应用       |
| `app.launch`        | Normal | 启动应用       |
| `app.focus`         | Normal | 聚焦应用       |
| `app.close`         | Admin  | 关闭应用       |

### 浏览器扩展命令 (extension.\*)

支持 **200+** 个浏览器控制命令，包括：

- Tab 管理、窗口管理
- 页面导航、截图
- 书签、历史记录
- Cookie、存储
- 网络拦截
- DOM 操作
- WebRTC 调试
- 性能监控
- 无障碍检查
- 等等...

详见 `permission-gate.js` 中的完整命令权限映射。

## 权限系统

### 权限级别

| 级别 | 名称   | 说明                             |
| ---- | ------ | -------------------------------- |
| 1    | Public | 查询状态、读取数据               |
| 2    | Normal | AI 对话、文件读取、基本操作      |
| 3    | Admin  | 系统控制、文件写入、进程管理     |
| 4    | Root   | 核心功能、安全设置（需要 U-Key） |

### 设置设备权限

```javascript
const { PERMISSION_LEVELS } = require("./remote");

// 提升设备到 Admin 级别
await gateway.setDevicePermission(did, PERMISSION_LEVELS.ADMIN, {
  deviceName: "My Phone",
  grantedBy: "admin",
  expiresIn: 86400000, // 24 小时后过期
  notes: "Temporary admin access",
});
```

### 查看审计日志

```javascript
// 查看某个设备的审计日志
const logs = gateway.getAuditLogs({
  did: "did:chainlesschain:abc123",
  limit: 50,
});

logs.forEach((log) => {
  console.log(
    `${log.timestamp}: ${log.method} - ${log.granted ? "GRANTED" : "DENIED"}`,
  );
});
```

## 工作流自动化

### 创建工作流

```javascript
const workflow = {
  name: "Daily Report",
  description: "每日自动生成报告",
  triggers: [
    { type: "schedule", cron: "0 9 * * *" }, // 每天 9:00
  ],
  steps: [
    {
      id: "step1",
      command: "system.getStatus",
      params: {},
    },
    {
      id: "step2",
      command: "ai.chat",
      params: {
        message: "请根据以下系统状态生成报告: {{step1.result}}",
      },
      dependsOn: ["step1"],
    },
  ],
};

await gateway.handlers.workflow.create(workflow);
```

### 工作流功能

- **条件分支**: 根据上一步结果决定下一步
- **循环执行**: 重复执行某些步骤
- **变量管理**: 步骤间传递数据
- **错误处理**: 失败重试、跳过、回滚
- **断点调试**: 单步执行、暂停恢复

## 浏览器扩展

### 安装步骤（开发者模式）

1. 打开 Chrome 浏览器，访问 `chrome://extensions/`
2. 开启右上角的 "开发者模式"
3. 点击 "加载已解压的扩展程序"
4. 选择 `desktop-app-vue/src/main/remote/browser-extension/` 目录
5. 扩展安装完成后，点击扩展图标连接桌面应用

### 扩展功能

- **标签管理**: 创建、关闭、切换标签页
- **页面导航**: 前进、后退、刷新
- **截图**: 可见区域、整页截图
- **DOM 操作**: 点击、输入、提取数据
- **网络拦截**: 请求阻断、响应模拟
- **Cookie 管理**: 读取、设置、删除
- **存储访问**: localStorage、sessionStorage、IndexedDB
- **性能监控**: 获取性能指标、内存分析

## 统计信息

```javascript
const stats = gateway.getStats();

console.log("统计信息:");
console.log("- 总命令数:", stats.totalCommands);
console.log("- 成功率:", stats.successRate);
console.log("- 已连接设备:", stats.connectedDevices);
console.log("- 运行时间:", stats.uptime, "ms");
```

## 安全注意事项

1. **权限管理**: 新设备默认为 Level 1（Public），需要手动提升权限
2. **时间戳验证**: 命令时间戳有效期为 5 分钟，防止重放攻击
3. **Nonce 验证**: 每个 Nonce 只能使用一次
4. **频率限制**: 默认 100 req/min，高危命令 10 req/min
5. **U-Key 验证**: Level 4 命令需要 U-Key 二次验证（如果启用）
6. **审计日志**: 所有命令都会记录审计日志
7. **自动撤销**: 7 天不活跃的设备自动降级到 Public 权限

## 添加自定义命令处理器

### 1. 创建处理器

```javascript
// handlers/custom-handler.js
class CustomHandler {
  constructor(options) {
    this.options = options;
  }

  async handle(action, params, context) {
    switch (action) {
      case "doSomething":
        return await this.doSomething(params, context);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  async doSomething(params, context) {
    // 实现自定义逻辑
    return { success: true, data: "result" };
  }
}

module.exports = { CustomHandler };
```

### 2. 注册处理器

```javascript
const { CustomHandler } = require("./handlers/custom-handler");

// 在 remote-gateway.js 的 registerCommandHandlers() 中添加：
this.handlers.custom = new CustomHandler(this.options.custom || {});
this.commandRouter.registerHandler("custom", this.handlers.custom);
```

### 3. 配置权限

```javascript
// 在 permission-gate.js 中添加权限配置
'custom.doSomething': PERMISSION_LEVELS.NORMAL,
'custom.sensitiveAction': PERMISSION_LEVELS.ADMIN,
```

## 测试

```bash
# 运行单元测试
npm run test:unit -- src/main/remote/__tests__/

# 运行特定测试
npm run test:unit -- src/main/remote/__tests__/command-router.test.js
```

## 故障排查

### 命令无响应

1. 检查 P2P 网络是否已连接
2. 检查设备是否已注册
3. 查看审计日志确认权限

### 权限被拒绝

1. 检查设备权限级别：`gateway.getDevicePermission(did)`
2. 检查命令所需权限级别
3. 提升设备权限或降低命令权限要求

### 性能问题

1. 查看统计信息：`gateway.getStats()`
2. 检查频率限制是否触发
3. 优化命令处理逻辑

### 浏览器扩展无法连接

1. 确认桌面应用已启动
2. 检查 WebSocket 端口（默认 18790）是否可用
3. 查看扩展控制台错误信息

## 最佳实践

1. **渐进式授权**: 从 Level 1 开始，根据信任度逐步提升
2. **临时权限**: 使用 `expiresIn` 设置权限过期时间
3. **监控审计日志**: 定期检查异常行为
4. **错误处理**: 始终 try-catch 处理命令执行
5. **性能优化**: 避免频繁发送大数据量命令

## 相关文档

- [P2P 网络文档](../p2p/README.md)
- [DID 身份系统](../did/README.md)
- [权限系统详解](../../docs/features/PERMISSION_SYSTEM.md)
- [Android 客户端开发](../../../../android-app/README.md)
