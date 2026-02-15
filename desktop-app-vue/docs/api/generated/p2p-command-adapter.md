# p2p-command-adapter

**Source**: `src/main/remote/p2p-command-adapter.js`

**Generated**: 2026-02-15T08:42:37.194Z

---

## const

```javascript
const
```

* P2P 命令适配器 - 将命令协议适配到 P2P 网络
 *
 * 功能：
 * - 命令消息类型定义（REQUEST/RESPONSE/EVENT）
 * - 请求/响应匹配机制
 * - 超时处理和重试
 * - 与现有 P2P 网络集成
 *
 * @module remote/p2p-command-adapter

---

## const MESSAGE_TYPES =

```javascript
const MESSAGE_TYPES =
```

* 消息类型常量

---

## const ERROR_CODES =

```javascript
const ERROR_CODES =
```

* 错误码

---

## class P2PCommandAdapter extends EventEmitter

```javascript
class P2PCommandAdapter extends EventEmitter
```

* P2P 命令适配器

---

## async initialize()

```javascript
async initialize()
```

* 初始化适配器

---

## registerP2PHandlers()

```javascript
registerP2PHandlers()
```

* 注册 P2P 消息处理器

---

## async handleP2PMessage(peerId, rawMessage)

```javascript
async handleP2PMessage(peerId, rawMessage)
```

* 处理 P2P 消息

---

## async handleCommandRequest(peerId, request)

```javascript
async handleCommandRequest(peerId, request)
```

* 处理命令请求（来自 Android）

---

## handleCommandResponse(response)

```javascript
handleCommandResponse(response)
```

* 处理命令响应（PC 主动发送命令后收到的响应）

---

## handleCommandCancel(peerId, payload)

```javascript
handleCommandCancel(peerId, payload)
```

* 处理命令取消请求

---

## cancelCommand(commandId, reason = "Cancelled by server")

```javascript
cancelCommand(commandId, reason = "Cancelled by server")
```

* 取消指定命令（PC 端主动取消）

---

## getRunningCommands()

```javascript
getRunningCommands()
```

* 获取运行中的命令列表

---

## cancelLongRunningCommands(maxDuration = 60000)

```javascript
cancelLongRunningCommands(maxDuration = 60000)
```

* 取消所有超时的命令

---

## handleHeartbeat(peerId, payload)

```javascript
handleHeartbeat(peerId, payload)
```

* 处理心跳

---

## async sendCommand(peerId, method, params, options =

```javascript
async sendCommand(peerId, method, params, options =
```

* 发送命令（PC -> Android）

---

## sendResponse(peerId, response)

```javascript
sendResponse(peerId, response)
```

* 发送响应（PC -> Android）

---

## broadcastEvent(method, params, targetDevices = null)

```javascript
broadcastEvent(method, params, targetDevices = null)
```

* 广播事件（PC -> All Android）

---

## sendMessage(peerId, message)

```javascript
sendMessage(peerId, message)
```

* 发送 P2P 消息（底层方法）

---

## registerDevice(peerId, did)

```javascript
registerDevice(peerId, did)
```

* 注册设备

---

## getConnectedDevices()

```javascript
getConnectedDevices()
```

* 获取已连接设备列表

---

## startHeartbeat()

```javascript
startHeartbeat()
```

* 启动心跳

---

## checkDeviceHealth()

```javascript
checkDeviceHealth()
```

* 检查设备健康状态

---

## stopHeartbeat()

```javascript
stopHeartbeat()
```

* 停止心跳

---

## async executeWithRetry(fn, retries, delay)

```javascript
async executeWithRetry(fn, retries, delay)
```

* 带重试的执行

---

## sleep(ms)

```javascript
sleep(ms)
```

* 睡眠函数

---

## generateRequestId()

```javascript
generateRequestId()
```

* 生成请求 ID

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## startPendingCleanup()

```javascript
startPendingCleanup()
```

* 启动待处理请求定期清理

---

## cleanupStalePendingRequests()

```javascript
cleanupStalePendingRequests()
```

* 清理过期的待处理请求

---

## stopPendingCleanup()

```javascript
stopPendingCleanup()
```

* 停止待处理请求清理

---

## async disconnectPeer(peerId)

```javascript
async disconnectPeer(peerId)
```

* 断开指定节点

---

## async cleanup()

```javascript
async cleanup()
```

* 清理资源

---

