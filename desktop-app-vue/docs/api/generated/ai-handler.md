# ai-handler

**Source**: `src/main/remote/handlers/ai-handler.js`

---

## const

```javascript
const
```

* AI 命令处理器
 *
 * 处理 AI 相关命令：
 * - ai.chat: AI 对话
 * - ai.getConversations: 查询对话历史
 * - ai.ragSearch: RAG 知识库搜索
 * - ai.controlAgent: 控制 AI Agent
 * - ai.getModels: 获取可用模型列表
 *
 * @module remote/handlers/ai-handler

---

## class AICommandHandler

```javascript
class AICommandHandler
```

* AI 命令处理器类

---

## _ensureSchema()

```javascript
_ensureSchema()
```

* 幂等建表 — ai_conversations + ai_messages。
   * iOS Phase 5 Conversation/ChatMessage 字段对齐：
   *   Conversation: id / title / model / messageCount / lastMessageAt / createdAt / archived
   *   ChatMessage:  id / role (user|assistant|system) / content / createdAt / modelUsed / isStreaming

---

## _upsertConversation(conversationId, title, model, systemPrompt)

```javascript
_upsertConversation(conversationId, title, model, systemPrompt)
```

内部：upsert conversation + 自增 messageCount。

---

## _insertMessage(

```javascript
_insertMessage(
```

内部：insert message + 自增 conversation.message_count。

---

## async handle(action, params, context)

```javascript
async handle(action, params, context)
```

* 处理命令（统一入口）

---

## async chat(params, context)

```javascript
async chat(params, context)
```

* AI 对话

---

## async getConversations(params, context)

```javascript
async getConversations(params, context)
```

* 查询对话历史

---

## async ragSearch(params, context)

```javascript
async ragSearch(params, context)
```

* RAG 知识库搜索

---

## async controlAgent(params, context)

```javascript
async controlAgent(params, context)
```

* 控制 AI Agent

---

## async getModels(params, context)

```javascript
async getModels(params, context)
```

* 获取可用模型列表

---

## async chatStream(params, context)

```javascript
async chatStream(params, context)
```

* 启动流式 chat — Phase 5 iOS UI 核心 UX。
   *
   * 返 streamId 给 iOS；后续 iOS 通过 `getStreamChunk(streamId)` 轮询。
   * 内部 Promise 异步驱动 LLMManager.chatStream，chunks 通过 callback 累
   * 积进 activeStreams Map.[streamId].chunks。完成时设 done=true。

---

## async getStreamChunk(params, _context)

```javascript
async getStreamChunk(params, _context)
```

* 拉 streamId 的 buffered chunks（自 sinceChunk 起）。
   *
   * iOS 端按 sinceChunk 递增轮询，桌面返新累积 chunks + isComplete + nextChunkIdx。

---

## async cancelStream(params, _context)

```javascript
async cancelStream(params, _context)
```

取消 in-flight stream — 设 cancelled flag，下次 chunk callback 会被忽略。

---

## async getConversation(params, _context)

```javascript
async getConversation(params, _context)
```

查单个对话 metadata.

---

## async createConversation(params, _context)

```javascript
async createConversation(params, _context)
```

创建空对话 — title/model/systemPrompt 全可选；返 conversationId + Conversation.

---

## async deleteConversation(params, _context)

```javascript
async deleteConversation(params, _context)
```

删除对话 + 所有 messages (FK CASCADE).

---

## async getMessages(params, _context)

```javascript
async getMessages(params, _context)
```

拉对话 messages 列表 (按 createdAt ASC).

---

