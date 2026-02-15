# p2p-enhanced-manager

**Source**: `src/main/p2p/p2p-enhanced-manager.js`

**Generated**: 2026-02-15T10:10:53.398Z

---

## const

```javascript
const
```

* P2P增强管理器 - 集成消息去重、知识库同步、文件传输
 *
 * 功能：
 * - 集成MessageManager（消息去重和批量处理）
 * - 集成KnowledgeSyncManager（知识库增量同步）
 * - 集成FileTransferManager（大文件分块传输）
 * - 统一的事件管理和错误处理
 * - 性能监控和统计

---

## async initialize()

```javascript
async initialize()
```

* 初始化增强管理器

---

## connectMediaStreamBridge()

```javascript
connectMediaStreamBridge()
```

* 连接MediaStream桥接到VoiceVideoManager

---

## setupEventHandlers()

```javascript
setupEventHandlers()
```

* 设置事件处理器

---

## connectToP2PNetwork()

```javascript
connectToP2PNetwork()
```

* 连接到P2P网络

---

## async handleIncomingMessage(

```javascript
async handleIncomingMessage(
```

* 处理接收到的消息

---

## async sendToP2PNetwork(peerId, message)

```javascript
async sendToP2PNetwork(peerId, message)
```

* 发送消息到P2P网络

---

## async sendBatchToP2PNetwork(peerId, messages)

```javascript
async sendBatchToP2PNetwork(peerId, messages)
```

* 批量发送消息到P2P网络

---

## async sendMessage(peerId, payload, options =

```javascript
async sendMessage(peerId, payload, options =
```

* 发送消息（公共API）

---

## async syncKnowledge(peerId, options =

```javascript
async syncKnowledge(peerId, options =
```

* 同步知识库（公共API）

---

## async uploadFile(peerId, filePath, options =

```javascript
async uploadFile(peerId, filePath, options =
```

* 上传文件（公共API）

---

## async downloadFile(peerId, transferId, savePath)

```javascript
async downloadFile(peerId, transferId, savePath)
```

* 下载文件（公共API）

---

## getFileTransferProgress(transferId)

```javascript
getFileTransferProgress(transferId)
```

* 获取文件传输进度

---

## async cancelFileTransfer(transferId)

```javascript
async cancelFileTransfer(transferId)
```

* 取消文件传输

---

## getKnowledgeConflicts()

```javascript
getKnowledgeConflicts()
```

* 获取知识库冲突列表

---

## async resolveKnowledgeConflict(conflictId, resolution)

```javascript
async resolveKnowledgeConflict(conflictId, resolution)
```

* 手动解决知识库冲突

---

## async startCall(peerId, type, options =

```javascript
async startCall(peerId, type, options =
```

* 发起语音/视频通话（公共API）

---

## async acceptCall(callId)

```javascript
async acceptCall(callId)
```

* 接受通话（公共API）

---

## async rejectCall(callId, reason)

```javascript
async rejectCall(callId, reason)
```

* 拒绝通话（公共API）

---

## async endCall(callId)

```javascript
async endCall(callId)
```

* 结束通话（公共API）

---

## toggleMute(callId)

```javascript
toggleMute(callId)
```

* 切换静音（公共API）

---

## toggleVideo(callId)

```javascript
toggleVideo(callId)
```

* 切换视频（公共API）

---

## getCallInfo(callId)

```javascript
getCallInfo(callId)
```

* 获取通话信息（公共API）

---

## getActiveCalls()

```javascript
getActiveCalls()
```

* 获取活动通话列表（公共API）

---

## async getCallHistory(options =

```javascript
async getCallHistory(options =
```

* 获取通话历史（公共API）

---

## async getCallDetails(callId)

```javascript
async getCallDetails(callId)
```

* 获取通话详情（公共API）

---

## async getCallStatistics(peerId = null)

```javascript
async getCallStatistics(peerId = null)
```

* 获取通话统计（公共API）

---

## async deleteCallHistory(callId)

```javascript
async deleteCallHistory(callId)
```

* 删除通话记录（公共API）

---

## async clearCallHistory(peerId = null)

```javascript
async clearCallHistory(peerId = null)
```

* 清空通话历史（公共API）

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## async stop()

```javascript
async stop()
```

* 停止增强管理器

---

