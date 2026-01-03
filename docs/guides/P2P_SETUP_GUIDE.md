# ChainlessChain P2P功能使用指南

## 📋 目录

1. [概述](#概述)
2. [架构说明](#架构说明)
3. [快速开始](#快速开始)
4. [服务端部署](#服务端部署)
5. [移动端集成](#移动端集成)
6. [测试验证](#测试验证)
7. [故障排查](#故障排查)

---

## 概述

ChainlessChain移动端现已实现**完整的P2P端到端加密消息系统**，与桌面端功能对齐。

### 核心功能

- ✅ **P2P网络层** - 基于WebRTC的去中心化通信
- ✅ **Signal协议E2E加密** - X3DH密钥协商 + Double Ratchet加密
- ✅ **WebSocket信令服务器** - 节点发现和SDP/ICE交换
- ✅ **离线消息队列** - 对方离线时自动缓存消息
- ✅ **消息状态同步** - 送达、已读回执
- ✅ **NAT穿透** - STUN/TURN服务器支持

### 技术栈

| 组件 | 技术 | 说明 |
|------|------|------|
| **传输层** | WebRTC | DataChannel直连通信 |
| **信令** | WebSocket | 节点发现、SDP/ICE交换 |
| **加密** | Signal Protocol (TweetNaCl) | X25519密钥交换 + AES加密 |
| **后端** | FastAPI (Python) | WebSocket信令服务器 |
| **前端** | uni-app (Vue3) | H5/小程序/App三端兼容 |

---

## 架构说明

### 系统架构

```
┌─────────────────┐         WebSocket          ┌─────────────────┐
│   移动端 A      │ ◄───────────────────────► │  信令服务器      │
│   (uni-app)     │        (信令交换)           │  (FastAPI)      │
└─────────────────┘                            └─────────────────┘
         │                                              ▲
         │                                              │
         │                                              │
         │  WebRTC DataChannel                          │
         │  (端到端加密消息)                              │
         │                                              │
         ▼                                              │
┌─────────────────┐         WebSocket          ┌───────┴─────────┐
│   移动端 B      │ ◄───────────────────────────┘
│   (uni-app)     │
└─────────────────┘
```

### 数据流

```
发送消息流程：

用户A → 明文消息
  ↓
Signal加密 (X3DH + Double Ratchet)
  ↓
加密消息 (AES-256)
  ↓
P2P Manager
  ↓
WebRTC DataChannel → 用户B
  ↓
Signal解密
  ↓
明文消息 → 用户B
```

---

## 快速开始

### 前置要求

- **后端环境**:
  - Python 3.8+
  - FastAPI
  - uvicorn

- **移动端环境**:
  - Node.js 16+
  - uni-app CLI
  - 浏览器支持WebRTC (Chrome/Safari/微信小程序)

### 1分钟快速测试

```bash
# 1. 启动信令服务器
cd backend/ai-service
python main.py

# 2. 测试信令服务器
python test_signaling.py

# 3. 启动移动端 (另一个终端)
cd mobile-app-uniapp
npm run dev:h5
```

访问 `http://localhost:8080` 即可测试P2P消息功能。

---

## 服务端部署

### 开发环境

```bash
# 1. 安装依赖
cd backend/ai-service
pip install -r requirements.txt

# 2. 启动服务器（开发模式）
python main.py

# 服务器会监听:
# - HTTP API: http://localhost:8000
# - WebSocket信令: ws://localhost:8000/ws/signaling/{peer_id}
```

### 生产环境

#### Docker部署 (推荐)

```bash
# 1. 构建镜像
cd backend/ai-service
docker build -t chainlesschain-ai-service .

# 2. 运行容器
docker run -d \
  -p 8000:8000 \
  --name chainlesschain-signal \
  chainlesschain-ai-service

# 3. 查看日志
docker logs -f chainlesschain-signal
```

#### 使用docker-compose

```yaml
# 在 docker-compose.yml 中已配置，直接运行：
docker-compose up -d ai-service
```

#### Nginx反向代理 (WebSocket支持)

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL证书配置
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # WebSocket信令
    location /ws/signaling/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400; # 24小时
    }

    # HTTP API
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 配置STUN/TURN服务器

在移动端配置中修改ICE服务器：

```javascript
// mobile-app-uniapp/src/services/p2p/p2p-manager.js

const config = {
  iceServers: [
    // 公共STUN服务器
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },

    // 自建TURN服务器 (需要认证)
    {
      urls: 'turn:your-turn-server.com:3478',
      username: 'your-username',
      credential: 'your-password'
    }
  ]
}
```

**推荐TURN服务器**:
- [coturn](https://github.com/coturn/coturn) - 开源TURN服务器
- Twilio STUN/TURN (商业服务)
- 自建coturn服务器

---

## 移动端集成

### 配置信令服务器地址

修改 `mobile-app-uniapp/src/services/p2p/p2p-manager.js`:

```javascript
const config = {
  // 开发环境
  signalingServer: 'ws://localhost:8000/ws/signaling',

  // 生产环境 (使用wss://加密连接)
  // signalingServer: 'wss://your-domain.com/ws/signaling',
}
```

### 使用示例

#### 1. 初始化P2P消息服务

```javascript
import { getP2PMessaging } from '@/services/p2p/p2p-messaging.js'
import didService from '@/services/did.js'

async function initP2P() {
  // 获取当前DID
  const identity = await didService.getCurrentIdentity()

  // 初始化P2P服务
  const p2pMessaging = getP2PMessaging()
  await p2pMessaging.initialize(identity.did, {
    deviceId: 1,
    p2p: {
      signalingServer: 'ws://localhost:8000/ws/signaling'
    }
  })

  console.log('✅ P2P服务已初始化')
}
```

#### 2. 发送消息

```javascript
const p2pMessaging = getP2PMessaging()

// 发送文本消息
await p2pMessaging.sendMessage('did:chainlesschain:bob', {
  type: 'text',
  content: 'Hello, Bob!',
  metadata: {
    timestamp: Date.now()
  }
})
```

#### 3. 接收消息

```javascript
const p2pMessaging = getP2PMessaging()

// 添加监听器
p2pMessaging.addListener((event, data) => {
  switch (event) {
    case 'message:received':
      console.log('收到新消息:', data.plaintext)
      // 更新UI
      break

    case 'message:sent':
      console.log('消息已发送:', data.id)
      break

    case 'peer:connected':
      console.log('节点已连接:', data.peerId)
      break

    case 'peer:disconnected':
      console.log('节点已断开:', data.peerId)
      break
  }
})
```

#### 4. 获取会话列表

```javascript
const conversations = await p2pMessaging.getConversations()

conversations.forEach(conv => {
  console.log(`会话: ${conv.friendInfo.nickname}`)
  console.log(`未读: ${conv.unreadCount}`)
  console.log(`最后消息: ${conv.lastMessage}`)
})
```

---

## 测试验证

### 测试1: 信令服务器连接

```bash
# 运行测试脚本
cd backend/ai-service
python test_signaling.py
```

**预期输出**:
```
========== ChainlessChain P2P信令服务器测试 ==========

测试1: 单节点连接

[test-peer-1] 连接到信令服务器: ws://localhost:8000/ws/signaling/test-peer-1
[test-peer-1] ✅ 已连接
[test-peer-1] 收到消息: register:success
[test-peer-1] 在线节点: 0
[test-peer-1] 发送心跳
[test-peer-1] 收到心跳响应: heartbeat:ack

------------------------------------------------------------

测试2: 消息转发

[Alice] 已连接
[Bob] 已连接
[Alice] 已发送Offer给Bob
[Bob] 收到来自Alice的消息: offer
[Bob] 已发送Answer给Alice
[Alice] 收到来自Bob的消息: answer

------------------------------------------------------------

测试3: 统计接口

在线节点数: 0
节点列表:

============================================================
测试完成
============================================================
```

### 测试2: 端到端消息加密

在移动端创建两个用户并测试：

```javascript
// 用户A发送消息
const result = await p2pMessaging.sendMessage('did:chainlesschain:userB', {
  content: 'Secret message'
})

// 验证消息已加密存储
const messages = await p2pMessaging.getMessages(conversationId)
console.log(messages[0].content) // 输出加密的密文
console.log(messages[0].plaintext) // 输出解密的明文
```

### 测试3: NAT穿透

使用不同网络环境测试：
- 同一WiFi网络（本地网络）
- 4G/5G网络（移动网络）
- 不同运营商网络

---

## 故障排查

### 问题1: WebSocket连接失败

**症状**: 移动端无法连接到信令服务器

**解决方案**:
1. 检查后端服务是否启动: `curl http://localhost:8000/api/signaling/stats`
2. 检查防火墙配置，开放8000端口
3. 如果使用wss://，确保SSL证书配置正确
4. 查看浏览器控制台WebSocket错误

### 问题2: P2P连接建立失败

**症状**: 节点已注册但DataChannel未打开

**解决方案**:
1. 检查STUN服务器是否可达
2. 查看WebRTC连接状态: `p2pManager.getConnectionState(peerId)`
3. 配置TURN服务器（STUN无法穿透时）
4. 检查浏览器控制台ICE候选错误

### 问题3: 消息解密失败

**症状**: 收到消息但无法解密

**解决方案**:
1. 确认Signal会话已建立: `signalManager.getSession(peerId)`
2. 检查消息计数器是否同步
3. 重新建立Signal会话: `p2pMessaging.requestPreKeyBundle(peerId)`
4. 查看数据库`signal_sessions`表

### 问题4: 小程序WebRTC支持

**症状**: 微信小程序中P2P功能不可用

**解决方案**:
- 微信小程序不支持标准WebRTC API
- 使用小程序专用的`live-pusher`和`live-player`组件
- 或通过服务器中继消息（回退方案）

### 查看日志

**后端日志**:
```bash
# 查看实时日志
docker logs -f chainlesschain-signal

# 或直接运行
python main.py  # 控制台输出
```

**移动端日志**:
```javascript
// 启用详细日志
localStorage.setItem('p2p:debug', 'true')

// 查看连接状态
const p2pManager = getP2PManager()
console.log('在线节点:', p2pManager.getOnlinePeers())
console.log('连接状态:', p2pManager.connectionStates)
```

---

## 性能优化

### 减少信令流量

```javascript
// 增加心跳间隔（默认30秒）
const config = {
  heartbeatInterval: 60000 // 60秒
}
```

### 离线消息队列大小

```javascript
const config = {
  messageQueueSize: 200 // 默认100条
}
```

### 连接池管理

```javascript
// 限制最大并发连接数
const maxPeers = 10

if (p2pManager.getOnlinePeers().length >= maxPeers) {
  console.warn('已达到最大连接数')
}
```

---

## 安全建议

1. **生产环境必须使用wss://** - 加密WebSocket连接
2. **定期轮换PreKey** - 每周重新生成预密钥
3. **验证对方身份** - 检查DID签名
4. **限制消息大小** - 防止DoS攻击
5. **审计日志** - 记录所有连接和消息事件

---

## 下一步计划

- [ ] 添加语音/视频通话支持（WebRTC音视频流）
- [ ] 实现群组消息（多方加密）
- [ ] 优化NAT穿透成功率（UDP hole punching）
- [ ] 添加消息重传机制（可靠传输）
- [ ] 实现设备同步（多设备支持）

---

## 参考资源

- [Signal Protocol规范](https://signal.org/docs/)
- [WebRTC官方文档](https://webrtc.org/)
- [FastAPI WebSocket指南](https://fastapi.tiangolo.com/advanced/websockets/)
- [uni-app WebSocket API](https://uniapp.dcloud.net.cn/api/request/websocket.html)

---

## 技术支持

如有问题，请提交Issue: https://github.com/your-repo/chainlesschain/issues

---

**版本**: v1.0.0
**更新日期**: 2026-01-02
**作者**: ChainlessChain Team
