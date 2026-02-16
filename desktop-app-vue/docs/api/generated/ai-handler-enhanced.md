# ai-handler-enhanced

**Source**: `src/main/remote/handlers/ai-handler-enhanced.js`

**Generated**: 2026-02-16T13:44:34.624Z

---

## const

```javascript
const
```

* AI 命令处理器（增强版）
 *
 * 完整实现 AI 相关命令，集成现有的 LLMManager、RAGManager 和数据库
 *
 * 命令列表：
 * - ai.chat: AI 对话（支持流式响应）
 * - ai.getConversations: 查询对话历史
 * - ai.ragSearch: RAG 知识库搜索
 * - ai.controlAgent: 控制 AI Agent
 * - ai.getModels: 获取可用模型列表
 *
 * @module remote/handlers/ai-handler-enhanced

---

## class AICommandHandlerEnhanced extends EventEmitter

```javascript
class AICommandHandlerEnhanced extends EventEmitter
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
   *
   * 集成 LLMManager，支持多轮对话、流式响应、上下文管理

---

## async getConversations(params, context)

```javascript
async getConversations(params, context)
```

* 查询对话历史
   *
   * 支持分页、搜索、排序

---

## async ragSearch(params, context)

```javascript
async ragSearch(params, context)
```

* RAG 知识库搜索
   *
   * 集成 RAGManager，支持向量检索、重排序、混合搜索

---

## async controlAgent(params, context)

```javascript
async controlAgent(params, context)
```

* 控制 AI Agent
   *
   * 支持启动、停止、查询状态、任务分配

---

## async getModels(params, context)

```javascript
async getModels(params, context)
```

* 获取可用模型列表
   *
   * 支持本地模型（Ollama）和云端模型（OpenAI、Anthropic 等）

---

## async getOllamaModels(includeStatus = true)

```javascript
async getOllamaModels(includeStatus = true)
```

* 获取 Ollama 模型列表

---

## getCloudModels(provider)

```javascript
getCloudModels(provider)
```

* 获取云端模型配置

---

## async startAgent(agentId, taskConfig)

```javascript
async startAgent(agentId, taskConfig)
```

* 启动 Agent

---

## async stopAgent(agentId)

```javascript
async stopAgent(agentId)
```

* 停止 Agent

---

## async getAgentStatus(agentId)

```javascript
async getAgentStatus(agentId)
```

* 获取 Agent 状态

---

## async listAgents()

```javascript
async listAgents()
```

* 列出所有 Agent

---

## getMockAgentResponse(action, agentId, taskConfig)

```javascript
getMockAgentResponse(action, agentId, taskConfig)
```

* 获取模拟 Agent 响应（当 AI Engine Manager 不可用时）

---

## updateAvgResponseTime(responseTime)

```javascript
updateAvgResponseTime(responseTime)
```

* 更新平均响应时间

---

## getMetrics()

```javascript
getMetrics()
```

* 获取性能指标

---

