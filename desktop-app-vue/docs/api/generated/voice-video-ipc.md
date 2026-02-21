# voice-video-ipc

**Source**: `src/main/p2p/voice-video-ipc.js`

**Generated**: 2026-02-21T22:04:25.805Z

---

## const

```javascript
const
```

* Voice/Video Call IPC处理器
 *
 * 提供前端与语音/视频通话功能的通信接口

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

## async handleGetStats(event)

```javascript
async handleGetStats(event)
```

* 获取统计信息

---

## unregister()

```javascript
unregister()
```

* 注销所有处理器

---

