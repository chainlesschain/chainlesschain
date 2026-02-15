# voice-video-manager

**Source**: `src/main/p2p/voice-video-manager.js`

**Generated**: 2026-02-15T07:37:13.805Z

---

## const

```javascript
const
```

* P2P Voice/Video Call Manager
 *
 * 功能：
 * - P2P语音通话（基于WebRTC）
 * - P2P视频通话（基于WebRTC）
 * - 屏幕共享
 * - 通话质量监控
 * - 多人会议支持

---

## function createMockWrtc()

```javascript
function createMockWrtc()
```

* 在测试环境中提供 WebRTC 兼容 mock，避免依赖原生模块

---

## const CallState =

```javascript
const CallState =
```

* 通话状态

---

## const CallType =

```javascript
const CallType =
```

* 通话类型

---

## class CallSession

```javascript
class CallSession
```

* 通话会话

---

## getDuration()

```javascript
getDuration()
```

* 获取通话时长（秒）

---

## class VoiceVideoManager extends EventEmitter

```javascript
class VoiceVideoManager extends EventEmitter
```

* Voice/Video Manager

---

## _registerProtocolHandlers()

```javascript
_registerProtocolHandlers()
```

* 注册P2P协议处理器

---

## async startCall(peerId, type = CallType.AUDIO, options =

```javascript
async startCall(peerId, type = CallType.AUDIO, options =
```

* 发起通话

---

## async acceptCall(callId)

```javascript
async acceptCall(callId)
```

* 接受通话

---

## async rejectCall(callId, reason = "rejected")

```javascript
async rejectCall(callId, reason = "rejected")
```

* 拒绝通话

---

## async endCall(callId)

```javascript
async endCall(callId)
```

* 结束通话

---

## toggleMute(callId)

```javascript
toggleMute(callId)
```

* 切换静音

---

## toggleVideo(callId)

```javascript
toggleVideo(callId)
```

* 切换视频

---

## getCallInfo(callId)

```javascript
getCallInfo(callId)
```

* 获取通话信息

---

## getActiveCalls()

```javascript
getActiveCalls()
```

* 获取所有活动通话

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## async _handleCallSignaling(peerId, message)

```javascript
async _handleCallSignaling(peerId, message)
```

* 处理通话信令

---

## async _handleCallRequest(peerId, message)

```javascript
async _handleCallRequest(peerId, message)
```

* 处理通话请求

---

## async _handleCallAnswer(peerId, message)

```javascript
async _handleCallAnswer(peerId, message)
```

* 处理通话应答

---

## async _handleCallReject(peerId, message)

```javascript
async _handleCallReject(peerId, message)
```

* 处理通话拒绝

---

## async _handleCallEnd(peerId, message)

```javascript
async _handleCallEnd(peerId, message)
```

* 处理通话结束

---

## async _handleIceCandidate(peerId, message)

```javascript
async _handleIceCandidate(peerId, message)
```

* 处理ICE候选

---

## async _sendCallSignaling(peerId, message)

```javascript
async _sendCallSignaling(peerId, message)
```

* 发送通话信令

---

## _createPeerConnection(session)

```javascript
_createPeerConnection(session)
```

* 创建PeerConnection

---

## async _getUserMedia(type, options =

```javascript
async _getUserMedia(type, options =
```

* 获取用户媒体
   *
   * 注意：在Electron主进程中无法直接访问getUserMedia
   * 实际应用中需要：
   * 1. 从renderer进程获取MediaStream
   * 2. 通过IPC传递stream ID
   * 3. 在主进程中使用stream ID创建RTCPeerConnection
   *
   * 当前实现返回模拟的MediaStream用于测试

---

## _startQualityMonitoring(session)

```javascript
_startQualityMonitoring(session)
```

* 开始质量监控

---

## _endCall(callId, reason)

```javascript
_endCall(callId, reason)
```

* 结束通话（内部方法）

---

## _generateCallId()

```javascript
_generateCallId()
```

* 生成通话ID

---

## async cleanup()

```javascript
async cleanup()
```

* 清理资源

---

