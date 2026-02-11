# 远程控制系统

> **版本: v0.27.0+ | 完整的桌面应用远程控制能力**

远程控制系统允许通过浏览器插件和移动端远程控制 ChainlessChain Desktop 应用，实现跨设备的无缝操作体验。

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

## 下一步

- [浏览器插件](/chainlesschain/browser-extension) - 安装和使用浏览器插件
- [Computer Use](/chainlesschain/computer-use) - 桌面自动化能力
- [移动端同步](/chainlesschain/mobile-sync) - 移动设备数据同步

---

**随时随地，掌控一切** 📱
