# media-stream-bridge

**Source**: `src/main/p2p/media-stream-bridge.js`

**Generated**: 2026-02-16T13:44:34.639Z

---

## let electron;

```javascript
let electron;
```

* MediaStream Bridge Service
 *
 * 在Electron主进程和渲染进程之间桥接MediaStream
 * 由于主进程无法直接访问getUserMedia，需要通过渲染进程获取媒体流

---

## registerHandlers()

```javascript
registerHandlers()
```

* 注册IPC处理器

---

## async requestMediaStream(type, constraints =

```javascript
async requestMediaStream(type, constraints =
```

* 请求媒体流
   * @param {string} type - 'audio' | 'video'
   * @param {Object} constraints - 媒体约束
   * @param {Object} options - 额外选项
   * @returns {Promise<Object>} 媒体流信息

---

## handleStreamReady(data)

```javascript
handleStreamReady(data)
```

* 处理媒体流就绪

---

## handleStreamStopped(data)

```javascript
handleStreamStopped(data)
```

* 处理媒体流停止

---

## handleTrackChanged(data)

```javascript
handleTrackChanged(data)
```

* 处理track状态变化

---

## stopMediaStream(streamId)

```javascript
stopMediaStream(streamId)
```

* 停止媒体流
   * @param {string} streamId - 流ID

---

## getStreamInfo(streamId)

```javascript
getStreamInfo(streamId)
```

* 获取媒体流信息
   * @param {string} streamId - 流ID
   * @returns {Object|null} 流信息

---

## getActiveStreams()

```javascript
getActiveStreams()
```

* 获取所有活动流
   * @returns {Array} 流列表

---

## toggleTrack(streamId, kind, enabled)

```javascript
toggleTrack(streamId, kind, enabled)
```

* 切换track启用状态
   * @param {string} streamId - 流ID
   * @param {string} kind - 'audio' | 'video'
   * @param {boolean} enabled - 是否启用

---

## _generateRequestId()

```javascript
_generateRequestId()
```

* 生成请求ID

---

## cleanup()

```javascript
cleanup()
```

* 清理资源

---

