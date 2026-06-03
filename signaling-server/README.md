# ChainlessChain WebSocket Signaling Server

WebSocket信令服务器，用于移动端与PC端的P2P通讯。

## 功能特性

- WebRTC信令转发（Offer/Answer/ICE候选交换）
- 节点注册与发现
- 离线消息暂存（最多保留24小时）
- 心跳检测和自动重连
- 连接统计和监控

## 安装

```bash
cd signaling-server
npm install
```

## 运行

### 生产环境
```bash
npm start
```

### 开发环境（自动重启）
```bash
npm run dev
```

服务器将在端口 `9001` 启动。

## 消息协议

### 1. 节点注册

**客户端发送**：
```json
{
  "type": "register",
  "peerId": "your-peer-id",
  "deviceType": "mobile" | "desktop",
  "deviceInfo": {
    "name": "iPhone 13",
    "platform": "ios",
    "version": "0.16.0"
  }
}
```

**服务器响应**：
```json
{
  "type": "registered",
  "peerId": "your-peer-id",
  "serverTime": 1704672000000
}
```

### 2. WebRTC信令（Offer）

**发送Offer**：
```json
{
  "type": "offer",
  "to": "target-peer-id",
  "from": "your-peer-id",
  "offer": {
    "type": "offer",
    "sdp": "..."
  }
}
```

**接收Offer**（服务器转发）：
```json
{
  "type": "offer",
  "from": "sender-peer-id",
  "offer": {
    "type": "offer",
    "sdp": "..."
  }
}
```

### 3. WebRTC信令（Answer）

**发送Answer**：
```json
{
  "type": "answer",
  "to": "target-peer-id",
  "answer": {
    "type": "answer",
    "sdp": "..."
  }
}
```

### 4. ICE候选

**发送ICE候选**：
```json
{
  "type": "ice-candidate",
  "to": "target-peer-id",
  "candidate": {
    "candidate": "...",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  }
}
```

### 5. 获取在线节点列表

**请求**：
```json
{
  "type": "get-peers"
}
```

**响应**：
```json
{
  "type": "peers-list",
  "peers": [
    {
      "peerId": "peer-1",
      "deviceType": "desktop",
      "deviceInfo": {...},
      "connectedAt": 1704672000000
    }
  ],
  "count": 1
}
```

### 6. 节点状态通知

**服务器广播**（当节点上线/离线时）：
```json
{
  "type": "peer-status",
  "peerId": "peer-1",
  "status": "online" | "offline",
  "deviceType": "desktop",
  "timestamp": 1704672000000
}
```

### 7. 离线消息投递

**服务器推送**（当节点重新上线时）：
```json
{
  "type": "offline-message",
  "originalMessage": {...},
  "storedAt": 1704670000000,
  "deliveredAt": 1704672000000
}
```

## 部署选项

### 选项1：独立部署

将信令服务器部署到云服务器：

```bash
# 使用PM2管理进程
npm install -g pm2
pm2 start index.js --name chainlesschain-signaling
pm2 save
pm2 startup
```

### 选项2：PC端内嵌

在PC端应用中内嵌运行（开发中）：

```javascript
const SignalingServer = require('./signaling-server');
const server = new SignalingServer({ port: 9001 });
server.start();
```

## 配置

可通过环境变量配置：

```bash
PORT=9001  # 服务器端口
```

## 监控

服务器每5分钟打印统计信息：

```
[Stats] 连接数: 5, 总连接: 120, 转发消息: 3456, 离线消息: 12
```

## 安全建议

- 生产环境建议使用WSS（WebSocket over TLS）
- 考虑添加身份验证机制
- 限制单个客户端的连接速率
- 定期备份离线消息队列

## 故障排查

### 连接失败

检查防火墙是否开放端口9001：
```bash
sudo ufw allow 9001
```

### 消息丢失

检查离线消息队列大小限制（默认100条/节点）。

## License

MIT
