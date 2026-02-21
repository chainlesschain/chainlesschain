# ai-handler

**Source**: `src/main/remote/handlers/ai-handler.js`

**Generated**: 2026-02-21T22:04:25.792Z

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

