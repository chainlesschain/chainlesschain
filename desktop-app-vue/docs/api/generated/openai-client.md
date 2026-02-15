# openai-client

**Source**: `src/main/llm/openai-client.js`

**Generated**: 2026-02-15T10:10:53.411Z

---

## const

```javascript
const
```

* OpenAI 兼容 API 客户端
 *
 * 支持: OpenAI, DeepSeek, 以及其他兼容OpenAI API的服务

---

## class OpenAIClient extends EventEmitter

```javascript
class OpenAIClient extends EventEmitter
```

* OpenAI兼容客户端类

---

## async checkStatus()

```javascript
async checkStatus()
```

* 检查服务状态

---

## async chat(messages, options =

```javascript
async chat(messages, options =
```

* 聊天补全（非流式）
   * @param {Array} messages - 消息数组
   * @param {Object} options - 选项

---

## async chatStream(messages, onChunk, options =

```javascript
async chatStream(messages, onChunk, options =
```

* 聊天补全（流式）
   * @param {Array} messages - 消息数组
   * @param {Function} onChunk - 回调函数
   * @param {Object} options - 选项

---

## async complete(prompt, options =

```javascript
async complete(prompt, options =
```

* 文本补全（非流式）- 兼容老版API
   * @param {string} prompt - 提示词
   * @param {Object} options - 选项

---

## async embeddings(input, model = null)

```javascript
async embeddings(input, model = null)
```

* 生成嵌入向量
   * @param {string|Array} input - 文本或文本数组
   * @param {string} model - 模型（可选，默认使用配置的embeddingModel）

---

## async listModels()

```javascript
async listModels()
```

* 列出可用模型

---

## async getModel(modelId)

```javascript
async getModel(modelId)
```

* 获取模型信息
   * @param {string} modelId - 模型ID

---

## _formatAPIError(error)

```javascript
_formatAPIError(error)
```

* 格式化 API 错误为用户友好的消息
   * @param {Error} error - axios 错误对象
   * @returns {string} 用户友好的错误消息

---

## class DeepSeekClient extends OpenAIClient

```javascript
class DeepSeekClient extends OpenAIClient
```

* DeepSeek 客户端 (使用OpenAI兼容API)

---

