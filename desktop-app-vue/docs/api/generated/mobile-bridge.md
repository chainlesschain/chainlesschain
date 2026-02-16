# mobile-bridge

**Source**: `src/main/p2p/mobile-bridge.js`

**Generated**: 2026-02-16T22:06:51.457Z

---

## const

```javascript
const
```

* Mobile Bridge - PC端libp2p与移动端WebRTC桥接层
 *
 * 功能：
 * - 连接到信令服务器（WebSocket客户端）
 * - 处理移动端WebRTC信令（Offer/Answer/ICE）
 * - WebRTC DataChannel与libp2p Stream桥接
 * - 消息转发和协议转换

---

## async connect()

```javascript
async connect()
```

* 连接到信令服务器

---

## register()

```javascript
register()
```

* 注册PC端身份到信令服务器
   * 使用与 signaling-server registerLocal 相同的 deviceId，
   * 这样 Android 发送 offer 到该 ID 时可以正确转发到 MobileBridge

---

## async handleSignalingMessage(message)

```javascript
async handleSignalingMessage(message)
```

* 处理信令消息

---

## async handleOffer(message)

```javascript
async handleOffer(message)
```

* 处理移动端的WebRTC Offer

---

## async handleAnswer(message)

```javascript
async handleAnswer(message)
```

* 处理Answer（如果PC端主动发起连接，当前暂未实现）

---

## async handleICECandidate(message)

```javascript
async handleICECandidate(message)
```

* 处理ICE候选

---

## async handleICECandidates(message)

```javascript
async handleICECandidates(message)
```

* 处理批量ICE候选

---

## queueIceCandidate(peerId, candidate)

```javascript
queueIceCandidate(peerId, candidate)
```

* 队列ICE候选（批量发送）

---

## flushIceCandidates(peerId)

```javascript
flushIceCandidates(peerId)
```

* 批量发送ICE候选

---

## setConnectionTimeout(peerId)

```javascript
setConnectionTimeout(peerId)
```

* 设置连接超时

---

## clearConnectionTimeout(peerId)

```javascript
clearConnectionTimeout(peerId)
```

* 清除连接超时

---

## handleError(peerId, context, error)

```javascript
handleError(peerId, context, error)
```

* 处理错误

---

## shouldBlockPeer(peerId)

```javascript
shouldBlockPeer(peerId)
```

* 检查是否应该阻止节点

---

## handleDisconnection(peerId)

```javascript
handleDisconnection(peerId)
```

* 处理断开连接

---

## handleConnectionFailed(peerId)

```javascript
handleConnectionFailed(peerId)
```

* 处理连接失败

---

## handlePeerStatus(message)

```javascript
handlePeerStatus(message)
```

* 处理节点状态变更

---

## async handleOfflineMessage(message)

```javascript
async handleOfflineMessage(message)
```

* 处理离线消息
   * 包括在 MobileBridge 连接前入队的 offer 等消息

---

## async handleP2PMessage(message)

```javascript
async handleP2PMessage(message)
```

* 处理P2P业务消息

---

## async bridgeToLibp2p(mobilePeerId, data)

```javascript
async bridgeToLibp2p(mobilePeerId, data)
```

* 桥接消息到libp2p网络

---

## async sendToMobile(mobilePeerId, message)

```javascript
async sendToMobile(mobilePeerId, message)
```

* 发送消息到移动端

---

## send(message)

```javascript
send(message)
```

* 发送信令消息

---

## closePeerConnection(peerId)

```javascript
closePeerConnection(peerId)
```

* 关闭与指定节点的连接

---

## scheduleReconnect()

```javascript
scheduleReconnect()
```

* 安排重连（指数退避策略）

---

## resetReconnectAttempts()

```javascript
resetReconnectAttempts()
```

* 重置重连计数（手动调用时）

---

## startHeartbeat()

```javascript
startHeartbeat()
```

* 启动心跳检测

---

## sendHeartbeat()

```javascript
sendHeartbeat()
```

* 发送心跳

---

## handleHeartbeatTimeout()

```javascript
handleHeartbeatTimeout()
```

* 处理心跳超时

---

## stopHeartbeat()

```javascript
stopHeartbeat()
```

* 停止心跳检测

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## async disconnect()

```javascript
async disconnect()
```

* 断开连接

---

