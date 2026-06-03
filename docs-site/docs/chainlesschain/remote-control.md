# 远程控制系统

> **版本: v0.27.0+ | 完整的桌面应用远程控制能力**

## 概述

远程控制系统允许通过浏览器插件（Chrome/Edge）和移动端（Android/iOS）远程控制 ChainlessChain Desktop 应用，实现跨设备的无缝操作体验。系统基于 WebSocket 本地通信（仅监听 127.0.0.1:18790），提供四级权限体系（READ/WRITE/EXECUTE/ADMIN）、AI 命令代理、命令审计追踪和速率限制保护。

远程控制系统允许通过浏览器插件和移动端远程控制 ChainlessChain Desktop 应用，实现跨设备的无缝操作体验。

## 核心特性

- 🌐 **WebSocket 本地通信**: 仅监听 127.0.0.1:18790，安全的本地双向通信
- 📱 **多端远程控制**: 支持浏览器插件（Chrome/Edge）和移动端（Android/iOS）
- 🤖 **AI 命令代理**: 通过远程通道调用本地 AI 进行智能分析
- 🔐 **四级权限体系**: READ/WRITE/EXECUTE/ADMIN 分级权限控制
- 📊 **命令审计追踪**: 所有远程命令完整记录，支持操作日志查询
- ⚡ **速率限制保护**: 可配置的命令频率限制，防止滥用

## 系统架构

```
┌─────────────────────┐
│  移动端 App         │
│  (Android/iOS)      │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐     ┌─────────────────────┐
│  ChainlessChain     │◄────│  浏览器插件         │
│  Desktop            │     │  (Chrome/Edge)      │
│  (主控制中心)        │     └─────────────────────┘
└──────────┬──────────┘
           │
    ┌──────┴──────┐
    ▼             ▼
┌─────────┐  ┌─────────────┐
│ 本地AI   │  │ 浏览器自动化 │
└─────────┘  └─────────────┘
```

## 连接方式

### WebSocket 连接

Desktop 应用作为 WebSocket 服务器：

```
本地地址: ws://127.0.0.1:18790
仅接受本地连接，确保安全
```

### 连接流程

1. **插件/移动端启动** → 尝试连接 WebSocket
2. **发送注册消息** → 包含设备信息
3. **建立双向通信** → 命令/响应/事件
4. **保持心跳** → 检测连接状态

```javascript
// 注册消息示例
{
  "type": "register",
  "client": {
    "type": "browser-extension",
    "version": "1.0.0",
    "browser": "Chrome 120"
  }
}
```

---

## 命令类型

### AI 命令

通过本地 AI 执行智能任务：

```javascript
// 发送 AI 命令
{
  "type": "ai",
  "command": "analyze",
  "params": {
    "content": "分析这段代码的安全性",
    "context": "..."
  }
}

// 响应
{
  "type": "ai-response",
  "result": {
    "analysis": "...",
    "suggestions": [...]
  }
}
```

### 系统命令

控制 Desktop 应用功能：

```javascript
// 获取系统状态
{
  "type": "system",
  "command": "getStatus"
}

// 执行操作
{
  "type": "system",
  "command": "openNote",
  "params": { "id": "note-123" }
}
```

### 浏览器命令

通过插件控制浏览器：

```javascript
// 打开新标签
{
  "type": "browser",
  "command": "tabs.create",
  "params": { "url": "https://example.com" }
}

// 截取页面
{
  "type": "browser",
  "command": "page.screenshot"
}
```

---

## 权限系统

### 权限级别

| 级别    | 说明 | 允许的操作           |
| ------- | ---- | -------------------- |
| READ    | 只读 | 获取信息、查看状态   |
| WRITE   | 读写 | 创建、修改内容       |
| EXECUTE | 执行 | 运行命令、自动化操作 |
| ADMIN   | 管理 | 系统设置、权限管理   |

### 权限配置

在 Desktop 设置中配置：

```
设置 → 远程控制 → 权限管理
```

可以：

- 启用/禁用远程控制
- 设置允许的命令类型
- 配置设备白名单
- 查看连接历史

---

## 移动端控制

### Android 应用

从移动端远程控制 Desktop：

**功能模块：**

- **应用管理器** - 查看和管理应用
- **安全信息** - 查看安全状态
- **网络信息** - 网络连接状态
- **输入控制** - 远程输入文本
- **存储控制** - 文件管理

### 连接移动端

1. 确保 Desktop 和移动设备在同一网络
2. 在 Desktop 启用远程控制
3. 在移动端扫描二维码或输入连接码
4. 授权连接

---

## 统计信息

### 查看统计

```javascript
// 获取远程控制统计
{
  "type": "system",
  "command": "getRemoteStats"
}

// 响应
{
  "totalCommands": 1234,
  "successRate": 99.5,
  "connectedClients": 2,
  "uptime": "2h 30m"
}
```

### 统计面板

在 Desktop 查看：

```
设置 → 远程控制 → 统计信息
```

包含：

- 命令执行数量
- 成功/失败率
- 连接时长
- 带宽使用

---

## 安全注意事项

### 本地通信限制

```javascript
// 仅接受本地连接
const ALLOWED_ORIGINS = ["127.0.0.1", "localhost"];
```

- WebSocket 仅监听 127.0.0.1
- 不暴露到局域网或互联网
- 需要用户主动安装和启用插件

### 命令审计

所有远程命令都会被记录：

```javascript
{
  "timestamp": "2026-02-11T10:30:00Z",
  "client": "browser-extension",
  "command": "page.screenshot",
  "params": {},
  "result": "success",
  "duration": 150
}
```

查看审计日志：

```
设置 → 远程控制 → 操作日志
```

### 敏感操作确认

高风险操作需要用户确认：

- 删除文件
- 修改系统设置
- 执行脚本
- 访问敏感数据

---

## 使用示例

### 从浏览器插件远程控制

```javascript
// 1. 插件自动连接 Desktop WebSocket
const ws = new WebSocket("ws://127.0.0.1:18790");

// 2. 注册插件设备
ws.send(JSON.stringify({
  type: "register",
  client: { type: "browser-extension", version: "1.0.0" }
}));

// 3. 发送 AI 分析命令
ws.send(JSON.stringify({
  type: "ai",
  command: "analyze",
  params: { content: "帮我总结这篇文章的要点" }
}));

// 4. 接收 AI 响应
ws.onmessage = (event) => {
  const response = JSON.parse(event.data);
  if (response.type === "ai-response") {
    console.log("AI 分析结果:", response.result);
  }
};
```

### 从移动端查看笔记

```javascript
// 移动端发送命令获取笔记列表
{
  "type": "system",
  "command": "listNotes",
  "params": { "limit": 10, "orderBy": "updated_at" }
}

// Desktop 返回笔记数据
{
  "type": "system-response",
  "result": {
    "notes": [
      { "id": "note-001", "title": "会议纪要", "updatedAt": "2026-03-10" },
      { "id": "note-002", "title": "项目计划", "updatedAt": "2026-03-09" }
    ]
  }
}
```

## 配置参考

### 服务器核心配置

```javascript
// src/main/remote/remote-control-server.js
const remoteControlServerConfig = {
  host: '127.0.0.1',   // 严格绑定本地回环，不对外暴露
  port: 18790,
  maxConnections: 5,   // 最大同时连接数
  heartbeatInterval: 30 * 1000,   // 心跳检测间隔（毫秒）
  connectionTimeout: 60 * 1000,   // 空闲连接超时时间（毫秒）
};
```

### 权限与速率限制配置

```javascript
// .chainlesschain/remote-control.json
const remoteControlConfig = {
  enabled: true,
  port: 18790,
  allowedClients: ['browser-extension', 'mobile-app'],

  // 四级权限分配
  permissions: {
    'browser-extension': ['READ', 'WRITE', 'EXECUTE'],
    'mobile-app': ['READ', 'WRITE'],
  },

  // 速率限制
  rateLimit: {
    maxCommandsPerSecond: 10,
    maxCommandsPerMinute: 200,
    burstAllowance: 5,       // 允许短时突发超量
  },

  // 审计日志
  audit: {
    enabled: true,
    retentionDays: 30,
    sensitiveParamsMask: ['password', 'token', 'apiKey'],  // 自动脱敏字段
  },
};
```

### AI 命令代理配置

```javascript
// src/main/remote/remote-command-handler.js
const aiCommandConfig = {
  // AI 命令超时
  timeout: 60 * 1000,      // 60 秒（毫秒）
  streamEnabled: true,      // 启用流式响应
  maxContextLength: 4096,   // 最大上下文长度（tokens）

  // 允许远程调用的 AI 功能
  allowedFeatures: ['analyze', 'summarize', 'translate', 'generate'],
};
```

---

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
| ---- | ---- | ---- | ---- |
| WebSocket 连接建立耗时 | < 50ms | ~20ms | ✅ 达标 |
| 系统命令响应延迟（READ） | < 100ms | ~30ms | ✅ 达标 |
| 系统命令响应延迟（WRITE） | < 200ms | ~80ms | ✅ 达标 |
| AI 命令首字节延迟（流式） | < 1000ms | ~500ms | ✅ 达标 |
| 浏览器命令执行延迟 | < 500ms | ~200ms | ✅ 达标 |
| 最大并发连接数 | 5 | 5 | ✅ 达标 |
| 速率限制响应延迟（超限拦截） | < 5ms | ~2ms | ✅ 达标 |
| 审计日志写入耗时 | < 10ms | ~3ms | ✅ 达标 |
| 心跳检测周期 | 30s | 30s | ✅ 达标 |
| 空闲连接超时断开 | 60s | 60s | ✅ 达标 |

---

## 测试覆盖率

| 测试文件 | 覆盖范围 |
| -------- | -------- |
| ✅ `tests/unit/remote/remote-control-server.test.js` | WebSocket 服务器启动/停止、仅本地连接校验、心跳检测 |
| ✅ `tests/unit/remote/remote-command-handler.test.js` | AI/系统/浏览器命令分发、超时处理、响应格式 |
| ✅ `tests/unit/remote/remote-permission-manager.test.js` | 四级权限校验、设备白名单、未授权拒绝 |
| ✅ `tests/unit/remote/remote-audit-logger.test.js` | 命令审计记录、敏感参数脱敏、日志保留策略 |
| ✅ `tests/unit/remote/rate-limiter.test.js` | 速率限制阈值、突发允许、超限拦截 |
| ✅ `tests/integration/remote/browser-extension-flow.test.js` | 插件注册→命令→响应完整流程 |
| ✅ `tests/integration/remote/mobile-app-flow.test.js` | 移动端连接、二维码授权、笔记读写流程 |
| ✅ `tests/e2e/remote/multi-client-concurrent.test.js` | 多客户端并发命令、权限隔离验证 |

---

## 安全考虑

1. **仅本地通信**: WebSocket 严格监听 127.0.0.1，不暴露到局域网或公网
2. **设备白名单**: 仅允许已授权的客户端类型连接，拒绝未知设备
3. **权限分级**: 不同客户端分配不同权限级别，移动端默认 READ/WRITE，不给 ADMIN
4. **速率限制**: 配置每秒/每分钟最大命令数，防止恶意客户端滥用
5. **敏感操作确认**: 删除文件、修改系统设置等操作需用户在 Desktop 端手动确认
6. **命令审计**: 所有远程命令完整记录时间、来源、参数和结果，支持事后审查
7. **超时断连**: 空闲连接超时自动断开，减少攻击面
8. **数据脱敏**: 审计日志中密码等敏感参数自动脱敏

## 故障排查

### 连接失败

1. **检查 Desktop 是否运行**
   - 确保应用已启动
   - 检查系统托盘图标

2. **检查端口占用**

   ```bash
   # Windows
   netstat -an | findstr 18790

   # macOS/Linux
   lsof -i :18790
   ```

3. **重启远程控制服务**
   ```
   设置 → 远程控制 → 重启服务
   ```

### 命令超时

1. 检查网络连接
2. 增加超时时间
3. 检查 Desktop 负载

### 权限被拒绝

1. 检查权限配置
2. 确认设备已授权
3. 查看审计日志

---

## 配置文件

远程控制配置位于：

```
.chainlesschain/remote-control.json
```

```json
{
  "enabled": true,
  "port": 18790,
  "allowedClients": ["browser-extension", "mobile-app"],
  "permissions": {
    "browser-extension": ["READ", "WRITE", "EXECUTE"],
    "mobile-app": ["READ", "WRITE"]
  },
  "rateLimit": {
    "maxCommandsPerSecond": 10,
    "maxCommandsPerMinute": 200
  },
  "audit": {
    "enabled": true,
    "retentionDays": 30
  }
}
```

---

## 关键文件

| 文件                                                  | 职责                     |
| ----------------------------------------------------- | ------------------------ |
| `src/main/remote/remote-control-server.js`            | WebSocket 服务器核心     |
| `src/main/remote/remote-command-handler.js`           | 远程命令分发与执行       |
| `src/main/remote/remote-permission-manager.js`        | 权限校验与设备白名单     |
| `src/main/remote/remote-audit-logger.js`              | 命令审计日志记录         |
| `src/renderer/pages/settings/RemoteControlPage.vue`   | 远程控制设置页面         |
| `src/renderer/stores/remoteControl.ts`                | 远程控制状态管理         |

---

## 相关文档

- [浏览器插件](/chainlesschain/browser-extension) - 安装和使用浏览器插件
- [Computer Use](/chainlesschain/computer-use) - 桌面自动化能力
- [移动端同步](/chainlesschain/mobile-sync) - 移动设备数据同步

---

**随时随地，掌控一切** 📱
