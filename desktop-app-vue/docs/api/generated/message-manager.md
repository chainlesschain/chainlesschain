# message-manager

**Source**: `src/main/p2p/message-manager.js`

**Generated**: 2026-02-15T10:10:53.399Z

---

## const

```javascript
const
```

* 消息管理器 - 消息去重和批量处理
 *
 * 功能：
 * - 消息ID生成和管理
 * - 消息去重（基于ID）
 * - 批量消息发送
 * - 消息确认和重传
 * - 消息压缩（可选）

---

## generateMessageId()

```javascript
generateMessageId()
```

* 生成消息ID

---

## async sendMessage(peerId, payload, options =

```javascript
async sendMessage(peerId, payload, options =
```

* 发送消息（带去重和批量处理）
   * @param {string} peerId - 目标节点ID
   * @param {Object} payload - 消息内容
   * @param {Object} options - 发送选项

---

## async receiveMessage(peerId, message)

```javascript
async receiveMessage(peerId, message)
```

* 接收消息（带去重）
   * @param {string} peerId - 发送方节点ID
   * @param {Object} message - 消息对象

---

## async receiveBatchMessages(peerId, messages)

```javascript
async receiveBatchMessages(peerId, messages)
```

* 接收批量消息

---

## isDuplicate(messageId)

```javascript
isDuplicate(messageId)
```

* 检查是否重复

---

## queueMessage(peerId, message)

```javascript
queueMessage(peerId, message)
```

* 加入批量队列

---

## scheduleBatchSend(peerId)

```javascript
scheduleBatchSend(peerId)
```

* 计划批量发送

---

## async flushQueue(peerId)

```javascript
async flushQueue(peerId)
```

* 刷新队列（批量发送）

---

## async sendImmediately(peerId, message)

```javascript
async sendImmediately(peerId, message)
```

* 立即发送单条消息

---

## async sendBatch(peerId, messages)

```javascript
async sendBatch(peerId, messages)
```

* 发送批量消息

---

## async sendAck(peerId, messageId)

```javascript
async sendAck(peerId, messageId)
```

* 发送确认

---

## waitForAck(messageId, peerId, message)

```javascript
waitForAck(messageId, peerId, message)
```

* 等待确认

---

## receiveAck(ackFor)

```javascript
receiveAck(ackFor)
```

* 接收确认

---

## async handleAckTimeout(messageId, peerId, message)

```javascript
async handleAckTimeout(messageId, peerId, message)
```

* 处理确认超时

---

## shouldCompress(message)

```javascript
shouldCompress(message)
```

* 判断是否需要压缩

---

## async compressPayload(payload)

```javascript
async compressPayload(payload)
```

* 压缩payload

---

## async decompressPayload(compressedPayload)

```javascript
async decompressPayload(compressedPayload)
```

* 解压缩payload

---

## startCleanupTimer()

```javascript
startCleanupTimer()
```

* 启动清理定时器

---

## cleanupExpiredData()

```javascript
cleanupExpiredData()
```

* 清理过期数据

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## cleanup()

```javascript
cleanup()
```

* 清理资源

---

