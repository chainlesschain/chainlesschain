# 远程控制模块

基于 P2P 网络的远程命令系统，支持 Android 设备远程控制 PC。

## 目录结构

```
remote/
├── index.js                      # 模块主入口
├── remote-gateway.js             # 远程网关（核心）
├── p2p-command-adapter.js        # P2P 命令适配器
├── permission-gate.js            # 权限验证器
├── command-router.js             # 命令路由器
├── handlers/                     # 命令处理器
│   ├── ai-handler.js             # AI 命令处理器
│   └── system-handler.js         # 系统命令处理器
└── README.md                     # 本文件
```

## 快速开始

### 1. 初始化远程网关

在主进程中（如 `index.js`）：

```javascript
const { createRemoteGateway } = require('./remote');

// 假设已有这些管理器实例
const p2pManager = require('./p2p/p2p-manager');
const didManager = require('./did/did-manager');
const ukeyManager = require('./ukey/ukey-manager');
const { getDatabase } = require('./database');

// 创建远程网关
const gateway = await createRemoteGateway({
  p2pManager,
  didManager,
  ukeyManager,
  database: getDatabase(),
  mainWindow,
  aiEngine: null,  // 可选
  ragManager: null // 可选
}, {
  enableP2P: true,
  enableWebSocket: false,  // 暂时不启用 WebSocket
  p2p: {
    requestTimeout: 30000,
    enableHeartbeat: true
  },
  permission: {
    timestampWindow: 300000,
    enableRateLimit: true
  }
});

console.log('远程网关已启动');
```

### 2. 监听事件

```javascript
// 设备连接
gateway.on('device:connected', (peerId) => {
  console.log('设备已连接:', peerId);
});

// 设备注册
gateway.on('device:registered', ({ peerId, did }) => {
  console.log('设备已注册:', did);

  // 设置设备权限（默认为 Level 1）
  gateway.setDevicePermission(did, 2, {
    deviceName: 'My Android Phone',
    grantedBy: 'admin'
  });
});

// 命令完成
gateway.on('command:completed', ({ method, success, duration }) => {
  console.log(`命令 ${method} ${success ? '成功' : '失败'} (${duration}ms)`);
});
```

### 3. 主动发送命令到 Android

```javascript
// 获取已连接设备
const devices = gateway.getConnectedDevices();

if (devices.length > 0) {
  const device = devices[0];

  // 发送命令
  const response = await gateway.sendCommand(
    device.peerId,
    'mobile.vibrate',
    { duration: 500 }
  );

  console.log('命令响应:', response);
}
```

### 4. 广播事件到所有设备

```javascript
// 当 PC 端发生某事件时，通知所有移动设备
gateway.broadcastEvent('pc.status.changed', {
  status: 'busy',
  message: 'PC is running a task'
});
```

## 支持的命令

### AI 命令 (ai.*)

#### ai.chat - AI 对话
```javascript
{
  method: 'ai.chat',
  params: {
    message: 'Hello AI',
    conversationId: 'conv-123',  // 可选
    model: 'gpt-4',              // 可选
    systemPrompt: 'You are...'   // 可选
  }
}

// 响应
{
  conversationId: 'conv-123',
  reply: 'Hello! How can I help you?',
  model: 'gpt-4',
  tokens: { prompt: 10, completion: 20, total: 30 }
}
```

#### ai.getConversations - 查询对话历史
```javascript
{
  method: 'ai.getConversations',
  params: {
    limit: 20,     // 可选
    offset: 0,     // 可选
    keyword: 'AI'  // 可选
  }
}
```

#### ai.ragSearch - RAG 搜索
```javascript
{
  method: 'ai.ragSearch',
  params: {
    query: 'What is AI?',
    topK: 5  // 可选
  }
}
```

#### ai.controlAgent - 控制 Agent
```javascript
{
  method: 'ai.controlAgent',
  params: {
    action: 'start',  // 'start' | 'stop' | 'restart' | 'status'
    agentId: 'agent-1'
  }
}
```

### 系统命令 (system.*)

#### system.getStatus - 获取系统状态
```javascript
{
  method: 'system.getStatus',
  params: {}
}

// 响应
{
  cpu: { usage: '15.50', cores: 8 },
  memory: { total: 16000000, used: 8000000, free: 8000000 },
  system: { platform: 'win32', uptime: 86400 }
}
```

#### system.screenshot - 截图
```javascript
{
  method: 'system.screenshot',
  params: {
    display: 0,       // 可选
    format: 'png',    // 可选
    quality: 80       // 可选
  }
}

// 响应
{
  format: 'png',
  data: '<base64 encoded image>',
  width: 1920,
  height: 1080
}
```

#### system.notify - 发送通知
```javascript
{
  method: 'system.notify',
  params: {
    title: 'Notification Title',
    body: 'Notification body text',
    urgency: 'normal'  // 'low' | 'normal' | 'critical'
  }
}
```

#### system.execCommand - 执行命令（需要高权限）
```javascript
{
  method: 'system.execCommand',
  params: {
    command: 'ls -la',
    cwd: '/home/user',  // 可选
    timeout: 30000      // 可选
  }
}

// 响应
{
  success: true,
  stdout: '...',
  stderr: '',
  exitCode: 0
}
```

## 权限系统

### 权限级别

- **Level 1 (Public)**: 查询状态、读取数据
- **Level 2 (Normal)**: AI 对话、文件操作
- **Level 3 (Admin)**: 系统控制、配置修改
- **Level 4 (Root)**: 核心功能、安全设置（需要 U-Key）

### 设置设备权限

```javascript
const { PERMISSION_LEVELS } = require('./remote');

// 提升设备到 Admin 级别
await gateway.setDevicePermission(did, PERMISSION_LEVELS.ADMIN, {
  deviceName: 'My Phone',
  grantedBy: 'admin',
  expiresIn: 86400000,  // 24 小时后过期
  notes: 'Temporary admin access'
});
```

### 查看审计日志

```javascript
// 查看某个设备的审计日志
const logs = gateway.getAuditLogs({
  did: 'did:chainlesschain:abc123',
  limit: 50
});

logs.forEach(log => {
  console.log(`${log.timestamp}: ${log.method} - ${log.granted ? 'GRANTED' : 'DENIED'}`);
});
```

## 统计信息

```javascript
const stats = gateway.getStats();

console.log('统计信息:');
console.log('- 总命令数:', stats.totalCommands);
console.log('- 成功率:', stats.successRate);
console.log('- 已连接设备:', stats.connectedDevices);
console.log('- 运行时间:', stats.uptime, 'ms');
```

## 安全注意事项

1. **权限管理**: 新设备默认为 Level 1（Public），需要手动提升权限
2. **时间戳验证**: 命令时间戳有效期为 5 分钟，防止重放攻击
3. **Nonce 验证**: 每个 Nonce 只能使用一次
4. **频率限制**: 默认 100 req/min，高危命令 10 req/min
5. **U-Key 验证**: Level 4 命令需要 U-Key 二次验证（如果启用）
6. **审计日志**: 所有命令都会记录审计日志

## 添加自定义命令处理器

### 1. 创建处理器

```javascript
// handlers/file-handler.js
class FileCommandHandler {
  constructor(options) {
    this.options = options;
  }

  async handle(action, params, context) {
    switch (action) {
      case 'read':
        return await this.read(params, context);
      case 'write':
        return await this.write(params, context);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  async read(params, context) {
    // 实现文件读取逻辑
    return { content: '...' };
  }

  async write(params, context) {
    // 实现文件写入逻辑
    return { success: true };
  }
}

module.exports = FileCommandHandler;
```

### 2. 注册处理器

```javascript
const FileCommandHandler = require('./handlers/file-handler');

// 在 remote-gateway.js 的 registerCommandHandlers() 中添加：
this.handlers.file = new FileCommandHandler();
this.commandRouter.registerHandler('file', this.handlers.file);
```

### 3. 配置权限

```javascript
// 在 permission-gate.js 中添加权限配置
'file.read': PERMISSION_LEVELS.NORMAL,
'file.write': PERMISSION_LEVELS.ADMIN,
'file.delete': PERMISSION_LEVELS.ADMIN,
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
