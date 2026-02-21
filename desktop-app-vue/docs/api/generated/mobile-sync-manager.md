# mobile-sync-manager

**Source**: `src/main/sync/mobile-sync-manager.js`

**Generated**: 2026-02-21T20:04:16.199Z

---

## const

```javascript
const
```

* 移动端同步管理器
 *
 * 功能：
 * - 桌面端与移动端数据双向同步
 * - 群聊消息同步
 * - 知识库同步
 * - 联系人同步
 * - 增量同步和冲突解决
 * - 离线队列管理

---

## async registerMobileDevice(deviceId, peerId, deviceInfo)

```javascript
async registerMobileDevice(deviceId, peerId, deviceInfo)
```

* 注册移动设备
   * @param {string} deviceId - 设备ID
   * @param {string} peerId - P2P节点ID
   * @param {Object} deviceInfo - 设备信息

---

## unregisterMobileDevice(deviceId)

```javascript
unregisterMobileDevice(deviceId)
```

* 注销移动设备
   * @param {string} deviceId - 设备ID

---

## async startSync(deviceId, options =

```javascript
async startSync(deviceId, options =
```

* 开始同步
   * @param {string} deviceId - 目标设备ID
   * @param {Object} options - 同步选项

---

## async syncKnowledge(deviceId, since)

```javascript
async syncKnowledge(deviceId, since)
```

* 同步知识库

---

## async syncContacts(deviceId, since)

```javascript
async syncContacts(deviceId, since)
```

* 同步联系人

---

## async syncGroupChats(deviceId, since)

```javascript
async syncGroupChats(deviceId, since)
```

* 同步群聊

---

## async syncMessages(deviceId, since)

```javascript
async syncMessages(deviceId, since)
```

* 同步消息

---

## async getKnowledgeChanges(since)

```javascript
async getKnowledgeChanges(since)
```

* 获取知识库变更

---

## async getContactsChanges(since)

```javascript
async getContactsChanges(since)
```

* 获取联系人变更

---

## async getGroupChatsChanges(since)

```javascript
async getGroupChatsChanges(since)
```

* 获取群聊变更

---

## async getMessagesChanges(since)

```javascript
async getMessagesChanges(since)
```

* 获取消息变更

---

## async handleMobileSyncRequest(deviceId, payload)

```javascript
async handleMobileSyncRequest(deviceId, payload)
```

* 处理来自移动端的同步请求

---

## async applyKnowledgeChanges(changes)

```javascript
async applyKnowledgeChanges(changes)
```

* 应用知识库变更

---

## async applyContactsChanges(changes)

```javascript
async applyContactsChanges(changes)
```

* 应用联系人变更

---

## async applyGroupChatsChanges(changes)

```javascript
async applyGroupChatsChanges(changes)
```

* 应用群聊变更

---

## async applyMessagesChanges(changes)

```javascript
async applyMessagesChanges(changes)
```

* 应用消息变更

---

## updateProgress(deviceId, type, progress)

```javascript
updateProgress(deviceId, type, progress)
```

* 更新同步进度

---

## chunkArray(array, size)

```javascript
chunkArray(array, size)
```

* 分块数组

---

## startAutoSync()

```javascript
startAutoSync()
```

* 启动自动同步

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## getMobileDevices()

```javascript
getMobileDevices()
```

* 获取移动设备列表

---

## cleanup()

```javascript
cleanup()
```

* 清理资源

---

