# pc-status-handler

**Source**: `src/main/p2p/pc-status-handler.js`

**Generated**: 2026-02-17T10:13:18.215Z

---

## const

```javascript
const
```

* PC Status Handler - PC状态监控处理器
 *
 * 功能：
 * - 提供PC端系统信息
 * - 实时监控CPU、内存、磁盘使用情况
 * - 监控AI服务状态
 * - 监控数据库状态

---

## async handleMessage(mobilePeerId, message)

```javascript
async handleMessage(mobilePeerId, message)
```

* 统一消息处理入口

---

## async handleGetSystemInfo(mobilePeerId, message)

```javascript
async handleGetSystemInfo(mobilePeerId, message)
```

* 处理获取系统信息请求

---

## async handleGetServices(mobilePeerId, message)

```javascript
async handleGetServices(mobilePeerId, message)
```

* 处理获取服务状态请求

---

## async handleGetRealtime(mobilePeerId, message)

```javascript
async handleGetRealtime(mobilePeerId, message)
```

* 处理获取实时状态请求

---

## async handleSubscribe(mobilePeerId, message)

```javascript
async handleSubscribe(mobilePeerId, message)
```

* 处理订阅状态更新请求

---

## async getSystemInfo()

```javascript
async getSystemInfo()
```

* 获取系统信息

---

## async getServicesStatus()

```javascript
async getServicesStatus()
```

* 获取服务状态

---

## async getRealtimeStatus()

```javascript
async getRealtimeStatus()
```

* 获取实时状态

---

## startStatusUpdates()

```javascript
startStatusUpdates()
```

* 启动定期状态更新

---

## stopStatusUpdates()

```javascript
stopStatusUpdates()
```

* 停止状态更新

---

## startSubscription(mobilePeerId, interval)

```javascript
startSubscription(mobilePeerId, interval)
```

* 启动指定设备的订阅推送
   * @param {string} mobilePeerId
   * @param {number} interval

---

## stopSubscription(mobilePeerId)

```javascript
stopSubscription(mobilePeerId)
```

* 停止指定设备的订阅
   * @param {string} mobilePeerId

---

## clearAllSubscriptions()

```javascript
clearAllSubscriptions()
```

* 清理所有订阅

---

## async sendToMobile(mobilePeerId, message)

```javascript
async sendToMobile(mobilePeerId, message)
```

* 发送消息到移动端

---

## async sendError(mobilePeerId, requestId, errorMessage)

```javascript
async sendError(mobilePeerId, requestId, errorMessage)
```

* 发送错误响应

---

## destroy()

```javascript
destroy()
```

* 清理资源

---

