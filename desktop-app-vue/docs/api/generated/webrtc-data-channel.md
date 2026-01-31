# webrtc-data-channel

**Source**: `src\main\p2p\webrtc-data-channel.js`

**Generated**: 2026-01-27T06:44:03.831Z

---

## const

```javascript
const
```

* WebRTC 数据通道管理器
 *
 * 基于 wrtc (node-webrtc) 实现 PC 端的 WebRTC 数据通道
 * 用于与 Android 客户端建立点对点连接
 *
 * @module p2p/webrtc-data-channel

---

## class WebRTCDataChannelManager extends EventEmitter

```javascript
class WebRTCDataChannelManager extends EventEmitter
```

* WebRTC 数据通道管理器

---

## async initialize()

```javascript
async initialize()
```

* 初始化管理器

---

## setupSignalingHandlers()

```javascript
setupSignalingHandlers()
```

* 设置信令处理器

---

## createPeerConnection(peerId)

```javascript
createPeerConnection(peerId)
```

* 创建对等连接

---

## async handleOffer(data)

```javascript
async handleOffer(data)
```

* 处理 Offer（来自 Android）

---

## async handleIceCandidate(data)

```javascript
async handleIceCandidate(data)
```

* 处理 ICE Candidate

---

## setupDataChannel(peerId, channel)

```javascript
setupDataChannel(peerId, channel)
```

* 设置数据通道

---

## sendMessage(peerId, message)

```javascript
sendMessage(peerId, message)
```

* 发送消息

---

## sendAnswer(peerId, answer)

```javascript
sendAnswer(peerId, answer)
```

* 发送 Answer

---

## sendIceCandidate(peerId, candidate)

```javascript
sendIceCandidate(peerId, candidate)
```

* 发送 ICE Candidate

---

## handleConnectionFailure(peerId)

```javascript
handleConnectionFailure(peerId)
```

* 处理连接失败

---

## disconnect(peerId)

```javascript
disconnect(peerId)
```

* 断开连接

---

## getConnectionState(peerId)

```javascript
getConnectionState(peerId)
```

* 获取连接状态

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## createMockConnection(peerId)

```javascript
createMockConnection(peerId)
```

* 创建模拟连接（开发模式）

---

## async cleanup()

```javascript
async cleanup()
```

* 清理资源

---

