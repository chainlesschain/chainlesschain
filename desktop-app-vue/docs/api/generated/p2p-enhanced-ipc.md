# p2p-enhanced-ipc

**Source**: `src/main/p2p/p2p-enhanced-ipc.js`

**Generated**: 2026-02-15T10:10:53.398Z

---

## const

```javascript
const
```

* P2P增强功能IPC处理器
 *
 * 提供前端与P2P增强功能的通信接口

---

## register()

```javascript
register()
```

* 注册所有IPC处理器

---

## registerHandler(channel, handler)

```javascript
registerHandler(channel, handler)
```

* 注册单个处理器

---

## setupEventForwarding()

```javascript
setupEventForwarding()
```

* 设置事件转发到渲染进程

---

## sendToRenderer(channel, data)

```javascript
sendToRenderer(channel, data)
```

* 发送事件到渲染进程

---

## async handleSendMessage(event,

```javascript
async handleSendMessage(event,
```

* 处理发送消息

---

## async handleGetMessageStats(event)

```javascript
async handleGetMessageStats(event)
```

* 获取消息统计

---

## async handleSyncKnowledge(event,

```javascript
async handleSyncKnowledge(event,
```

* 处理知识库同步

---

## async handleGetSyncStats(event)

```javascript
async handleGetSyncStats(event)
```

* 获取同步统计

---

## async handleGetConflicts(event)

```javascript
async handleGetConflicts(event)
```

* 获取冲突列表

---

## async handleResolveConflict(event,

```javascript
async handleResolveConflict(event,
```

* 解决冲突

---

## async handleUploadFile(event,

```javascript
async handleUploadFile(event,
```

* 处理文件上传

---

## async handleDownloadFile(event,

```javascript
async handleDownloadFile(event,
```

* 处理文件下载

---

## async handleGetTransferProgress(event,

```javascript
async handleGetTransferProgress(event,
```

* 获取传输进度

---

## async handleCancelTransfer(event,

```javascript
async handleCancelTransfer(event,
```

* 取消传输

---

## async handleGetTransferStats(event)

```javascript
async handleGetTransferStats(event)
```

* 获取传输统计

---

## async handleGetStats(event)

```javascript
async handleGetStats(event)
```

* 获取总体统计

---

## async handleStartCall(event,

```javascript
async handleStartCall(event,
```

* 处理发起通话

---

## async handleAcceptCall(event,

```javascript
async handleAcceptCall(event,
```

* 处理接受通话

---

## async handleRejectCall(event,

```javascript
async handleRejectCall(event,
```

* 处理拒绝通话

---

## async handleEndCall(event,

```javascript
async handleEndCall(event,
```

* 处理结束通话

---

## async handleToggleMute(event,

```javascript
async handleToggleMute(event,
```

* 处理切换静音

---

## async handleToggleVideo(event,

```javascript
async handleToggleVideo(event,
```

* 处理切换视频

---

## async handleGetCallInfo(event,

```javascript
async handleGetCallInfo(event,
```

* 获取通话信息

---

## async handleGetActiveCalls(event)

```javascript
async handleGetActiveCalls(event)
```

* 获取活动通话列表

---

## unregister()

```javascript
unregister()
```

* 注销所有处理器

---

