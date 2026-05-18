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

## async updateConversation(params, _context)

```javascript
async updateConversation(params, _context)
```

改 conversation 元信息 (title / model / systemPrompt 任一改)。

---

## async archiveConversation(params, _context)

```javascript
async archiveConversation(params, _context)
```

归档 conversation (archived=1)。隐藏在 getConversations 默认列表外。

---

## async searchConversations(params, _context)

```javascript
async searchConversations(params, _context)
```

* 搜 conversation by title / 内容（messages.content LIKE）。
   * archived 默认 false (排除归档)，传 true 仅在归档里找。

---

## async exportConversation(params, _context)

```javascript
async exportConversation(params, _context)
```

* 导出 conversation 完整消息历史。format: markdown (default) / json。

---

## async savePromptTemplate(params, _context)

```javascript
async savePromptTemplate(params, _context)
```

* 创建或更新 prompt template (id 传入则 upsert，缺省自动生成新 id)。
   * variables: 字符串数组，例 ["topic", "tone"] 表示模板含 {{topic}} / {{tone}} 占位。

---

## async ragSearchAdvanced(params, _context)

```javascript
async ragSearchAdvanced(params, _context)
```

* 高级 RAG 检索：含 filters (metadata 过滤) / scoreThreshold (低分截断) / namespace 隔离。
   * 若 ragManager.searchAdvanced 不存在，fallback 到普通 search 然后客户端侧过滤。

---

## async ragIndex(params, _context)

```javascript
async ragIndex(params, _context)
```

手动 index 一段 text 到向量库。docId 可传或自动生成。

---

## async generateImage(params, _context)

```javascript
async generateImage(params, _context)
```

* 文本生图。aiEngine.generateImage(prompt, options) → { images, model }。
   * options 含 size (e.g. "1024x1024") / n (生成张数) / model (engine id)。

---

## async ocrImage(params, _context)

```javascript
async ocrImage(params, _context)
```

* OCR 图像文字识别。imageData (base64) 或 imagePath 二选一。
   * aiEngine.ocrImage(imageOrPath, options) → { text, confidence, language }。

---

## async transcribeAudio(params, _context)

```javascript
async transcribeAudio(params, _context)
```

* 音频转文字。audioData (base64) 或 audioPath 二选一。

---

## async textToSpeech(params, _context)

```javascript
async textToSpeech(params, _context)
```

* 文字转语音 (TTS)。返 base64 audio data + format。

---

## async _chatOnce(systemPrompt, userPrompt, options =

```javascript
async _chatOnce(systemPrompt, userPrompt, options =
```

* 通用内部 helper — 用 aiEngine.chat 跑一次 system+user prompt 拿到 content。
   * 4 个 code helper 都共用此模板，避免重复 chat 失败兜底逻辑。

---

## async generateCode(params, _context)

```javascript
async generateCode(params, _context)
```

自然语言生成代码。

---

## async explainCode(params, _context)

```javascript
async explainCode(params, _context)
```

代码解释。

---

## async refactorCode(params, _context)

```javascript
async refactorCode(params, _context)
```

代码重构。

---

## async fixCode(params, _context)

```javascript
async fixCode(params, _context)
```

代码修 bug，给出错误信息后返修复版本。

---

## async runAgent(params, _context)

```javascript
async runAgent(params, _context)
```

* 跑指定 agent。input 是 agent 起始 prompt；options 可含 timeout / model / contextId。
   * 返 runId 让 caller 可后续 stopAgent / 查询状态。

---

