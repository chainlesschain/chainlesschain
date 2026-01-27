# mediaStreamHandler

**Source**: `src\renderer\utils\mediaStreamHandler.js`

**Generated**: 2026-01-27T06:44:03.897Z

---

## const getIpcRenderer = () => window.electron?.ipcRenderer;

```javascript
const getIpcRenderer = () => window.electron?.ipcRenderer;
```

* MediaStream Handler (Renderer Process)
 *
 * 在渲染进程中处理媒体流获取和管理

---

## setupListeners()

```javascript
setupListeners()
```

* 设置事件监听

---

## async handleStreamRequest(data)

```javascript
async handleStreamRequest(data)
```

* 处理媒体流请求

---

## async getScreenStream(constraints =

```javascript
async getScreenStream(constraints =
```

* 获取屏幕共享流

---

## async getAvailableScreenSources()

```javascript
async getAvailableScreenSources()
```

* 获取可用的屏幕源列表（用于UI选择）

---

## handleStopRequest(data)

```javascript
handleStopRequest(data)
```

* 处理停止流请求

---

## handleToggleTrack(data)

```javascript
handleToggleTrack(data)
```

* 处理切换track请求

---

## notifyTrackChanged(streamId, trackId, kind, enabled)

```javascript
notifyTrackChanged(streamId, trackId, kind, enabled)
```

* 通知track状态变化

---

## buildConstraints(type, customConstraints =

```javascript
buildConstraints(type, customConstraints =
```

* 构建媒体约束

---

## generateStreamId()

```javascript
generateStreamId()
```

* 生成streamId

---

## getStream(streamId)

```javascript
getStream(streamId)
```

* 获取媒体流
   * @param {string} streamId - 流ID
   * @returns {MediaStream|null}

---

## getActiveStreams()

```javascript
getActiveStreams()
```

* 获取所有活动流
   * @returns {Array<{streamId: string, stream: MediaStream}>}

---

## cleanup()

```javascript
cleanup()
```

* 清理所有流

---

