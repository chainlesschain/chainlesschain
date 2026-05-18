# conversation

**Source**: `src\renderer\stores\conversation.js`

**Generated**: 2026-01-27T06:44:03.892Z

---

## createNewConversation()

```javascript
createNewConversation()
```

* 创建新对话

---

## async loadConversations(offset = 0, limit = 50)

```javascript
async loadConversations(offset = 0, limit = 50)
```

* 加载对话列表

---

## async loadConversation(conversationId)

```javascript
async loadConversation(conversationId)
```

* 加载指定对话

---

## async saveCurrentConversation()

```javascript
async saveCurrentConversation()
```

* 保存当前对话（批量优化版）

---

## scheduleBatchSave()

```javascript
scheduleBatchSave()
```

* 调度批量保存

---

## async flushPendingMessages()

```javascript
async flushPendingMessages()
```

* 立即保存所有待保存的消息

---

## addMessage(message)

```javascript
addMessage(message)
```

* 添加消息

---

## updateMessage(messageId, updates)

```javascript
updateMessage(messageId, updates)
```

* 更新消息

---

## deleteMessage(messageId)

```javascript
deleteMessage(messageId)
```

* 删除消息

---

## clearCurrentMessages()

```javascript
clearCurrentMessages()
```

* 清空当前对话消息

---

## async updateConversation(conversationId, updates)

```javascript
async updateConversation(conversationId, updates)
```

* 更新对话

---

## async deleteConversation(conversationId)

```javascript
async deleteConversation(conversationId)
```

* 删除对话

---

## searchConversations(query)

```javascript
searchConversations(query)
```

* 搜索对话

---

## exportConversation(conversationId)

```javascript
exportConversation(conversationId)
```

* 导出对话

---

## async importConversation(data)

```javascript
async importConversation(data)
```

* 导入对话

---

## async reset()

```javascript
async reset()
```

* 重置

---

