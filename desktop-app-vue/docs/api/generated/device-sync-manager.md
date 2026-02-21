# device-sync-manager

**Source**: `src/main/p2p/device-sync-manager.js`

**Generated**: 2026-02-21T20:04:16.228Z

---

## const

```javascript
const
```

* 设备同步管理器
 *
 * 负责多设备间的消息同步和状态管理
 * 功能: 离线消息队列、消息状态同步、设备间数据同步

---

## const MessageStatus =

```javascript
const MessageStatus =
```

* 消息状态

---

## const SyncMessageType =

```javascript
const SyncMessageType =
```

* 同步消息类型

---

## class DeviceSyncManager extends EventEmitter

```javascript
class DeviceSyncManager extends EventEmitter
```

* 设备同步管理器类

---

## async initialize()

```javascript
async initialize()
```

* 初始化同步管理器

---

## async loadMessageQueue()

```javascript
async loadMessageQueue()
```

* 加载消息队列

---

## async saveMessageQueue()

```javascript
async saveMessageQueue()
```

* 保存消息队列

---

## async loadMessageStatus()

```javascript
async loadMessageStatus()
```

* 加载消息状态

---

## async saveMessageStatus()

```javascript
async saveMessageStatus()
```

* 保存消息状态

---

## async queueMessage(targetDeviceId, message)

```javascript
async queueMessage(targetDeviceId, message)
```

* 将消息加入队列
   * @param {string} targetDeviceId - 目标设备ID
   * @param {Object} message - 消息对象

---

## getDeviceQueue(deviceId)

```javascript
getDeviceQueue(deviceId)
```

* 获取设备的消息队列
   * @param {string} deviceId - 设备ID

---

## async markMessageSent(messageId)

```javascript
async markMessageSent(messageId)
```

* 标记消息已发送
   * @param {string} messageId - 消息ID

---

## async markMessageDelivered(messageId)

```javascript
async markMessageDelivered(messageId)
```

* 标记消息已送达
   * @param {string} messageId - 消息ID

---

## async markMessageRead(messageId)

```javascript
async markMessageRead(messageId)
```

* 标记消息已读
   * @param {string} messageId - 消息ID

---

## async markMessageFailed(messageId, error)

```javascript
async markMessageFailed(messageId, error)
```

* 标记消息发送失败
   * @param {string} messageId - 消息ID
   * @param {string} error - 错误信息

---

## async removeMessage(messageId)

```javascript
async removeMessage(messageId)
```

* 移除已送达的消息
   * @param {string} messageId - 消息ID

---

## updateDeviceStatus(deviceId, status)

```javascript
updateDeviceStatus(deviceId, status)
```

* 更新设备状态
   * @param {string} deviceId - 设备ID
   * @param {Object} status - 设备状态

---

## getDeviceStatus(deviceId)

```javascript
getDeviceStatus(deviceId)
```

* 获取设备状态
   * @param {string} deviceId - 设备ID

---

## startDeviceSync(deviceId)

```javascript
startDeviceSync(deviceId)
```

* 启动设备同步
   * @param {string} deviceId - 设备ID

---

## stopDeviceSync(deviceId)

```javascript
stopDeviceSync(deviceId)
```

* 停止设备同步
   * @param {string} deviceId - 设备ID

---

## async syncDevice(deviceId)

```javascript
async syncDevice(deviceId)
```

* 同步设备消息
   * @param {string} deviceId - 设备ID

---

## startCleanupTimer()

```javascript
startCleanupTimer()
```

* 启动定期清理

---

## async cleanup()

```javascript
async cleanup()
```

* 清理过期消息

---

## generateMessageId()

```javascript
generateMessageId()
```

* 生成消息ID

---

## getStatistics()

```javascript
getStatistics()
```

* 获取统计信息

---

## async close()

```javascript
async close()
```

* 关闭同步管理器

---

