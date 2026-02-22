# group-chat-sync-manager

**Source**: `src/main/sync/group-chat-sync-manager.js`

**Generated**: 2026-02-22T01:23:36.668Z

---

## const

```javascript
const
```

* 群聊同步管理器
 *
 * 功能：
 * - 群聊消息实时同步
 * - 群成员变更同步
 * - 群聊设置同步
 * - 离线消息队列
 * - 消息去重和顺序保证

---

## async syncMessage(groupId, message)

```javascript
async syncMessage(groupId, message)
```

* 同步群聊消息
   * @param {string} groupId - 群聊ID
   * @param {Object} message - 消息对象

---

## async syncMemberChange(groupId, change)

```javascript
async syncMemberChange(groupId, change)
```

* 同步群成员变更
   * @param {string} groupId - 群聊ID
   * @param {Object} change - 变更对象

---

## async syncGroupSettings(groupId, settings)

```javascript
async syncGroupSettings(groupId, settings)
```

* 同步群聊设置
   * @param {string} groupId - 群聊ID
   * @param {Object} settings - 设置对象

---

## async requestHistory(groupId, since = 0, limit = 100)

```javascript
async requestHistory(groupId, since = 0, limit = 100)
```

* 请求群聊历史消息
   * @param {string} groupId - 群聊ID
   * @param {number} since - 起始时间戳
   * @param {number} limit - 消息数量限制

---

## async handleMobileSyncRequest(peerId, payload)

```javascript
async handleMobileSyncRequest(peerId, payload)
```

* 处理来自移动端的群聊同步请求

---

## async saveMessage(groupId, message)

```javascript
async saveMessage(groupId, message)
```

* 保存消息到数据库

---

## async getGroupMembers(groupId)

```javascript
async getGroupMembers(groupId)
```

* 获取群成员列表

---

## async updateGroupSettings(groupId, settings)

```javascript
async updateGroupSettings(groupId, settings)
```

* 更新群聊设置

---

## async sendMessageToMember(memberDid, message)

```javascript
async sendMessageToMember(memberDid, message)
```

* 发送消息给成员

---

## queueMessage(groupId, memberDid, message)

```javascript
queueMessage(groupId, memberDid, message)
```

* 将消息加入队列

---

## async flushMessageQueue(groupId, memberDid)

```javascript
async flushMessageQueue(groupId, memberDid)
```

* 刷新消息队列

---

## isDuplicateMessage(messageId)

```javascript
isDuplicateMessage(messageId)
```

* 检查是否为重复消息

---

## isMemberOnline(groupId, memberDid)

```javascript
isMemberOnline(groupId, memberDid)
```

* 检查成员是否在线

---

## updateMemberStatus(groupId, memberDid, status)

```javascript
updateMemberStatus(groupId, memberDid, status)
```

* 更新成员在线状态

---

## startRealTimeSync()

```javascript
startRealTimeSync()
```

* 启动实时同步

---

## startCleanup()

```javascript
startCleanup()
```

* 启动定期清理

---

## cleanupMessageCache()

```javascript
cleanupMessageCache()
```

* 清理消息缓存

---

## chunkArray(array, size)

```javascript
chunkArray(array, size)
```

* 分块数组

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

