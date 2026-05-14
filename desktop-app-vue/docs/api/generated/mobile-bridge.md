# mobile-bridge

**Source**: `src/main/p2p/mobile-bridge.js`

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
   *
   * Phase 3d v1.3 fix: signaling WebSocket 与 datachannel 是两条独立通道。移动端
   * 在 datachannel 建立后通常会主动断开 signaling WS 省电，这条信令"offline"
   * 通知**不应**触发 datachannel 关闭——否则连上 5s 就被踢，sync 跑不起来。
   * 只在 datachannel 不存在或已 closed 时才清理 PC 端连接。

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

## _gcRecentMobileRequests()

```javascript
_gcRecentMobileRequests()
```

* Plan A.1 Phase 4 — 回收 [recentMobileRequests] 里超过 TTL 的条目。
   * 在每次入站 dedup check 前调一次，无独立 timer（避免 leaking）。

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

## async sendReverseRpcRequest(mobilePeerId, request, timeoutMs = 60000)

```javascript
async sendReverseRpcRequest(mobilePeerId, request, timeoutMs = 60000)
```

* 反向 JSON-RPC 请求（桌面 → Android）。
   *
   * 设计文档 M5 ADR-6 + MobileSignClient transport 抽象的真实接通：
   *  1. request.id 唯一 → 存 pendingReverseRpc map
   *  2. 通过 [sendToMobile] 推到 Android（DataChannel 或 signaling fallback）
   *  3. timeoutMs 后未收到响应 → reject with timeout
   *  4. Android 端 RemoteCommandClient 收到 sign.request 等 method → 路由
   *     SignAsService → 返回 JSON-RPC response with matching id
   *  5. response 经 channel.onmessage → bridgeToLibp2p → 拦截分支 resolve
   *     本 Promise
   *
   * @param {string} mobilePeerId 目标 Android 设备 ID
   * @param {Object} request JSON-RPC 2.0 request（含 jsonrpc:"2.0" + id + method + params）
   * @param {number} [timeoutMs=60000] 超时（默认 60s 覆盖慢用户 BiometricPrompt）
   * @returns {Promise<Object>} Android 端的 JSON-RPC response

---

## asMobileSignTransport()

```javascript
asMobileSignTransport()
```

* 返回符合 [MobileSignClient] 期望的 transport 适配器：`{send(peerId, req) → Promise<resp>}`.
   * 真接通 M5 反向 sign.request 路径。

---

## handlePairAckFromRelay(ack, fromPeerId)

```javascript
handlePairAckFromRelay(ack, fromPeerId)
```

* 由 RelayClient 在收到公网中继转发的 pair-ack 时调用 — v1.3+ remote
   * 模式补全。LAN 路径走 [handleP2PMessage] 的 pair-ack 拦截分支调
   * recordPairAck；relay 路径在 `main/index.js startRelayClient.onMessage`
   * 已直调 recordPairAck，本方法只补 EventEmitter 通知，让 IPC 监听端
   * （Vue store / web-panel WS subscriber）与 LAN 行为对称。
   *
   * 此前 [index.js] 调 `this.mobileBridge?.handlePairAckFromRelay(...)` 但
   * 该方法不存在，optional-chain `?.` silently 吞掉，relay 路径 pair-ack
   * 不触发任何事件。bug fix。

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

